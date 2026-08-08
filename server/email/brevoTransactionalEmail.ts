import { createHash } from "node:crypto";
import { z } from "zod";
import {
  TransactionalEmailError,
  validateTransactionalEmail,
  type TransactionalEmailMessage,
  type TransactionalEmailProvider,
  type TransactionalEmailReceipt,
} from "./transactionalEmail.js";

export interface BrevoTransactionalEmailConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  endpoint?: string;
  timeoutMs?: number;
}

const responseSchema = z.object({ messageId: z.string().min(1) });

// A stable private namespace keeps Buildy's durable logical key out of the
// provider payload while producing the UUID Brevo requires for retries.
const BREVO_IDEMPOTENCY_NAMESPACE = Buffer.from(
  "673d2b65e15b4cddba2ba297f3669da3",
  "hex",
);

export function brevoIdempotencyKey(logicalKey: string): string {
  const bytes = createHash("sha1")
    .update(BREVO_IDEMPOTENCY_NAMESPACE)
    .update(logicalKey)
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canonicalBrevoMessageId(value: string): string {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
  if (!/^[\x21-\x7e]{1,500}$/.test(unwrapped)) {
    throw new TransactionalEmailError(
      "PROVIDER_UNAVAILABLE",
      "Brevo gaf een ongeldig bericht-ID terug.",
      true,
    );
  }
  return unwrapped;
}

export class BrevoTransactionalEmailProvider implements TransactionalEmailProvider {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: BrevoTransactionalEmailConfig,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!config.apiKey || !config.senderEmail || !config.senderName) {
      throw new TransactionalEmailError("INVALID_MESSAGE", "Brevo-configuratie is onvolledig.", false);
    }
    this.endpoint = config.endpoint ?? "https://api.brevo.com/v3/smtp/email";
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async send(message: TransactionalEmailMessage): Promise<TransactionalEmailReceipt> {
    const validated = validateTransactionalEmail(message);
    let response: Response;

    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": this.config.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.config.senderEmail, name: this.config.senderName },
          to: [validated.recipient],
          ...(validated.content !== undefined
            ? {
              subject: validated.content.subject,
              htmlContent: validated.content.html,
              textContent: validated.content.text,
            }
            : {
              templateId: validated.templateId,
              params: validated.parameters,
            }),
          headers: { idempotencyKey: brevoIdempotencyKey(validated.idempotencyKey) },
          tags: validated.tags,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TransactionalEmailError(
        "PROVIDER_UNAVAILABLE",
        "Brevo kon niet worden bereikt.",
        true,
        { cause: error },
      );
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new TransactionalEmailError(
        response.status === 429 ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE",
        `Brevo weigerde het bericht met status ${response.status}.`,
        retryable,
      );
    }

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new TransactionalEmailError(
        "PROVIDER_UNAVAILABLE",
        "Brevo gaf een ongeldig antwoord terug.",
        true,
        { cause: parsed.error },
      );
    }

    return {
      provider: "brevo",
      messageId: canonicalBrevoMessageId(parsed.data.messageId),
      acceptedAt: new Date().toISOString(),
    };
  }
}

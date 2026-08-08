import { z } from "zod";

const emailAddressSchema = z.string().trim().email().max(254);
const idempotencyKeySchema = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const templateParameterSchema: z.ZodType<EmailTemplateParameter> = z.lazy(() =>
  z.union([
    z.string().max(10_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(templateParameterSchema).max(100),
    z.record(templateParameterSchema),
  ]),
);

export type EmailTemplateParameter =
  | string
  | number
  | boolean
  | null
  | EmailTemplateParameter[]
  | { [key: string]: EmailTemplateParameter };

interface TransactionalEmailMessageBase {
  recipient: {
    email: string;
    name?: string;
  };
  idempotencyKey: string;
  tags?: string[];
}

export type TransactionalEmailMessage = TransactionalEmailMessageBase & (
  | {
    templateId: number;
    parameters: Record<string, EmailTemplateParameter>;
    content?: never;
  }
  | {
    templateId?: never;
    parameters?: never;
    content: {
      subject: string;
      html: string;
      text: string;
    };
  }
);

export interface TransactionalEmailReceipt {
  provider: "brevo" | "local";
  messageId: string;
  acceptedAt: string;
}

export interface TransactionalEmailProvider {
  send(message: TransactionalEmailMessage): Promise<TransactionalEmailReceipt>;
}

export class TransactionalEmailError extends Error {
  constructor(
    public readonly code: "INVALID_EMAIL" | "INVALID_MESSAGE" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE",
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TransactionalEmailError";
  }
}

export function validateTransactionalEmail(message: TransactionalEmailMessage): TransactionalEmailMessage {
  const baseSchema = z.object({
    recipient: z.object({
      email: emailAddressSchema,
      name: z.string().trim().min(1).max(120).optional(),
    }),
    idempotencyKey: idempotencyKeySchema,
    tags: z.array(z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/)).max(10).optional(),
  });
  const schema = z.union([
    baseSchema.extend({
      templateId: z.number().int().positive(),
      parameters: z.record(templateParameterSchema),
      content: z.never().optional(),
    }),
    baseSchema.extend({
      templateId: z.never().optional(),
      parameters: z.never().optional(),
      content: z.object({
        subject: z.string().trim().min(1).max(160),
        html: z.string().min(1).max(500_000),
        text: z.string().min(1).max(100_000),
      }).strict(),
    }),
  ]);

  const parsed = schema.safeParse(message);
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((issue) => issue.path.join(".").startsWith("recipient.email"));
    throw new TransactionalEmailError(
      emailIssue ? "INVALID_EMAIL" : "INVALID_MESSAGE",
      "E-mailbericht voldoet niet aan het providercontract.",
      false,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export class MemoryEmailSink implements TransactionalEmailProvider {
  readonly messages: TransactionalEmailMessage[] = [];

  async send(message: TransactionalEmailMessage): Promise<TransactionalEmailReceipt> {
    const validated = validateTransactionalEmail(message);
    this.messages.push(structuredClone(validated));
    return {
      provider: "local",
      messageId: `local:${validated.idempotencyKey}`,
      acceptedAt: new Date().toISOString(),
    };
  }
}

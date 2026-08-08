import { z } from "zod";
import type { AuthEmailKind } from "../auth/outbox.js";
import {
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../security/dataProtection.js";
import type { TransactionalEmailMessage } from "./transactionalEmail.js";
import {
  EmailTemplateCatalog,
  templateKeyForAuthEmail,
  type EmailTemplateKey,
} from "./templates.js";

const authEmailKindSchema = z.enum(["verify_email", "magic_link", "reset_password"]);
const protectedPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  kind: authEmailKindSchema,
  authUserIdHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  recipientCiphertext: z.string().min(1).max(200_000),
  actionUrlCiphertext: z.string().min(1).max(200_000),
}).strict();

const claimedEventSchema = z.object({
  id: z.string().uuid(),
  aggregateId: z.string().uuid(),
  aggregateType: z.literal("auth_email"),
  eventType: z.string().regex(/^auth\.email\.(verify_email|magic_link|reset_password)$/),
  idempotencyKey: z.string().regex(/^auth-email:v1:(verify_email|magic_link|reset_password):[0-9a-f]{64}$/),
  payload: z.record(z.unknown()),
  attemptCount: z.number().int().nonnegative(),
});

export type ClaimedAuthEmailEvent = z.infer<typeof claimedEventSchema>;

export interface PreparedAuthEmail {
  delivery: {
    idempotencyKey: string;
    recipientHash: string;
    templateKey: EmailTemplateKey;
    templateVersion: string;
  };
  message: TransactionalEmailMessage;
}

export class AuthEmailPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthEmailPayloadError";
  }
}

function expectedEventType(kind: AuthEmailKind): string {
  return `auth.email.${kind}`;
}

export function prepareAuthEmail(
  rawEvent: unknown,
  keyring: DataProtectionKeyring,
  blindIndex: PrivacyBlindIndex,
  templates: EmailTemplateCatalog,
): { event: ClaimedAuthEmailEvent; prepared: PreparedAuthEmail } {
  try {
    const event = claimedEventSchema.parse(rawEvent);
    const payload = protectedPayloadSchema.parse(event.payload);
    if (event.eventType !== expectedEventType(payload.kind)) {
      throw new AuthEmailPayloadError("Eventtype en e-mailpayload komen niet overeen.");
    }

    const expectedKeyPrefix = `auth-email:v1:${payload.kind}:`;
    if (!event.idempotencyKey.startsWith(expectedKeyPrefix)) {
      throw new AuthEmailPayloadError("E-mail-idempotentiesleutel en payload komen niet overeen.");
    }

    const context = `auth-outbox:${event.aggregateId}:${payload.kind}`;
    const recipient = keyring.decrypt(payload.recipientCiphertext, `${context}:recipient`);
    const actionUrl = keyring.decrypt(payload.actionUrlCiphertext, `${context}:action-url`);
    const templateKey = templateKeyForAuthEmail(payload.kind);
    const template = templates.resolve(templateKey);

    return {
      event,
      prepared: {
        delivery: {
          idempotencyKey: event.idempotencyKey,
          recipientHash: blindIndex.create("email-recipient", recipient),
          templateKey,
          templateVersion: template.version,
        },
        message: {
          recipient: { email: recipient },
          templateId: template.id,
          parameters: { actionUrl },
          idempotencyKey: event.idempotencyKey,
          tags: ["auth", payload.kind],
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthEmailPayloadError) throw error;
    throw new AuthEmailPayloadError("Beschermde auth-e-mailpayload is ongeldig.", { cause: error });
  }
}

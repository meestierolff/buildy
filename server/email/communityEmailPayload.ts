import { z } from "zod";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import { renderTransactionalEmail } from "./render.js";
import type { EmailTemplateCatalog, EmailTemplateKey } from "./templates.js";
import type { TransactionalEmailMessage } from "./transactionalEmail.js";

const communityKindSchema = z.enum(["support", "third_party_request", "appeal"]);
const moderationTargetSchema = z.enum(["profile", "project", "update", "media", "comment"]);
const supportCategorySchema = z.enum([
  "account",
  "privacy",
  "safety",
  "order",
  "technical",
  "content_appeal",
  "other",
]);

const eventSchema = z.object({
  id: z.string().uuid(),
  aggregateId: z.string().uuid(),
  aggregateType: z.enum(["moderation_report", "feedback_submission"]),
  eventType: z.string().min(1).max(120),
  idempotencyKey: z.string().min(16).max(160),
  payload: z.record(z.unknown()),
  attemptCount: z.number().int().nonnegative(),
}).strict();

const moderationPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  reportId: z.string().uuid(),
  receiptCode: z.string().regex(/^MELD-[A-Z0-9]{8}$/),
}).strict();

const supportPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  submissionId: z.string().uuid(),
  kind: communityKindSchema,
  receiptCode: z.string().regex(/^HELP-[A-Z0-9]{8}$/),
}).strict();

export const communityEmailContextSchema = z.object({
  aggregateType: z.enum(["moderation_report", "feedback_submission"]),
  aggregateId: z.string().uuid(),
  recipientCiphertext: z.string().min(1).max(200_000),
  contactHash: z.string().regex(/^[0-9a-f]{64}$/),
  receiptCode: z.string().regex(/^(?:MELD|HELP)-[A-Z0-9]{8}$/),
  kind: communityKindSchema.nullable(),
  createdAt: z.coerce.date(),
  targetType: moderationTargetSchema.nullable(),
  category: supportCategorySchema.nullable(),
}).strict();

export type CommunityEmailContext = z.infer<typeof communityEmailContextSchema>;

export interface PreparedCommunityEmail {
  delivery: {
    idempotencyKey: string;
    recipientHash: string;
    templateKey: EmailTemplateKey;
    templateVersion: string;
  };
  message: TransactionalEmailMessage;
}

export class CommunityEmailPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CommunityEmailPayloadError";
  }
}

function supportKindLabel(kind: z.infer<typeof communityKindSchema>): string {
  switch (kind) {
    case "support":
      return "Supportvraag";
    case "third_party_request":
      return "Verzoek van een derde";
    case "appeal":
      return "Bezwaar";
  }
}

export function prepareCommunityEmail(input: {
  rawEvent: unknown;
  rawContext: unknown;
  keyring: DataProtectionKeyring;
  blindIndex: PrivacyBlindIndex;
  templates: EmailTemplateCatalog;
}): { event: z.infer<typeof eventSchema>; prepared: PreparedCommunityEmail } {
  try {
    const event = eventSchema.parse(input.rawEvent);
    const context = communityEmailContextSchema.parse(input.rawContext);
    if (event.aggregateType !== context.aggregateType || event.aggregateId !== context.aggregateId) {
      throw new CommunityEmailPayloadError("Community-event en ontvangstcontext komen niet overeen.");
    }

    let templateKey: EmailTemplateKey;
    let recipientAad: string;
    let content: ReturnType<typeof renderTransactionalEmail>;

    if (event.aggregateType === "moderation_report") {
      const payload = moderationPayloadSchema.parse(event.payload);
      const expectedIdempotencyKey = `moderation-report:${event.aggregateId}:email:received:v1`;
      if (
        event.eventType !== "moderation.report.received.requested.v1"
        || event.idempotencyKey !== expectedIdempotencyKey
        || payload.reportId !== event.aggregateId
        || payload.receiptCode !== context.receiptCode
        || context.kind !== null
        || context.targetType === null
        || context.category !== null
      ) {
        throw new CommunityEmailPayloadError("Meldingsbevestiging bevat tegenstrijdige metadata.");
      }
      templateKey = "moderation.report_received";
      recipientAad = `moderation-report:${event.aggregateId}:contact`;
      content = renderTransactionalEmail({
        subject: `Je melding ${context.receiptCode} is ontvangen`,
        previewText: "Buildy heeft je melding veilig ontvangen.",
        heading: "Bedankt voor je melding",
        paragraphs: [
          "We hebben je melding ontvangen en beoordelen die volgens onze huisregels en ons contentbeleid.",
          "Bewaar de ontvangstcode hieronder wanneer je later contact met ons opneemt. Deze bevestiging bevat bewust geen kopie van je melding.",
        ],
        facts: [{ label: "Ontvangstcode", value: context.receiptCode }],
        closing: "Stuur geen extra privégegevens per e-mail. Gebruik voor aanvullende informatie het beveiligde contactkanaal van Buildy.",
      });
    } else {
      const payload = supportPayloadSchema.parse(event.payload);
      const expectedIdempotencyKey = `feedback-submission:${event.aggregateId}:email:confirmation:v1`;
      if (
        event.eventType !== "support.confirmation.requested.v1"
        || event.idempotencyKey !== expectedIdempotencyKey
        || payload.submissionId !== event.aggregateId
        || payload.receiptCode !== context.receiptCode
        || payload.kind !== context.kind
        || context.kind === null
        || context.targetType !== null
        || context.category === null
      ) {
        throw new CommunityEmailPayloadError("Supportbevestiging bevat tegenstrijdige metadata.");
      }
      templateKey = "support.confirmation";
      recipientAad = `feedback-submission:${event.aggregateId}:contact`;
      content = renderTransactionalEmail({
        subject: `Je verzoek ${context.receiptCode} is ontvangen`,
        previewText: "Buildy heeft je verzoek veilig ontvangen.",
        heading: "We hebben je verzoek ontvangen",
        paragraphs: [
          "Dank je wel. Ons team beoordeelt je verzoek en reageert via het contactadres dat je veilig hebt opgegeven.",
          "Bewaar de ontvangstcode hieronder. Deze bevestiging bevat bewust geen kopie van je bericht.",
        ],
        facts: [
          { label: "Ontvangstcode", value: context.receiptCode },
          { label: "Soort verzoek", value: supportKindLabel(context.kind) },
        ],
        closing: "Stuur geen wachtwoorden, betaalgegevens of andere gevoelige informatie per e-mail.",
      });
    }

    const recipient = z.string().trim().email().max(254).parse(
      input.keyring.decrypt(context.recipientCiphertext, recipientAad),
    );
    if (!input.blindIndex.matches("email-recipient", recipient, context.contactHash)) {
      throw new CommunityEmailPayloadError("Contactadres en blind index komen niet overeen.");
    }
    const template = input.templates.resolve(templateKey);

    return {
      event,
      prepared: {
        delivery: {
          idempotencyKey: event.idempotencyKey,
          recipientHash: context.contactHash,
          templateKey,
          templateVersion: template.version,
        },
        message: {
          recipient: { email: recipient },
          content,
          idempotencyKey: event.idempotencyKey,
          tags: event.aggregateType === "moderation_report"
            ? ["community", "moderation-receipt"]
            : ["community", "support-receipt"],
        },
      },
    };
  } catch (error) {
    if (error instanceof CommunityEmailPayloadError) throw error;
    throw new CommunityEmailPayloadError("Beschermde community-e-mailpayload is ongeldig.", {
      cause: error,
    });
  }
}

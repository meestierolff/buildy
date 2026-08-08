import { z } from "zod";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import { renderTransactionalEmail } from "./render.js";
import type { EmailTemplateCatalog, EmailTemplateKey } from "./templates.js";
import type { TransactionalEmailMessage } from "./transactionalEmail.js";

const aggregateTypeSchema = z.enum([
  "account_lifecycle",
  "project_access",
  "account_security",
  "identity_migration",
]);

const eventSchema = z.object({
  id: z.string().uuid(),
  aggregateId: z.string().uuid(),
  aggregateType: aggregateTypeSchema,
  eventType: z.enum([
    "lifecycle.welcome.requested.v1",
    "social.access_requested.requested.v1",
    "social.access_accepted.requested.v1",
    "security.account_alert.requested.v1",
    "migration.account.requested.v1",
  ]),
  idempotencyKey: z.string().min(16).max(160),
  payload: z.record(z.unknown()),
  attemptCount: z.number().int().nonnegative(),
}).strict();

const welcomePayloadSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.string().uuid(),
}).strict();

const accessPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  projectId: z.string().uuid(),
}).strict();

const securityPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  deletionJobId: z.string().uuid(),
  accountAction: z.literal("deletion_requested"),
}).strict();

const migrationPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.string().uuid(),
}).strict();

export const accountEventEmailContextSchema = z.object({
  aggregateType: aggregateTypeSchema,
  aggregateId: z.string().uuid(),
  recipientUserId: z.string().uuid(),
  recipientCiphertext: z.string().min(1).max(200_000),
  recipientHash: z.string().regex(/^[0-9a-f]{64}$/),
  displayName: z.string().trim().min(1).max(80),
  actorDisplayName: z.string().trim().min(1).max(80).nullable(),
  projectTitle: z.string().trim().min(1).max(160).nullable(),
  createdAt: z.coerce.date(),
}).strict();

export type AccountEventEmailContext = z.infer<typeof accountEventEmailContextSchema>;

export interface PreparedAccountEventEmail {
  delivery: {
    idempotencyKey: string;
    recipientHash: string;
    templateKey: EmailTemplateKey;
    templateVersion: string;
  };
  message: TransactionalEmailMessage;
}

export class AccountEventEmailPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AccountEventEmailPayloadError";
  }
}

function appUrl(appOrigin: string, path: string): string {
  const origin = new URL(appOrigin);
  if (
    origin.protocol !== "https:"
    || origin.username
    || origin.password
    || origin.pathname !== "/"
    || origin.search
    || origin.hash
  ) {
    throw new AccountEventEmailPayloadError("De publieke app-origin voor e-mail is ongeldig.");
  }
  return new URL(path, origin).toString();
}

function expectedMetadata(input: {
  event: z.infer<typeof eventSchema>;
  context: AccountEventEmailContext;
  appOrigin: string;
}): {
  templateKey: EmailTemplateKey;
  idempotencyKey: string;
  content: ReturnType<typeof renderTransactionalEmail>;
  tags: string[];
} {
  const { event, context, appOrigin } = input;

  if (event.aggregateType === "account_lifecycle") {
    const payload = welcomePayloadSchema.parse(event.payload);
    const idempotencyKey = `account:${context.recipientUserId}:email:welcome:v1`;
    if (
      event.eventType !== "lifecycle.welcome.requested.v1"
      || event.aggregateId !== context.recipientUserId
      || payload.userId !== context.recipientUserId
      || event.idempotencyKey !== idempotencyKey
      || context.actorDisplayName !== null
      || context.projectTitle !== null
    ) throw new AccountEventEmailPayloadError("Welkomstmail bevat tegenstrijdige metadata.");

    return {
      templateKey: "lifecycle.welcome",
      idempotencyKey,
      tags: ["lifecycle", "welcome"],
      content: renderTransactionalEmail({
        subject: "Welkom bij Buildy",
        previewText: "Je Buildy-account is klaar voor je eerste verbouwingsproject.",
        heading: `Welkom, ${context.displayName}`,
        paragraphs: [
          "Je account is succesvol geactiveerd. Vanaf nu kun je je verbouwing stap voor stap vastleggen en veilig delen.",
          "Begin met een project en voeg daarna updates, foto’s en belangrijke momenten toe wanneer het jou uitkomt.",
        ],
        callToAction: { label: "Start je eerste project", url: appUrl(appOrigin, "/project/nieuw") },
        closing: "Dit is een eenmalig servicebericht na je eerste succesvolle aanmelding.",
      }),
    };
  }

  if (event.aggregateType === "project_access") {
    const payload = accessPayloadSchema.parse(event.payload);
    const requested = event.eventType === "social.access_requested.requested.v1";
    const expectedType = requested
      ? "social.access_requested.requested.v1"
      : "social.access_accepted.requested.v1";
    const suffix = requested ? "requested" : "accepted";
    const idempotencyKey = `access-request:${event.aggregateId}:email:${suffix}:v1`;
    if (
      event.eventType !== expectedType
      || payload.requestId !== event.aggregateId
      || context.aggregateId !== event.aggregateId
      || context.actorDisplayName === null
      || context.projectTitle === null
      || event.idempotencyKey !== idempotencyKey
    ) throw new AccountEventEmailPayloadError("Toegangsmail bevat tegenstrijdige metadata.");

    return requested ? {
      templateKey: "social.access_requested",
      idempotencyKey,
      tags: ["social", "access-requested"],
      content: renderTransactionalEmail({
        subject: `${context.actorDisplayName} vraagt toegang tot ${context.projectTitle}`,
        previewText: "Er staat een nieuw toegangsverzoek klaar in Buildy.",
        heading: "Nieuw toegangsverzoek",
        paragraphs: [
          `${context.actorDisplayName} wil het besloten project ‘${context.projectTitle}’ bekijken.`,
          "Open Buildy om het verzoek te accepteren of af te wijzen. Deel geen projectinformatie door op deze e-mail te antwoorden.",
        ],
        callToAction: { label: "Bekijk het verzoek", url: appUrl(appOrigin, `/project/${payload.projectId}?toegang=1`) },
      }),
    } : {
      templateKey: "social.access_accepted",
      idempotencyKey,
      tags: ["social", "access-accepted"],
      content: renderTransactionalEmail({
        subject: `Je hebt toegang tot ${context.projectTitle}`,
        previewText: "Je toegangsverzoek is geaccepteerd.",
        heading: "Je toegangsverzoek is geaccepteerd",
        paragraphs: [
          `${context.actorDisplayName} heeft je toegang gegeven tot het besloten project ‘${context.projectTitle}’.`,
          "Je kunt het project nu in Buildy bekijken. De eigenaar kan deze toegang later altijd weer intrekken.",
        ],
        callToAction: { label: "Bekijk het project", url: appUrl(appOrigin, `/project/${payload.projectId}`) },
      }),
    };
  }

  if (event.aggregateType === "account_security") {
    const payload = securityPayloadSchema.parse(event.payload);
    const idempotencyKey = `deletion-job:${event.aggregateId}:email:security-requested:v1`;
    if (
      event.eventType !== "security.account_alert.requested.v1"
      || payload.deletionJobId !== event.aggregateId
      || event.idempotencyKey !== idempotencyKey
      || context.actorDisplayName !== null
      || context.projectTitle !== null
    ) throw new AccountEventEmailPayloadError("Beveiligingsmail bevat tegenstrijdige metadata.");

    return {
      templateKey: "security.account_alert",
      idempotencyKey,
      tags: ["security", "account-alert"],
      content: renderTransactionalEmail({
        subject: "Verwijderverzoek voor je Buildy-account",
        previewText: "Er is een verzoek gestart om je Buildy-account te verwijderen.",
        heading: "Controleer dit accountverzoek",
        paragraphs: [
          "Er is een verzoek geregistreerd om je Buildy-account te verwijderen. Afhankelijk van actieve bestellingen kan de uitvoering tijdelijk worden uitgesteld.",
          "Heb je dit niet zelf gedaan? Meld dit direct via het beveiligde supportkanaal en controleer je actieve sessies.",
        ],
        callToAction: { label: "Controleer je account", url: appUrl(appOrigin, "/account") },
        closing: "Buildy vraagt nooit per e-mail om je wachtwoord, herstelcode of betaalgegevens.",
      }),
    };
  }

  const payload = migrationPayloadSchema.parse(event.payload);
  const idempotencyKey = `account:${context.recipientUserId}:email:migration:v1`;
  if (
    event.aggregateType !== "identity_migration"
    || event.eventType !== "migration.account.requested.v1"
    || event.aggregateId !== context.recipientUserId
    || payload.userId !== context.recipientUserId
    || event.idempotencyKey !== idempotencyKey
    || context.actorDisplayName !== null
    || context.projectTitle !== null
  ) throw new AccountEventEmailPayloadError("Accountmigratiemail bevat tegenstrijdige metadata.");

  return {
    templateKey: "migration.account",
    idempotencyKey,
    tags: ["migration", "account"],
    content: renderTransactionalEmail({
      subject: "Je Buildy-account verhuist veilig mee",
      previewText: "Activeer je bestaande Buildy-account in de vernieuwde omgeving.",
      heading: "Activeer je vernieuwde Buildy-account",
      paragraphs: [
        "Je bestaande projecten en updates zijn gekoppeld aan de vernieuwde Buildy-omgeving. Oude wachtwoorden en sessies zijn uit veiligheid niet overgenomen.",
        "Open Buildy om je identiteit opnieuw te bevestigen. Afhankelijk van je eerdere inlogmethode stel je een nieuw wachtwoord in of koppel je je aanbieder opnieuw.",
      ],
      callToAction: { label: "Activeer mijn account", url: appUrl(appOrigin, "/auth?migratie=1") },
      closing: "Gebruik alleen deze officiële Buildy-route en deel nooit een inlogcode met iemand anders.",
    }),
  };
}

export function prepareAccountEventEmail(input: {
  rawEvent: unknown;
  rawContext: unknown;
  keyring: DataProtectionKeyring;
  blindIndex: PrivacyBlindIndex;
  templates: EmailTemplateCatalog;
  appOrigin: string;
}): { event: z.infer<typeof eventSchema>; prepared: PreparedAccountEventEmail } {
  try {
    const event = eventSchema.parse(input.rawEvent);
    const context = accountEventEmailContextSchema.parse(input.rawContext);
    if (event.aggregateType !== context.aggregateType || event.aggregateId !== context.aggregateId) {
      throw new AccountEventEmailPayloadError("Account-event en leasecontext komen niet overeen.");
    }

    const metadata = expectedMetadata({ event, context, appOrigin: input.appOrigin });
    const recipient = z.string().trim().email().max(254).parse(input.keyring.decrypt(
      context.recipientCiphertext,
      `email-recipient:${context.recipientUserId}:address`,
    ));
    if (!input.blindIndex.matches("email-recipient", recipient, context.recipientHash)) {
      throw new AccountEventEmailPayloadError("Ontvanger en blind index komen niet overeen.");
    }
    const template = input.templates.resolve(metadata.templateKey);

    return {
      event,
      prepared: {
        delivery: {
          idempotencyKey: metadata.idempotencyKey,
          recipientHash: context.recipientHash,
          templateKey: metadata.templateKey,
          templateVersion: template.version,
        },
        message: {
          recipient: { email: recipient, name: context.displayName },
          content: metadata.content,
          idempotencyKey: metadata.idempotencyKey,
          tags: metadata.tags,
        },
      },
    };
  } catch (error) {
    if (error instanceof AccountEventEmailPayloadError) throw error;
    throw new AccountEventEmailPayloadError("Beschermde account-e-mailpayload is ongeldig.", {
      cause: error,
    });
  }
}

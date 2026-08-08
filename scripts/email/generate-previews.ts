import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareAccountEventEmail } from "../../server/email/accountEventEmailPayload";
import { buildOrderConfirmationEmail } from "../../server/email/render";
import { EmailTemplateCatalog } from "../../server/email/templates";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";

const outputDirectory = resolve(process.cwd(), "artifacts/email");
const preview = buildOrderConfirmationEmail({
  orderNumber: "BLD-TEST-00000001",
  orderDate: "4 augustus 2026 om 12:15",
  bookVariant: "Bouwboek “Synthetisch testproject” · A4 liggend hardcover",
  pageCount: 48,
  quantity: 2,
  subtotal: "€ 80,00",
  vatStatus: "€ 18,27 inbegrepen",
  shipping: "€ 6,95",
  total: "€ 105,22",
  currency: "EUR",
  deliveryEstimate: "5–8 werkdagen na productie",
  shippingDestination: "TESTONTVANGER, TESTADRES — NIET BEZORGEN, 0000 ZZ Teststad, NL",
  sellerLegalIdentity: "SYNTHETISCHE TESTVERKOPER B.V. · TEST-KVK-00000000 · TEST-BTW-NL000000000B00",
  sellerContact: "Buildy testomgeving · support@example.test · TESTADRES — NIET BEZORGEN",
  acceptedTermsVersion: "synthetic-terms-v1",
  customizationNotice: "Gepersonaliseerd testproduct; dit artifact is geen echte bestelling of juridisch bewijs.",
  orderStatusUrl: "https://app.buildy.test/bestellingen/10000000-0000-4000-8000-000000000001",
});

const userId = "10000000-0000-4000-8000-000000000101";
const requestId = "10000000-0000-4000-8000-000000000102";
const projectId = "10000000-0000-4000-8000-000000000103";
const deletionJobId = "10000000-0000-4000-8000-000000000104";
const keyring = new DataProtectionKeyring({
  currentVersion: 1,
  keys: { 1: Buffer.alloc(32, 31).toString("base64") },
});
const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 32).toString("base64"));
const syntheticRecipient = "synthetic-account@example.test";
const recipientCiphertext = keyring.encrypt(
  syntheticRecipient,
  `email-recipient:${userId}:address`,
);
const recipientHash = blindIndex.create("email-recipient", syntheticRecipient);
const templates = new EmailTemplateCatalog({
  "lifecycle.welcome": { id: 1, version: "synthetic-v1" },
  "social.access_requested": { id: 2, version: "synthetic-v1" },
  "social.access_accepted": { id: 3, version: "synthetic-v1" },
  "security.account_alert": { id: 4, version: "synthetic-v1" },
  "migration.account": { id: 5, version: "synthetic-v1" },
});

const accountPreviews = [
  {
    filename: "lifecycle-welcome",
    event: {
      aggregateId: userId,
      aggregateType: "account_lifecycle",
      eventType: "lifecycle.welcome.requested.v1",
      idempotencyKey: `account:${userId}:email:welcome:v1`,
      payload: { schemaVersion: 1, userId },
    },
    context: { aggregateType: "account_lifecycle", aggregateId: userId },
  },
  {
    filename: "social-access-requested",
    event: {
      aggregateId: requestId,
      aggregateType: "project_access",
      eventType: "social.access_requested.requested.v1",
      idempotencyKey: `access-request:${requestId}:email:requested:v1`,
      payload: { schemaVersion: 1, requestId, projectId },
    },
    context: {
      aggregateType: "project_access",
      aggregateId: requestId,
      actorDisplayName: "Synthetische aanvrager",
      projectTitle: "Synthetisch testproject",
    },
  },
  {
    filename: "social-access-accepted",
    event: {
      aggregateId: requestId,
      aggregateType: "project_access",
      eventType: "social.access_accepted.requested.v1",
      idempotencyKey: `access-request:${requestId}:email:accepted:v1`,
      payload: { schemaVersion: 1, requestId, projectId },
    },
    context: {
      aggregateType: "project_access",
      aggregateId: requestId,
      actorDisplayName: "Synthetische eigenaar",
      projectTitle: "Synthetisch testproject",
    },
  },
  {
    filename: "security-account-alert",
    event: {
      aggregateId: deletionJobId,
      aggregateType: "account_security",
      eventType: "security.account_alert.requested.v1",
      idempotencyKey: `deletion-job:${deletionJobId}:email:security-requested:v1`,
      payload: { schemaVersion: 1, deletionJobId, accountAction: "deletion_requested" },
    },
    context: { aggregateType: "account_security", aggregateId: deletionJobId },
  },
  {
    filename: "migration-account",
    event: {
      aggregateId: userId,
      aggregateType: "identity_migration",
      eventType: "migration.account.requested.v1",
      idempotencyKey: `account:${userId}:email:migration:v1`,
      payload: { schemaVersion: 1, userId },
    },
    context: { aggregateType: "identity_migration", aggregateId: userId },
  },
].map((entry) => {
  const prepared = prepareAccountEventEmail({
    rawEvent: {
      id: "10000000-0000-4000-8000-000000000199",
      ...entry.event,
      attemptCount: 1,
    },
    rawContext: {
      recipientUserId: userId,
      recipientCiphertext,
      recipientHash,
      displayName: "Synthetische bewoner",
      actorDisplayName: null,
      projectTitle: null,
      createdAt: new Date("2026-08-04T12:00:00.000Z"),
      ...entry.context,
    },
    keyring,
    blindIndex,
    templates,
    appOrigin: "https://app.buildy.test",
  }).prepared.message.content;
  if (!prepared) throw new Error("Synthetische accountmail heeft geen repo-owned inhoud.");
  return { filename: entry.filename, preview: prepared };
});

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(outputDirectory, "order-confirmation.synthetic.html"),
    `<!-- SYNTHETIC TEST ARTIFACT: contains no real customer, order, seller or address data. -->\n${preview.html}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "order-confirmation.synthetic.txt"),
    `SYNTHETIC TEST ARTIFACT — GEEN ECHTE BESTELLING OF PERSOONSGEGEVENS\n\n${preview.text}\n`,
    "utf8",
  ),
  ...accountPreviews.flatMap(({ filename, preview: accountPreview }) => [
    writeFile(
      resolve(outputDirectory, `${filename}.synthetic.html`),
      `<!-- SYNTHETIC TEST ARTIFACT: contains no real account or recipient data. -->\n${accountPreview.html}\n`,
      "utf8",
    ),
    writeFile(
      resolve(outputDirectory, `${filename}.synthetic.txt`),
      `SYNTHETIC TEST ARTIFACT — GEEN ECHT ACCOUNT OF PERSOONSGEGEVENS\n\n${accountPreview.text}\n`,
      "utf8",
    ),
  ]),
]);

process.stdout.write(`E-mailpreviews geschreven naar ${outputDirectory}\n`);

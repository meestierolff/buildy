// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  prepareAccountEventEmail,
  type AccountEventEmailContext,
} from "../../server/email/accountEventEmailPayload";
import { enqueueMigrationAccountEmail } from "../../server/email/migrationAccountProducer";
import { EmailTemplateCatalog } from "../../server/email/templates";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";

const USER_ID = "10000000-0000-4000-8000-000000000101";
const ACTOR_ID = "10000000-0000-4000-8000-000000000102";
const PROJECT_ID = "10000000-0000-4000-8000-000000000103";
const REQUEST_ID = "10000000-0000-4000-8000-000000000104";
const JOB_ID = "10000000-0000-4000-8000-000000000105";
const EMAIL = "bewoner@example.test";

function dependencies() {
  const keyring = new DataProtectionKeyring({
    currentVersion: 1,
    keys: { 1: Buffer.alloc(32, 21).toString("base64") },
  });
  const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 22).toString("base64"));
  const templates = new EmailTemplateCatalog({
    "lifecycle.welcome": { id: 1, version: "repo-v1" },
    "social.access_requested": { id: 2, version: "repo-v1" },
    "social.access_accepted": { id: 3, version: "repo-v1" },
    "security.account_alert": { id: 4, version: "repo-v1" },
    "migration.account": { id: 5, version: "repo-v1" },
  });
  return { keyring, blindIndex, templates };
}

function context(
  aggregateType: AccountEventEmailContext["aggregateType"],
  aggregateId: string,
  overrides: Partial<AccountEventEmailContext> = {},
): AccountEventEmailContext {
  const { keyring, blindIndex } = dependencies();
  return {
    aggregateType,
    aggregateId,
    recipientUserId: USER_ID,
    recipientCiphertext: keyring.encrypt(EMAIL, `email-recipient:${USER_ID}:address`),
    recipientHash: blindIndex.create("email-recipient", EMAIL),
    displayName: "Testbewoner",
    actorDisplayName: null,
    projectTitle: null,
    createdAt: new Date("2026-08-04T12:00:00.000Z"),
    ...overrides,
  };
}

describe("account and social transactional e-mail payloads", () => {
  const cases = [
    {
      aggregateId: USER_ID,
      aggregateType: "account_lifecycle" as const,
      eventType: "lifecycle.welcome.requested.v1",
      idempotencyKey: `account:${USER_ID}:email:welcome:v1`,
      payload: { schemaVersion: 1, userId: USER_ID },
      templateKey: "lifecycle.welcome",
      expectedText: "Welkom, Testbewoner",
      expectedPath: "/project/nieuw",
      context: context("account_lifecycle", USER_ID),
    },
    {
      aggregateId: REQUEST_ID,
      aggregateType: "project_access" as const,
      eventType: "social.access_requested.requested.v1",
      idempotencyKey: `access-request:${REQUEST_ID}:email:requested:v1`,
      payload: { schemaVersion: 1, requestId: REQUEST_ID, projectId: PROJECT_ID },
      templateKey: "social.access_requested",
      expectedText: "Nieuw toegangsverzoek",
      expectedPath: `/project/${PROJECT_ID}?toegang=1`,
      context: context("project_access", REQUEST_ID, {
        actorDisplayName: "Andere verbouwer",
        projectTitle: "Keukenproject",
      }),
    },
    {
      aggregateId: REQUEST_ID,
      aggregateType: "project_access" as const,
      eventType: "social.access_accepted.requested.v1",
      idempotencyKey: `access-request:${REQUEST_ID}:email:accepted:v1`,
      payload: { schemaVersion: 1, requestId: REQUEST_ID, projectId: PROJECT_ID },
      templateKey: "social.access_accepted",
      expectedText: "Je toegangsverzoek is geaccepteerd",
      expectedPath: `/project/${PROJECT_ID}`,
      context: context("project_access", REQUEST_ID, {
        actorDisplayName: "Projecteigenaar",
        projectTitle: "Keukenproject",
      }),
    },
    {
      aggregateId: JOB_ID,
      aggregateType: "account_security" as const,
      eventType: "security.account_alert.requested.v1",
      idempotencyKey: `deletion-job:${JOB_ID}:email:security-requested:v1`,
      payload: { schemaVersion: 1, deletionJobId: JOB_ID, accountAction: "deletion_requested" },
      templateKey: "security.account_alert",
      expectedText: "Controleer dit accountverzoek",
      expectedPath: "/account",
      context: context("account_security", JOB_ID),
    },
    {
      aggregateId: USER_ID,
      aggregateType: "identity_migration" as const,
      eventType: "migration.account.requested.v1",
      idempotencyKey: `account:${USER_ID}:email:migration:v1`,
      payload: { schemaVersion: 1, userId: USER_ID },
      templateKey: "migration.account",
      expectedText: "Activeer je vernieuwde Buildy-account",
      expectedPath: "/auth?migratie=1",
      context: context("identity_migration", USER_ID),
    },
  ];

  for (const emailCase of cases) {
    it(`renders Dutch repo-owned content for ${emailCase.templateKey}`, () => {
      const { keyring, blindIndex, templates } = dependencies();
      const result = prepareAccountEventEmail({
        rawEvent: {
          id: "10000000-0000-4000-8000-000000000199",
          aggregateId: emailCase.aggregateId,
          aggregateType: emailCase.aggregateType,
          eventType: emailCase.eventType,
          idempotencyKey: emailCase.idempotencyKey,
          payload: emailCase.payload,
          attemptCount: 1,
        },
        rawContext: emailCase.context,
        keyring,
        blindIndex,
        templates,
        appOrigin: "https://app.buildy.test",
      });

      expect(result.prepared.delivery).toMatchObject({
        idempotencyKey: emailCase.idempotencyKey,
        templateKey: emailCase.templateKey,
        templateVersion: "repo-v1",
      });
      expect(result.prepared.message).toMatchObject({
        recipient: { email: EMAIL, name: "Testbewoner" },
        content: {
          html: expect.stringContaining('lang="nl"'),
          text: expect.stringContaining(emailCase.expectedText),
        },
      });
      const content = result.prepared.message.content;
      expect(content).toBeDefined();
      if (!content) throw new Error("Expected repo-owned account e-mail content");
      expect(content.html).toContain(
        `https://app.buildy.test${emailCase.expectedPath}`,
      );
      expect(content.text).toContain(
        `https://app.buildy.test${emailCase.expectedPath}`,
      );
      expect(JSON.stringify(content)).not.toMatch(/\/trips?\//);
      expect(JSON.stringify(content)).not.toContain(EMAIL);
    });
  }

  it("fails closed when ciphertext is copied to another AAD-bound user", () => {
    const { keyring, blindIndex, templates } = dependencies();
    const rawContext = context("account_lifecycle", ACTOR_ID, { recipientUserId: ACTOR_ID });
    expect(() => prepareAccountEventEmail({
      rawEvent: {
        id: "10000000-0000-4000-8000-000000000199",
        aggregateId: ACTOR_ID,
        aggregateType: "account_lifecycle",
        eventType: "lifecycle.welcome.requested.v1",
        idempotencyKey: `account:${ACTOR_ID}:email:welcome:v1`,
        payload: { schemaVersion: 1, userId: ACTOR_ID },
        attemptCount: 1,
      },
      rawContext,
      keyring,
      blindIndex,
      templates,
      appOrigin: "https://app.buildy.test",
    })).toThrow("Beschermde account-e-mailpayload is ongeldig");
  });

  it("rejects an app origin with a path so CTA routes cannot be silently rebased", () => {
    const { keyring, blindIndex, templates } = dependencies();
    expect(() => prepareAccountEventEmail({
      rawEvent: {
        id: "10000000-0000-4000-8000-000000000199",
        aggregateId: USER_ID,
        aggregateType: "account_lifecycle",
        eventType: "lifecycle.welcome.requested.v1",
        idempotencyKey: `account:${USER_ID}:email:welcome:v1`,
        payload: { schemaVersion: 1, userId: USER_ID },
        attemptCount: 1,
      },
      rawContext: context("account_lifecycle", USER_ID),
      keyring,
      blindIndex,
      templates,
      appOrigin: "https://app.buildy.test/onverwacht",
    })).toThrow("publieke app-origin");
  });
});

describe("migration account e-mail producer", () => {
  it("passes only AAD-bound ciphertext and a blind index to PostgreSQL", async () => {
    const { keyring, blindIndex } = dependencies();
    const query = vi.fn(async (_queryText: string, values: readonly unknown[]) => {
      expect(values[0]).toBe(USER_ID);
      expect(values[1]).toEqual(expect.stringMatching(/^v1\./));
      expect(values[1]).not.toContain(EMAIL);
      expect(values[2]).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
      return { rows: [{ queued: true, replayed: false }] };
    });

    await expect(enqueueMigrationAccountEmail(
      { query },
      keyring,
      blindIndex,
      { appUserId: USER_ID, email: EMAIL },
    )).resolves.toEqual({ queued: true, replayed: false });
    expect(JSON.stringify(await query.mock.results[0]?.value)).not.toContain(EMAIL);
  });
});

// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Moderation-tests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let savepointSequence = 0;
async function expectDatabaseError(
  client: Client,
  statement: string,
  parameters: unknown[],
  expectedCode: string,
): Promise<void> {
  savepointSequence += 1;
  const savepoint = `moderation_boundary_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught: unknown;
  try {
    await client.query(statement, parameters);
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  expect(caught).toBeDefined();
  expect(
    typeof caught === "object" && caught !== null && "code" in caught
      ? String(caught.code)
      : undefined,
  ).toBe(expectedCode);
}

describeWithDatabase("moderation/support PostgreSQL boundary", () => {
  it("permits only visibility-checked encrypted intake and writes PII-free events", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const reporterId = randomUUID();
    const publicOwnerId = randomUUID();
    const privateOwnerId = randomUUID();
    const reportId = randomUUID();
    const hiddenReportId = randomUUID();
    const supportId = randomUUID();
    const reportRequestHash = digest(`report-request:${reportId}`);
    const reportIdempotency = `community-command:v1:moderation.report:${digest(`report-key:${reportId}`)}`;
    const supportIdempotency = `community-command:v1:support.submit:${digest(`support-key:${supportId}`)}`;
    const sourceHash = digest(`source:${reportId}`);
    const contactHash = digest(`contact:${reportId}`);
    const reportReceiptCode = `MELD-${reportId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const supportReceiptCode = `HELP-${supportId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`
        INSERT INTO app_users (id, status) VALUES
          ($1, 'active'), ($2, 'active'), ($3, 'active')
      `, [reporterId, publicOwnerId, privateOwnerId]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Melder', $4, true),
          ($2, 'Openbaar doel', $5, false),
          ($3, 'Privédoel', $6, true)
      `, [
        reporterId,
        publicOwnerId,
        privateOwnerId,
        `mod-reporter-${reporterId}`,
        `mod-public-${publicOwnerId}`,
        `mod-private-${privateOwnerId}`,
      ]);

      await client.query(`SET LOCAL ROLE "${webRole}"`);
      await client.query("SELECT set_config('app.actor_id', $1, true)", [reporterId]);

      await expectDatabaseError(client, `
        INSERT INTO moderation_reports (
          reporter_id, target_type, target_id, reason, target_snapshot_ciphertext,
          policy_version, source_fingerprint_hash, receipt_code
        ) VALUES ($1, 'profile', $2, 'spam', 'v1.1.forged', 'content-policy-test', $3, 'MELD-FORGED00')
      `, [reporterId, publicOwnerId, sourceHash], "42501");

      const receipt = await client.query<{
        id: string;
        replayed: boolean;
      }>(`
        SELECT id, replayed
        FROM app_submit_moderation_report(
          $1, $2, $3, 'profile', $4, 'privacy', $5, $6, $7, $8,
          $9, 'content-policy-test', '/profiel/test', $10, $11, $12
        )
      `, [
        reportId,
        reportIdempotency,
        reportRequestHash,
        publicOwnerId,
        "v1.1.encrypted-details",
        "v1.1.encrypted-contact",
        contactHash,
        sourceHash,
        "v1.1.encrypted-target-snapshot",
        reportReceiptCode,
        digest(`ip:${reportId}`),
        digest(`ua:${reportId}`),
      ]);
      expect(receipt.rows[0]).toEqual({
        id: reportId,
        replayed: false,
      });

      const visible = await client.query<{
        details: string | null;
        details_ciphertext: string;
        reporter_contact_ciphertext: string;
      }>(`
        SELECT details, details_ciphertext, reporter_contact_ciphertext
        FROM moderation_reports WHERE id = $1
      `, [reportId]);
      expect(visible.rows[0]).toEqual({
        details: null,
        details_ciphertext: "v1.1.encrypted-details",
        reporter_contact_ciphertext: "v1.1.encrypted-contact",
      });

      await client.query("SELECT set_config('app.actor_id', '', true)");
      await expectDatabaseError(client, `
        SELECT * FROM app_submit_moderation_report(
          $1, $2, $3, 'profile', $4, 'spam', NULL, NULL, NULL, $5,
          'v1.1.encrypted-hidden-snapshot', 'content-policy-test', '/profiel/private',
          $6, NULL, NULL
        )
      `, [
        hiddenReportId,
        `community-command:v1:moderation.report:${digest(`hidden:${hiddenReportId}`)}`,
        digest(`hidden-request:${hiddenReportId}`),
        privateOwnerId,
        digest(`hidden-source:${hiddenReportId}`),
        `MELD-${hiddenReportId.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
      ], "42501");

      const support = await client.query<{ id: string; kind: string }>(`
        SELECT id, kind FROM app_submit_feedback_submission(
          $1, $2, $3, 'third_party_request', 'privacy', $4, $5, $6, $7,
          '/support', 'unknown', 'support-privacy-test', $8, NULL, NULL
        )
      `, [
        supportId,
        supportIdempotency,
        digest(`support-request:${supportId}`),
        "v1.1.encrypted-support-message",
        "v1.1.encrypted-support-contact",
        digest(`support-contact:${supportId}`),
        digest(`support-source:${supportId}`),
        supportReceiptCode,
      ]);
      expect(support.rows[0]).toEqual({ id: supportId, kind: "third_party_request" });
      expect((await client.query("SELECT id FROM feedback_submissions WHERE id = $1", [supportId])).rowCount)
        .toBe(0);

      await client.query("RESET ROLE");
      const events = await client.query<{
        event_type: string;
        payload: Record<string, unknown>;
      }>(`
        SELECT event_type, payload FROM outbox_events
        WHERE aggregate_id = ANY($1::uuid[])
        ORDER BY event_type
      `, [[reportId, supportId]]);
      expect(events.rows).toEqual([]);
      const serializedEvents = JSON.stringify(events.rows);
      expect(serializedEvents).not.toContain("encrypted-contact");
      expect(serializedEvents).not.toContain("encrypted-support-message");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

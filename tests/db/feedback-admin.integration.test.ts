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
    throw new Error("Feedbackbeheer-tests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function postgresCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function seedSubmission(
  client: Client,
  id: string,
  submittedById: string | null,
  marker: string,
): Promise<void> {
  await client.query(`
    INSERT INTO feedback_submissions (
      id, submitted_by_id, kind, category, message_ciphertext,
      contact_ciphertext, contact_hash, source_fingerprint_hash,
      receipt_code, privacy_notice_version
    ) VALUES (
      $1, $2, 'support', 'privacy', $3, $4, $5, $6, $7, 'support-test-v1'
    )
  `, [
    id,
    submittedById,
    `v1.1.encrypted-message-${marker}`,
    `v1.1.encrypted-contact-${marker}`,
    digest(`contact:${marker}`),
    digest(`source:${marker}`),
    `HELP-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
  ]);
}

describeWithDatabase("feedback admin PostgreSQL boundary", () => {
  it("keeps PII out of the queue, denies moderators and applies audited idempotent transitions", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const adminId = randomUUID();
    const moderatorId = randomUUID();
    const submissionId = randomUUID();
    const reviewId = randomUUID();
    const requestHash = digest(`request:${submissionId}`);
    const idempotencyKey = `feedback-admin-command:v1:${digest(`command:${submissionId}`)}`;

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')", [
        adminId,
        moderatorId,
      ]);
      await client.query(`
        INSERT INTO app_role_grants (
          id, app_user_id, role, operator_reference, reason_code
        ) VALUES
          ($1, $2, 'admin', 'ci:feedback', 'integration_test'),
          ($3, $4, 'moderator', 'ci:feedback', 'integration_test')
      `, [randomUUID(), adminId, randomUUID(), moderatorId]);
      await seedSubmission(client, submissionId, null, "private-pii-marker");

      await client.query(`SET LOCAL ROLE "${webRole}"`);
      await client.query("SELECT set_config('app.actor_id', $1, true)", [moderatorId]);
      await client.query("SAVEPOINT moderator_denial");
      let moderatorError: unknown;
      try {
        await client.query(`
          SELECT * FROM app_admin_list_feedback_submissions('new', NULL, NULL, NULL, 20)
        `);
      } catch (error) {
        moderatorError = error;
      }
      await client.query("ROLLBACK TO SAVEPOINT moderator_denial");
      expect(postgresCode(moderatorError)).toBe("42501");

      await client.query("RESET ROLE");
      await client.query(`SET LOCAL ROLE "${webRole}"`);
      await client.query("SELECT set_config('app.actor_id', $1, true)", [adminId]);
      const queue = await client.query<{ payload: Record<string, unknown> }>(`
        SELECT to_jsonb(item) AS payload
        FROM app_admin_list_feedback_submissions('new', 'support', NULL, NULL, 20) item
        WHERE item.id = $1
      `, [submissionId]);
      expect(queue.rows[0]?.payload).toMatchObject({
        id: submissionId,
        kind: "support",
        category: "privacy",
        status: "new",
        version: 1,
        has_contact: true,
      });
      for (const field of [
        "message",
        "message_ciphertext",
        "contact_ciphertext",
        "contact_hash",
        "request_hash",
        "source_fingerprint_hash",
        "submitted_by_id",
        "route",
      ]) {
        expect(queue.rows[0]?.payload).not.toHaveProperty(field);
      }
      const detail = await client.query<{ message_ciphertext: string; contact_ciphertext: string }>(`
        SELECT message_ciphertext, contact_ciphertext
        FROM app_admin_load_feedback_submission($1)
      `, [submissionId]);
      expect(detail.rows[0]).toEqual({
        message_ciphertext: "v1.1.encrypted-message-private-pii-marker",
        contact_ciphertext: "v1.1.encrypted-contact-private-pii-marker",
      });

      const first = await client.query<{ status: string; version: number; replayed: boolean }>(`
        SELECT status::text, version, replayed
        FROM app_admin_update_feedback_status($1, $2, 'triaged', 1, $3, $4, $5)
      `, [submissionId, reviewId, idempotencyKey, requestHash, randomUUID()]);
      expect(first.rows[0]).toEqual({ status: "triaged", version: 2, replayed: false });
      const replay = await client.query<{ replayed: boolean }>(`
        SELECT replayed
        FROM app_admin_update_feedback_status($1, $2, 'triaged', 1, $3, $4, $5)
      `, [submissionId, randomUUID(), idempotencyKey, requestHash, randomUUID()]);
      expect(replay.rows[0]?.replayed).toBe(true);

      await client.query("RESET ROLE");
      const reviews = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count FROM feedback_submission_reviews WHERE submission_id = $1
      `, [submissionId]);
      expect(reviews.rows[0]?.count).toBe("1");
      const audits = await client.query<{ metadata: Record<string, unknown> }>(`
        SELECT metadata FROM audit_events
        WHERE resource_id = $1 AND action = 'feedback.review.status_changed'
      `, [submissionId]);
      expect(audits).toHaveProperty("rowCount", 1);
      expect(JSON.stringify(audits.rows)).not.toMatch(/private-pii-marker|message|contact|ciphertext/i);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });

  it("erases linked feedback content while leaving unrelated anonymous feedback intact", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const accountId = randomUUID();
    const linkedId = randomUUID();
    const anonymousId = randomUUID();

    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO app_users (id, status) VALUES ($1, 'deletion_pending')", [accountId]);
      await seedSubmission(client, linkedId, accountId, "linked-private");
      await seedSubmission(client, anonymousId, null, "anonymous-unrelated");
      await client.query("SELECT set_config('app.actor_id', $1, true)", [accountId]);
      await client.query(`
        UPDATE feedback_submissions SET submitted_by_id = NULL WHERE id = $1
      `, [linkedId]);

      const linked = await client.query<Record<string, unknown>>(`
        SELECT message, message_ciphertext, contact_ciphertext, contact_hash,
          source_fingerprint_hash, screenshot_asset_id, submitted_by_id
        FROM feedback_submissions WHERE id = $1
      `, [linkedId]);
      expect(linked.rows[0]).toEqual({
        message: "[verwijderd na accountverwijdering]",
        message_ciphertext: null,
        contact_ciphertext: null,
        contact_hash: null,
        source_fingerprint_hash: null,
        screenshot_asset_id: null,
        submitted_by_id: null,
      });
      const anonymous = await client.query<{ message_ciphertext: string; contact_ciphertext: string }>(`
        SELECT message_ciphertext, contact_ciphertext FROM feedback_submissions WHERE id = $1
      `, [anonymousId]);
      expect(anonymous.rows[0]).toEqual({
        message_ciphertext: "v1.1.encrypted-message-anonymous-unrelated",
        contact_ciphertext: "v1.1.encrypted-contact-anonymous-unrelated",
      });
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

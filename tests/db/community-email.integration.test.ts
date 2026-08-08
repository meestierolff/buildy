// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createBuildyDatabase } from "../../server/db/client";
import { PostgresEmailWorkerRepository } from "../../server/email/postgresWorkerRepository";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const emailDatabaseUrl = process.env.DATABASE_SECURITY_EMAIL_WORKER_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && emailDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Communitymail-integratietests mogen uitsluitend op een lokale tijdelijke database draaien.");
  }
}

describeWithDatabase("community e-mail PostgreSQL boundary", () => {
  it("keeps contact PII behind the exact lease and supports anonymous delivery records", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(emailDatabaseUrl!);

    const submissionId = randomUUID();
    const eventId = randomUUID();
    const receiptCode = `HELP-${submissionId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const idempotencyKey = `feedback-submission:${submissionId}:email:confirmation:v1`;
    const contactHash = "a".repeat(64);
    const contactCiphertext = "v1.1.integration-encrypted-contact";

    const admin = new Client({ connectionString: adminDatabaseUrl });
    const resources = createBuildyDatabase(emailDatabaseUrl!, {
      applicationName: "buildy-community-email-integration",
      maxConnections: 1,
    });
    const repository = new PostgresEmailWorkerRepository(resources.database);
    await admin.connect();

    try {
      await admin.query(`
        INSERT INTO feedback_submissions (
          id, submitted_by_id, kind, category, message, message_ciphertext,
          contact_ciphertext, contact_hash, idempotency_key, request_hash,
          source_fingerprint_hash, route, user_agent_family,
          privacy_notice_version, receipt_code, status
        ) VALUES (
          $1, NULL, 'support', 'technical', NULL, $2, $3, $4,
          $5, $6, $7, '/support', 'unknown', 'privacy-integration-v1', $8, 'new'
        )
      `, [
        submissionId,
        "v1.1.integration-encrypted-message",
        contactCiphertext,
        contactHash,
        `community-command:v1:support.submit:${"b".repeat(64)}`,
        "c".repeat(64),
        "d".repeat(64),
        receiptCode,
      ]);
      await admin.query(`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, idempotency_key, payload
        ) VALUES (
          $1, 'feedback_submission', $2, 'support.confirmation.requested.v1',
          $3, jsonb_build_object(
            'schemaVersion', 1,
            'submissionId', $2::uuid,
            'kind', 'support',
            'receiptCode', $4::text
          )
        )
      `, [eventId, submissionId, idempotencyKey, receiptCode]);

      await expect(resources.pool.query("select contact_ciphertext from feedback_submissions"))
        .rejects.toThrow();
      await expect(repository.loadCommunityEmailContext({
        eventId,
        leaseOwner: "wrong-lease-owner",
      })).resolves.toBeUndefined();

      const claimed = await repository.claim({
        batchSize: 25,
        leaseOwner: "community-email-worker",
        leaseSeconds: 90,
      });
      expect(claimed).toContainEqual(expect.objectContaining({
        id: eventId,
        aggregateId: submissionId,
        aggregateType: "feedback_submission",
        eventType: "support.confirmation.requested.v1",
        idempotencyKey,
        payload: {
          schemaVersion: 1,
          submissionId,
          kind: "support",
          receiptCode,
        },
        attemptCount: 1,
      }));
      expect(JSON.stringify(claimed)).not.toContain("integration-encrypted-contact");

      const context = await repository.loadCommunityEmailContext({
        eventId,
        leaseOwner: "community-email-worker",
      });
      expect(context).toMatchObject({
        aggregateType: "feedback_submission",
        aggregateId: submissionId,
        recipientCiphertext: contactCiphertext,
        contactHash,
        receiptCode,
        kind: "support",
        targetType: null,
        category: "technical",
      });

      await expect(repository.prepareDelivery({
        eventId,
        leaseOwner: "community-email-worker",
        idempotencyKey,
        recipientHash: contactHash,
        templateKey: "support.confirmation",
        templateVersion: "content-integration-v1",
      })).resolves.toMatchObject({ status: "queued" });
      await repository.complete({
        eventId,
        leaseOwner: "community-email-worker",
        receipt: {
          provider: "brevo",
          messageId: `integration-${eventId}`,
          acceptedAt: new Date().toISOString(),
        },
      });

      const persisted = await admin.query<{
        recipient_user_id: string | null;
        delivery_status: string;
        outbox_status: string;
      }>(`
        SELECT
          delivery.recipient_user_id,
          delivery.status::text AS delivery_status,
          queued.status::text AS outbox_status
        FROM email_deliveries delivery
        JOIN outbox_events queued ON queued.id = delivery.outbox_event_id
        WHERE queued.id = $1
      `, [eventId]);
      expect(persisted.rows).toEqual([{
        recipient_user_id: null,
        delivery_status: "submitted",
        outbox_status: "delivered",
      }]);
    } finally {
      await resources.pool.end();
      await admin.end();
    }
  });
});

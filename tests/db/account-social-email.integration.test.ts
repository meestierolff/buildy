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
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)
    || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Accountmail-integratietests mogen uitsluitend op een lokale tijdelijke database draaien.");
  }
}

describeWithDatabase("account and social e-mail PostgreSQL boundary", () => {
  it("produces once, respects leases and never grants direct recipient-table access", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(emailDatabaseUrl!);

    const ownerId = randomUUID();
    const requesterId = randomUUID();
    const authUserId = `auth-${randomUUID()}`;
    const projectId = randomUUID();
    const accessRequestId = randomUUID();
    const deletionJobId = randomUUID();
    const ownerHash = "a".repeat(64);
    const requesterHash = "b".repeat(64);
    const ownerCiphertext = "v1.1.integration-owner-ciphertext";
    const requesterCiphertext = "v1.1.integration-requester-ciphertext";
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const resources = createBuildyDatabase(emailDatabaseUrl!, {
      applicationName: "buildy-account-email-integration",
      maxConnections: 1,
    });
    const repository = new PostgresEmailWorkerRepository(resources.database);
    await admin.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')", [ownerId, requesterId]);
      await admin.query(`
        INSERT INTO profiles (user_id, display_name, slug)
        VALUES ($1, 'Projecteigenaar', $2), ($3, 'Aanvrager', $4)
      `, [ownerId, `owner-${ownerId}`, requesterId, `requester-${requesterId}`]);
      await admin.query(`
        INSERT INTO auth_users (id, name, email, email_verified)
        VALUES ($1, 'Aanvrager', 'integration-requester@example.test', true)
      `, [authUserId]);
      await admin.query(`
        INSERT INTO auth_identity_mappings (
          app_user_id, auth_user_id, legacy_provider, legacy_subject_id,
          migration_status, linked_at
        ) VALUES ($1, $2, 'legacy_auth', $2, 'linked', now())
      `, [requesterId, authUserId]);
      await admin.query(`
        INSERT INTO email_recipient_profiles (
          user_id, recipient_ciphertext, recipient_hash, social_access_enabled
        ) VALUES ($1, $2, $3, true), ($4, $5, $6, true)
      `, [ownerId, ownerCiphertext, ownerHash, requesterId, requesterCiphertext, requesterHash]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status,
          content_revision, published_at
        ) VALUES ($1, $2, $3, 'Integratieproject', 'private', 'active', 1, now())
      `, [projectId, ownerId, `account-mail-${projectId}`]);

      await admin.query("UPDATE app_users SET last_authenticated_at = now() WHERE id = $1", [requesterId]);
      await admin.query("UPDATE app_users SET last_authenticated_at = now() WHERE id = $1", [requesterId]);
      await admin.query(`
        INSERT INTO project_access_requests (
          id, project_id, project_owner_id, requester_id, status
        ) VALUES ($1, $2, $3, $4, 'pending')
      `, [accessRequestId, projectId, ownerId, requesterId]);
      await admin.query(`
        UPDATE project_access_requests
        SET status = 'accepted', decided_by_id = $1, decided_at = now(), version = version + 1
        WHERE id = $2
      `, [ownerId, accessRequestId]);
      await admin.query(`
        INSERT INTO deletion_jobs (
          id, kind, target_id, requested_by_id, status, idempotency_key,
          retention_policy_version
        ) VALUES ($1, 'account', $2, $2, 'requested', $3, 'integration-v1')
      `, [deletionJobId, requesterId, `delete-${deletionJobId}`]);

      const firstMigration = await admin.query<{ queued: boolean; replayed: boolean }>(
        "SELECT * FROM app_enqueue_migration_account_email($1, $2, $3)",
        [requesterId, requesterCiphertext, requesterHash],
      );
      const replayedMigration = await admin.query<{ queued: boolean; replayed: boolean }>(
        "SELECT * FROM app_enqueue_migration_account_email($1, $2, $3)",
        [requesterId, requesterCiphertext, requesterHash],
      );
      expect(firstMigration.rows).toEqual([{ queued: true, replayed: false }]);
      expect(replayedMigration.rows).toEqual([{ queued: true, replayed: true }]);

      const counts = await admin.query<{ event_type: string; count: string }>(`
        SELECT event_type, count(*)::text AS count
        FROM outbox_events
        WHERE aggregate_id = ANY($1::uuid[])
        GROUP BY event_type
      `, [[requesterId, accessRequestId, deletionJobId]]);
      expect(new Map(counts.rows.map((row) => [row.event_type, row.count]))).toEqual(new Map([
        ["lifecycle.welcome.requested.v1", "1"],
        ["social.access_requested.requested.v1", "1"],
        ["social.access_accepted.requested.v1", "1"],
        ["security.account_alert.requested.v1", "1"],
        ["migration.account.requested.v1", "1"],
      ]));

      await expect(resources.pool.query("select recipient_ciphertext from email_recipient_profiles"))
        .rejects.toThrow();
      const requestedEvent = await admin.query<{ id: string }>(`
        SELECT id FROM outbox_events
        WHERE aggregate_id = $1 AND event_type = 'social.access_requested.requested.v1'
      `, [accessRequestId]);
      const requestedEventId = requestedEvent.rows[0]!.id;
      await expect(repository.loadAccountEventEmailContext({
        eventId: requestedEventId,
        leaseOwner: "wrong-account-email-lease",
      })).resolves.toBeUndefined();

      const claimed = await repository.claim({
        batchSize: 25,
        leaseOwner: "account-email-worker",
        leaseSeconds: 90,
      });
      const relevantClaimed = claimed.filter((event) => (
        (event.aggregateType === "account_lifecycle" && event.aggregateId === requesterId)
        || (event.aggregateType === "identity_migration" && event.aggregateId === requesterId)
        || (event.aggregateType === "project_access" && event.aggregateId === accessRequestId)
        || (event.aggregateType === "account_security" && event.aggregateId === deletionJobId)
      ));
      expect(relevantClaimed).toHaveLength(5);
      expect(relevantClaimed.map((event) => event.eventType).sort()).toEqual([
        "lifecycle.welcome.requested.v1",
        "migration.account.requested.v1",
        "security.account_alert.requested.v1",
        "social.access_accepted.requested.v1",
        "social.access_requested.requested.v1",
      ]);
      expect(JSON.stringify(claimed)).not.toContain("integration-owner-ciphertext");
      const loaded = await repository.loadAccountEventEmailContext({
        eventId: requestedEventId,
        leaseOwner: "account-email-worker",
      });
      expect(loaded).toMatchObject({
        aggregateType: "project_access",
        aggregateId: accessRequestId,
        recipientUserId: ownerId,
        recipientCiphertext: ownerCiphertext,
        recipientHash: ownerHash,
        displayName: "Projecteigenaar",
        actorDisplayName: "Aanvrager",
        projectTitle: "Integratieproject",
      });
      await expect(repository.prepareDelivery({
        eventId: requestedEventId,
        leaseOwner: "account-email-worker",
        idempotencyKey: `access-request:${accessRequestId}:email:requested:v1`,
        recipientHash: ownerHash,
        templateKey: "social.access_requested",
        templateVersion: "integration-v1",
      })).resolves.toMatchObject({ status: "queued" });
    } finally {
      await admin.query("DELETE FROM email_deliveries WHERE outbox_event_id IN (SELECT id FROM outbox_events WHERE aggregate_id = ANY($1::uuid[]))", [[requesterId, accessRequestId, deletionJobId]]).catch(() => undefined);
      await admin.query("DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])", [[requesterId, accessRequestId, deletionJobId]]).catch(() => undefined);
      await admin.query("DELETE FROM deletion_jobs WHERE id = $1", [deletionJobId]).catch(() => undefined);
      await admin.query("DELETE FROM project_access_requests WHERE id = $1", [accessRequestId]).catch(() => undefined);
      await admin.query("DELETE FROM projects WHERE id = $1", [projectId]).catch(() => undefined);
      await admin.query("DELETE FROM auth_identity_mappings WHERE auth_user_id = $1", [authUserId]).catch(() => undefined);
      await admin.query("DELETE FROM auth_users WHERE id = $1", [authUserId]).catch(() => undefined);
      await admin.query("DELETE FROM profiles WHERE user_id = ANY($1::uuid[])", [[ownerId, requesterId]]).catch(() => undefined);
      await admin.query("DELETE FROM email_recipient_profiles WHERE user_id = ANY($1::uuid[])", [[ownerId, requesterId]]).catch(() => undefined);
      await admin.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [[ownerId, requesterId]]).catch(() => undefined);
      await resources.pool.end();
      await admin.end();
    }
  });
});

// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const mediaWorkerRole = process.env.DATABASE_SECURITY_MEDIA_WORKER_ROLE?.trim();
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Gerichte mediatests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (mediaWorkerRole && !/^[a-z_][a-z0-9_]{0,62}$/.test(mediaWorkerRole)) {
    throw new Error("DATABASE_SECURITY_MEDIA_WORKER_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

async function assumeMediaWorker(client: Client): Promise<void> {
  if (mediaWorkerRole) await client.query(`SET LOCAL ROLE "${mediaWorkerRole}"`);
}

async function resetRole(client: Client): Promise<void> {
  if (mediaWorkerRole) await client.query("RESET ROLE");
}

describeWithDatabase("request-driven media processing PostgreSQL boundary", () => {
  it("leases only the exact eligible asset and preserves retry and lease semantics", async () => {
    assertLocalDisposableDatabase(databaseUrl!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const ownerId = randomUUID();
    const projectId = randomUUID();
    const targetAssetId = randomUUID();
    const otherAssetId = randomUUID();
    const targetEventId = randomUUID();
    const otherEventId = randomUUID();
    const firstWorker = "media-request:first";
    const secondWorker = "media-request:retry";

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [ownerId]);
      await client.query(`
        INSERT INTO projects (id, owner_id, slug, title, visibility, lifecycle_status)
        VALUES ($1, $2, $3, 'Gerichte mediatest', 'private', 'active')
      `, [projectId, ownerId, `media-request-${projectId.replaceAll("-", "")}`]);
      await client.query(`
        INSERT INTO media_assets (
          id, owner_id, project_id, purpose, status, bucket, object_key,
          upload_idempotency_key, claimed_content_type, size_bytes, sha256
        ) VALUES
          ($1, $3, $4, 'project_media', 'uploaded', 'test-private-media', $5, $6, 'image/jpeg', 128, $7),
          ($2, $3, $4, 'project_media', 'uploaded', 'test-private-media', $8, $9, 'image/jpeg', 128, $7)
      `, [
        targetAssetId,
        otherAssetId,
        ownerId,
        projectId,
        `temporary/${targetAssetId.slice(0, 2)}/${targetAssetId}`,
        `request-media-${targetAssetId}`,
        "a".repeat(64),
        `temporary/${otherAssetId.slice(0, 2)}/${otherAssetId}`,
        `request-media-${otherAssetId}`,
      ]);
      await client.query(`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, idempotency_key,
          payload, status, available_at, created_at
        ) VALUES
          ($1, 'media', $3, 'media.processing.requested.v1', $5, $7::jsonb, 'pending', now(), now()),
          ($2, 'media', $4, 'media.processing.requested.v1', $6, $8::jsonb, 'pending', now(), now() - interval '1 hour')
      `, [
        targetEventId,
        otherEventId,
        targetAssetId,
        otherAssetId,
        `media-processing:v1:${targetAssetId}`,
        `media-processing:v1:${otherAssetId}`,
        JSON.stringify({ schemaVersion: 1, assetId: targetAssetId }),
        JSON.stringify({ schemaVersion: 1, assetId: otherAssetId }),
      ]);

      if (mediaWorkerRole) {
        await client.query("SAVEPOINT media_worker_table_denied");
        await assumeMediaWorker(client);
        await expect(client.query("SELECT id FROM media_assets LIMIT 1")).rejects.toMatchObject({
          code: "42501",
        });
        await client.query("ROLLBACK TO SAVEPOINT media_worker_table_denied");
      }

      await assumeMediaWorker(client);
      const firstClaim = await client.query<{
        event_id: string;
        aggregate_id: string;
        attempt_count: number;
      }>(`
        SELECT event_id, aggregate_id, attempt_count
        FROM app_claim_media_processing_asset($1, $2, 60)
      `, [firstWorker, targetAssetId]);
      await resetRole(client);
      expect(firstClaim.rows).toEqual([{
        event_id: targetEventId,
        aggregate_id: targetAssetId,
        attempt_count: 1,
      }]);
      expect((await client.query<{ status: string }>(
        "SELECT status FROM outbox_events WHERE id = $1",
        [otherEventId],
      )).rows[0]?.status).toBe("pending");

      await assumeMediaWorker(client);
      const competingClaim = await client.query(
        "SELECT event_id FROM app_claim_media_processing_asset($1, $2, 60)",
        [secondWorker, targetAssetId],
      );
      await resetRole(client);
      expect(competingClaim.rowCount).toBe(0);

      await assumeMediaWorker(client);
      const begun = await client.query<{ asset_id: string; attempt_count: number }>(
        "SELECT asset_id, attempt_count FROM app_begin_media_processing_job($1, $2)",
        [firstWorker, targetEventId],
      );
      await resetRole(client);
      expect(begun.rows).toEqual([{ asset_id: targetAssetId, attempt_count: 1 }]);
      expect((await client.query<{ status: string }>(
        "SELECT status FROM media_assets WHERE id = $1",
        [targetAssetId],
      )).rows[0]?.status).toBe("processing");

      await assumeMediaWorker(client);
      const resumedClaim = await client.query<{ attempt_count: number }>(
        "SELECT attempt_count FROM app_claim_media_processing_asset($1, $2, 60)",
        [firstWorker, targetAssetId],
      );
      await resetRole(client);
      expect(resumedClaim.rows).toEqual([{ attempt_count: 1 }]);

      await assumeMediaWorker(client);
      await client.query(
        "SELECT app_fail_media_processing_job($1, $2, $3, 'STORAGE_PROVIDER_ERROR', 30, false)",
        [firstWorker, targetEventId, targetAssetId],
      );
      await resetRole(client);
      await assumeMediaWorker(client);
      const earlyRetry = await client.query(
        "SELECT event_id FROM app_claim_media_processing_asset($1, $2, 60)",
        [secondWorker, targetAssetId],
      );
      await resetRole(client);
      expect(earlyRetry.rowCount).toBe(0);

      await client.query(
        "UPDATE outbox_events SET available_at = now() - interval '1 second' WHERE id = $1",
        [targetEventId],
      );
      await assumeMediaWorker(client);
      const retryClaim = await client.query<{ aggregate_id: string; attempt_count: number }>(
        "SELECT aggregate_id, attempt_count FROM app_claim_media_processing_asset($1, $2, 60)",
        [secondWorker, targetAssetId],
      );
      await resetRole(client);
      expect(retryClaim.rows).toEqual([{ aggregate_id: targetAssetId, attempt_count: 2 }]);

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });

  it("resumes privacy-free orphan cursors with exact-purpose leases and persisted dead letters", async () => {
    assertLocalDisposableDatabase(databaseUrl!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const firstWorker = "media-cleanup:first";
    const secondWorker = "media-cleanup:retry";

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");

      if (mediaWorkerRole) {
        await client.query("SAVEPOINT media_cleanup_table_denied");
        await assumeMediaWorker(client);
        await expect(client.query(`
          SELECT payload
          FROM outbox_events
          WHERE event_type = 'media.orphan_cleanup.maintenance.v1'
        `)).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK TO SAVEPOINT media_cleanup_table_denied");
      }

      await assumeMediaWorker(client);
      const claim = await client.query<{
        event_id: string;
        cleanup_purpose: string;
        provider_cursor: string | null;
        attempt_count: number;
      }>(`
        SELECT event_id, cleanup_purpose, provider_cursor, attempt_count
        FROM app_media_worker_claim_orphan_cleanup($1, 'temporary', 60)
      `, [firstWorker]);
      await resetRole(client);
      expect(claim.rows).toEqual([expect.objectContaining({
        cleanup_purpose: "temporary",
        provider_cursor: null,
        attempt_count: 1,
      })]);
      const eventId = claim.rows[0]!.event_id;

      await assumeMediaWorker(client);
      const competingFinalize = await client.query<{ finalized: boolean }>(`
        SELECT app_media_worker_finalize_orphan_cleanup(
          $1, $2::uuid, 'temporary', 'opaque-page-2', false
        ) AS finalized
      `, [secondWorker, eventId]);
      await resetRole(client);
      expect(competingFinalize.rows).toEqual([{ finalized: false }]);

      await assumeMediaWorker(client);
      const finalized = await client.query<{ finalized: boolean }>(`
        SELECT app_media_worker_finalize_orphan_cleanup(
          $1, $2::uuid, 'temporary', 'opaque-page-2', false
        ) AS finalized
      `, [firstWorker, eventId]);
      await resetRole(client);
      expect(finalized.rows).toEqual([{ finalized: true }]);

      await assumeMediaWorker(client);
      const resumed = await client.query<{
        provider_cursor: string;
        attempt_count: number;
      }>(`
        SELECT provider_cursor, attempt_count
        FROM app_media_worker_claim_orphan_cleanup($1, 'temporary', 60)
      `, [secondWorker]);
      await resetRole(client);
      expect(resumed.rows).toEqual([{ provider_cursor: "opaque-page-2", attempt_count: 1 }]);

      await assumeMediaWorker(client);
      const retry = await client.query<{ failed: boolean }>(`
        SELECT app_media_worker_fail_orphan_cleanup(
          $1, $2::uuid, 'temporary', 'STORAGE_PROVIDER_ERROR', 30, false
        ) AS failed
      `, [secondWorker, eventId]);
      await resetRole(client);
      expect(retry.rows).toEqual([{ failed: true }]);
      expect((await client.query<{ status: string; cursor: string; last_error_code: string }>(`
        SELECT status, payload ->> 'cursor' AS cursor, last_error_code
        FROM outbox_events
        WHERE id = $1
      `, [eventId])).rows).toEqual([{
        status: "retry",
        cursor: "opaque-page-2",
        last_error_code: "STORAGE_PROVIDER_ERROR",
      }]);

      await client.query(
        "UPDATE outbox_events SET available_at = now() - interval '1 second' WHERE id = $1",
        [eventId],
      );
      await assumeMediaWorker(client);
      const retryClaim = await client.query<{ attempt_count: number }>(`
        SELECT attempt_count
        FROM app_media_worker_claim_orphan_cleanup($1, 'temporary', 60)
      `, [firstWorker]);
      await resetRole(client);
      expect(retryClaim.rows).toEqual([{ attempt_count: 2 }]);

      await assumeMediaWorker(client);
      const deadLettered = await client.query<{ failed: boolean }>(`
        SELECT app_media_worker_fail_orphan_cleanup(
          $1, $2::uuid, 'temporary', 'STORAGE_PROVIDER_ERROR', 1, true
        ) AS failed
      `, [firstWorker, eventId]);
      await resetRole(client);
      expect(deadLettered.rows).toEqual([{ failed: true }]);
      expect((await client.query<{ status: string; last_error_code: string }>(`
        SELECT status, last_error_code FROM outbox_events WHERE id = $1
      `, [eventId])).rows).toEqual([{
        status: "dead_letter",
        last_error_code: "STORAGE_PROVIDER_ERROR",
      }]);

      await assumeMediaWorker(client);
      const deadLetterClaim = await client.query(
        "SELECT event_id FROM app_media_worker_claim_orphan_cleanup($1, 'temporary', 60)",
        [secondWorker],
      );
      await resetRole(client);
      expect(deadLetterClaim.rowCount).toBe(0);

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

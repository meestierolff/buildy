// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const workerDatabaseUrl = process.env.DATABASE_SECURITY_PHOTOBOOK_WORKER_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && workerDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Bouwboek-workertests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

describeWithDatabase("photobook PostgreSQL worker boundary", () => {
  it("claims and finalizes an exact proof without granting the worker table access", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(workerDatabaseUrl!);

    const ownerId = randomUUID();
    const projectId = randomUUID();
    const sourceAssetId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const eventId = randomUUID();
    const workerId = `photobook-test-${randomUUID()}`;
    const sourceHash = "1".repeat(64);
    const documentHash = "2".repeat(64);
    const assetSetHash = "3".repeat(64);
    const pdfHash = "4".repeat(64);
    const fontHash = "5".repeat(64);
    const renderEngine = "buildy-pdfkit";
    const renderVersion = "photobook-worker-integration-v1";
    const document = {
      version: 1,
      projectId,
      projectRevision: 1,
      sourceAssetIds: [sourceAssetId],
      sourceAssets: [{ id: sourceAssetId, sha256: sourceHash }],
    };

    const admin = new Client({ connectionString: adminDatabaseUrl });
    const worker = new Client({ connectionString: workerDatabaseUrl });
    await admin.connect();
    await worker.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [ownerId]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision, published_at
        ) VALUES ($1, $2, $3, 'Bouwboek workerproef', 'public', 'active', 1, now())
      `, [projectId, ownerId, `photobook-worker-${projectId}`]);
      let traversalError: unknown;
      try {
        await admin.query(`
          INSERT INTO media_assets (
            id, owner_id, project_id, purpose, status, bucket, object_key,
            upload_idempotency_key
          ) VALUES ($1, $2, $3, 'project_media', 'pending_upload', 'test-assets',
            'originals/../private.jpg', $4)
        `, [randomUUID(), ownerId, projectId, `traversal-${randomUUID()}`]);
      } catch (error) {
        traversalError = error;
      }
      expect(postgresCode(traversalError)).toBe("23514");

      await admin.query(`
        INSERT INTO media_assets (
          id, owner_id, project_id, purpose, status, bucket, object_key,
          upload_idempotency_key, detected_content_type, size_bytes, sha256,
          width_pixels, height_pixels, exif_stripped, ready_at
        ) VALUES
          ($1, $2, $3, 'project_media', 'ready', 'test-assets', $4,
           $5, 'image/jpeg', 4096, $6, 2400, 1600, true, now()),
          ($7, $2, $3, 'photobook_pdf', 'processing', 'test-assets', $8,
           $9, NULL, NULL, NULL, NULL, NULL, false, NULL)
      `, [
        sourceAssetId,
        ownerId,
        projectId,
        `originals/${sourceAssetId}.jpg`,
        `photobook-source-${sourceAssetId}`,
        sourceHash,
        pdfAssetId,
        `photobook-pdfs/${pdfAssetId.slice(0, 2)}/${pdfAssetId}`,
        `photobook-pdf-${pdfAssetId}`,
      ]);
      await admin.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES ($1, $2, $3, 'rendering', 1, 1, $4::jsonb, $5, 24, 'a4-landscape-hardcover-v1')
      `, [draftId, projectId, ownerId, JSON.stringify(document), documentHash]);
      await admin.query(`
        INSERT INTO photobook_revisions (
          id, draft_id, project_id, owner_id, revision_number, status,
          schema_version, project_revision, document, document_sha256,
          asset_set, asset_set_sha256, pdf_asset_id, render_engine, render_version
        ) VALUES (
          $1, $2, $3, $4, 1, 'rendering', 1, 1, $5::jsonb, $6,
          $7::jsonb, $8, $9, $10, $11
        )
      `, [
        revisionId,
        draftId,
        projectId,
        ownerId,
        JSON.stringify(document),
        documentHash,
        JSON.stringify([{ id: sourceAssetId, sha256: sourceHash }]),
        assetSetHash,
        pdfAssetId,
        renderEngine,
        renderVersion,
      ]);
      await admin.query(`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, idempotency_key, payload, status
        ) VALUES (
          $1, 'photobook_proof', $2, 'photobook.proof.requested.v1', $3,
          $4::jsonb, 'pending'
        )
      `, [
        eventId,
        revisionId,
        `photobook-worker-event-${eventId}`,
        JSON.stringify({ schemaVersion: 1, revisionId, projectId }),
      ]);

      let tableReadError: unknown;
      try {
        await worker.query("SELECT id FROM public.photobook_revisions LIMIT 1");
      } catch (error) {
        tableReadError = error;
      }
      expect(postgresCode(tableReadError)).toBe("42501");

      const unrelatedClaim = await worker.query(
        "SELECT * FROM public.app_photobook_worker_claim_revision($1, $2, $3)",
        [workerId, randomUUID(), 60],
      );
      expect(unrelatedClaim.rows).toEqual([]);

      const claim = await worker.query<{
        event_id: string;
        revision_id: string;
        attempt_count: number;
      }>("SELECT * FROM public.app_photobook_worker_claim_revision($1, $2, $3)", [
        workerId,
        revisionId,
        60,
      ]);
      expect(claim.rows).toMatchObject([{ event_id: eventId, revision_id: revisionId, attempt_count: 1 }]);

      expect((await worker.query(
        "SELECT * FROM public.app_begin_photobook_render($1, $2)",
        [`${workerId}-wrong`, eventId],
      )).rowCount).toBe(0);
      const render = await worker.query<{
        event_id: string;
        revision_id: string;
        pdf_asset_id: string;
        pdf_object_key: string;
        source_assets: Array<{ id: string; sha256: string }>;
      }>("SELECT * FROM public.app_begin_photobook_render($1, $2)", [workerId, eventId]);
      expect(render.rows).toMatchObject([{
        event_id: eventId,
        revision_id: revisionId,
        pdf_asset_id: pdfAssetId,
        pdf_object_key: `photobook-pdfs/${pdfAssetId.slice(0, 2)}/${pdfAssetId}`,
        source_assets: [{ id: sourceAssetId, sha256: sourceHash }],
      }]);

      const retry = await worker.query<{ failed: boolean }>(`
        SELECT public.app_fail_photobook_render($1, $2, $3, $4, $5, false) AS failed
      `, [workerId, eventId, revisionId, "TRANSIENT_RENDER_FAILURE", 1]);
      expect(retry.rows).toEqual([{ failed: true }]);
      expect((await admin.query(`
        SELECT revision.status AS revision_status, event.status AS event_status,
          revision.failure_code, event.last_error_code
        FROM photobook_revisions revision
        JOIN outbox_events event ON event.aggregate_id = revision.id
        WHERE revision.id = $1
      `, [revisionId])).rows).toEqual([{
        revision_status: "rendering",
        event_status: "retry",
        failure_code: "TRANSIENT_RENDER_FAILURE",
        last_error_code: "TRANSIENT_RENDER_FAILURE",
      }]);
      await admin.query(
        "UPDATE outbox_events SET available_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [eventId],
      );
      const retryClaim = await worker.query<{ attempt_count: number }>(
        "SELECT * FROM public.app_photobook_worker_claim_revision($1, $2, $3)",
        [workerId, revisionId, 60],
      );
      expect(retryClaim.rows).toMatchObject([{ attempt_count: 2 }]);
      expect((await worker.query(
        "SELECT * FROM public.app_begin_photobook_render($1, $2)",
        [workerId, eventId],
      )).rowCount).toBe(1);

      const wrongAssetSet = await worker.query<{ finalized: boolean }>(`
        SELECT public.app_finalize_photobook_render(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) AS finalized
      `, [
        workerId,
        eventId,
        revisionId,
        pdfHash,
        8192,
        24,
        "f".repeat(64),
        fontHash,
        renderEngine,
        renderVersion,
      ]);
      expect(wrongAssetSet.rows[0]?.finalized).toBe(false);

      const finalized = await worker.query<{ finalized: boolean }>(`
        SELECT public.app_finalize_photobook_render(
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        ) AS finalized
      `, [
        workerId,
        eventId,
        revisionId,
        pdfHash,
        8192,
        24,
        assetSetHash,
        fontHash,
        renderEngine,
        renderVersion,
      ]);
      expect(finalized.rows[0]?.finalized).toBe(true);

      const state = await admin.query<{
        revision_status: string;
        draft_status: string;
        asset_status: string;
        event_status: string;
        pdf_sha256: string;
        font_set_sha256: string;
      }>(`
        SELECT
          revision.status AS revision_status,
          draft.status AS draft_status,
          asset.status AS asset_status,
          event.status AS event_status,
          revision.pdf_sha256,
          revision.font_set_sha256
        FROM photobook_revisions revision
        JOIN photobook_drafts draft ON draft.id = revision.draft_id
        JOIN media_assets asset ON asset.id = revision.pdf_asset_id
        JOIN outbox_events event ON event.aggregate_id = revision.id
        WHERE revision.id = $1
      `, [revisionId]);
      expect(state.rows).toEqual([{
        revision_status: "ready",
        draft_status: "ready",
        asset_status: "ready",
        event_status: "delivered",
        pdf_sha256: pdfHash,
        font_set_sha256: fontHash,
      }]);
    } finally {
      await admin.query("DELETE FROM outbox_events WHERE id = $1", [eventId]);
      await admin.query("DELETE FROM photobook_revisions WHERE id = $1", [revisionId]);
      await admin.query("DELETE FROM photobook_drafts WHERE id = $1", [draftId]);
      await admin.query("DELETE FROM media_assets WHERE id = ANY($1::uuid[])", [[sourceAssetId, pdfAssetId]]);
      await admin.query("DELETE FROM projects WHERE id = $1", [projectId]);
      await admin.query("UPDATE app_users SET status = 'deleted', deleted_at = now() WHERE id = $1", [ownerId]);
      await admin.query("DELETE FROM app_users WHERE id = $1", [ownerId]);
      await worker.end();
      await admin.end();
    }
  });
});

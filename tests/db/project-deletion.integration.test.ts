// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const workerDatabaseUrl = process.env.DATABASE_SECURITY_ACCOUNT_WORKER_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && webRole && workerDatabaseUrl
  ? describe
  : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string, role?: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Project-deletietests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (role && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function beginAsActor(client: Client, actorId: string): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '10s'");
  await client.query(`SET LOCAL ROLE "${webRole!}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
}

describeWithDatabase("project deletion PostgreSQL saga", () => {
  it("blocks an active order, resumes after delivery, deletes verified media and retains the ordered proof", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!, webRole!);
    assertLocalDisposableDatabase(workerDatabaseUrl!);

    const ownerId = randomUUID();
    const strangerId = randomUUID();
    const projectId = randomUUID();
    const sourceAssetId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const workerId = `project-delete-${randomUUID()}`;
    const idempotencyKey = `project-command:v1:project.delete:${"d".repeat(64)}`;
    const documentHash = "1".repeat(64);
    const pdfHash = "2".repeat(64);
    const assetSetHash = "3".repeat(64);
    let deletionJobId: string | undefined;

    const document = {
      version: 1,
      selectedFormat: "a4-landscape-hardcover-v1",
      pageCount: 24,
      warnings: [],
      sourceAssetIds: [sourceAssetId],
      sourceAssets: [{ id: sourceAssetId, sha256: "4".repeat(64) }],
    };
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const worker = new Client({ connectionString: workerDatabaseUrl });
    await admin.connect();
    await worker.connect();

    try {
      await admin.query(
        "INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')",
        [ownerId, strangerId],
      );
      await admin.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Projecteigenaar', $3, true),
          ($2, 'Vreemdeling', $4, true)
      `, [ownerId, strangerId, `delete-owner-${ownerId}`, `delete-stranger-${strangerId}`]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision, version
        ) VALUES ($1, $2, $3, 'Te verwijderen project', 'private', 'active', 1, 1)
      `, [projectId, ownerId, `delete-project-${projectId}`]);
      await admin.query(`
        INSERT INTO project_private_details (
          project_id, owner_id, city_ciphertext, encryption_key_version
        ) VALUES ($1, $2, 'v1.1.private-city', 1)
      `, [projectId, ownerId]);
      await admin.query(`
        INSERT INTO media_assets (
          id, owner_id, project_id, purpose, status, storage_provider, bucket,
          object_key, upload_idempotency_key, claimed_content_type,
          detected_content_type, size_bytes, sha256, exif_stripped, ready_at
        ) VALUES
          ($1, $3, $4, 'project_media', 'ready', 'r2', 'test-private-assets',
           $5, $6, 'image/jpeg', 'image/jpeg', 1024, $7, true, now()),
          ($2, $3, $4, 'photobook_pdf', 'ready', 'r2', 'test-private-assets',
           $8, $9, 'application/pdf', 'application/pdf', 8192, $10, false, now())
      `, [
        sourceAssetId,
        pdfAssetId,
        ownerId,
        projectId,
        `originals/${sourceAssetId.slice(0, 2)}/${sourceAssetId}/original.jpg`,
        `project-delete-source-${sourceAssetId}`,
        "4".repeat(64),
        `photobook-pdfs/${pdfAssetId.slice(0, 2)}/${pdfAssetId}`,
        `project-delete-proof-${pdfAssetId}`,
        pdfHash,
      ]);
      await admin.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES ($1, $2, $3, 'ready', 1, 1, $4::jsonb, $5, 24, 'a4-landscape-hardcover-v1')
      `, [draftId, projectId, ownerId, JSON.stringify(document), documentHash]);
      await admin.query(`
        INSERT INTO photobook_revisions (
          id, draft_id, project_id, owner_id, revision_number, status,
          schema_version, project_revision, document, document_sha256,
          asset_set, asset_set_sha256, pdf_asset_id, pdf_sha256, pdf_size_bytes,
          page_count, render_engine, render_version, font_set_sha256,
          approved_by_id, approved_at, locked_at
        ) VALUES (
          $1, $2, $3, $4, 1, 'locked', 1, 1, $5::jsonb, $6,
          '[]'::jsonb, $7, $8, $9, 8192, 24,
          'buildy-pdfkit', 'integration-v1', $10, $4, now(), now()
        )
      `, [
        revisionId,
        draftId,
        projectId,
        ownerId,
        JSON.stringify(document),
        documentHash,
        assetSetHash,
        pdfAssetId,
        pdfHash,
        "5".repeat(64),
      ]);
      await admin.query(`
        INSERT INTO photobook_orders (
          id, order_number, merchant_reference, project_id, owner_id,
          proof_revision_id, idempotency_key, status, payment_status,
          fulfilment_status, currency, quantity, subtotal_minor, shipping_minor,
          tax_minor, total_minor, shipping_country, checkout_snapshot,
          seller_snapshot, terms_version, legal_accepted_at, stripe_payment_intent_id,
          pii_encryption_key_version, paid_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'paid', 'paid', 'in_production',
          'EUR', 1, 4000, 800, 1008, 5808, 'NL', $8::jsonb, $9::jsonb,
          'integration-v1', now(), $10, 1, now()
        )
      `, [
        orderId,
        `BLD-TEST-${orderId.replaceAll("-", "").slice(0, 12).toUpperCase()}`,
        `buildy:${orderId}`,
        projectId,
        ownerId,
        revisionId,
        `project-delete-order:${orderId}`,
        JSON.stringify({ schemaVersion: 1, documentSha256: documentHash }),
        JSON.stringify({ legalName: "Buildy Test" }),
        `pi_${orderId.replaceAll("-", "")}`,
      ]);

      await beginAsActor(admin, strangerId);
      let idorError: unknown;
      try {
        await admin.query(
          "SELECT * FROM public.app_request_project_deletion($1, 1, $2, 'project-erasure-v1')",
          [projectId, `project-command:v1:project.delete:${"7".repeat(64)}`],
        );
      } catch (error) {
        idorError = error;
      }
      expect(postgresCode(idorError)).toBe("42501");
      await admin.query("ROLLBACK");

      await beginAsActor(admin, ownerId);
      const blocked = await admin.query<{
        job_id: string;
        job_status: string;
        active_order_count: number;
        replayed: boolean;
      }>(
        "SELECT * FROM public.app_request_project_deletion($1, 1, $2, 'project-erasure-v1')",
        [projectId, idempotencyKey],
      );
      deletionJobId = blocked.rows[0]?.job_id;
      expect(blocked.rows).toEqual([{
        job_id: deletionJobId,
        job_status: "blocked_active_order",
        active_order_count: 1,
        replayed: false,
      }]);
      await admin.query("COMMIT");
      expect((await admin.query("SELECT lifecycle_status FROM projects WHERE id = $1", [projectId])).rows)
        .toEqual([{ lifecycle_status: "active" }]);

      await admin.query(`
        UPDATE photobook_orders
        SET fulfilment_status = 'shipped', version = version + 1, updated_at = now()
        WHERE id = $1
      `, [orderId]);
      await admin.query(`
        UPDATE photobook_orders
        SET fulfilment_status = 'delivered', version = version + 1, updated_at = now()
        WHERE id = $1
      `, [orderId]);

      await beginAsActor(admin, ownerId);
      const accepted = await admin.query<{
        job_id: string;
        job_status: string;
        active_order_count: number;
        replayed: boolean;
      }>(
        "SELECT * FROM public.app_request_project_deletion($1, 1, $2, 'project-erasure-v1')",
        [projectId, idempotencyKey],
      );
      expect(accepted.rows).toEqual([{
        job_id: deletionJobId,
        job_status: "deletion_pending",
        active_order_count: 0,
        replayed: true,
      }]);
      const hidden = await admin.query("SELECT id FROM projects WHERE id = $1", [projectId]);
      expect(hidden.rowCount).toBe(0);
      await admin.query("COMMIT");

      const claim = await worker.query<{ job_id: string }>(
        "SELECT * FROM public.app_account_worker_claim_deletion($1, 60)",
        [workerId],
      );
      expect(claim.rows).toMatchObject([{ job_id: deletionJobId }]);
      const asset = await worker.query<{
        deletion_asset_id: string;
        media_asset_id: string;
        object_key: string;
      }>("SELECT * FROM public.app_account_worker_begin_deletion($1, $2)", [
        workerId,
        deletionJobId,
      ]);
      expect(asset.rows).toMatchObject([{
        media_asset_id: sourceAssetId,
        object_key: `originals/${sourceAssetId.slice(0, 2)}/${sourceAssetId}/original.jpg`,
      }]);
      expect((await worker.query<{ verified: boolean }>(`
        SELECT public.app_account_worker_verify_deletion_asset($1, $2, $3) AS verified
      `, [workerId, deletionJobId, asset.rows[0]?.deletion_asset_id])).rows)
        .toEqual([{ verified: true }]);

      const finalClaim = await worker.query(
        "SELECT * FROM public.app_account_worker_claim_deletion($1, 60)",
        [workerId],
      );
      expect(finalClaim.rows).toMatchObject([{ job_id: deletionJobId }]);
      expect((await worker.query<{ status: string }>(`
        SELECT public.app_account_worker_finalize_deletion_job($1, $2) AS status
      `, [workerId, deletionJobId])).rows).toEqual([{ status: "completed" }]);

      const persisted = await admin.query<{
        project_status: string;
        project_title: string;
        source_status: string;
        proof_status: string;
        order_count: number;
        private_details_count: number;
      }>(`
        SELECT project.lifecycle_status AS project_status,
          project.title AS project_title,
          source.status AS source_status,
          proof.status AS proof_status,
          (SELECT count(*)::integer FROM photobook_orders orders WHERE orders.id = $4) AS order_count,
          (SELECT count(*)::integer FROM project_private_details details WHERE details.project_id = $1)
            AS private_details_count
        FROM projects project
        JOIN media_assets source ON source.id = $2
        JOIN media_assets proof ON proof.id = $3
        WHERE project.id = $1
      `, [projectId, sourceAssetId, pdfAssetId, orderId]);
      expect(persisted.rows).toEqual([{
        project_status: "deleted",
        project_title: "Verwijderd project",
        source_status: "deleted",
        proof_status: "ready",
        order_count: 1,
        private_details_count: 0,
      }]);
    } catch (error) {
      await admin.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await admin.query("DELETE FROM photobook_order_events WHERE order_id = $1", [orderId]).catch(() => undefined);
      await admin.query("DELETE FROM photobook_orders WHERE id = $1", [orderId]).catch(() => undefined);
      await admin.query("DELETE FROM photobook_revisions WHERE id = $1", [revisionId]).catch(() => undefined);
      await admin.query("DELETE FROM photobook_drafts WHERE id = $1", [draftId]).catch(() => undefined);
      if (deletionJobId) {
        await admin.query("DELETE FROM deletion_jobs WHERE id = $1", [deletionJobId]).catch(() => undefined);
      }
      await admin.query("DELETE FROM media_assets WHERE id = ANY($1::uuid[])", [[sourceAssetId, pdfAssetId]])
        .catch(() => undefined);
      await admin.query("DELETE FROM project_private_details WHERE project_id = $1", [projectId]).catch(() => undefined);
      await admin.query("DELETE FROM projects WHERE id = $1", [projectId]).catch(() => undefined);
      await admin.query("DELETE FROM profiles WHERE user_id = ANY($1::uuid[])", [[ownerId, strangerId]])
        .catch(() => undefined);
      await admin.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [[ownerId, strangerId]])
        .catch(() => undefined);
      await worker.end();
      await admin.end();
    }
  });
});

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
    throw new Error("Account-lifecycletests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
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

describeWithDatabase("account lifecycle PostgreSQL boundaries", () => {
  it("enqueues and finalizes an actor-bound export through a no-table-access worker role", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!, webRole!);
    assertLocalDisposableDatabase(workerDatabaseUrl!);
    const ownerId = randomUUID();
    const otherId = randomUUID();
    const workerId = `account-test-${randomUUID()}`;
    const idempotencyKey = "a".repeat(64);
    const archiveSha256 = "b".repeat(64);
    const manifestSha256 = "c".repeat(64);
    let jobId: string | undefined;
    let exportAssetId: string | undefined;
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const worker = new Client({ connectionString: workerDatabaseUrl });
    await admin.connect();
    await worker.connect();

    try {
      await admin.query(
        "INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')",
        [ownerId, otherId],
      );
      await admin.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Export eigenaar', $3, true),
          ($2, 'Andere gebruiker', $4, true)
      `, [ownerId, otherId, `export-${ownerId}`, `other-${otherId}`]);

      await beginAsActor(admin, ownerId);
      const created = await admin.query<{
        job_id: string;
        job_status: string;
        replayed: boolean;
      }>("SELECT * FROM public.app_request_account_export($1, true, 'test-private-assets')", [
        idempotencyKey,
      ]);
      jobId = created.rows[0]?.job_id;
      expect(created.rows).toMatchObject([{ job_status: "requested", replayed: false }]);
      const replay = await admin.query<{
        job_id: string;
        replayed: boolean;
      }>("SELECT * FROM public.app_request_account_export($1, true, 'test-private-assets')", [
        idempotencyKey,
      ]);
      expect(replay.rows).toEqual([{ job_id: jobId, job_status: "requested", replayed: true }]);
      await admin.query("COMMIT");

      let tableReadError: unknown;
      try {
        await worker.query("SELECT id FROM public.export_jobs LIMIT 1");
      } catch (error) {
        tableReadError = error;
      }
      expect(postgresCode(tableReadError)).toBe("42501");

      const claim = await worker.query<{
        job_id: string;
        export_asset_id: string;
        attempt_count: number;
      }>("SELECT * FROM public.app_account_worker_claim_export($1, 60)", [workerId]);
      exportAssetId = claim.rows[0]?.export_asset_id;
      expect(claim.rows).toMatchObject([{
        job_id: jobId,
        attempt_count: 1,
      }]);
      expect((await worker.query(
        "SELECT * FROM public.app_account_worker_begin_export($1, $2)",
        [`${workerId}-wrong`, jobId],
      )).rowCount).toBe(0);
      const snapshot = await worker.query<{
        payload: { account: { id: string } };
        source_assets: unknown[];
      }>("SELECT * FROM public.app_account_worker_begin_export($1, $2)", [workerId, jobId]);
      expect(snapshot.rows[0]?.payload.account.id).toBe(ownerId);
      expect(snapshot.rows[0]?.source_assets).toEqual([]);

      const finalized = await worker.query<{ finalized: boolean }>(`
        SELECT public.app_account_worker_finalize_export($1, $2, $3, $4, $5) AS finalized
      `, [workerId, jobId, archiveSha256, 4096, manifestSha256]);
      expect(finalized.rows).toEqual([{ finalized: true }]);

      await beginAsActor(admin, otherId);
      expect((await admin.query("SELECT id FROM export_jobs WHERE id = $1", [jobId])).rowCount).toBe(0);
      await admin.query("ROLLBACK");
      await beginAsActor(admin, ownerId);
      const visible = await admin.query<{
        status: string;
        manifest_sha256: string;
      }>("SELECT status, manifest_sha256 FROM export_jobs WHERE id = $1", [jobId]);
      expect(visible.rows).toEqual([{ status: "ready", manifest_sha256: manifestSha256 }]);
      await admin.query("ROLLBACK");
    } catch (error) {
      await admin.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      if (jobId) await admin.query("DELETE FROM export_jobs WHERE id = $1", [jobId]).catch(() => undefined);
      if (exportAssetId) {
        await admin.query("DELETE FROM media_assets WHERE id = $1", [exportAssetId]).catch(() => undefined);
      }
      await admin.query("DELETE FROM profiles WHERE user_id = ANY($1::uuid[])", [[ownerId, otherId]])
        .catch(() => undefined);
      await admin.query("DELETE FROM app_users WHERE id = ANY($1::uuid[])", [[ownerId, otherId]])
        .catch(() => undefined);
      await worker.end();
      await admin.end();
    }
  });

  it("keeps request-time rows pending, verifies private objects per lease, then redacts in the job", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!, webRole!);
    assertLocalDisposableDatabase(workerDatabaseUrl!);
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const mediaId = randomUUID();
    const authUserId = `account-integration-${randomUUID()}`;
    const workerId = `account-delete-${randomUUID()}`;
    const idempotencyKey = "d".repeat(64);
    let deletionJobId: string | undefined;
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const worker = new Client({ connectionString: workerDatabaseUrl });
    await admin.connect();
    await worker.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [ownerId]);
      await admin.query(
        "INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES ($1, 'Te verwijderen', $2, true)",
        [ownerId, `delete-${ownerId}`],
      );
      await admin.query(`
        INSERT INTO auth_users (id, name, email, email_verified)
        VALUES ($1, 'Te verwijderen', $2, true)
      `, [authUserId, `${ownerId}@example.test`]);
      await admin.query(`
        INSERT INTO auth_identity_mappings (
          app_user_id, auth_user_id, migration_status, linked_at
        ) VALUES ($1, $2, 'linked', now())
      `, [ownerId, authUserId]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision
        ) VALUES ($1, $2, $3, 'Accountverwijdering', 'private', 'active', 1)
      `, [projectId, ownerId, `delete-project-${projectId}`]);
      await admin.query(`
        INSERT INTO media_assets (
          id, owner_id, project_id, purpose, status, storage_provider, bucket,
          object_key, upload_idempotency_key, detected_content_type, size_bytes,
          sha256, exif_stripped, ready_at
        ) VALUES (
          $1, $2, $3, 'project_media', 'ready', 'r2', 'test-private-assets',
          $4, $5, 'image/jpeg', 1024, $6, true, now()
        )
      `, [
        mediaId,
        ownerId,
        projectId,
        `originals/${mediaId.slice(0, 2)}/${mediaId}/original.jpg`,
        `account-delete-source-${mediaId}`,
        "e".repeat(64),
      ]);

      await beginAsActor(admin, ownerId);
      const requested = await admin.query<{
        job_id: string;
        job_status: string;
        active_order_count: number;
      }>("SELECT * FROM public.app_request_account_deletion($1, 'account-erasure-v1')", [
        idempotencyKey,
      ]);
      deletionJobId = requested.rows[0]?.job_id;
      expect(requested.rows).toMatchObject([{
        job_status: "deletion_pending",
        active_order_count: 0,
      }]);
      await admin.query("COMMIT");

      const pending = await admin.query<{
        account_status: string;
        project_status: string;
        project_count: number;
        media_count: number;
      }>(`
        SELECT account.status AS account_status,
          project.lifecycle_status AS project_status,
          (SELECT count(*)::integer FROM projects WHERE id = $2) AS project_count,
          (SELECT count(*)::integer FROM media_assets WHERE id = $3) AS media_count
        FROM app_users account
        JOIN projects project ON project.owner_id = account.id
        WHERE account.id = $1
      `, [ownerId, projectId, mediaId]);
      expect(pending.rows).toEqual([{
        account_status: "deletion_pending",
        project_status: "deletion_pending",
        project_count: 1,
        media_count: 1,
      }]);

      const firstClaim = await worker.query<{ job_id: string }>(
        "SELECT * FROM public.app_account_worker_claim_deletion($1, 60)",
        [workerId],
      );
      expect(firstClaim.rows).toMatchObject([{ job_id: deletionJobId }]);
      const deletionAsset = await worker.query<{
        deletion_asset_id: string;
        media_asset_id: string;
        object_key: string;
      }>("SELECT * FROM public.app_account_worker_begin_deletion($1, $2)", [
        workerId,
        deletionJobId,
      ]);
      expect(deletionAsset.rows).toMatchObject([{
        media_asset_id: mediaId,
        object_key: `originals/${mediaId.slice(0, 2)}/${mediaId}/original.jpg`,
      }]);
      expect((await worker.query<{ verified: boolean }>(`
        SELECT public.app_account_worker_verify_deletion_asset($1, $2, $3) AS verified
      `, [workerId, deletionJobId, deletionAsset.rows[0]?.deletion_asset_id])).rows)
        .toEqual([{ verified: true }]);

      const finalClaim = await worker.query(
        "SELECT * FROM public.app_account_worker_claim_deletion($1, 60)",
        [workerId],
      );
      expect(finalClaim.rows).toMatchObject([{ job_id: deletionJobId }]);
      expect((await worker.query(
        "SELECT * FROM public.app_account_worker_begin_deletion($1, $2)",
        [workerId, deletionJobId],
      )).rowCount).toBe(0);
      const finalized = await worker.query<{ status: string }>(`
        SELECT public.app_account_worker_finalize_deletion($1, $2) AS status
      `, [workerId, deletionJobId]);
      expect(finalized.rows).toEqual([{ status: "completed" }]);

      const completed = await admin.query<{
        account_status: string;
        project_status: string;
        display_name: string;
        media_status: string;
        job_status: string;
        auth_count: number;
      }>(`
        SELECT account.status AS account_status,
          project.lifecycle_status AS project_status,
          profile.display_name,
          media.status AS media_status,
          job.status AS job_status,
          (SELECT count(*)::integer FROM auth_users WHERE id = $3) AS auth_count
        FROM app_users account
        JOIN projects project ON project.owner_id = account.id
        JOIN profiles profile ON profile.user_id = account.id
        JOIN media_assets media ON media.owner_id = account.id
        JOIN deletion_jobs job ON job.target_id = account.id
        WHERE account.id = $1 AND project.id = $2
      `, [ownerId, projectId, authUserId]);
      expect(completed.rows).toEqual([{
        account_status: "deleted",
        project_status: "deleted",
        display_name: "Verwijderde gebruiker",
        media_status: "deleted",
        job_status: "completed",
        auth_count: 0,
      }]);
    } catch (error) {
      await admin.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      if (deletionJobId) {
        await admin.query("DELETE FROM deletion_jobs WHERE id = $1", [deletionJobId]).catch(() => undefined);
      }
      await admin.query("DELETE FROM auth_identity_mappings WHERE app_user_id = $1", [ownerId])
        .catch(() => undefined);
      await admin.query("DELETE FROM auth_users WHERE id = $1", [authUserId]).catch(() => undefined);
      await admin.query("DELETE FROM media_assets WHERE id = $1", [mediaId]).catch(() => undefined);
      await admin.query("DELETE FROM profiles WHERE user_id = $1", [ownerId]).catch(() => undefined);
      await admin.query("DELETE FROM projects WHERE id = $1", [projectId]).catch(() => undefined);
      await admin.query("DELETE FROM app_users WHERE id = $1", [ownerId]).catch(() => undefined);
      await worker.end();
      await admin.end();
    }
  });
});

import { sql } from "drizzle-orm";
import type { AccountExport, AccountExportStatus } from "../../shared/contracts/account.js";
import type { BuildyDatabase } from "../db/client.js";
import { AccountError } from "./errors.js";
import type {
  AccountDeletionAssetJob,
  AccountExportJob,
  AccountExportSourceAsset,
  AccountRepository,
  AccountWorkerRepository,
  DeletionMutation,
  ExpiredExportJob,
  ExportDownloadObject,
  ExportMutation,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const EXPORT_STATUSES = new Set<AccountExportStatus>([
  "requested",
  "processing",
  "retry_scheduled",
  "ready",
  "expired",
  "failed",
  "dead_letter",
  "deleted",
]);
const DELETION_STATUSES = new Set<DeletionMutation["status"]>([
  "requested",
  "blocked_active_order",
  "deletion_pending",
  "database_redaction",
  "storage_cleanup",
  "verification",
  "completed",
  "retry_scheduled",
  "manual_review",
  "dead_letter",
]);

function numberValue(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new AccountError("INVALID_STATE");
  return parsed;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AccountError("INVALID_STATE");
  return date.toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function objectValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new AccountError("INVALID_STATE", { cause: error });
  }
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof AccountError) throw error;
  const code = databaseCode(error);
  if (code === "23505") throw new AccountError("IDEMPOTENCY_CONFLICT", { cause: error });
  if (code === "42501") throw new AccountError("INVALID_STATE", { cause: error });
  if (["22023", "23514", "40001"].includes(code ?? "")) {
    throw new AccountError("INVALID_STATE", { cause: error });
  }
  throw error;
}

async function setActor(transaction: DatabaseTransaction, actorId: string): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
}

function exportStatus(value: string): AccountExportStatus {
  if (!EXPORT_STATUSES.has(value as AccountExportStatus)) throw new AccountError("INVALID_STATE");
  return value as AccountExportStatus;
}

function deletionStatus(value: string): DeletionMutation["status"] {
  if (!DELETION_STATUSES.has(value as DeletionMutation["status"])) {
    throw new AccountError("INVALID_STATE");
  }
  return value as DeletionMutation["status"];
}

function sourceAssets(value: unknown): AccountExportSourceAsset[] {
  const parsed = objectValue(value);
  if (!Array.isArray(parsed)) throw new AccountError("INVALID_STATE");
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") throw new AccountError("INVALID_STATE");
    const asset = entry as Record<string, unknown>;
    const sizeBytes = numberValue(asset.sizeBytes as number | string);
    if (
      typeof asset.id !== "string"
      || typeof asset.storageProvider !== "string"
      || typeof asset.bucket !== "string"
      || typeof asset.objectKey !== "string"
      || typeof asset.contentType !== "string"
      || typeof asset.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(asset.sha256)
      || typeof asset.purpose !== "string"
      || sizeBytes < 1
    ) throw new AccountError("INVALID_STATE");
    return {
      id: asset.id,
      storageProvider: asset.storageProvider,
      bucket: asset.bucket,
      objectKey: asset.objectKey,
      contentType: asset.contentType,
      sizeBytes,
      sha256: asset.sha256,
      purpose: asset.purpose,
    };
  });
}

export class PostgresAccountRepository implements AccountRepository, AccountWorkerRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async requestExport(
    actorId: string,
    idempotencyKey: string,
    includeMedia: boolean,
    bucket: string,
  ): Promise<ExportMutation> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, actorId);
        const result = await transaction.execute<{
          job_id: string;
          job_status: string;
          replayed: boolean;
        }>(sql`select * from public.app_request_account_export(${idempotencyKey}, ${includeMedia}, ${bucket})`);
        const row = result.rows[0];
        if (!row) throw new AccountError("INVALID_STATE");
        return { jobId: row.job_id, status: exportStatus(row.job_status), replayed: row.replayed };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async listExports(actorId: string): Promise<AccountExport[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<{
        id: string;
        status: string;
        include_media: boolean;
        manifest_sha256: string | null;
        created_at: Date | string;
        completed_at: Date | string | null;
        expires_at: Date | string | null;
        failure_code: string | null;
      }>(sql`
        select job.id, job.status, job.include_media, job.manifest_sha256,
          job.created_at, job.completed_at, job.expires_at, job.failure_code
        from public.export_jobs job
        where job.user_id = ${actorId}::uuid
        order by job.created_at desc, job.id desc
        limit 20
      `);
      return result.rows.map((row) => {
        const status = exportStatus(row.status);
        const expiresAt = nullableIso(row.expires_at);
        const downloadable = status === "ready"
          && expiresAt !== null
          && new Date(expiresAt).getTime() > Date.now();
        return {
          id: row.id,
          status,
          includeMedia: row.include_media,
          manifestSha256: row.manifest_sha256,
          createdAt: iso(row.created_at),
          completedAt: nullableIso(row.completed_at),
          expiresAt,
          downloadPath: downloadable ? `/api/account/exports/${row.id}/download` : null,
          failureCode: row.failure_code,
        };
      });
    });
  }

  async resolveExportDownload(actorId: string, jobId: string): Promise<ExportDownloadObject | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<{
        job_id: string;
        object_key: string;
        size_bytes: number | string;
        sha256: string;
        manifest_sha256: string;
      }>(sql`
        select job.id as job_id, asset.object_key, asset.size_bytes,
          asset.sha256, job.manifest_sha256
        from public.export_jobs job
        join public.media_assets asset
          on asset.id = job.export_asset_id
         and asset.owner_id = job.user_id
         and asset.purpose = 'export_archive'
         and asset.status = 'ready'
         and asset.detected_content_type = 'application/zip'
        where job.id = ${jobId}::uuid
          and job.user_id = ${actorId}::uuid
          and job.status = 'ready'
          and job.expires_at > statement_timestamp()
          and job.manifest_sha256 is not null
          and asset.sha256 is not null
          and asset.size_bytes is not null
        limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      return {
        jobId: row.job_id,
        objectKey: row.object_key,
        sizeBytes: numberValue(row.size_bytes),
        sha256: row.sha256,
        manifestSha256: row.manifest_sha256,
      };
    });
  }

  async requestDeletion(
    actorId: string,
    idempotencyKey: string,
    retentionPolicyVersion: string,
  ): Promise<DeletionMutation> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, actorId);
        const result = await transaction.execute<{
          job_id: string;
          job_status: string;
          active_order_count: number | string;
          replayed: boolean;
        }>(sql`select * from public.app_request_account_deletion(${idempotencyKey}, ${retentionPolicyVersion})`);
        const row = result.rows[0];
        if (!row) throw new AccountError("INVALID_STATE");
        return {
          jobId: row.job_id,
          status: deletionStatus(row.job_status),
          activeOrderCount: numberValue(row.active_order_count),
          replayed: row.replayed,
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async claimExport(workerId: string, leaseSeconds: number): Promise<AccountExportJob | null> {
    return this.database.transaction(async (transaction) => {
      const claimed = await transaction.execute<{
        job_id: string;
        user_id: string;
        export_asset_id: string;
        object_key: string;
        include_media: boolean;
        attempt_count: number | string;
      }>(sql`select * from public.app_account_worker_claim_export(${workerId}, ${leaseSeconds})`);
      const row = claimed.rows[0];
      if (!row) return null;
      const begun = await transaction.execute<{
        payload: unknown;
        source_assets: unknown;
        requested_at: Date | string;
      }>(sql`select * from public.app_account_worker_begin_export(${workerId}, ${row.job_id}::uuid)`);
      const snapshot = begun.rows[0];
      if (!snapshot) throw new AccountError("WORKER_LEASE_LOST");
      return {
        workerId,
        jobId: row.job_id,
        userId: row.user_id,
        exportAssetId: row.export_asset_id,
        objectKey: row.object_key,
        includeMedia: row.include_media,
        attemptCount: numberValue(row.attempt_count),
        requestedAt: iso(snapshot.requested_at),
        payload: objectValue(snapshot.payload),
        sourceAssets: sourceAssets(snapshot.source_assets),
      };
    });
  }

  async finalizeExport(
    job: AccountExportJob,
    archiveSha256: string,
    archiveSizeBytes: number,
    manifestSha256: string,
  ): Promise<boolean> {
    const result = await this.database.execute<{ finalized: boolean }>(sql`
      select public.app_account_worker_finalize_export(
        ${job.workerId}, ${job.jobId}::uuid, ${archiveSha256}, ${archiveSizeBytes}, ${manifestSha256}
      ) as finalized
    `);
    return result.rows[0]?.finalized === true;
  }

  async failExport(
    job: AccountExportJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    const result = await this.database.execute<{ failed: boolean }>(sql`
      select public.app_account_worker_fail_export(
        ${job.workerId}, ${job.jobId}::uuid, ${failureCode},
        ${retry?.delaySeconds ?? 1}, ${retry === null}
      ) as failed
    `);
    if (!result.rows[0]?.failed) throw new AccountError("WORKER_LEASE_LOST");
  }

  async claimExpiredExport(workerId: string, leaseSeconds: number): Promise<ExpiredExportJob | null> {
    const result = await this.database.execute<{
      job_id: string;
      export_asset_id: string;
      object_key: string;
      attempt_count: number | string;
    }>(sql`select * from public.app_account_worker_claim_expired_export(${workerId}, ${leaseSeconds})`);
    const row = result.rows[0];
    return row ? {
      workerId,
      jobId: row.job_id,
      exportAssetId: row.export_asset_id,
      objectKey: row.object_key,
      attemptCount: numberValue(row.attempt_count),
    } : null;
  }

  async finalizeExportCleanup(job: ExpiredExportJob): Promise<void> {
    const result = await this.database.execute<{ finalized: boolean }>(sql`
      select public.app_account_worker_finalize_export_cleanup(${job.workerId}, ${job.jobId}::uuid) as finalized
    `);
    if (!result.rows[0]?.finalized) throw new AccountError("WORKER_LEASE_LOST");
  }

  async failExportCleanup(
    job: ExpiredExportJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    const result = await this.database.execute<{ failed: boolean }>(sql`
      select public.app_account_worker_fail_export_cleanup(
        ${job.workerId}, ${job.jobId}::uuid, ${failureCode},
        ${retry?.delaySeconds ?? 1}, ${retry === null}
      ) as failed
    `);
    if (!result.rows[0]?.failed) throw new AccountError("WORKER_LEASE_LOST");
  }

  async claimDeletion(workerId: string, leaseSeconds: number): Promise<AccountDeletionAssetJob | null> {
    return this.database.transaction(async (transaction) => {
      const claimed = await transaction.execute<{
        job_id: string;
        target_id: string;
        attempt_count: number | string;
      }>(sql`select * from public.app_account_worker_claim_deletion(${workerId}, ${leaseSeconds})`);
      const job = claimed.rows[0];
      if (!job) return null;
      const begun = await transaction.execute<{
        deletion_asset_id: string;
        media_asset_id: string | null;
        storage_provider: string;
        bucket: string;
        object_key: string;
        expected_sha256: string | null;
        attempt_count: number | string;
      }>(sql`select * from public.app_account_worker_begin_deletion(${workerId}, ${job.job_id}::uuid)`);
      const asset = begun.rows[0];
      return {
        workerId,
        jobId: job.job_id,
        targetId: job.target_id,
        deletionAssetId: asset?.deletion_asset_id ?? null,
        mediaAssetId: asset?.media_asset_id ?? null,
        storageProvider: asset?.storage_provider ?? null,
        bucket: asset?.bucket ?? null,
        objectKey: asset?.object_key ?? null,
        expectedSha256: asset?.expected_sha256 ?? null,
        attemptCount: numberValue(job.attempt_count),
        assetAttemptCount: asset ? numberValue(asset.attempt_count) : 0,
      };
    });
  }

  async verifyDeletionAsset(job: AccountDeletionAssetJob): Promise<void> {
    if (!job.deletionAssetId) throw new AccountError("INVALID_STATE");
    const result = await this.database.execute<{ verified: boolean }>(sql`
      select public.app_account_worker_verify_deletion_asset(
        ${job.workerId}, ${job.jobId}::uuid, ${job.deletionAssetId}::uuid
      ) as verified
    `);
    if (!result.rows[0]?.verified) throw new AccountError("WORKER_LEASE_LOST");
  }

  async failDeletion(
    job: AccountDeletionAssetJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    const result = await this.database.execute<{ failed: boolean }>(sql`
      select public.app_account_worker_fail_deletion(
        ${job.workerId}, ${job.jobId}::uuid, ${job.deletionAssetId}::uuid,
        ${failureCode}, ${retry?.delaySeconds ?? 1}, ${retry === null}
      ) as failed
    `);
    if (!result.rows[0]?.failed) throw new AccountError("WORKER_LEASE_LOST");
  }

  async finalizeDeletion(job: AccountDeletionAssetJob): Promise<"completed" | "blocked_active_order"> {
    const result = await this.database.execute<{ status: string | null }>(sql`
      select public.app_account_worker_finalize_deletion_job(${job.workerId}, ${job.jobId}::uuid) as status
    `);
    const status = result.rows[0]?.status;
    if (status !== "completed" && status !== "blocked_active_order") {
      throw new AccountError("WORKER_LEASE_LOST");
    }
    return status;
  }
}

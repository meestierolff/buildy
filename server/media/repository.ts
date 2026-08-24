import { and, eq, sql } from "drizzle-orm";
import { mediaAssets, outboxEvents, projects } from "../../db/schema/index.js";
import type {
  MediaAssetState,
  MediaDisplaySize,
  MediaUploadPurpose,
  ProjectImageContentType,
} from "../../shared/contracts/media.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import { createObjectKey } from "../storage/objectStorage.js";
import { MediaError } from "./errors.js";
import type {
  CompleteUploadCommand,
  CreateUploadIntentCommand,
  DisplayObject,
  FinalizeMediaProcessingCommand,
  InternalUploadIntent,
  MediaCleanupCheckpoint,
  MediaCleanupPurpose,
  MediaProcessingJob,
  MediaRepository,
  OriginalObject,
  PendingUpload,
} from "./types.js";

type DatabaseTransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<DatabaseTransactionCallback>[0];

type UploadRow = {
  id: string;
  ownerId: string;
  projectId: string | null;
  purpose: MediaUploadPurpose;
  status: string;
  objectKey: string;
  claimedContentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
};

function actorIdFor(viewer: ProjectActor): string | null {
  return viewer.kind === "authenticated" ? viewer.appUserId : null;
}

async function setActor(
  transaction: DatabaseTransaction,
  actorId: string | null,
  shareLinkId?: string,
): Promise<void> {
  await transaction.execute(sql`select
    set_config('app.actor_id', ${actorId ?? ""}, true),
    set_config('app.share_link_id', ${shareLinkId ?? ""}, true)
  `);
}

async function lockKey(transaction: DatabaseTransaction, value: string): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${value}, 0))`);
}

function apiStatus(status: string): MediaAssetState["status"] {
  if (
    status === "pending_upload" ||
    status === "uploaded" ||
    status === "processing" ||
    status === "ready" ||
    status === "failed"
  ) return status;
  return "failed";
}

function assetState(row: Pick<UploadRow, "id" | "projectId" | "purpose" | "status">): MediaAssetState {
  if (!row.projectId) throw new MediaError("MEDIA_NOT_FOUND");
  return {
    id: row.id,
    projectId: row.projectId,
    purpose: row.purpose,
    status: apiStatus(row.status),
  };
}

function base64FromHex(value: string): string {
  return Buffer.from(value, "hex").toString("base64");
}

function typedRows<T>(rows: unknown[]): T[] {
  return rows as T[];
}

function databaseCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function assertFailureCode(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) return "MEDIA_PROCESSING_FAILED";
  return value;
}

export class PostgresMediaRepository implements MediaRepository {
  constructor(private readonly database: BuildyDatabase) {}

  private async beginClaimedProcessingJob(
    transaction: DatabaseTransaction,
    workerId: string,
    eventId: string,
  ): Promise<MediaProcessingJob | null> {
    const begun = await transaction.execute<{
      event_id: string;
      asset_id: string;
      owner_id: string;
      project_id: string;
      purpose: MediaUploadPurpose;
      temporary_object_key: string;
      bucket_name: string;
      claimed_content_type: ProjectImageContentType;
      expected_size_bytes: number | string;
      expected_sha256_hex: string;
      privacy_version: number;
      attempt_count: number;
    }>(sql`select * from app_begin_media_processing_job(${workerId}, ${eventId}::uuid)`);
    const row = begun.rows[0];
    if (!row) {
      await transaction.execute(sql`
        select app_retry_outbox_event(
          ${workerId},
          ${eventId}::uuid,
          'INVALID_MEDIA_JOB',
          1,
          true
        )
      `);
      return null;
    }
    return {
      workerId,
      eventId: row.event_id,
      assetId: row.asset_id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      purpose: row.purpose,
      temporaryObjectKey: row.temporary_object_key,
      bucket: row.bucket_name,
      claimedContentType: row.claimed_content_type,
      expectedSizeBytes: Number(row.expected_size_bytes),
      expectedSha256Hex: row.expected_sha256_hex,
      privacyVersion: Number(row.privacy_version),
      attemptCount: Number(row.attempt_count),
    };
  }

  async createUploadIntent(command: CreateUploadIntentCommand): Promise<InternalUploadIntent> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await lockKey(transaction, command.idempotencyKey);

        const priorEvents = await transaction
          .select({
            aggregateId: outboxEvents.aggregateId,
            eventType: outboxEvents.eventType,
            payload: outboxEvents.payload,
          })
          .from(outboxEvents)
          .where(eq(outboxEvents.idempotencyKey, command.idempotencyKey))
          .limit(1);
        const priorEvent = priorEvents[0];
        if (priorEvent) {
          if (
            priorEvent.eventType !== "media.upload.intent.created.v1" ||
            priorEvent.payload.requestHashVersion !== 2 ||
            priorEvent.payload.requestHash !== command.requestHash
          ) throw new MediaError("UPLOAD_CONFLICT");

          const rows = await transaction
            .select({
              id: mediaAssets.id,
              ownerId: mediaAssets.ownerId,
              projectId: mediaAssets.projectId,
              purpose: mediaAssets.purpose,
              status: mediaAssets.status,
              objectKey: mediaAssets.objectKey,
              claimedContentType: mediaAssets.claimedContentType,
              sizeBytes: mediaAssets.sizeBytes,
              sha256: mediaAssets.sha256,
            })
            .from(mediaAssets)
            .where(and(
              eq(mediaAssets.id, priorEvent.aggregateId),
              eq(mediaAssets.ownerId, command.actorId),
            ))
            .limit(1);
          const existing = rows[0] as UploadRow | undefined;
          if (
            !existing ||
            !existing.claimedContentType ||
            !existing.sizeBytes ||
            !existing.sha256
          ) throw new MediaError("MEDIA_NOT_FOUND");
          return {
            asset: assetState(existing),
            temporaryObjectKey: existing.objectKey,
            contentType: existing.claimedContentType as ProjectImageContentType,
            sizeBytes: existing.sizeBytes,
            checksumSha256Base64: base64FromHex(existing.sha256),
            replayed: true,
          };
        }

        const [project] = await transaction
          .select({ id: projects.id, ownerId: projects.ownerId })
          .from(projects)
          .where(and(
            eq(projects.id, command.projectId),
            eq(projects.lifecycleStatus, "active"),
          ))
          .limit(1);
        if (!project || project.ownerId !== command.actorId) {
          throw new MediaError("PROJECT_NOT_FOUND");
        }

        await transaction.insert(mediaAssets).values({
          id: command.assetId,
          ownerId: command.actorId,
          projectId: command.projectId,
          purpose: command.purpose,
          status: "pending_upload",
          storageProvider: command.storageProvider,
          bucket: command.bucket,
          objectKey: command.temporaryObjectKey,
          uploadIdempotencyKey: command.idempotencyKey,
          claimedContentType: command.contentType,
          sizeBytes: command.sizeBytes,
          sha256: command.checksumSha256Hex,
          privacyVersion: 1,
          version: 1,
        });
        await transaction.insert(outboxEvents).values({
          aggregateType: "media",
          aggregateId: command.assetId,
          eventType: "media.upload.intent.created.v1",
          idempotencyKey: command.idempotencyKey,
          payload: { schemaVersion: 1, requestHashVersion: 2, requestHash: command.requestHash },
        });

        return {
          asset: {
            id: command.assetId,
            projectId: command.projectId,
            purpose: command.purpose,
            status: "pending_upload",
          },
          temporaryObjectKey: command.temporaryObjectKey,
          contentType: command.contentType,
          sizeBytes: command.sizeBytes,
          checksumSha256Base64: command.checksumSha256Base64,
          replayed: false,
        };
      });
    } catch (error) {
      if (error instanceof MediaError) throw error;
      if (databaseCode(error) === "42501") throw new MediaError("PROJECT_NOT_FOUND");
      throw error;
    }
  }

  async findUploadForCompletion(actorId: string, assetId: string): Promise<PendingUpload | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const rows = await transaction
        .select({
          id: mediaAssets.id,
          ownerId: mediaAssets.ownerId,
          projectId: mediaAssets.projectId,
          purpose: mediaAssets.purpose,
          status: mediaAssets.status,
          objectKey: mediaAssets.objectKey,
          claimedContentType: mediaAssets.claimedContentType,
          sizeBytes: mediaAssets.sizeBytes,
          sha256: mediaAssets.sha256,
        })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerId, actorId)))
        .limit(1);
      const row = rows[0] as UploadRow | undefined;
      if (
        !row ||
        !row.projectId ||
        !row.claimedContentType ||
        !row.sizeBytes ||
        !row.sha256
      ) return null;
      return {
        asset: assetState(row),
        ownerId: row.ownerId,
        temporaryObjectKey: row.objectKey,
        contentType: row.claimedContentType as ProjectImageContentType,
        maximumBytes: row.sizeBytes,
        checksumSha256Base64: base64FromHex(row.sha256),
        checksumSha256Hex: row.sha256,
      };
    });
  }

  async completeUpload(command: CompleteUploadCommand): Promise<{
    asset: MediaAssetState;
    replayed: boolean;
  }> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      await lockKey(transaction, `media-complete:v1:${command.assetId}`);
      const rows = await transaction
        .select({
          id: mediaAssets.id,
          ownerId: mediaAssets.ownerId,
          projectId: mediaAssets.projectId,
          purpose: mediaAssets.purpose,
          status: mediaAssets.status,
          objectKey: mediaAssets.objectKey,
          claimedContentType: mediaAssets.claimedContentType,
          sizeBytes: mediaAssets.sizeBytes,
          sha256: mediaAssets.sha256,
        })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, command.assetId), eq(mediaAssets.ownerId, command.actorId)))
        .limit(1);
      const row = rows[0] as UploadRow | undefined;
      if (!row) throw new MediaError("MEDIA_NOT_FOUND");
      if (["uploaded", "processing", "ready"].includes(row.status)) {
        return { asset: assetState(row), replayed: true };
      }
      if (
        row.status !== "pending_upload" ||
        row.claimedContentType !== command.objectContentType ||
        row.sizeBytes !== command.objectSizeBytes ||
        !row.sha256 ||
        base64FromHex(row.sha256) !== command.objectChecksumSha256Base64
      ) throw new MediaError("UPLOAD_INVALID");

      const [updated] = await transaction
        .update(mediaAssets)
        .set({
          status: "uploaded",
          storageVersion: command.objectEtag,
          failureCode: null,
          version: sql`${mediaAssets.version} + 1`,
        })
        .where(and(
          eq(mediaAssets.id, command.assetId),
          eq(mediaAssets.ownerId, command.actorId),
          eq(mediaAssets.status, "pending_upload"),
        ))
        .returning({
          id: mediaAssets.id,
          ownerId: mediaAssets.ownerId,
          projectId: mediaAssets.projectId,
          purpose: mediaAssets.purpose,
          status: mediaAssets.status,
        });
      if (!updated) throw new MediaError("UPLOAD_CONFLICT");

      await transaction.insert(outboxEvents).values({
        aggregateType: "media",
        aggregateId: command.assetId,
        eventType: "media.processing.requested.v1",
        idempotencyKey: `media-processing:v1:${command.assetId}`,
        payload: { schemaVersion: 1, assetId: command.assetId },
      });
      return { asset: assetState(updated as UploadRow), replayed: false };
    });
  }

  async rejectUpload(actorId: string, assetId: string, failureCode: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      await transaction
        .update(mediaAssets)
        .set({
          status: "failed",
          failureCode: assertFailureCode(failureCode),
          version: sql`${mediaAssets.version} + 1`,
        })
        .where(and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.ownerId, actorId),
          eq(mediaAssets.status, "pending_upload"),
        ));
    });
  }

  async resolveDisplayObject(
    viewer: ProjectActor,
    assetId: string,
    size: MediaDisplaySize,
  ): Promise<DisplayObject | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = actorIdFor(viewer);
      await setActor(transaction, actorId, viewer.shareLinkId);
      const result = await transaction.execute<{
        object_key: string;
        content_type: string;
        size_bytes: number | string;
        sha256: string;
        effective_privacy_version: string;
        publicly_cacheable: boolean;
      }>(sql`
        with visible_object as (
          select
            derivative.object_key,
            derivative.detected_content_type as content_type,
            derivative.size_bytes,
            derivative.sha256,
            parent.privacy_version::text || '.' || project.version::text as effective_privacy_version,
            (${actorId}::uuid is null and project.visibility = 'public') as publicly_cacheable
          from media_assets parent
          join projects project on project.id = parent.project_id
          join media_assets derivative
            on derivative.original_asset_id = parent.id
           and derivative.owner_id = parent.owner_id
           and derivative.project_id = parent.project_id
           and derivative.storage_version = ${`display-${size}-v1`}
          where parent.id = ${assetId}::uuid
            and parent.original_asset_id is null
            and parent.purpose in ('project_media', 'project_cover', 'floorplan')
            and parent.status = 'ready'
            and parent.is_current
            and derivative.status = 'ready'
            and derivative.is_current
            and derivative.detected_content_type is not null
            and derivative.size_bytes is not null
            and derivative.sha256 is not null
            and project.lifecycle_status = 'active'
            and app_can_view_project(project.id)
            and (
              project.owner_id = ${actorId}::uuid
              or parent.purpose <> 'project_media'
              or exists (
                select 1
                from update_media attachment
                join updates project_update
                  on project_update.id = attachment.update_id
                 and project_update.project_id = attachment.project_id
                where attachment.media_asset_id = parent.id
                  and project_update.status = 'published'
              )
            )

          union all

          select
            coalesce(derivative.object_key, parent.object_key) as object_key,
            coalesce(derivative.detected_content_type, parent.detected_content_type) as content_type,
            coalesce(derivative.size_bytes, parent.size_bytes) as size_bytes,
            coalesce(derivative.sha256, parent.sha256) as sha256,
            parent.privacy_version::text || '.' || profile.version::text as effective_privacy_version,
            (${actorId}::uuid is null and not profile.is_private) as publicly_cacheable
          from media_assets parent
          join profiles profile
            on profile.avatar_asset_id = parent.id
           and profile.user_id = parent.owner_id
          left join media_assets derivative
            on derivative.original_asset_id = parent.id
           and derivative.owner_id = parent.owner_id
           and derivative.project_id is null
           and derivative.purpose = 'avatar'
           and derivative.storage_version = ${`display-${size}-v1`}
           and derivative.status = 'ready'
           and derivative.is_current
           and derivative.exif_stripped
           and derivative.deleted_at is null
           and derivative.detected_content_type like 'image/%'
           and derivative.size_bytes is not null
           and derivative.sha256 is not null
          where parent.id = ${assetId}::uuid
            and parent.owner_id = profile.user_id
            and parent.project_id is null
            and parent.original_asset_id is null
            and parent.purpose = 'avatar'
            and parent.status = 'ready'
            and parent.is_current
            and parent.exif_stripped
            and parent.deleted_at is null
            and parent.ready_at is not null
            and parent.object_key like 'originals/%'
            and parent.detected_content_type like 'image/%'
            and parent.size_bytes is not null
            and parent.sha256 is not null
            and parent.width_pixels > 0
            and parent.height_pixels > 0
            and app_can_view_profile(profile.user_id)
        )
        select * from visible_object
        limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      return {
        objectKey: row.object_key,
        contentType: row.content_type,
        sizeBytes: Number(row.size_bytes),
        sha256Hex: row.sha256,
        effectivePrivacyVersion: row.effective_privacy_version,
        publiclyCacheable: row.publicly_cacheable,
      };
    });
  }

  async resolveOwnedOriginal(actorId: string, assetId: string): Promise<OriginalObject | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const [row] = await transaction
        .select({
          objectKey: mediaAssets.objectKey,
          contentType: mediaAssets.detectedContentType,
          sizeBytes: mediaAssets.sizeBytes,
          sha256Hex: mediaAssets.sha256,
        })
        .from(mediaAssets)
        .where(and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.ownerId, actorId),
          eq(mediaAssets.status, "ready"),
          eq(mediaAssets.isCurrent, true),
          sql`${mediaAssets.originalAssetId} is null`,
          sql`${mediaAssets.objectKey} like 'originals/%'`,
        ))
        .limit(1);
      if (!row || !row.contentType || !row.sizeBytes || !row.sha256Hex) return null;
      return {
        objectKey: row.objectKey,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        sha256Hex: row.sha256Hex,
      };
    });
  }

  async claimProcessingJob(workerId: string, leaseSeconds: number): Promise<MediaProcessingJob | null> {
    return this.database.transaction(async (transaction) => {
      const claimed = await transaction.execute<{ event_id: string }>(sql`
        select event_id
        from app_claim_outbox_event(
          ${workerId},
          'media.processing.requested.v1',
          ${leaseSeconds}
        )
      `);
      const eventId = claimed.rows[0]?.event_id;
      if (!eventId) return null;
      return this.beginClaimedProcessingJob(transaction, workerId, eventId);
    });
  }

  async claimProcessingJobForAsset(
    workerId: string,
    assetId: string,
    leaseSeconds: number,
  ): Promise<MediaProcessingJob | null> {
    return this.database.transaction(async (transaction) => {
      const claimed = await transaction.execute<{ event_id: string }>(sql`
        select event_id
        from app_claim_media_processing_asset(
          ${workerId},
          ${assetId}::uuid,
          ${leaseSeconds}
        )
      `);
      const eventId = claimed.rows[0]?.event_id;
      if (!eventId) return null;
      return this.beginClaimedProcessingJob(transaction, workerId, eventId);
    });
  }

  async finalizeProcessing(command: FinalizeMediaProcessingCommand): Promise<void> {
    const { job } = command;
    const derivativeRecords = command.derivatives.map((derivative) => ({
      id: derivative.assetId,
      size: derivative.size,
      objectKey: derivative.objectKey,
      contentType: derivative.variant.contentType,
      sizeBytes: derivative.variant.sizeBytes,
      sha256: derivative.variant.sha256Hex,
      widthPixels: derivative.variant.widthPixels,
      heightPixels: derivative.variant.heightPixels,
    }));
    const result = await this.database.execute<{ finalized: boolean }>(sql`
      select app_finalize_media_processing_job(
        ${job.workerId},
        ${job.eventId}::uuid,
        ${job.assetId}::uuid,
        ${command.originalObjectKey},
        ${command.original.contentType},
        ${command.original.sizeBytes},
        ${command.original.sha256Hex},
        ${command.original.widthPixels},
        ${command.original.heightPixels},
        ${JSON.stringify(derivativeRecords)}::jsonb
      ) as finalized
    `);
    if (!result.rows[0]?.finalized) throw new MediaError("WORKER_LEASE_LOST");
  }

  async failProcessing(
    job: MediaProcessingJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    const code = assertFailureCode(failureCode);
    const result = await this.database.execute<{ failed: boolean }>(sql`
      select app_fail_media_processing_job(
        ${job.workerId},
        ${job.eventId}::uuid,
        ${job.assetId}::uuid,
        ${code},
        ${retry?.delaySeconds ?? 1},
        ${retry === null}
      ) as failed
    `);
    if (!result.rows[0]?.failed) throw new MediaError("WORKER_LEASE_LOST");
  }

  async claimOrphanCleanup(
    workerId: string,
    purpose: MediaCleanupPurpose,
    leaseSeconds: number,
  ): Promise<MediaCleanupCheckpoint | null> {
    const result = await this.database.execute<{
      event_id: string;
      cleanup_purpose: MediaCleanupPurpose;
      provider_cursor: string | null;
      attempt_count: number;
    }>(sql`
      select event_id, cleanup_purpose, provider_cursor, attempt_count
      from app_media_worker_claim_orphan_cleanup(${workerId}, ${purpose}, ${leaseSeconds})
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      workerId,
      eventId: row.event_id,
      purpose: row.cleanup_purpose,
      ...(row.provider_cursor ? { cursor: row.provider_cursor } : {}),
      attemptCount: Number(row.attempt_count),
    };
  }

  async finalizeOrphanCleanup(
    checkpoint: MediaCleanupCheckpoint,
    nextCursor: string | undefined,
    scanComplete: boolean,
  ): Promise<void> {
    const result = await this.database.execute<{ finalized: boolean }>(sql`
      select app_media_worker_finalize_orphan_cleanup(
        ${checkpoint.workerId},
        ${checkpoint.eventId}::uuid,
        ${checkpoint.purpose},
        ${nextCursor ?? null},
        ${scanComplete}
      ) as finalized
    `);
    if (!result.rows[0]?.finalized) throw new MediaError("WORKER_LEASE_LOST");
  }

  async failOrphanCleanup(
    checkpoint: MediaCleanupCheckpoint,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    const code = assertFailureCode(failureCode);
    const result = await this.database.execute<{ failed: boolean }>(sql`
      select app_media_worker_fail_orphan_cleanup(
        ${checkpoint.workerId},
        ${checkpoint.eventId}::uuid,
        ${checkpoint.purpose},
        ${code},
        ${retry?.delaySeconds ?? 1},
        ${retry === null}
      ) as failed
    `);
    if (!result.rows[0]?.failed) throw new MediaError("WORKER_LEASE_LOST");
  }

  async filterProtectedObjectKeys(candidateKeys: readonly string[]): Promise<Set<string>> {
    if (candidateKeys.length === 0) return new Set();
    if (candidateKeys.length > 1_000) throw new Error("Te veel objectkeys voor één cleanupbatch.");
    const result = await this.database.execute<{ object_key: string }>(sql`
      select object_key from app_media_protected_object_keys(${[...candidateKeys]}::text[])
    `);
    return new Set(typedRows<{ object_key: string }>(result.rows).map((row) => row.object_key));
  }
}

export function expectedProcessingObjectKeys(assetId: string): string[] {
  return [
    createObjectKey("originals", assetId),
    createObjectKey("display", assetId, "small.webp"),
    createObjectKey("display", assetId, "medium.webp"),
    createObjectKey("display", assetId, "large.webp"),
  ];
}

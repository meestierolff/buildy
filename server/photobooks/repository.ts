import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  mediaAssets,
  outboxEvents,
  photobookDrafts,
  photobookExclusions,
  photobookRevisions,
} from "../../db/schema/index.js";
import {
  LAUNCH_PHOTOBOOK_FORMAT,
  photobookDocumentSchema,
  photobookPreferencesSchema,
  photobookSettingsSchema,
  type PhotobookDocument,
  type PhotobookExclusion,
  type PhotobookSettings,
} from "../../shared/contracts/photobooks.js";
import type { BuildyDatabase } from "../db/client.js";
import { createObjectKey } from "../storage/objectStorage.js";
import { PhotobookError } from "./errors.js";
import {
  PHOTOBOOK_RENDER_ENGINE,
  PHOTOBOOK_RENDER_VERSION,
  photobookAssetSetChecksum,
} from "./pdfRenderer.js";
import type {
  ApprovePhotobookProofCommand,
  FinalizePhotobookProofCommand,
  PhotobookProofAsset,
  PhotobookProofMutation,
  PhotobookProofObject,
  PhotobookProofStatus,
  PhotobookProofSummary,
  PhotobookRenderJob,
  PhotobookRepository,
  PhotobookSource,
  RequestPhotobookProofCommand,
  SavePhotobookDraftCommand,
  SavePhotobookSettingsCommand,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

type SourceHeaderRow = {
  project_id: string;
  owner_id: string;
  project_revision: number | string;
  project_title: string;
  project_subtitle: string | null;
  cover_media_asset_id: string | null;
  selected_format: string | null;
  settings_title: string | null;
  settings_subtitle: string | null;
  include_budget: boolean | null;
  preferences: unknown;
  settings_version: number | string | null;
  draft_id: string | null;
  draft_version: number | string | null;
};

type UpdateRow = {
  id: string;
  update_date: string;
  title: string | null;
  room: string | null;
  description: string | null;
  phase_id: string | null;
  phase_name: string | null;
  phase_sort_order: number | string | null;
};

type MediaRow = {
  update_id: string;
  id: string;
  sha256: string | null;
  content_type: string | null;
  width_pixels: number | string | null;
  height_pixels: number | string | null;
  sort_order: number | string;
  alt_text: string | null;
};

function numberValue(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PhotobookError("INVALID_STATE");
  return parsed;
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : numberValue(value);
}

function objectValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new PhotobookError("INVALID_STATE", { cause: error });
  }
}

async function setActor(transaction: DatabaseTransaction, actorId: string): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
}

async function lockOwnedProject(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
): Promise<{ revision: number; title: string }> {
  const result = await transaction.execute<{ content_revision: number | string; title: string }>(sql`
    select project.content_revision, project.title
    from public.projects project
    join public.app_users actor
      on actor.id = project.owner_id
     and actor.id = ${actorId}::uuid
     and actor.status = 'active'
     and actor.deleted_at is null
    where project.id = ${projectId}::uuid
      and project.owner_id = ${actorId}::uuid
      and project.lifecycle_status = 'active'
      and project.deleted_at is null
    for update of project
  `);
  const row = result.rows[0];
  if (!row) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
  return { revision: numberValue(row.content_revision), title: row.title };
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseErrorCode(error.cause) : undefined;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof PhotobookError) throw error;
  const code = databaseErrorCode(error);
  if (code === "23505") throw new PhotobookError("VERSION_CONFLICT", { cause: error });
  if (code === "23503") throw new PhotobookError("PHOTOBOOK_NOT_FOUND", { cause: error });
  if (code === "23514") throw new PhotobookError("INVALID_STATE", { cause: error });
  if (code === "40001") throw new PhotobookError("VERSION_CONFLICT", { cause: error });
  throw error;
}

function normalizedSettings(row: SourceHeaderRow): PhotobookSettings {
  const preferences = photobookPreferencesSchema.parse(objectValue(row.preferences ?? {}));
  return photobookSettingsSchema.parse({
    coverMediaAssetId: row.cover_media_asset_id,
    selectedFormat: row.selected_format ?? LAUNCH_PHOTOBOOK_FORMAT,
    title: row.settings_title,
    subtitle: row.settings_subtitle,
    includeBudget: row.include_budget ?? false,
    preferences,
    version: row.settings_version === null ? 1 : numberValue(row.settings_version),
  });
}

function requestPayloadHash(document: PhotobookDocument): string {
  return createHash("sha256")
    .update("buildy-photobook-proof-request:v1\0")
    .update(document.checksumSha256)
    .digest("hex");
}

function isProofPayload(value: unknown): value is {
  schemaVersion: 1;
  projectId: string;
  revisionId: string;
  requestHash: string;
} {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.schemaVersion === 1
    && typeof payload.projectId === "string"
    && typeof payload.revisionId === "string"
    && typeof payload.requestHash === "string";
}

async function replayedProofMutation(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
  eventType: "photobook.proof.requested.v1" | "photobook.proof.approved.v1",
  requestHash: string,
  status: "rendering" | "approved",
): Promise<PhotobookProofMutation | null> {
  const rows = await transaction
    .select({
      aggregateId: outboxEvents.aggregateId,
      eventType: outboxEvents.eventType,
      payload: outboxEvents.payload,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.idempotencyKey, idempotencyKey))
    .limit(1);
  const existing = rows[0];
  if (!existing) return null;
  if (
    existing.eventType !== eventType
    || !isProofPayload(existing.payload)
    || existing.payload.requestHash !== requestHash
    || existing.payload.revisionId !== existing.aggregateId
  ) throw new PhotobookError("IDEMPOTENCY_CONFLICT");
  return { revisionId: existing.aggregateId, status, replayed: true };
}

export class PostgresPhotobookRepository implements PhotobookRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async loadSource(actorId: string, projectId: string): Promise<PhotobookSource | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const headerResult = await transaction.execute<SourceHeaderRow>(sql`
        select
          project.id as project_id,
          project.owner_id,
          project.content_revision as project_revision,
          project.title as project_title,
          project.description as project_subtitle,
          settings.cover_media_asset_id,
          settings.selected_format,
          settings.title as settings_title,
          settings.subtitle as settings_subtitle,
          settings.include_budget,
          settings.preferences,
          settings.version as settings_version,
          draft.id as draft_id,
          draft.version as draft_version
        from public.projects project
        left join public.photobook_settings settings on settings.project_id = project.id
        left join public.photobook_drafts draft on draft.project_id = project.id
        where project.id = ${projectId}::uuid
          and project.owner_id = ${actorId}::uuid
          and project.lifecycle_status = 'active'
          and project.deleted_at is null
        limit 1
      `);
      const header = headerResult.rows[0];
      if (!header) return null;

      const updateResult = await transaction.execute<UpdateRow>(sql`
        select
          update.id,
          update.update_date,
          update.title,
          update.room,
          update.description,
          phase.id as phase_id,
          phase.name as phase_name,
          phase.sort_order as phase_sort_order
        from public.updates update
        left join public.project_phases phase
          on phase.id = update.phase_id
         and phase.project_id = update.project_id
        where update.project_id = ${projectId}::uuid
          and update.project_owner_id = ${actorId}::uuid
          and update.status <> 'deleted'
          and update.deleted_at is null
        order by update.update_date, update.sort_order, update.id
      `);
      const mediaResult = await transaction.execute<MediaRow>(sql`
        select
          link.update_id,
          asset.id,
          asset.sha256,
          asset.detected_content_type as content_type,
          asset.width_pixels,
          asset.height_pixels,
          link.sort_order,
          link.caption as alt_text
        from public.update_media link
        join public.media_assets asset
          on asset.id = link.media_asset_id
         and asset.project_id = link.project_id
        where link.project_id = ${projectId}::uuid
          and asset.owner_id = ${actorId}::uuid
          and asset.original_asset_id is null
          and asset.purpose in ('project_media', 'project_cover')
          and asset.status = 'ready'
          and asset.is_current
          and asset.deleted_at is null
        order by link.update_id, link.sort_order, asset.id
      `);
      const mediaByUpdate = new Map<string, MediaRow[]>();
      for (const media of mediaResult.rows) {
        const current = mediaByUpdate.get(media.update_id) ?? [];
        current.push(media);
        mediaByUpdate.set(media.update_id, current);
      }

      const exclusions: PhotobookExclusion[] = [];
      if (header.draft_id) {
        const exclusionRows = await transaction
          .select({
            targetType: photobookExclusions.targetType,
            updateId: photobookExclusions.updateId,
            mediaAssetId: photobookExclusions.mediaAssetId,
            chapterKey: photobookExclusions.chapterKey,
          })
          .from(photobookExclusions)
          .where(eq(photobookExclusions.draftId, header.draft_id));
        for (const exclusion of exclusionRows) {
          if (exclusion.targetType === "update" && exclusion.updateId) {
            exclusions.push({ targetType: "update", updateId: exclusion.updateId });
          } else if (exclusion.targetType === "media" && exclusion.mediaAssetId) {
            exclusions.push({ targetType: "media", mediaAssetId: exclusion.mediaAssetId });
          } else if (exclusion.targetType === "chapter" && exclusion.chapterKey) {
            exclusions.push({ targetType: "chapter", chapterKey: exclusion.chapterKey });
          } else {
            throw new PhotobookError("INVALID_STATE");
          }
        }
      }

      return {
        projectId: header.project_id,
        ownerId: header.owner_id,
        projectRevision: numberValue(header.project_revision),
        projectTitle: header.project_title,
        projectSubtitle: header.project_subtitle,
        settings: normalizedSettings(header),
        exclusions,
        draftId: header.draft_id,
        draftVersion: nullableNumber(header.draft_version),
        updates: updateResult.rows.map((update) => ({
          id: update.id,
          updateDate: update.update_date,
          title: update.title,
          room: update.room,
          description: update.description,
          phaseId: update.phase_id,
          phaseName: update.phase_name,
          phaseSortOrder: nullableNumber(update.phase_sort_order),
          media: (mediaByUpdate.get(update.id) ?? []).map((media) => ({
            id: media.id,
            sha256: media.sha256,
            contentType: media.content_type,
            widthPixels: nullableNumber(media.width_pixels),
            heightPixels: nullableNumber(media.height_pixels),
            sortOrder: numberValue(media.sort_order),
            altText: media.alt_text,
          })),
        })),
      };
    });
  }

  async saveSettings(command: SavePhotobookSettingsCommand): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await lockOwnedProject(transaction, command.actorId, command.projectId);
        if (command.settings.coverMediaAssetId) {
          const cover = await transaction
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(and(
              eq(mediaAssets.id, command.settings.coverMediaAssetId),
              eq(mediaAssets.projectId, command.projectId),
              eq(mediaAssets.ownerId, command.actorId),
              eq(mediaAssets.status, "ready"),
              eq(mediaAssets.isCurrent, true),
              inArray(mediaAssets.purpose, ["project_media", "project_cover"]),
              sql`${mediaAssets.originalAssetId} is null`,
            ))
            .limit(1);
          if (!cover[0]) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
        }

        const result = await transaction.execute<{ version: number | string }>(sql`
          insert into public.photobook_settings (
            project_id, owner_id, cover_media_asset_id, selected_format,
            title, subtitle, include_budget, preferences, version
          ) values (
            ${command.projectId}::uuid,
            ${command.actorId}::uuid,
            ${command.settings.coverMediaAssetId}::uuid,
            ${LAUNCH_PHOTOBOOK_FORMAT},
            ${command.settings.title},
            ${command.settings.subtitle},
            ${command.settings.includeBudget},
            ${JSON.stringify(command.settings.preferences)}::jsonb,
            1
          )
          on conflict (project_id) do update set
            cover_media_asset_id = excluded.cover_media_asset_id,
            selected_format = excluded.selected_format,
            title = excluded.title,
            subtitle = excluded.subtitle,
            include_budget = excluded.include_budget,
            preferences = excluded.preferences,
            version = photobook_settings.version + 1,
            updated_at = statement_timestamp()
          where photobook_settings.owner_id = ${command.actorId}::uuid
            and photobook_settings.version = ${command.settings.version}
          returning version
        `);
        if (!result.rows[0]) throw new PhotobookError("VERSION_CONFLICT");
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async replaceExclusions(
    actorId: string,
    projectId: string,
    exclusions: readonly PhotobookExclusion[],
  ): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        await setActor(transaction, actorId);
        await lockOwnedProject(transaction, actorId, projectId);
        const draftRows = await transaction
          .select({ id: photobookDrafts.id })
          .from(photobookDrafts)
          .where(and(
            eq(photobookDrafts.projectId, projectId),
            eq(photobookDrafts.ownerId, actorId),
          ))
          .limit(1);
        const draft = draftRows[0];
        if (!draft) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");

        const updateIds = exclusions.flatMap((item) => item.targetType === "update" ? [item.updateId] : []);
        const mediaIds = exclusions.flatMap((item) => item.targetType === "media" ? [item.mediaAssetId] : []);
        const chapterKeys = exclusions.flatMap((item) => item.targetType === "chapter" ? [item.chapterKey] : []);
        if (updateIds.length > 0) {
          const valid = await transaction.execute<{ count: number | string }>(sql`
            select count(*) as count
            from public.updates update
            where update.project_id = ${projectId}::uuid
              and update.project_owner_id = ${actorId}::uuid
              and update.id = any(${updateIds}::uuid[])
              and update.status <> 'deleted'
          `);
          if (numberValue(valid.rows[0]?.count ?? 0) !== new Set(updateIds).size) {
            throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
          }
        }
        if (mediaIds.length > 0) {
          const valid = await transaction.execute<{ count: number | string }>(sql`
            select count(*) as count
            from public.media_assets asset
            where asset.project_id = ${projectId}::uuid
              and asset.owner_id = ${actorId}::uuid
              and asset.id = any(${mediaIds}::uuid[])
              and asset.original_asset_id is null
              and asset.status = 'ready'
              and asset.purpose in ('project_media', 'project_cover')
          `);
          if (numberValue(valid.rows[0]?.count ?? 0) !== new Set(mediaIds).size) {
            throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
          }
        }
        const phaseIds = chapterKeys.filter((key) => key !== "other");
        if (phaseIds.length > 0) {
          const valid = await transaction.execute<{ count: number | string }>(sql`
            select count(*) as count
            from public.project_phases phase
            where phase.project_id = ${projectId}::uuid
              and phase.id = any(${phaseIds}::uuid[])
          `);
          if (numberValue(valid.rows[0]?.count ?? 0) !== new Set(phaseIds).size) {
            throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
          }
        }

        await transaction.delete(photobookExclusions)
          .where(eq(photobookExclusions.draftId, draft.id));
        const unique = new Map<string, PhotobookExclusion>();
        for (const exclusion of exclusions) {
          const key = exclusion.targetType === "update"
            ? `update:${exclusion.updateId}`
            : exclusion.targetType === "media"
              ? `media:${exclusion.mediaAssetId}`
              : `chapter:${exclusion.chapterKey}`;
          unique.set(key, exclusion);
        }
        if (unique.size > 0) {
          await transaction.insert(photobookExclusions).values(
            [...unique.values()].map((exclusion) => ({
              draftId: draft.id,
              projectId,
              targetType: exclusion.targetType,
              updateId: exclusion.targetType === "update" ? exclusion.updateId : null,
              mediaAssetId: exclusion.targetType === "media" ? exclusion.mediaAssetId : null,
              chapterKey: exclusion.targetType === "chapter" ? exclusion.chapterKey : null,
            })),
          );
        }
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async saveDraft(command: SavePhotobookDraftCommand): Promise<{ draftId: string; version: number }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        const project = await lockOwnedProject(transaction, command.actorId, command.projectId);
        if (project.revision !== command.projectRevision) throw new PhotobookError("STALE_DRAFT");

        const currentResult = await transaction.execute<{
          id: string;
          document_sha256: string | null;
          version: number | string;
        }>(sql`
          select draft.id, draft.document_sha256, draft.version
          from public.photobook_drafts draft
          where draft.project_id = ${command.projectId}::uuid
            and draft.owner_id = ${command.actorId}::uuid
          for update
        `);
        const current = currentResult.rows[0];
        if (current?.document_sha256 === command.document.checksumSha256) {
          return { draftId: current.id, version: numberValue(current.version) };
        }

        if (current) {
          await transaction.execute(sql`
            update public.media_assets asset
            set
              status = 'failed',
              failure_code = 'PROOF_SUPERSEDED',
              version = asset.version + 1,
              updated_at = statement_timestamp()
            from public.photobook_revisions revision
            where revision.draft_id = ${current.id}::uuid
              and revision.status = 'rendering'
              and revision.pdf_asset_id = asset.id
              and asset.status = 'processing'
          `);
          await transaction.execute(sql`
            update public.photobook_revisions revision
            set
              status = 'invalidated',
              invalidated_at = statement_timestamp(),
              invalidation_reason = 'canonical_draft_changed',
              updated_at = statement_timestamp()
            where revision.draft_id = ${current.id}::uuid
              and revision.status in ('rendering', 'ready', 'approved')
          `);
          await transaction.execute(sql`
            update public.outbox_events event
            set
              status = 'dead_letter',
              lease_owner = null,
              lease_expires_at = null,
              last_error_code = 'PROOF_SUPERSEDED',
              updated_at = statement_timestamp()
            where event.aggregate_type = 'photobook_proof'
              and event.event_type = 'photobook.proof.requested.v1'
              and event.status in ('pending', 'retry', 'claimed')
              and exists (
                select 1 from public.photobook_revisions revision
                where revision.id = event.aggregate_id
                  and revision.draft_id = ${current.id}::uuid
                  and revision.status = 'invalidated'
              )
          `);
        }

        const result = await transaction.execute<{ id: string; version: number | string }>(sql`
          insert into public.photobook_drafts (
            id, project_id, owner_id, status, schema_version, project_revision,
            document, document_sha256, page_count, selected_format, version
          ) values (
            ${command.draftId}::uuid,
            ${command.projectId}::uuid,
            ${command.actorId}::uuid,
            'draft',
            ${command.document.version},
            ${command.projectRevision},
            ${JSON.stringify(command.document)}::jsonb,
            ${command.document.checksumSha256},
            ${command.document.pageCount},
            ${LAUNCH_PHOTOBOOK_FORMAT},
            1
          )
          on conflict (project_id) do update set
            status = 'draft',
            schema_version = excluded.schema_version,
            project_revision = excluded.project_revision,
            document = excluded.document,
            document_sha256 = excluded.document_sha256,
            page_count = excluded.page_count,
            selected_format = excluded.selected_format,
            version = photobook_drafts.version + 1,
            updated_at = statement_timestamp()
          returning id, version
        `);
        const saved = result.rows[0];
        if (!saved) throw new PhotobookError("VERSION_CONFLICT");
        return { draftId: saved.id, version: numberValue(saved.version) };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async latestProof(actorId: string, projectId: string): Promise<PhotobookProofSummary | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const rows = await transaction
        .select({
          revisionId: photobookRevisions.id,
          status: photobookRevisions.status,
          documentSha256: photobookRevisions.documentSha256,
          pdfSha256: photobookRevisions.pdfSha256,
          pageCount: photobookRevisions.pageCount,
        })
        .from(photobookRevisions)
        .where(and(
          eq(photobookRevisions.projectId, projectId),
          eq(photobookRevisions.ownerId, actorId),
        ))
        .orderBy(desc(photobookRevisions.createdAt), desc(photobookRevisions.id))
        .limit(1);
      const row = rows[0];
      return row ? {
        ...row,
        status: row.status as PhotobookProofStatus,
      } : null;
    });
  }

  async requestProof(command: RequestPhotobookProofCommand): Promise<PhotobookProofMutation> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`);
        const replayed = await replayedProofMutation(
          transaction,
          command.idempotencyKey,
          "photobook.proof.requested.v1",
          command.requestHash,
          "rendering",
        );
        if (replayed) return replayed;

        const project = await lockOwnedProject(transaction, command.actorId, command.projectId);
        const draftResult = await transaction.execute<{
          id: string;
          version: number | string;
          project_revision: number | string;
          document_sha256: string | null;
        }>(sql`
          select draft.id, draft.version, draft.project_revision, draft.document_sha256
          from public.photobook_drafts draft
          where draft.id = ${command.draftId}::uuid
            and draft.project_id = ${command.projectId}::uuid
            and draft.owner_id = ${command.actorId}::uuid
          for update
        `);
        const draft = draftResult.rows[0];
        if (!draft) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
        if (
          numberValue(draft.version) !== command.expectedDraftVersion
          || numberValue(draft.project_revision) !== project.revision
          || draft.document_sha256 !== command.document.checksumSha256
        ) throw new PhotobookError("STALE_DRAFT");
        if (command.document.warnings.some((warning) => warning.severity === "blocking")) {
          throw new PhotobookError("PROOF_BLOCKED");
        }

        const assetSet = command.document.sourceAssets.map((asset) => ({ id: asset.id, sha256: asset.sha256 }));
        const assetSetSha256 = photobookAssetSetChecksum(assetSet);
        if (assetSet.length > 0) {
          const assets = await transaction
            .select({ id: mediaAssets.id, sha256: mediaAssets.sha256 })
            .from(mediaAssets)
            .where(and(
              inArray(mediaAssets.id, assetSet.map((asset) => asset.id)),
              eq(mediaAssets.projectId, command.projectId),
              eq(mediaAssets.ownerId, command.actorId),
              eq(mediaAssets.status, "ready"),
              eq(mediaAssets.isCurrent, true),
              inArray(mediaAssets.purpose, ["project_media", "project_cover"]),
              sql`${mediaAssets.originalAssetId} is null`,
            ));
          const hashes = new Map(assets.map((asset) => [asset.id, asset.sha256]));
          if (assetSet.some((asset) => hashes.get(asset.id) !== asset.sha256)) {
            throw new PhotobookError("STALE_DRAFT");
          }
        }

        const priorRendering = await transaction
          .select({ id: photobookRevisions.id, pdfAssetId: photobookRevisions.pdfAssetId })
          .from(photobookRevisions)
          .where(and(
            eq(photobookRevisions.draftId, command.draftId),
            inArray(photobookRevisions.status, ["rendering", "ready", "approved"]),
          ));
        const processingAssetIds = priorRendering
          .filter((revision) => revision.pdfAssetId)
          .map((revision) => revision.pdfAssetId!);
        if (processingAssetIds.length > 0) {
          await transaction.update(mediaAssets)
            .set({ status: "failed", failureCode: "PROOF_SUPERSEDED" })
            .where(and(
              inArray(mediaAssets.id, processingAssetIds),
              eq(mediaAssets.status, "processing"),
            ));
        }
        if (priorRendering.length > 0) {
          await transaction.update(photobookRevisions)
            .set({
              status: "invalidated",
              invalidatedAt: new Date(),
              invalidationReason: "superseded_by_new_render",
            })
            .where(inArray(photobookRevisions.id, priorRendering.map((revision) => revision.id)));
          await transaction.execute(sql`
            update public.outbox_events event
            set
              status = 'dead_letter',
              lease_owner = null,
              lease_expires_at = null,
              last_error_code = 'PROOF_SUPERSEDED',
              updated_at = statement_timestamp()
            where event.aggregate_id = any(${priorRendering.map((revision) => revision.id)}::uuid[])
              and event.aggregate_type = 'photobook_proof'
              and event.event_type = 'photobook.proof.requested.v1'
              and event.status in ('pending', 'retry', 'claimed')
          `);
        }

        const revisionNumberResult = await transaction.execute<{ next_revision: number | string }>(sql`
          select coalesce(max(revision.revision_number), 0) + 1 as next_revision
          from public.photobook_revisions revision
          where revision.draft_id = ${command.draftId}::uuid
        `);
        const revisionNumber = numberValue(revisionNumberResult.rows[0]?.next_revision ?? 1);

        await transaction.insert(mediaAssets).values({
          id: command.pdfAssetId,
          ownerId: command.actorId,
          projectId: command.projectId,
          purpose: "photobook_pdf",
          status: "processing",
          storageProvider: "r2",
          bucket: command.bucket,
          objectKey: command.pdfObjectKey,
          uploadIdempotencyKey: `photobook-proof:v1:${command.revisionId}`,
          claimedContentType: "application/pdf",
          exifStripped: false,
          isCurrent: true,
        });
        await transaction.insert(photobookRevisions).values({
          id: command.revisionId,
          draftId: command.draftId,
          projectId: command.projectId,
          ownerId: command.actorId,
          revisionNumber,
          status: "rendering",
          schemaVersion: command.document.version,
          projectRevision: command.document.projectRevision,
          document: command.document,
          documentSha256: command.document.checksumSha256,
          assetSet,
          assetSetSha256,
          pdfAssetId: command.pdfAssetId,
          renderEngine: PHOTOBOOK_RENDER_ENGINE,
          renderVersion: PHOTOBOOK_RENDER_VERSION,
        });
        await transaction.insert(outboxEvents).values({
          aggregateType: "photobook_proof",
          aggregateId: command.revisionId,
          eventType: "photobook.proof.requested.v1",
          idempotencyKey: command.idempotencyKey,
          payload: {
            schemaVersion: 1,
            projectId: command.projectId,
            revisionId: command.revisionId,
            requestHash: command.requestHash,
          },
        });
        await transaction.update(photobookDrafts)
          .set({ status: "rendering" })
          .where(and(
            eq(photobookDrafts.id, command.draftId),
            eq(photobookDrafts.version, command.expectedDraftVersion),
          ));
        return { revisionId: command.revisionId, status: "rendering", replayed: false };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async approveProof(command: ApprovePhotobookProofCommand): Promise<PhotobookProofMutation> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`);
        const replayed = await replayedProofMutation(
          transaction,
          command.idempotencyKey,
          "photobook.proof.approved.v1",
          command.requestHash,
          "approved",
        );
        if (replayed) return replayed;

        const result = await transaction.execute<{
          project_id: string;
          status: PhotobookProofStatus;
          document: unknown;
          document_sha256: string;
          pdf_sha256: string | null;
          project_revision: number | string;
          current_project_revision: number | string;
          current_draft_sha256: string | null;
          asset_sha256: string | null;
          asset_status: string;
          font_set_sha256: string | null;
        }>(sql`
          select
            revision.project_id,
            revision.status,
            revision.document,
            revision.document_sha256,
            revision.pdf_sha256,
            revision.project_revision,
            project.content_revision as current_project_revision,
            draft.document_sha256 as current_draft_sha256,
            asset.sha256 as asset_sha256,
            asset.status as asset_status,
            revision.font_set_sha256
          from public.photobook_revisions revision
          join public.projects project on project.id = revision.project_id
          join public.photobook_drafts draft on draft.id = revision.draft_id
          join public.media_assets asset on asset.id = revision.pdf_asset_id
          where revision.id = ${command.revisionId}::uuid
            and revision.owner_id = ${command.actorId}::uuid
            and project.lifecycle_status = 'active'
            and project.deleted_at is null
          for update of revision, draft, project
        `);
        const proof = result.rows[0];
        if (!proof) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
        if (proof.status !== "ready") throw new PhotobookError("PROOF_NOT_APPROVABLE");
        const document = photobookDocumentSchema.parse(objectValue(proof.document));
        if (
          proof.document_sha256 !== command.documentSha256
          || proof.pdf_sha256 !== command.pdfSha256
          || proof.asset_sha256 !== command.pdfSha256
          || proof.asset_status !== "ready"
          || proof.font_set_sha256 === null
        ) throw new PhotobookError("STALE_DRAFT");
        if (
          numberValue(proof.project_revision) !== numberValue(proof.current_project_revision)
          || proof.current_draft_sha256 !== proof.document_sha256
        ) throw new PhotobookError("STALE_DRAFT");
        if (document.warnings.some((warning) => warning.severity === "blocking")) {
          throw new PhotobookError("PROOF_BLOCKED");
        }

        await transaction.update(photobookRevisions)
          .set({
            status: "approved",
            approvedById: command.actorId,
            approvedAt: command.approvedAt,
          })
          .where(and(
            eq(photobookRevisions.id, command.revisionId),
            eq(photobookRevisions.status, "ready"),
          ));
        await transaction.insert(outboxEvents).values({
          aggregateType: "photobook_proof",
          aggregateId: command.revisionId,
          eventType: "photobook.proof.approved.v1",
          idempotencyKey: command.idempotencyKey,
          payload: {
            schemaVersion: 1,
            projectId: proof.project_id,
            revisionId: command.revisionId,
            requestHash: command.requestHash,
          },
        });
        return { revisionId: command.revisionId, status: "approved", replayed: false };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async resolveProofObject(actorId: string, revisionId: string): Promise<PhotobookProofObject | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<{
        revision_id: string;
        status: "ready" | "approved" | "locked";
        document_sha256: string;
        object_key: string;
        content_type: string;
        size_bytes: number | string;
        sha256: string;
      }>(sql`
        select
          revision.id as revision_id,
          revision.status,
          revision.document_sha256,
          asset.object_key,
          asset.detected_content_type as content_type,
          asset.size_bytes,
          asset.sha256
        from public.photobook_revisions revision
        join public.media_assets asset
          on asset.id = revision.pdf_asset_id
         and asset.project_id = revision.project_id
        where revision.id = ${revisionId}::uuid
          and revision.owner_id = ${actorId}::uuid
          and revision.status in ('ready', 'approved', 'locked')
          and asset.owner_id = ${actorId}::uuid
          and asset.purpose = 'photobook_pdf'
          and asset.status = 'ready'
          and asset.detected_content_type = 'application/pdf'
          and asset.sha256 = revision.pdf_sha256
          and asset.size_bytes = revision.pdf_size_bytes
        limit 1
      `);
      const row = result.rows[0];
      if (!row || row.content_type !== "application/pdf") return null;
      return {
        revisionId: row.revision_id,
        status: row.status,
        documentSha256: row.document_sha256,
        objectKey: row.object_key,
        contentType: "application/pdf",
        sizeBytes: numberValue(row.size_bytes),
        sha256: row.sha256,
      };
    });
  }

  async claimRenderJob(workerId: string, leaseSeconds: number): Promise<PhotobookRenderJob | null> {
    return this.database.transaction(async (transaction) => {
      const claimed = await transaction.execute<{ event_id: string }>(sql`
        select event_id from public.app_photobook_worker_claim(${workerId}, ${leaseSeconds})
      `);
      const eventId = claimed.rows[0]?.event_id;
      if (!eventId) return null;
      const begun = await transaction.execute<{
        event_id: string;
        revision_id: string;
        pdf_asset_id: string;
        pdf_object_key: string;
        document: unknown;
        source_assets: unknown;
        attempt_count: number | string;
      }>(sql`select * from public.app_begin_photobook_render(${workerId}, ${eventId}::uuid)`);
      const row = begun.rows[0];
      if (!row) {
        throw new PhotobookError("INVALID_STATE");
      }
      const document = photobookDocumentSchema.parse(objectValue(row.document));
      const rawAssets = objectValue(row.source_assets);
      if (!Array.isArray(rawAssets)) throw new PhotobookError("INVALID_STATE");
      const assets = rawAssets.map((value): PhotobookProofAsset => {
        if (!value || typeof value !== "object") throw new PhotobookError("INVALID_STATE");
        const asset = value as Record<string, unknown>;
        const contentType = asset.contentType;
        if (!document.sourceAssets.some((source) => source.id === asset.id)) {
          throw new PhotobookError("INVALID_STATE");
        }
        if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(String(contentType))) {
          throw new PhotobookError("INVALID_STATE");
        }
        return {
          id: String(asset.id),
          objectKey: String(asset.objectKey),
          sizeBytes: numberValue(asset.sizeBytes as number | string),
          sha256: String(asset.sha256),
          contentType: contentType as PhotobookProofAsset["contentType"],
          widthPixels: numberValue(asset.widthPixels as number | string),
          heightPixels: numberValue(asset.heightPixels as number | string),
        };
      });
      return {
        workerId,
        eventId: row.event_id,
        revisionId: row.revision_id,
        pdfAssetId: row.pdf_asset_id,
        pdfObjectKey: row.pdf_object_key,
        document,
        assets,
        attemptCount: numberValue(row.attempt_count),
      };
    });
  }

  async finalizeProof(command: FinalizePhotobookProofCommand): Promise<void> {
    const result = await this.database.execute<{ finalized: boolean }>(sql`
      select public.app_finalize_photobook_render(
        ${command.job.workerId},
        ${command.job.eventId}::uuid,
        ${command.job.revisionId}::uuid,
        ${command.pdfSha256},
        ${command.pdfSizeBytes},
        ${command.pageCount},
        ${command.assetSetSha256},
        ${command.fontSetSha256},
        ${command.renderEngine},
        ${command.renderVersion}
      ) as finalized
    `);
    if (!result.rows[0]?.finalized) throw new PhotobookError("WORKER_LEASE_LOST");
  }

  async failProof(
    job: PhotobookRenderJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    const safeCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(failureCode)
      ? failureCode
      : "PHOTOBOOK_RENDER_FAILED";
    const result = await this.database.execute<{ failed: boolean }>(sql`
      select public.app_fail_photobook_render(
        ${job.workerId},
        ${job.eventId}::uuid,
        ${job.revisionId}::uuid,
        ${safeCode},
        ${retry?.delaySeconds ?? 1},
        ${retry === null}
      ) as failed
    `);
    if (!result.rows[0]?.failed) throw new PhotobookError("WORKER_LEASE_LOST");
  }
}

export function photobookProofRequestHash(document: PhotobookDocument): string {
  return requestPayloadHash(document);
}

export function expectedPhotobookPdfObjectKey(pdfAssetId: string): string {
  return createObjectKey("photobook-pdfs", pdfAssetId);
}

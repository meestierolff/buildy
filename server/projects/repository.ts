import { and, eq, inArray, sql } from "drizzle-orm";
import {
  mediaAssets,
  outboxEvents,
  projectPhases,
  projectPrivateDetails,
  projects,
  updateMedia,
  updates,
} from "../../db/schema/index.js";
import type {
  FollowingActivity,
  ProjectCard,
  ProjectOverview,
  ProjectPhase,
  ProjectUpdate,
} from "../../shared/contracts/projects.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "./actor.js";
import type { DashboardCursor, DiscoveryCursor, TimelineCursor } from "./cursor.js";
import { ProjectError } from "./errors.js";
import type {
  CreateProjectCommand,
  CreateProjectPhaseCommand,
  CreateUpdateCommand,
  DeleteProjectCommand,
  DeleteUpdateCommand,
  EditUpdateCommand,
  MutationReference,
  ProjectDeletionMutation,
  ProjectRepository,
  UpdateProjectCommand,
} from "./types.js";
import { STANDARD_PROJECT_PHASES } from "./types.js";

type DatabaseTransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<DatabaseTransactionCallback>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProjectAccessFacts = {
  ownerId: string;
  visibility: "private" | "public";
  lifecycleStatus: "active" | "deletion_pending" | "deleted";
  acceptedAccess: boolean;
  blocked: boolean;
};

export function canActorViewProject(viewer: ProjectActor, facts: ProjectAccessFacts): boolean {
  if (facts.lifecycleStatus !== "active" || facts.blocked) return false;
  if (viewer.kind === "anonymous") return facts.visibility === "public";
  return facts.ownerId === viewer.appUserId || facts.visibility === "public" || facts.acceptedAccess;
}

type RawProjectCard = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  project_type: string | null;
  visibility: "private" | "public";
  progress_percentage: number;
  version: number;
  updated_at: Date | string;
  published_at: Date | string | null;
  owner_id: string;
  owner_display_name: string;
  owner_slug: string;
  update_count: number | string;
  last_update_at: Date | string | null;
  cover_id: string | null;
  cover_content_type: string | null;
  cover_width: number | null;
  cover_height: number | null;
};

type RawProjectOverview = RawProjectCard & {
  start_date: string | null;
  expected_end_date: string | null;
  content_revision: number | string;
  follower_count: number | string;
  viewer_access: "owner" | "granted" | "public";
  phases: ProjectPhase[];
};

type RawProjectUpdate = {
  id: string;
  projectId: string;
  phase: ProjectPhase | null;
  title: string | null;
  room: string | null;
  description: string | null;
  updateDate: string;
  status: "draft" | "published";
  isMilestone: boolean;
  sortOrder: number;
  contentRevision: number | string;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  media: Array<{
    id: string;
    contentType: string | null;
    width: number | null;
    height: number | null;
    role: "gallery" | "before" | "after";
    sortOrder: number;
    caption: string | null;
  }>;
};

type RawFollowingActivity = {
  project_id: string;
  project_title: string;
  document: RawProjectUpdate;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function typedRows<T>(rows: unknown[]): T[] {
  return rows as T[];
}

function mapProjectCard(row: RawProjectCard): ProjectCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    projectType: row.project_type,
    visibility: row.visibility,
    progressPercentage: Number(row.progress_percentage),
    version: Number(row.version),
    updatedAt: iso(row.updated_at),
    publishedAt: nullableIso(row.published_at),
    updateCount: Number(row.update_count),
    lastUpdateAt: nullableIso(row.last_update_at),
    owner: {
      id: row.owner_id,
      displayName: row.owner_display_name,
      slug: row.owner_slug,
    },
    cover: row.cover_id
      ? {
          id: row.cover_id,
          contentType: row.cover_content_type,
          width: row.cover_width,
          height: row.cover_height,
          proxyPath: `/api/media/${row.cover_id}`,
        }
      : null,
  };
}

function mapProjectOverview(row: RawProjectOverview): ProjectOverview {
  return {
    ...mapProjectCard(row),
    startDate: row.start_date,
    expectedEndDate: row.expected_end_date,
    contentRevision: Number(row.content_revision),
    followerCount: Number(row.follower_count),
    viewerAccess: row.viewer_access,
    canEdit: row.viewer_access === "owner",
    phases: row.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      sortOrder: Number(phase.sortOrder),
      isCustom: phase.isCustom,
    })),
  };
}

function mapProjectUpdate(row: RawProjectUpdate): ProjectUpdate {
  return {
    ...row,
    contentRevision: Number(row.contentRevision),
    version: Number(row.version),
    phase: row.phase
      ? { ...row.phase, sortOrder: Number(row.phase.sortOrder) }
      : null,
    media: row.media.map((media) => ({
      ...media,
      width: media.width === null ? null : Number(media.width),
      height: media.height === null ? null : Number(media.height),
      sortOrder: Number(media.sortOrder),
      proxyPath: `/api/media/${media.id}`,
    })),
  };
}

function actorIdFor(viewer: ProjectActor): string | null {
  return viewer.kind === "authenticated" ? viewer.appUserId : null;
}

async function setActor(transaction: DatabaseTransaction, actorId: string | null): Promise<void> {
  await transaction.execute(
    sql`select set_config('app.actor_id', ${actorId ?? ""}, true)`,
  );
}

async function lockIdempotencyKey(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
  );
}

async function replayedMutation(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
  eventType: string,
  requestHash: string,
): Promise<MutationReference | null> {
  const records = await transaction
    .select({
      aggregateId: outboxEvents.aggregateId,
      eventType: outboxEvents.eventType,
      payload: outboxEvents.payload,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.idempotencyKey, idempotencyKey))
    .limit(1);
  const existing = records[0];
  if (!existing) return null;
  if (existing.eventType !== eventType || existing.payload.requestHash !== requestHash) {
    throw new ProjectError("IDEMPOTENCY_CONFLICT");
  }
  const resultId = existing.payload.resultId;
  return {
    id: typeof resultId === "string" && UUID.test(resultId) ? resultId : existing.aggregateId,
    replayed: true,
  };
}

async function appendMutationEvent(
  transaction: DatabaseTransaction,
  input: {
    aggregateType: "project" | "update";
    aggregateId: string;
    eventType: string;
    idempotencyKey: string;
    requestHash: string;
    resultId?: string;
  },
): Promise<void> {
  await transaction.insert(outboxEvents).values({
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    payload: {
      schemaVersion: 1,
      requestHash: input.requestHash,
      ...(input.resultId ? { resultId: input.resultId } : {}),
    },
  });
}

async function assertPhase(
  transaction: DatabaseTransaction,
  projectId: string,
  phaseId: string | null | undefined,
): Promise<void> {
  if (!phaseId) return;
  const phase = await transaction
    .select({ id: projectPhases.id })
    .from(projectPhases)
    .where(and(eq(projectPhases.id, phaseId), eq(projectPhases.projectId, projectId)))
    .limit(1);
  if (!phase[0]) throw new ProjectError("INVALID_PHASE");
}

async function assertMedia(
  transaction: DatabaseTransaction,
  projectId: string,
  actorId: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return;
  const records = await transaction
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(
      inArray(mediaAssets.id, assetIds),
      eq(mediaAssets.projectId, projectId),
      eq(mediaAssets.ownerId, actorId),
      eq(mediaAssets.purpose, "project_media"),
      eq(mediaAssets.status, "ready"),
      eq(mediaAssets.isCurrent, true),
    ));
  if (records.length !== new Set(assetIds).size) throw new ProjectError("INVALID_MEDIA");
}

async function explainProjectMutationFailure(
  transaction: DatabaseTransaction,
  projectId: string,
  actorId: string,
  expectedVersion?: number,
): Promise<never> {
  const result = await transaction
    .select({
      ownerId: projects.ownerId,
      lifecycleStatus: projects.lifecycleStatus,
      version: projects.version,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = result[0];
  if (!project || project.ownerId !== actorId) throw new ProjectError("PROJECT_NOT_FOUND");
  if (project.lifecycleStatus !== "active") throw new ProjectError("PROJECT_NOT_ACTIVE");
  if (expectedVersion !== undefined && project.version !== expectedVersion) {
    throw new ProjectError("VERSION_CONFLICT");
  }
  throw new ProjectError("VERSION_CONFLICT");
}

function isConstraint(error: unknown, constraint: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "constraint" in error &&
      error.constraint === constraint,
  );
}

const PROJECT_DELETION_STATUSES = new Set<ProjectDeletionMutation["status"]>([
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

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresCode(error.cause) : undefined;
}

function nonnegativeInteger(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ProjectError("PROJECT_NOT_ACTIVE");
  return parsed;
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async createProject(command: CreateProjectCommand): Promise<MutationReference> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.ownerId);
      await lockIdempotencyKey(transaction, command.idempotencyKey);
      const replay = await replayedMutation(
        transaction,
        command.idempotencyKey,
        "project.created.v1",
        command.requestHash,
      );
      if (replay) return replay;

      await transaction.insert(projects).values({
        id: command.projectId,
        ownerId: command.ownerId,
        slug: command.slug,
        title: command.input.title,
        description: command.input.description ?? null,
        projectType: command.input.projectType ?? null,
        startDate: command.input.startDate ?? null,
        expectedEndDate: command.input.expectedEndDate ?? null,
        visibility: "private",
        lifecycleStatus: "active",
        progressPercentage: 0,
        contentRevision: 1,
        version: 1,
      });
      await transaction.insert(projectPrivateDetails).values({
        projectId: command.projectId,
        ownerId: command.ownerId,
        ...command.privateDetails,
        version: 1,
      });
      await transaction.insert(projectPhases).values(
        STANDARD_PROJECT_PHASES.map((name, sortOrder) => ({
          projectId: command.projectId,
          name,
          sortOrder,
          isCustom: false,
        })),
      );
      await appendMutationEvent(transaction, {
        aggregateType: "project",
        aggregateId: command.projectId,
        eventType: "project.created.v1",
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
      });
      return { id: command.projectId, replayed: false };
    });
  }

  async updateProject(command: UpdateProjectCommand): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.ownerId);
        const input = command.input;
        const values = {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.projectType !== undefined ? { projectType: input.projectType } : {}),
          ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
          ...(input.expectedEndDate !== undefined ? { expectedEndDate: input.expectedEndDate } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
          ...(input.progressPercentage !== undefined
            ? { progressPercentage: input.progressPercentage }
            : {}),
          ...(input.visibility === "public"
            ? { publishedAt: sql`coalesce(${projects.publishedAt}, ${command.now})` }
            : {}),
          contentRevision: sql`${projects.contentRevision} + 1`,
          version: sql`${projects.version} + 1`,
          updatedAt: command.now,
        };
        const updated = await transaction
          .update(projects)
          .set(values)
          .where(and(
            eq(projects.id, command.projectId),
            eq(projects.ownerId, command.ownerId),
            eq(projects.lifecycleStatus, "active"),
            eq(projects.version, input.expectedVersion),
          ))
          .returning({ id: projects.id });
        if (!updated[0]) {
          await explainProjectMutationFailure(
            transaction,
            command.projectId,
            command.ownerId,
            input.expectedVersion,
          );
        }
      });
    } catch (error) {
      if (isConstraint(error, "projects_date_order_ck")) {
        throw new ProjectError("INVALID_PROJECT_DATES");
      }
      throw error;
    }
  }

  async requestProjectDeletion(command: DeleteProjectCommand): Promise<ProjectDeletionMutation> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        const result = await transaction.execute<{
          job_id: string;
          job_status: string;
          active_order_count: number | string;
          replayed: boolean;
        }>(sql`
          select * from public.app_request_project_deletion(
            ${command.projectId}::uuid,
            ${command.input.expectedVersion},
            ${command.idempotencyKey},
            ${command.retentionPolicyVersion}
          )
        `);
        const row = result.rows[0];
        if (!row || !PROJECT_DELETION_STATUSES.has(row.job_status as ProjectDeletionMutation["status"])) {
          throw new ProjectError("PROJECT_NOT_ACTIVE");
        }
        return {
          jobId: row.job_id,
          projectId: command.projectId,
          status: row.job_status as ProjectDeletionMutation["status"],
          activeOrderCount: nonnegativeInteger(row.active_order_count),
          replayed: row.replayed,
        };
      });
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      const code = postgresCode(error);
      if (code === "40001") throw new ProjectError("VERSION_CONFLICT", { cause: error });
      if (code === "42501") throw new ProjectError("PROJECT_NOT_FOUND", { cause: error });
      if (code === "23505") throw new ProjectError("IDEMPOTENCY_CONFLICT", { cause: error });
      if (code === "22023" || code === "23514") {
        throw new ProjectError("PROJECT_NOT_ACTIVE", { cause: error });
      }
      throw error;
    }
  }

  async listDashboard(
    actorId: string,
    cursor: DashboardCursor | undefined,
    limit: number,
  ): Promise<ProjectCard[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const cursorFilter = cursor
        ? sql`and (project.updated_at, project.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`
        : sql``;
      const result = await transaction.execute(sql<RawProjectCard>`
        select
          project.id,
          project.slug,
          project.title,
          project.description,
          project.project_type,
          project.visibility,
          project.progress_percentage,
          project.version,
          project.updated_at,
          project.published_at,
          project.owner_id,
          coalesce(owner_profile.display_name, 'Buildy-bouwer') as owner_display_name,
          coalesce(owner_profile.slug, 'gebruiker-' || left(project.owner_id::text, 8)) as owner_slug,
          coalesce(update_stats.update_count, 0) as update_count,
          update_stats.last_update_at,
          cover.id as cover_id,
          cover.detected_content_type as cover_content_type,
          cover.width_pixels as cover_width,
          cover.height_pixels as cover_height
        from projects project
        left join profiles owner_profile on owner_profile.user_id = project.owner_id
        left join lateral (
          select count(*)::integer as update_count, max(item.updated_at) as last_update_at
          from updates item
          where item.project_id = project.id
            and item.status in ('draft', 'published')
        ) update_stats on true
        left join lateral (
          select asset.id, asset.detected_content_type, asset.width_pixels, asset.height_pixels
          from media_assets asset
          where asset.project_id = project.id
            and asset.owner_id = project.owner_id
            and asset.purpose = 'project_cover'
            and asset.status = 'ready'
            and asset.is_current
          order by asset.updated_at desc, asset.id desc
          limit 1
        ) cover on true
        where project.owner_id = ${actorId}::uuid
          and project.lifecycle_status = 'active'
          ${cursorFilter}
        order by project.updated_at desc, project.id desc
        limit ${limit}
      `);
      return typedRows<RawProjectCard>(result.rows).map(mapProjectCard);
    });
  }

  async listDiscovery(
    viewer: ProjectActor,
    cursor: DiscoveryCursor | undefined,
    limit: number,
  ): Promise<ProjectCard[]> {
    return this.database.transaction(async (transaction) => {
      const actorId = actorIdFor(viewer);
      await setActor(transaction, actorId);
      const cursorFilter = cursor
        ? sql`and (project.published_at, project.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`
        : sql``;
      const result = await transaction.execute(sql<RawProjectCard>`
        select
          project.id,
          project.slug,
          project.title,
          project.description,
          project.project_type,
          project.visibility,
          project.progress_percentage,
          project.version,
          project.updated_at,
          project.published_at,
          project.owner_id,
          coalesce(owner_profile.display_name, 'Buildy-bouwer') as owner_display_name,
          coalesce(owner_profile.slug, 'gebruiker-' || left(project.owner_id::text, 8)) as owner_slug,
          coalesce(update_stats.update_count, 0) as update_count,
          update_stats.last_update_at,
          cover.id as cover_id,
          cover.detected_content_type as cover_content_type,
          cover.width_pixels as cover_width,
          cover.height_pixels as cover_height
        from projects project
        left join profiles owner_profile on owner_profile.user_id = project.owner_id
        left join lateral (
          select count(*)::integer as update_count, max(item.updated_at) as last_update_at
          from updates item
          where item.project_id = project.id
            and item.status = 'published'
        ) update_stats on true
        left join lateral (
          select asset.id, asset.detected_content_type, asset.width_pixels, asset.height_pixels
          from media_assets asset
          where asset.project_id = project.id
            and asset.owner_id = project.owner_id
            and asset.purpose = 'project_cover'
            and asset.status = 'ready'
            and asset.is_current
          order by asset.updated_at desc, asset.id desc
          limit 1
        ) cover on true
        where project.visibility = 'public'
          and project.lifecycle_status = 'active'
          and project.published_at is not null
          and (${actorId}::uuid is null or project.owner_id <> ${actorId}::uuid)
          and not exists (
            select 1
            from user_relationships relationship
            where relationship.kind = 'block'
              and relationship.status = 'active'
              and (
                (relationship.source_user_id = ${actorId}::uuid and relationship.target_user_id = project.owner_id)
                or (relationship.target_user_id = ${actorId}::uuid and relationship.source_user_id = project.owner_id)
              )
          )
          ${cursorFilter}
        order by project.published_at desc, project.id desc
        limit ${limit}
      `);
      return typedRows<RawProjectCard>(result.rows).map(mapProjectCard);
    });
  }

  async listFollowingProjects(actorId: string, limit: number): Promise<ProjectCard[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute(sql<RawProjectCard>`
        select
          project.id,
          project.slug,
          project.title,
          project.description,
          project.project_type,
          project.visibility,
          project.progress_percentage,
          project.version,
          project.updated_at,
          project.published_at,
          project.owner_id,
          coalesce(owner_profile.display_name, 'Buildy-bouwer') as owner_display_name,
          coalesce(owner_profile.slug, 'gebruiker-' || left(project.owner_id::text, 8)) as owner_slug,
          coalesce(update_stats.update_count, 0) as update_count,
          update_stats.last_update_at,
          cover.id as cover_id,
          cover.detected_content_type as cover_content_type,
          cover.width_pixels as cover_width,
          cover.height_pixels as cover_height
        from projects project
        left join profiles owner_profile on owner_profile.user_id = project.owner_id
        left join lateral (
          select count(*)::integer as update_count, max(item.updated_at) as last_update_at
          from updates item
          where item.project_id = project.id
            and item.status = 'published'
        ) update_stats on true
        left join lateral (
          select asset.id, asset.detected_content_type, asset.width_pixels, asset.height_pixels
          from media_assets asset
          where asset.project_id = project.id
            and asset.owner_id = project.owner_id
            and asset.purpose = 'project_cover'
            and asset.status = 'ready'
            and asset.is_current
          order by asset.updated_at desc, asset.id desc
          limit 1
        ) cover on true
        where project.lifecycle_status = 'active'
          and (
            exists (
              select 1
              from project_followers project_follow
              where project_follow.project_id = project.id
                and project_follow.follower_id = ${actorId}::uuid
                and project_follow.status = 'active'
            )
            or (
              project.visibility = 'public'
              and exists (
                select 1
                from user_relationships builder_follow
                where builder_follow.source_user_id = ${actorId}::uuid
                  and builder_follow.target_user_id = project.owner_id
                  and builder_follow.kind = 'follow'
                  and builder_follow.status = 'active'
              )
            )
          )
          and (
            project.visibility = 'public'
            or exists (
              select 1
              from project_access_requests accepted_access
              where accepted_access.project_id = project.id
                and accepted_access.requester_id = ${actorId}::uuid
                and accepted_access.status = 'accepted'
            )
          )
          and not exists (
            select 1
            from user_relationships block
            where block.kind = 'block'
              and block.status = 'active'
              and (
                (block.source_user_id = ${actorId}::uuid and block.target_user_id = project.owner_id)
                or (block.target_user_id = ${actorId}::uuid and block.source_user_id = project.owner_id)
              )
          )
        order by update_stats.last_update_at desc nulls last, project.updated_at desc, project.id desc
        limit ${limit}
      `);
      return typedRows<RawProjectCard>(result.rows).map(mapProjectCard);
    });
  }

  async listFollowingActivity(actorId: string, limit: number): Promise<FollowingActivity[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute(sql<RawFollowingActivity>`
        select
          project.id as project_id,
          project.title as project_title,
          jsonb_build_object(
            'id', item.id,
            'projectId', item.project_id,
            'phase', case when phase.id is null then null else jsonb_build_object(
              'id', phase.id,
              'name', phase.name,
              'sortOrder', phase.sort_order,
              'isCustom', phase.is_custom
            ) end,
            'title', item.title,
            'room', item.room,
            'description', item.description,
            'updateDate', item.update_date,
            'status', item.status,
            'isMilestone', item.is_milestone,
            'sortOrder', item.sort_order,
            'contentRevision', item.content_revision,
            'version', item.version,
            'publishedAt', item.published_at,
            'updatedAt', item.updated_at,
            'media', coalesce(item_media.items, '[]'::jsonb)
          ) as document
        from updates item
        join projects project on project.id = item.project_id
        left join project_phases phase
          on phase.id = item.phase_id and phase.project_id = item.project_id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id', asset.id,
            'contentType', asset.detected_content_type,
            'width', asset.width_pixels,
            'height', asset.height_pixels,
            'role', attachment.role,
            'sortOrder', attachment.sort_order,
            'caption', attachment.caption
          ) order by attachment.sort_order, asset.id) as items
          from update_media attachment
          join media_assets asset
            on asset.id = attachment.media_asset_id
           and asset.project_id = attachment.project_id
          where attachment.update_id = item.id
            and asset.status = 'ready'
            and asset.is_current
        ) item_media on true
        where item.status = 'published'
          and project.lifecycle_status = 'active'
          and (
            exists (
              select 1
              from project_followers project_follow
              where project_follow.project_id = project.id
                and project_follow.follower_id = ${actorId}::uuid
                and project_follow.status = 'active'
            )
            or (
              project.visibility = 'public'
              and exists (
                select 1
                from user_relationships builder_follow
                where builder_follow.source_user_id = ${actorId}::uuid
                  and builder_follow.target_user_id = project.owner_id
                  and builder_follow.kind = 'follow'
                  and builder_follow.status = 'active'
              )
            )
          )
          and (
            project.visibility = 'public'
            or exists (
              select 1
              from project_access_requests accepted_access
              where accepted_access.project_id = project.id
                and accepted_access.requester_id = ${actorId}::uuid
                and accepted_access.status = 'accepted'
            )
          )
          and not exists (
            select 1
            from user_relationships block
            where block.kind = 'block'
              and block.status = 'active'
              and (
                (block.source_user_id = ${actorId}::uuid and block.target_user_id = project.owner_id)
                or (block.target_user_id = ${actorId}::uuid and block.source_user_id = project.owner_id)
              )
          )
        order by coalesce(item.published_at, item.updated_at) desc, item.id desc
        limit ${limit}
      `);
      return typedRows<RawFollowingActivity>(result.rows).map((row) => ({
        project: { id: row.project_id, title: row.project_title },
        update: mapProjectUpdate(row.document),
      }));
    });
  }

  async getOverview(viewer: ProjectActor, projectId: string): Promise<ProjectOverview | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = actorIdFor(viewer);
      await setActor(transaction, actorId);
      const result = await transaction.execute(sql<RawProjectOverview>`
        select
          project.id,
          project.slug,
          project.title,
          project.description,
          project.project_type,
          project.visibility,
          project.progress_percentage,
          project.version,
          project.updated_at,
          project.published_at,
          project.start_date,
          project.expected_end_date,
          project.content_revision,
          project.owner_id,
          coalesce(owner_profile.display_name, 'Buildy-bouwer') as owner_display_name,
          coalesce(owner_profile.slug, 'gebruiker-' || left(project.owner_id::text, 8)) as owner_slug,
          coalesce(update_stats.update_count, 0) as update_count,
          update_stats.last_update_at,
          coalesce(follower_stats.follower_count, 0) as follower_count,
          case
            when project.owner_id = ${actorId}::uuid then 'owner'
            when accepted_access.id is not null then 'granted'
            else 'public'
          end as viewer_access,
          coalesce(phases.items, '[]'::jsonb) as phases,
          cover.id as cover_id,
          cover.detected_content_type as cover_content_type,
          cover.width_pixels as cover_width,
          cover.height_pixels as cover_height
        from projects project
        left join profiles owner_profile on owner_profile.user_id = project.owner_id
        left join project_access_requests accepted_access
          on accepted_access.project_id = project.id
         and accepted_access.requester_id = ${actorId}::uuid
         and accepted_access.status = 'accepted'
        left join lateral (
          select
            count(*) filter (
              where item.status = 'published' or project.owner_id = ${actorId}::uuid
            )::integer as update_count,
            max(item.updated_at) filter (
              where item.status = 'published' or project.owner_id = ${actorId}::uuid
            ) as last_update_at
          from updates item
          where item.project_id = project.id
            and item.status in ('draft', 'published')
        ) update_stats on true
        left join lateral (
          select count(*)::integer as follower_count
          from project_followers follower
          where follower.project_id = project.id and follower.status = 'active'
        ) follower_stats on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id', phase.id,
            'name', phase.name,
            'sortOrder', phase.sort_order,
            'isCustom', phase.is_custom
          ) order by phase.sort_order, phase.id) as items
          from project_phases phase
          where phase.project_id = project.id
        ) phases on true
        left join lateral (
          select asset.id, asset.detected_content_type, asset.width_pixels, asset.height_pixels
          from media_assets asset
          where asset.project_id = project.id
            and asset.owner_id = project.owner_id
            and asset.purpose = 'project_cover'
            and asset.status = 'ready'
            and asset.is_current
          order by asset.updated_at desc, asset.id desc
          limit 1
        ) cover on true
        where project.id = ${projectId}::uuid
          and project.lifecycle_status = 'active'
          and not exists (
            select 1 from user_relationships relationship
            where relationship.kind = 'block'
              and relationship.status = 'active'
              and (
                (relationship.source_user_id = ${actorId}::uuid and relationship.target_user_id = project.owner_id)
                or (relationship.target_user_id = ${actorId}::uuid and relationship.source_user_id = project.owner_id)
              )
          )
          and (
            project.owner_id = ${actorId}::uuid
            or project.visibility = 'public'
            or accepted_access.id is not null
          )
        limit 1
      `);
      const row = typedRows<RawProjectOverview>(result.rows)[0];
      return row ? mapProjectOverview(row) : null;
    });
  }

  async listTimeline(
    viewer: ProjectActor,
    projectId: string,
    cursor: TimelineCursor | undefined,
    limit: number,
  ): Promise<ProjectUpdate[] | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = actorIdFor(viewer);
      await setActor(transaction, actorId);
      const cursorFilter = cursor
        ? sql`and (item.update_date, item.sort_order, item.id) < (${cursor.updateDate}::date, ${cursor.sortOrder}, ${cursor.id}::uuid)`
        : sql``;
      const result = await transaction.execute(sql<{ project_id: string; items: RawProjectUpdate[] }>`
        select project.id as project_id, coalesce(timeline.items, '[]'::jsonb) as items
        from projects project
        left join project_access_requests accepted_access
          on accepted_access.project_id = project.id
         and accepted_access.requester_id = ${actorId}::uuid
         and accepted_access.status = 'accepted'
        left join lateral (
          select jsonb_agg(entry.document order by entry.update_date desc, entry.sort_order desc, entry.id desc) as items
          from (
            select
              item.update_date,
              item.sort_order,
              item.id,
              jsonb_build_object(
                'id', item.id,
                'projectId', item.project_id,
                'phase', case when phase.id is null then null else jsonb_build_object(
                  'id', phase.id,
                  'name', phase.name,
                  'sortOrder', phase.sort_order,
                  'isCustom', phase.is_custom
                ) end,
                'title', item.title,
                'room', item.room,
                'description', item.description,
                'updateDate', item.update_date,
                'status', item.status,
                'isMilestone', item.is_milestone,
                'sortOrder', item.sort_order,
                'contentRevision', item.content_revision,
                'version', item.version,
                'publishedAt', item.published_at,
                'updatedAt', item.updated_at,
                'media', coalesce(item_media.items, '[]'::jsonb)
              ) as document
            from updates item
            left join project_phases phase
              on phase.id = item.phase_id and phase.project_id = item.project_id
            left join lateral (
              select jsonb_agg(jsonb_build_object(
                'id', asset.id,
                'contentType', asset.detected_content_type,
                'width', asset.width_pixels,
                'height', asset.height_pixels,
                'role', attachment.role,
                'sortOrder', attachment.sort_order,
                'caption', attachment.caption
              ) order by attachment.sort_order, asset.id) as items
              from update_media attachment
              join media_assets asset
                on asset.id = attachment.media_asset_id
               and asset.project_id = attachment.project_id
              where attachment.update_id = item.id
                and asset.status = 'ready'
                and asset.is_current
            ) item_media on true
            where item.project_id = project.id
              and item.status in ('draft', 'published')
              and (project.owner_id = ${actorId}::uuid or item.status = 'published')
              ${cursorFilter}
            order by item.update_date desc, item.sort_order desc, item.id desc
            limit ${limit}
          ) entry
        ) timeline on true
        where project.id = ${projectId}::uuid
          and project.lifecycle_status = 'active'
          and not exists (
            select 1 from user_relationships relationship
            where relationship.kind = 'block'
              and relationship.status = 'active'
              and (
                (relationship.source_user_id = ${actorId}::uuid and relationship.target_user_id = project.owner_id)
                or (relationship.target_user_id = ${actorId}::uuid and relationship.source_user_id = project.owner_id)
              )
          )
          and (
            project.owner_id = ${actorId}::uuid
            or project.visibility = 'public'
            or accepted_access.id is not null
          )
        limit 1
      `);
      const row = typedRows<{ project_id: string; items: RawProjectUpdate[] }>(result.rows)[0];
      return row ? row.items.map(mapProjectUpdate) : null;
    });
  }

  async getUpdate(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
  ): Promise<ProjectUpdate | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = actorIdFor(viewer);
      await setActor(transaction, actorId);
      const result = await transaction.execute(sql<{ document: RawProjectUpdate }>`
        select jsonb_build_object(
          'id', item.id,
          'projectId', item.project_id,
          'phase', case when phase.id is null then null else jsonb_build_object(
            'id', phase.id,
            'name', phase.name,
            'sortOrder', phase.sort_order,
            'isCustom', phase.is_custom
          ) end,
          'title', item.title,
          'room', item.room,
          'description', item.description,
          'updateDate', item.update_date,
          'status', item.status,
          'isMilestone', item.is_milestone,
          'sortOrder', item.sort_order,
          'contentRevision', item.content_revision,
          'version', item.version,
          'publishedAt', item.published_at,
          'updatedAt', item.updated_at,
          'media', coalesce(item_media.items, '[]'::jsonb)
        ) as document
        from projects project
        join updates item on item.project_id = project.id
        left join project_access_requests accepted_access
          on accepted_access.project_id = project.id
         and accepted_access.requester_id = ${actorId}::uuid
         and accepted_access.status = 'accepted'
        left join project_phases phase
          on phase.id = item.phase_id and phase.project_id = item.project_id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id', asset.id,
            'contentType', asset.detected_content_type,
            'width', asset.width_pixels,
            'height', asset.height_pixels,
            'role', attachment.role,
            'sortOrder', attachment.sort_order,
            'caption', attachment.caption
          ) order by attachment.sort_order, asset.id) as items
          from update_media attachment
          join media_assets asset
            on asset.id = attachment.media_asset_id
           and asset.project_id = attachment.project_id
          where attachment.update_id = item.id
            and asset.status = 'ready'
            and asset.is_current
        ) item_media on true
        where project.id = ${projectId}::uuid
          and item.id = ${updateId}::uuid
          and project.lifecycle_status = 'active'
          and item.status in ('draft', 'published')
          and (project.owner_id = ${actorId}::uuid or item.status = 'published')
          and not exists (
            select 1 from user_relationships relationship
            where relationship.kind = 'block'
              and relationship.status = 'active'
              and (
                (relationship.source_user_id = ${actorId}::uuid and relationship.target_user_id = project.owner_id)
                or (relationship.target_user_id = ${actorId}::uuid and relationship.source_user_id = project.owner_id)
              )
          )
          and (
            project.owner_id = ${actorId}::uuid
            or project.visibility = 'public'
            or accepted_access.id is not null
          )
        limit 1
      `);
      const row = typedRows<{ document: RawProjectUpdate }>(result.rows)[0];
      return row ? mapProjectUpdate(row.document) : null;
    });
  }

  async createUpdate(command: CreateUpdateCommand): Promise<MutationReference> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await lockIdempotencyKey(transaction, command.idempotencyKey);
        const replay = await replayedMutation(
          transaction,
          command.idempotencyKey,
          "project.update.created.v1",
          command.requestHash,
        );
        if (replay) return replay;

        await assertPhase(transaction, command.projectId, command.input.phaseId);
        await assertMedia(
          transaction,
          command.projectId,
          command.actorId,
          command.input.media.map((item) => item.assetId),
        );
        const project = await transaction
          .update(projects)
          .set({
            contentRevision: sql`${projects.contentRevision} + 1`,
            version: sql`${projects.version} + 1`,
            updatedAt: command.now,
          })
          .where(and(
            eq(projects.id, command.projectId),
            eq(projects.ownerId, command.actorId),
            eq(projects.lifecycleStatus, "active"),
            eq(projects.version, command.input.expectedProjectVersion),
          ))
          .returning({ ownerId: projects.ownerId });
        if (!project[0]) {
          await explainProjectMutationFailure(
            transaction,
            command.projectId,
            command.actorId,
            command.input.expectedProjectVersion,
          );
        }

        const sortResult = await transaction.execute<{ next_sort_order: number | string }>(sql`
          select coalesce(max(item.sort_order), -1) + 1 as next_sort_order
          from updates item
          where item.project_id = ${command.projectId}::uuid
            and item.update_date = ${command.input.updateDate}::date
        `);
        await transaction.insert(updates).values({
          id: command.updateId,
          projectId: command.projectId,
          projectOwnerId: command.actorId,
          authorId: command.actorId,
          phaseId: command.input.phaseId ?? null,
          title: command.input.title ?? null,
          room: command.input.room ?? null,
          description: command.input.description ?? null,
          updateDate: command.input.updateDate,
          status: command.input.publish ? "published" : "draft",
          isMilestone: command.input.isMilestone,
          sortOrder: Number(sortResult.rows[0]?.next_sort_order ?? 0),
          contentRevision: 1,
          version: 1,
          publishedAt: command.input.publish ? command.now : null,
        });
        if (command.input.media.length > 0) {
          await transaction.insert(updateMedia).values(command.input.media.map((media) => ({
            updateId: command.updateId,
            projectId: command.projectId,
            mediaAssetId: media.assetId,
            role: media.role,
            sortOrder: media.sortOrder,
            caption: media.caption ?? null,
          })));
        }
        await appendMutationEvent(transaction, {
          aggregateType: "update",
          aggregateId: command.updateId,
          eventType: "project.update.created.v1",
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
        });
        return { id: command.updateId, replayed: false };
      });
    } catch (error) {
      if (isConstraint(error, "update_media_asset_uq") || isConstraint(error, "update_media_update_sort_uq")) {
        throw new ProjectError("INVALID_MEDIA");
      }
      throw error;
    }
  }

  async editUpdate(command: EditUpdateCommand): Promise<MutationReference> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await lockIdempotencyKey(transaction, command.idempotencyKey);
        const eventType = command.input.publish
          ? "project.update.published.v1"
          : "project.update.edited.v1";
        const replay = await replayedMutation(
          transaction,
          command.idempotencyKey,
          eventType,
          command.requestHash,
        );
        if (replay) return replay;

        await assertPhase(transaction, command.projectId, command.input.phaseId);
        if (command.input.media) {
          await assertMedia(
            transaction,
            command.projectId,
            command.actorId,
            command.input.media.map((item) => item.assetId),
          );
        }
        const input = command.input;
        const changed = await transaction
          .update(updates)
          .set({
            ...(input.updateDate !== undefined ? { updateDate: input.updateDate } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.room !== undefined ? { room: input.room } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.phaseId !== undefined ? { phaseId: input.phaseId } : {}),
            ...(input.isMilestone !== undefined ? { isMilestone: input.isMilestone } : {}),
            ...(input.publish
              ? {
                  status: "published" as const,
                  publishedAt: sql`coalesce(${updates.publishedAt}, ${command.now})`,
                }
              : {}),
            contentRevision: sql`${updates.contentRevision} + 1`,
            version: sql`${updates.version} + 1`,
            updatedAt: command.now,
          })
          .where(and(
            eq(updates.id, command.updateId),
            eq(updates.projectId, command.projectId),
            eq(updates.projectOwnerId, command.actorId),
            eq(updates.authorId, command.actorId),
            inArray(updates.status, ["draft", "published"]),
            eq(updates.version, input.expectedVersion),
          ))
          .returning({ id: updates.id });
        if (!changed[0]) {
          const existing = await transaction
            .select({ ownerId: updates.projectOwnerId, version: updates.version })
            .from(updates)
            .where(and(eq(updates.id, command.updateId), eq(updates.projectId, command.projectId)))
            .limit(1);
          if (!existing[0] || existing[0].ownerId !== command.actorId) {
            throw new ProjectError("UPDATE_NOT_FOUND");
          }
          throw new ProjectError("VERSION_CONFLICT");
        }

        if (input.media) {
          await transaction.delete(updateMedia).where(and(
            eq(updateMedia.updateId, command.updateId),
            eq(updateMedia.projectId, command.projectId),
          ));
          if (input.media.length > 0) {
            await transaction.insert(updateMedia).values(input.media.map((media) => ({
              updateId: command.updateId,
              projectId: command.projectId,
              mediaAssetId: media.assetId,
              role: media.role,
              sortOrder: media.sortOrder,
              caption: media.caption ?? null,
            })));
          }
        }
        const project = await transaction
          .update(projects)
          .set({
            contentRevision: sql`${projects.contentRevision} + 1`,
            version: sql`${projects.version} + 1`,
            updatedAt: command.now,
          })
          .where(and(
            eq(projects.id, command.projectId),
            eq(projects.ownerId, command.actorId),
            eq(projects.lifecycleStatus, "active"),
          ))
          .returning({ id: projects.id });
        if (!project[0]) {
          await explainProjectMutationFailure(transaction, command.projectId, command.actorId);
        }
        await appendMutationEvent(transaction, {
          aggregateType: "update",
          aggregateId: command.updateId,
          eventType,
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
        });
        return { id: command.updateId, replayed: false };
      });
    } catch (error) {
      if (isConstraint(error, "update_media_asset_uq") || isConstraint(error, "update_media_update_sort_uq")) {
        throw new ProjectError("INVALID_MEDIA");
      }
      throw error;
    }
  }

  async deleteUpdate(command: DeleteUpdateCommand): Promise<MutationReference> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      await lockIdempotencyKey(transaction, command.idempotencyKey);
      const eventType = "project.update.deleted.v1";
      const replay = await replayedMutation(
        transaction,
        command.idempotencyKey,
        eventType,
        command.requestHash,
      );
      if (replay) return replay;

      const changed = await transaction
        .update(updates)
        .set({
          status: "deleted",
          deletedAt: command.now,
          contentRevision: sql`${updates.contentRevision} + 1`,
          version: sql`${updates.version} + 1`,
          updatedAt: command.now,
        })
        .where(and(
          eq(updates.id, command.updateId),
          eq(updates.projectId, command.projectId),
          eq(updates.projectOwnerId, command.actorId),
          eq(updates.authorId, command.actorId),
          inArray(updates.status, ["draft", "published"]),
          eq(updates.version, command.input.expectedVersion),
        ))
        .returning({ id: updates.id });
      if (!changed[0]) {
        const existing = await transaction
          .select({
            ownerId: updates.projectOwnerId,
            version: updates.version,
            status: updates.status,
          })
          .from(updates)
          .where(and(eq(updates.id, command.updateId), eq(updates.projectId, command.projectId)))
          .limit(1);
        if (!existing[0] || existing[0].ownerId !== command.actorId || existing[0].status === "deleted") {
          throw new ProjectError("UPDATE_NOT_FOUND");
        }
        throw new ProjectError("VERSION_CONFLICT");
      }

      const project = await transaction
        .update(projects)
        .set({
          contentRevision: sql`${projects.contentRevision} + 1`,
          version: sql`${projects.version} + 1`,
          updatedAt: command.now,
        })
        .where(and(
          eq(projects.id, command.projectId),
          eq(projects.ownerId, command.actorId),
          eq(projects.lifecycleStatus, "active"),
        ))
        .returning({ id: projects.id });
      if (!project[0]) {
        await explainProjectMutationFailure(transaction, command.projectId, command.actorId);
      }

      // Media objects and their update_media links intentionally remain intact.
      // The deleted update is filtered out by every public/read query and can be
      // retained for audit, moderation and eventual lifecycle cleanup.
      await appendMutationEvent(transaction, {
        aggregateType: "update",
        aggregateId: command.updateId,
        eventType,
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
      });
      return { id: command.updateId, replayed: false };
    });
  }

  async createProjectPhase(command: CreateProjectPhaseCommand): Promise<MutationReference> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await lockIdempotencyKey(transaction, command.idempotencyKey);
        const eventType = "project.phase.created.v1";
        const replay = await replayedMutation(
          transaction,
          command.idempotencyKey,
          eventType,
          command.requestHash,
        );
        if (replay) return replay;

        const project = await transaction
          .update(projects)
          .set({
            contentRevision: sql`${projects.contentRevision} + 1`,
            version: sql`${projects.version} + 1`,
            updatedAt: command.now,
          })
          .where(and(
            eq(projects.id, command.projectId),
            eq(projects.ownerId, command.actorId),
            eq(projects.lifecycleStatus, "active"),
            eq(projects.version, command.input.expectedProjectVersion),
          ))
          .returning({ id: projects.id });
        if (!project[0]) {
          await explainProjectMutationFailure(
            transaction,
            command.projectId,
            command.actorId,
            command.input.expectedProjectVersion,
          );
        }

        const duplicate = await transaction
          .select({ id: projectPhases.id })
          .from(projectPhases)
          .where(and(
            eq(projectPhases.projectId, command.projectId),
            sql`lower(btrim(${projectPhases.name})) = lower(btrim(${command.input.name}))`,
          ))
          .limit(1);
        if (duplicate[0]) throw new ProjectError("PHASE_CONFLICT");

        const sortResult = await transaction.execute<{ next_sort_order: number | string }>(sql`
          select coalesce(max(phase.sort_order), -1) + 1 as next_sort_order
          from project_phases phase
          where phase.project_id = ${command.projectId}::uuid
        `);
        await transaction.insert(projectPhases).values({
          id: command.phaseId,
          projectId: command.projectId,
          name: command.input.name,
          sortOrder: Number(sortResult.rows[0]?.next_sort_order ?? 0),
          isCustom: true,
          updatedAt: command.now,
        });
        await appendMutationEvent(transaction, {
          aggregateType: "project",
          aggregateId: command.projectId,
          eventType,
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestHash,
          resultId: command.phaseId,
        });
        return { id: command.phaseId, replayed: false };
      });
    } catch (error) {
      if (
        isConstraint(error, "project_phases_project_name_uq") ||
        isConstraint(error, "project_phases_project_sort_uq")
      ) {
        throw new ProjectError("PHASE_CONFLICT");
      }
      throw error;
    }
  }
}

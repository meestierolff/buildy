import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  appUsers,
  profiles,
  projectAccessRequests,
  projectFollowers,
  userRelationships,
} from "../../db/schema/index.js";
import type {
  ProjectAccessEntry,
  ProjectAccessList,
  ProjectSocialState,
  SocialMutationResult,
  SocialProfile,
} from "../../shared/contracts/social.js";
import type { BuildyDatabase } from "../db/client.js";
import { SocialError } from "./errors.js";
import type {
  ProfileListRecord,
  ProfileSearch,
  SocialActorId,
  SocialRepository,
  SocialViewerId,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

type RawProfile = {
  avatar_content_type: string | null;
  avatar_height: number | null;
  avatar_id: string | null;
  avatar_width: number | null;
  bio: string | null;
  created_at: Date | string;
  display_name: string;
  follower_count: number | string;
  following_count: number | string;
  follows_viewer: boolean;
  is_private: boolean;
  is_pro: boolean;
  location: string | null;
  slug: string;
  user_id: string;
  viewer_access: "owner" | "public" | "follower";
  viewer_follow_status: "self" | "none" | "pending" | "following";
};

type LockedProfile = {
  isPrivate: boolean;
  userId: string;
};

type LockedProject = {
  id: string;
  ownerId: string;
  visibility: "private" | "public";
};

type RelationshipRecord = {
  id: string;
  status: "active" | "pending" | "rejected" | "revoked";
  version: number;
};

type AccessRecord = {
  id: string;
  status: "accepted" | "cancelled" | "pending" | "rejected" | "revoked";
  version: number;
};

type RawProjectAccessEntry = {
  requester_id: string;
  display_name: string | null;
  avatar_id: string | null;
  avatar_content_type: string | null;
  avatar_width: number | null;
  avatar_height: number | null;
  status: "pending" | "accepted";
  requested_at: Date | string;
  updated_at: Date | string;
};

export const SOCIAL_NOTIFICATION_OUTBOX_PAYLOAD = Object.freeze({ schemaVersion: 1 as const });

export function buildSocialNotificationOutboxRecord(notificationId: string) {
  return {
    aggregateId: notificationId,
    aggregateType: "notification" as const,
    eventType: "social.notification.created.v1" as const,
    idempotencyKey: `social-notification:${notificationId}`,
    payload: SOCIAL_NOTIFICATION_OUTBOX_PAYLOAD,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function typedRows<Row>(rows: unknown[]): Row[] {
  return rows as Row[];
}

function mapProfile(row: RawProfile): ProfileListRecord {
  return {
    avatar: row.avatar_id
      ? {
          contentType: row.avatar_content_type,
          height: row.avatar_height === null ? null : Number(row.avatar_height),
          id: row.avatar_id,
          proxyPath: `/api/media/${row.avatar_id}`,
          width: row.avatar_width === null ? null : Number(row.avatar_width),
        }
      : null,
    bio: row.bio,
    cursorTimestamp: iso(row.created_at),
    displayName: row.display_name,
    followerCount: Number(row.follower_count),
    followingCount: Number(row.following_count),
    followsViewer: row.follows_viewer,
    id: row.user_id,
    isPrivate: row.is_private,
    isPro: row.is_pro,
    location: row.location,
    slug: row.slug,
    viewerAccess: row.viewer_access,
    viewerFollowStatus: row.viewer_follow_status,
  };
}

function withoutCursor(profile: ProfileListRecord): SocialProfile {
  const { cursorTimestamp: _cursorTimestamp, ...result } = profile;
  return result;
}

async function setActor(
  transaction: DatabaseTransaction,
  actorId: SocialViewerId,
): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId ?? ""}, true)`);
}

async function lockPair(
  transaction: DatabaseTransaction,
  leftUserId: string,
  rightUserId: string,
): Promise<void> {
  const [left, right] = [leftUserId, rightUserId].sort();
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`social:${left}:${right}`}, 0))`,
  );
}

async function lockActiveUsers(
  transaction: DatabaseTransaction,
  actorId: string,
  targetId: string,
): Promise<boolean> {
  try {
    const result = await transaction.execute(sql<{ target_is_private: boolean }>`
      select app_lock_social_user_pair(${targetId}::uuid) as target_is_private
    `);
    const row = typedRows<{ target_is_private: boolean }>(result.rows)[0];
    if (!row) throw new SocialError("TARGET_NOT_FOUND");
    return row.target_is_private;
  } catch (error) {
    if (error instanceof SocialError) throw error;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    if (code === "42501") {
      throw new SocialError("ACTOR_MAPPING_UNAVAILABLE", { cause: error });
    }
    if (code === "P0002") throw new SocialError("TARGET_NOT_FOUND", { cause: error });
    throw error;
  }
}

async function lockActiveActor(
  transaction: DatabaseTransaction,
  actorId: string,
): Promise<void> {
  const rows = await transaction
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.id, actorId),
        eq(appUsers.status, "active"),
        isNull(appUsers.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!rows[0]) throw new SocialError("ACTOR_MAPPING_UNAVAILABLE");
}

async function lockedProfile(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<LockedProfile> {
  const rows = await transaction
    .select({ isPrivate: profiles.isPrivate, userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
    .for("update");
  if (!rows[0]) throw new SocialError("TARGET_NOT_FOUND");
  return rows[0];
}

async function usersBlocked(
  transaction: DatabaseTransaction,
  leftUserId: string,
  rightUserId: string,
): Promise<boolean> {
  const rows = await transaction
    .select({ id: userRelationships.id })
    .from(userRelationships)
    .where(
      and(
        eq(userRelationships.kind, "block"),
        eq(userRelationships.status, "active"),
        or(
          and(
            eq(userRelationships.sourceUserId, leftUserId),
            eq(userRelationships.targetUserId, rightUserId),
          ),
          and(
            eq(userRelationships.sourceUserId, rightUserId),
            eq(userRelationships.targetUserId, leftUserId),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function assertNotBlocked(
  transaction: DatabaseTransaction,
  leftUserId: string,
  rightUserId: string,
): Promise<void> {
  if (await usersBlocked(transaction, leftUserId, rightUserId)) {
    throw new SocialError("TARGET_NOT_FOUND");
  }
}

async function relationship(
  transaction: DatabaseTransaction,
  sourceUserId: string,
  targetUserId: string,
  kind: "block" | "follow",
): Promise<RelationshipRecord | null> {
  const rows = await transaction
    .select({
      id: userRelationships.id,
      status: userRelationships.status,
      version: userRelationships.version,
    })
    .from(userRelationships)
    .where(
      and(
        eq(userRelationships.sourceUserId, sourceUserId),
        eq(userRelationships.targetUserId, targetUserId),
        eq(userRelationships.kind, kind),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

async function appendNotification(
  transaction: DatabaseTransaction,
  input: {
    actorId: string;
    projectId?: string;
    recipientId: string;
    type: string;
  },
): Promise<void> {
  await transaction.execute(sql`
    select app_enqueue_social_notification(
      ${input.recipientId}::uuid,
      ${input.type}::text,
      ${input.projectId ?? null}::uuid
    )
  `);
}

async function profileRelationshipUpdate(
  transaction: DatabaseTransaction,
  record: RelationshipRecord,
  status: RelationshipRecord["status"],
  now: Date,
): Promise<RelationshipRecord> {
  const rows = await transaction
    .update(userRelationships)
    .set({
      decidedAt: status === "pending" ? null : now,
      revokedAt: status === "revoked" ? now : null,
      status,
      updatedAt: now,
      version: sql`${userRelationships.version} + 1`,
    })
    .where(and(eq(userRelationships.id, record.id), eq(userRelationships.version, record.version)))
    .returning({
      id: userRelationships.id,
      status: userRelationships.status,
      version: userRelationships.version,
    });
  if (!rows[0]) throw new SocialError("INVALID_TRANSITION");
  return rows[0];
}

async function projectSnapshot(
  transaction: DatabaseTransaction,
  projectId: string,
  lockProject = false,
): Promise<LockedProject | null> {
  const result = await transaction.execute(sql<{
    owner_id: string;
    project_id: string;
    visibility: "private" | "public";
  }>`
    select project_id, owner_id, visibility
    from app_social_project_context(${projectId}::uuid, ${lockProject}::boolean)
  `);
  const row = typedRows<{
    owner_id: string;
    project_id: string;
    visibility: "private" | "public";
  }>(result.rows)[0];
  return row
    ? { id: row.project_id, ownerId: row.owner_id, visibility: row.visibility }
    : null;
}

async function lockedProjectContext(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
): Promise<LockedProject> {
  const snapshot = await projectSnapshot(transaction, projectId);
  if (!snapshot) throw new SocialError("TARGET_NOT_FOUND");
  if (snapshot.ownerId === actorId) throw new SocialError("SELF_ACTION");

  await lockPair(transaction, actorId, snapshot.ownerId);
  await lockActiveUsers(transaction, actorId, snapshot.ownerId);
  const project = await projectSnapshot(transaction, projectId, true);
  if (!project || project.ownerId !== snapshot.ownerId) {
    throw new SocialError("TARGET_NOT_FOUND");
  }
  await assertNotBlocked(transaction, actorId, project.ownerId);
  return project;
}

async function actorCanViewProject(
  transaction: DatabaseTransaction,
  actorId: string,
  project: LockedProject,
): Promise<boolean> {
  if (project.visibility === "public") return true;
  const rows = await transaction
    .select({ id: projectAccessRequests.id })
    .from(projectAccessRequests)
    .where(
      and(
        eq(projectAccessRequests.projectId, project.id),
        eq(projectAccessRequests.requesterId, actorId),
        eq(projectAccessRequests.status, "accepted"),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function ownedProjectContext(
  transaction: DatabaseTransaction,
  ownerId: string,
  projectId: string,
  requesterId: string,
): Promise<LockedProject> {
  const snapshot = await projectSnapshot(transaction, projectId);
  if (!snapshot || snapshot.ownerId !== ownerId) throw new SocialError("TARGET_NOT_FOUND");
  await lockPair(transaction, ownerId, requesterId);
  await lockActiveUsers(transaction, ownerId, requesterId);
  const project = await projectSnapshot(transaction, projectId, true);
  if (
    !project ||
    project.ownerId !== ownerId ||
    project.visibility !== "private"
  ) {
    throw new SocialError("TARGET_NOT_FOUND");
  }
  await assertNotBlocked(transaction, ownerId, requesterId);
  return project;
}

async function accessRecord(
  transaction: DatabaseTransaction,
  projectId: string,
  requesterId: string,
): Promise<AccessRecord | null> {
  const rows = await transaction
    .select({
      id: projectAccessRequests.id,
      status: projectAccessRequests.status,
      version: projectAccessRequests.version,
    })
    .from(projectAccessRequests)
    .where(
      and(
        eq(projectAccessRequests.projectId, projectId),
        eq(projectAccessRequests.requesterId, requesterId),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

async function accessUpdate(
  transaction: DatabaseTransaction,
  record: AccessRecord,
  status: AccessRecord["status"],
  decidedById: string | null,
  now: Date,
): Promise<AccessRecord> {
  const rows = await transaction
    .update(projectAccessRequests)
    .set({
      decidedAt: status === "pending" ? null : now,
      decidedById,
      revokedAt: status === "revoked" ? now : null,
      status,
      updatedAt: now,
      version: sql`${projectAccessRequests.version} + 1`,
    })
    .where(
      and(
        eq(projectAccessRequests.id, record.id),
        eq(projectAccessRequests.version, record.version),
      ),
    )
    .returning({
      id: projectAccessRequests.id,
      status: projectAccessRequests.status,
      version: projectAccessRequests.version,
    });
  if (!rows[0]) throw new SocialError("INVALID_TRANSITION");
  return rows[0];
}

async function revokeProjectFollower(
  transaction: DatabaseTransaction,
  projectId: string,
  followerId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(projectFollowers)
    .set({ status: "revoked", updatedAt: now })
    .where(
      and(
        eq(projectFollowers.projectId, projectId),
        eq(projectFollowers.followerId, followerId),
        inArray(projectFollowers.status, ["active", "muted"]),
      ),
    );
}

export class PostgresSocialRepository implements SocialRepository {
  constructor(private readonly database: BuildyDatabase) {}

  private async mutation<Result>(
    actorId: string,
    operation: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, actorId);
        return operation(transaction);
      });
    } catch (error) {
      if (error instanceof SocialError) throw error;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : undefined;
      if (code === "23503") throw new SocialError("TARGET_NOT_FOUND", { cause: error });
      throw error;
    }
  }

  async findProfile(viewerId: SocialViewerId, profileId: string): Promise<SocialProfile | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, viewerId);
      const result = await transaction.execute(sql<RawProfile>`
        select
          profile.user_id,
          profile.display_name,
          profile.slug,
          profile.bio,
          profile.location,
          profile.is_private,
          profile.is_pro,
          profile.created_at,
          avatar.id as avatar_id,
          avatar.detected_content_type as avatar_content_type,
          avatar.width_pixels as avatar_width,
          avatar.height_pixels as avatar_height,
          coalesce(follower_stats.count, 0) as follower_count,
          coalesce(following_stats.count, 0) as following_count,
          case
            when profile.user_id = ${viewerId}::uuid then 'owner'
            when profile.is_private then 'follower'
            else 'public'
          end as viewer_access,
          case
            when profile.user_id = ${viewerId}::uuid then 'self'
            when viewer_follow.status = 'active' then 'following'
            when viewer_follow.status = 'pending' then 'pending'
            else 'none'
          end as viewer_follow_status,
          coalesce(target_follow.status = 'active', false) as follows_viewer
        from profiles profile
        left join user_relationships viewer_follow
          on viewer_follow.source_user_id = ${viewerId}::uuid
         and viewer_follow.target_user_id = profile.user_id
         and viewer_follow.kind = 'follow'
        left join user_relationships target_follow
          on target_follow.source_user_id = profile.user_id
         and target_follow.target_user_id = ${viewerId}::uuid
         and target_follow.kind = 'follow'
        left join lateral (
          select count(*)::integer as count
          from user_relationships relationship
          where relationship.target_user_id = profile.user_id
            and relationship.kind = 'follow'
            and relationship.status = 'active'
        ) follower_stats on true
        left join lateral (
          select count(*)::integer as count
          from user_relationships relationship
          where relationship.source_user_id = profile.user_id
            and relationship.kind = 'follow'
            and relationship.status = 'active'
        ) following_stats on true
        left join media_assets avatar
          on avatar.id = profile.avatar_asset_id
         and avatar.owner_id = profile.user_id
         and avatar.project_id is null
         and avatar.original_asset_id is null
         and avatar.purpose = 'avatar'
         and avatar.status = 'ready'
         and avatar.is_current
         and avatar.exif_stripped
         and avatar.deleted_at is null
         and avatar.ready_at is not null
         and avatar.detected_content_type like 'image/%'
         and avatar.width_pixels > 0
         and avatar.height_pixels > 0
        where profile.user_id = ${profileId}::uuid
          and not exists (
            select 1 from user_relationships block
            where block.kind = 'block'
              and block.status = 'active'
              and (
                (block.source_user_id = ${viewerId}::uuid and block.target_user_id = profile.user_id)
                or (block.target_user_id = ${viewerId}::uuid and block.source_user_id = profile.user_id)
              )
          )
          and (
            profile.is_private = false
            or profile.user_id = ${viewerId}::uuid
            or viewer_follow.status = 'active'
          )
        limit 1
      `);
      const row = typedRows<RawProfile>(result.rows)[0];
      return row ? withoutCursor(mapProfile(row)) : null;
    });
  }

  async getProjectState(
    actorId: SocialActorId,
    projectId: string,
  ): Promise<ProjectSocialState | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const project = await projectSnapshot(transaction, projectId);
      if (!project) return null;
      if (project.ownerId === actorId) {
        return {
          projectId,
          viewerRole: "owner",
          followStatus: "none",
          accessStatus: "owner",
        };
      }

      const followRows = await transaction
        .select({ status: projectFollowers.status })
        .from(projectFollowers)
        .where(and(
          eq(projectFollowers.projectId, projectId),
          eq(projectFollowers.followerId, actorId),
          eq(projectFollowers.status, "active"),
        ))
        .limit(1);
      const accessRows = await transaction
        .select({ status: projectAccessRequests.status })
        .from(projectAccessRequests)
        .where(and(
          eq(projectAccessRequests.projectId, projectId),
          eq(projectAccessRequests.requesterId, actorId),
          inArray(projectAccessRequests.status, ["pending", "accepted"]),
        ))
        .limit(1);

      return {
        projectId,
        viewerRole: "viewer",
        followStatus: followRows[0] ? "following" : "none",
        accessStatus: project.visibility === "public"
          ? "not_required"
          : accessRows[0]?.status === "pending" || accessRows[0]?.status === "accepted"
            ? accessRows[0].status
            : "none",
      };
    });
  }

  async listProjectAccess(
    actorId: SocialActorId,
    projectId: string,
  ): Promise<ProjectAccessList | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const project = await projectSnapshot(transaction, projectId);
      if (!project || project.ownerId !== actorId) return null;

      const result = await transaction.execute(sql<RawProjectAccessEntry>`
        select
          access.requester_id,
          profile.display_name,
          avatar.id as avatar_id,
          avatar.detected_content_type as avatar_content_type,
          avatar.width_pixels as avatar_width,
          avatar.height_pixels as avatar_height,
          access.status,
          access.created_at as requested_at,
          access.updated_at
        from project_access_requests access
        left join profiles profile on profile.user_id = access.requester_id
        left join media_assets avatar
          on avatar.id = profile.avatar_asset_id
         and avatar.owner_id = profile.user_id
         and avatar.project_id is null
         and avatar.original_asset_id is null
         and avatar.purpose = 'avatar'
         and avatar.status = 'ready'
         and avatar.is_current
         and avatar.exif_stripped
         and avatar.deleted_at is null
         and avatar.ready_at is not null
         and avatar.detected_content_type like 'image/%'
         and avatar.width_pixels > 0
         and avatar.height_pixels > 0
        where access.project_id = ${projectId}::uuid
          and access.project_owner_id = ${actorId}::uuid
          and access.status in ('pending', 'accepted')
        order by (access.status = 'pending') desc, access.created_at asc, access.requester_id
      `);
      const items: ProjectAccessEntry[] = typedRows<RawProjectAccessEntry>(result.rows).map((row) => ({
        requesterId: row.requester_id,
        displayName: row.display_name ?? "Buildy-gebruiker",
        avatar: row.avatar_id
          ? {
              id: row.avatar_id,
              contentType: row.avatar_content_type,
              width: row.avatar_width === null ? null : Number(row.avatar_width),
              height: row.avatar_height === null ? null : Number(row.avatar_height),
              proxyPath: `/api/media/${row.avatar_id}`,
            }
          : null,
        status: row.status,
        requestedAt: iso(row.requested_at),
        updatedAt: iso(row.updated_at),
      }));
      return { projectId, items };
    });
  }

  async searchProfiles(
    viewerId: SocialViewerId,
    search: ProfileSearch,
  ): Promise<ProfileListRecord[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, viewerId);
      const query = search.normalizedQuery || null;
      const cursorFilter = search.cursor
        ? sql`and (profile.created_at, profile.user_id) < (${search.cursor.timestamp}::timestamptz, ${search.cursor.id}::uuid)`
        : sql``;
      const result = await transaction.execute(sql<RawProfile>`
        select
          profile.user_id,
          profile.display_name,
          profile.slug,
          profile.bio,
          profile.location,
          profile.is_private,
          profile.is_pro,
          profile.created_at,
          avatar.id as avatar_id,
          avatar.detected_content_type as avatar_content_type,
          avatar.width_pixels as avatar_width,
          avatar.height_pixels as avatar_height,
          coalesce(follower_stats.count, 0) as follower_count,
          coalesce(following_stats.count, 0) as following_count,
          case
            when profile.user_id = ${viewerId}::uuid then 'owner'
            when profile.is_private then 'follower'
            else 'public'
          end as viewer_access,
          case
            when profile.user_id = ${viewerId}::uuid then 'self'
            when viewer_follow.status = 'active' then 'following'
            when viewer_follow.status = 'pending' then 'pending'
            else 'none'
          end as viewer_follow_status,
          coalesce(target_follow.status = 'active', false) as follows_viewer
        from profiles profile
        left join user_relationships viewer_follow
          on viewer_follow.source_user_id = ${viewerId}::uuid
         and viewer_follow.target_user_id = profile.user_id
         and viewer_follow.kind = 'follow'
        left join user_relationships target_follow
          on target_follow.source_user_id = profile.user_id
         and target_follow.target_user_id = ${viewerId}::uuid
         and target_follow.kind = 'follow'
        left join lateral (
          select count(*)::integer as count
          from user_relationships relationship
          where relationship.target_user_id = profile.user_id
            and relationship.kind = 'follow'
            and relationship.status = 'active'
        ) follower_stats on true
        left join lateral (
          select count(*)::integer as count
          from user_relationships relationship
          where relationship.source_user_id = profile.user_id
            and relationship.kind = 'follow'
            and relationship.status = 'active'
        ) following_stats on true
        left join media_assets avatar
          on avatar.id = profile.avatar_asset_id
         and avatar.owner_id = profile.user_id
         and avatar.project_id is null
         and avatar.original_asset_id is null
         and avatar.purpose = 'avatar'
         and avatar.status = 'ready'
         and avatar.is_current
         and avatar.exif_stripped
         and avatar.deleted_at is null
         and avatar.ready_at is not null
         and avatar.detected_content_type like 'image/%'
         and avatar.width_pixels > 0
         and avatar.height_pixels > 0
        where not exists (
            select 1 from user_relationships block
            where block.kind = 'block'
              and block.status = 'active'
              and (
                (block.source_user_id = ${viewerId}::uuid and block.target_user_id = profile.user_id)
                or (block.target_user_id = ${viewerId}::uuid and block.source_user_id = profile.user_id)
              )
          )
          and (
            profile.is_private = false
            or profile.user_id = ${viewerId}::uuid
            or viewer_follow.status = 'active'
          )
          and (
            ${query}::text is null
            or position(${query}::text in lower(profile.display_name)) > 0
            or position(${query}::text in lower(profile.slug)) > 0
          )
          ${cursorFilter}
        order by profile.created_at desc, profile.user_id desc
        limit ${search.limit}
      `);
      return typedRows<RawProfile>(result.rows).map(mapProfile);
    });
  }

  async followProfile(
    actorId: string,
    profileId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await lockPair(transaction, actorId, profileId);
      const targetIsPrivate = await lockActiveUsers(transaction, actorId, profileId);
      await assertNotBlocked(transaction, actorId, profileId);
      const existing = await relationship(transaction, actorId, profileId, "follow");
      const desired = targetIsPrivate ? "pending" : "active";

      if (existing?.status === "active") return { replayed: true, state: "following" };
      if (existing?.status === desired) {
        return { replayed: true, state: desired === "pending" ? "pending" : "following" };
      }

      let record: RelationshipRecord;
      if (existing) {
        record = await profileRelationshipUpdate(transaction, existing, desired, now);
      } else {
        const rows = await transaction
          .insert(userRelationships)
          .values({
            decidedAt: desired === "active" ? now : null,
            kind: "follow",
            sourceUserId: actorId,
            status: desired,
            targetUserId: profileId,
          })
          .onConflictDoNothing({
            target: [
              userRelationships.sourceUserId,
              userRelationships.targetUserId,
              userRelationships.kind,
            ],
          })
          .returning({
            id: userRelationships.id,
            status: userRelationships.status,
            version: userRelationships.version,
          });
        record = rows[0] ?? (await relationship(transaction, actorId, profileId, "follow"))!;
      }

      if (!record) throw new SocialError("INVALID_TRANSITION");
      await appendNotification(transaction, {
        actorId,
        recipientId: profileId,
        type: desired === "pending" ? "profile.follow.requested" : "profile.followed",
      });
      return { replayed: false, state: desired === "pending" ? "pending" : "following" };
    });
  }

  async removeProfileFollow(
    actorId: string,
    profileId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await lockPair(transaction, actorId, profileId);
      await lockActiveActor(transaction, actorId);
      await usersBlocked(transaction, actorId, profileId);
      const existing = await relationship(transaction, actorId, profileId, "follow");
      if (!existing || existing.status === "rejected" || existing.status === "revoked") {
        return { replayed: true, state: "none" };
      }
      const state = existing.status === "pending" ? "cancelled" : "none";
      await profileRelationshipUpdate(transaction, existing, "revoked", now);
      return { replayed: false, state };
    });
  }

  async acceptProfileFollow(
    actorId: string,
    requesterId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.decideProfileFollow(actorId, requesterId, "active", now);
  }

  async rejectProfileFollow(
    actorId: string,
    requesterId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.decideProfileFollow(actorId, requesterId, "rejected", now);
  }

  private async decideProfileFollow(
    actorId: string,
    requesterId: string,
    decision: "active" | "rejected",
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await lockPair(transaction, actorId, requesterId);
      await lockActiveUsers(transaction, actorId, requesterId);
      await lockedProfile(transaction, actorId);
      await assertNotBlocked(transaction, actorId, requesterId);
      const existing = await relationship(transaction, requesterId, actorId, "follow");
      if (existing?.status === decision) {
        return {
          replayed: true,
          state: decision === "active" ? "following" : "rejected",
        };
      }
      if (!existing || existing.status !== "pending") {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      await profileRelationshipUpdate(transaction, existing, decision, now);
      await appendNotification(transaction, {
        actorId,
        recipientId: requesterId,
        type:
          decision === "active"
            ? "profile.follow.accepted"
            : "profile.follow.rejected",
      });
      return {
        replayed: false,
        state: decision === "active" ? "following" : "rejected",
      };
    });
  }

  async revokeProfileFollower(
    actorId: string,
    followerId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await lockPair(transaction, actorId, followerId);
      await lockActiveUsers(transaction, actorId, followerId);
      await lockedProfile(transaction, actorId);
      await usersBlocked(transaction, actorId, followerId);
      const existing = await relationship(transaction, followerId, actorId, "follow");
      if (existing?.status === "revoked") return { replayed: true, state: "revoked" };
      if (!existing || existing.status !== "active") {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      await profileRelationshipUpdate(transaction, existing, "revoked", now);
      return { replayed: false, state: "revoked" };
    });
  }

  async blockProfile(
    actorId: string,
    profileId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await lockPair(transaction, actorId, profileId);
      await lockActiveUsers(transaction, actorId, profileId);
      const existing = await relationship(transaction, actorId, profileId, "block");
      const replayed = existing?.status === "active";

      if (!replayed) {
        if (existing) {
          await profileRelationshipUpdate(transaction, existing, "active", now);
        } else {
          await transaction
            .insert(userRelationships)
            .values({
              decidedAt: now,
              kind: "block",
              sourceUserId: actorId,
              status: "active",
              targetUserId: profileId,
            })
            .onConflictDoNothing({
              target: [
                userRelationships.sourceUserId,
                userRelationships.targetUserId,
                userRelationships.kind,
              ],
            });
        }
      }

      await transaction
        .update(userRelationships)
        .set({
          decidedAt: now,
          revokedAt: now,
          status: "revoked",
          updatedAt: now,
          version: sql`${userRelationships.version} + 1`,
        })
        .where(
          and(
            eq(userRelationships.kind, "follow"),
            inArray(userRelationships.status, ["active", "pending"]),
            or(
              and(
                eq(userRelationships.sourceUserId, actorId),
                eq(userRelationships.targetUserId, profileId),
              ),
              and(
                eq(userRelationships.sourceUserId, profileId),
                eq(userRelationships.targetUserId, actorId),
              ),
            ),
          ),
        );

      await transaction.execute(sql`
        update project_access_requests access
        set
          status = 'revoked',
          decided_by_id = ${actorId}::uuid,
          decided_at = ${now},
          revoked_at = ${now},
          version = access.version + 1,
          updated_at = ${now}
        where access.status in ('pending', 'accepted')
          and (
            (access.requester_id = ${actorId}::uuid and access.project_owner_id = ${profileId}::uuid)
            or (access.requester_id = ${profileId}::uuid and access.project_owner_id = ${actorId}::uuid)
          )
      `);
      await transaction.execute(sql`
        update project_followers follower
        set status = 'revoked', updated_at = ${now}
        where follower.status in ('active', 'muted')
          and (
            (follower.follower_id = ${actorId}::uuid and follower.project_owner_id = ${profileId}::uuid)
            or (follower.follower_id = ${profileId}::uuid and follower.project_owner_id = ${actorId}::uuid)
          )
      `);
      return { replayed: Boolean(replayed), state: "blocked" };
    });
  }

  async unblockProfile(
    actorId: string,
    profileId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await lockPair(transaction, actorId, profileId);
      await lockActiveActor(transaction, actorId);
      const existing = await relationship(transaction, actorId, profileId, "block");
      if (!existing || existing.status === "revoked") {
        return { replayed: true, state: "unblocked" };
      }
      await profileRelationshipUpdate(transaction, existing, "revoked", now);
      return { replayed: false, state: "unblocked" };
    });
  }

  async followProject(
    actorId: string,
    projectId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      const project = await lockedProjectContext(transaction, actorId, projectId);
      if (!(await actorCanViewProject(transaction, actorId, project))) {
        throw new SocialError("TARGET_NOT_FOUND");
      }

      const existing = await transaction
        .select({ status: projectFollowers.status })
        .from(projectFollowers)
        .where(
          and(
            eq(projectFollowers.projectId, projectId),
            eq(projectFollowers.followerId, actorId),
          ),
        )
        .limit(1)
        .for("update");
      if (existing[0]?.status === "active") {
        return { replayed: true, state: "following" };
      }

      if (existing[0]) {
        await transaction
          .update(projectFollowers)
          .set({ followedAt: now, status: "active", updatedAt: now })
          .where(
            and(
              eq(projectFollowers.projectId, projectId),
              eq(projectFollowers.followerId, actorId),
            ),
          );
      } else {
        await transaction
          .insert(projectFollowers)
          .values({
            followedAt: now,
            followerId: actorId,
            projectId,
            projectOwnerId: project.ownerId,
            status: "active",
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [projectFollowers.projectId, projectFollowers.followerId],
          });
      }

      await appendNotification(transaction, {
        actorId,
        projectId,
        recipientId: project.ownerId,
        type: "project.followed",
      });
      return { replayed: false, state: "following" };
    });
  }

  async unfollowProject(
    actorId: string,
    projectId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      const project = await lockedProjectContext(transaction, actorId, projectId);
      if (!(await actorCanViewProject(transaction, actorId, project))) {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      const existing = await transaction
        .select({ status: projectFollowers.status })
        .from(projectFollowers)
        .where(
          and(
            eq(projectFollowers.projectId, projectId),
            eq(projectFollowers.followerId, actorId),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing[0] || existing[0].status === "revoked") {
        return { replayed: true, state: "none" };
      }
      await transaction
        .update(projectFollowers)
        .set({ status: "revoked", updatedAt: now })
        .where(
          and(
            eq(projectFollowers.projectId, projectId),
            eq(projectFollowers.followerId, actorId),
          ),
        );
      return { replayed: false, state: "none" };
    });
  }

  async requestProjectAccess(
    actorId: string,
    projectId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      const project = await lockedProjectContext(transaction, actorId, projectId);
      if (project.visibility !== "private") throw new SocialError("TARGET_NOT_FOUND");
      const existing = await accessRecord(transaction, projectId, actorId);
      if (existing?.status === "pending") return { replayed: true, state: "pending" };
      if (existing?.status === "accepted") return { replayed: true, state: "accepted" };

      if (existing) {
        await accessUpdate(transaction, existing, "pending", null, now);
      } else {
        const inserted = await transaction
          .insert(projectAccessRequests)
          .values({
            projectId,
            projectOwnerId: project.ownerId,
            requesterId: actorId,
            status: "pending",
          })
          .onConflictDoNothing({
            target: [projectAccessRequests.projectId, projectAccessRequests.requesterId],
          })
          .returning({ id: projectAccessRequests.id });
        if (!inserted[0] && !(await accessRecord(transaction, projectId, actorId))) {
          throw new SocialError("INVALID_TRANSITION");
        }
      }

      await appendNotification(transaction, {
        actorId,
        projectId,
        recipientId: project.ownerId,
        type: "project.access.requested",
      });
      return { replayed: false, state: "pending" };
    });
  }

  async cancelProjectAccess(
    actorId: string,
    projectId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      const project = await lockedProjectContext(transaction, actorId, projectId);
      if (project.visibility !== "private") throw new SocialError("TARGET_NOT_FOUND");
      const existing = await accessRecord(transaction, projectId, actorId);
      if (
        !existing ||
        existing.status === "cancelled" ||
        existing.status === "rejected" ||
        existing.status === "revoked"
      ) {
        return { replayed: true, state: "cancelled" };
      }
      await accessUpdate(transaction, existing, "cancelled", actorId, now);
      await revokeProjectFollower(transaction, projectId, actorId, now);
      return { replayed: false, state: "cancelled" };
    });
  }

  async acceptProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.decideProjectAccess(actorId, projectId, requesterId, "accepted", now);
  }

  async rejectProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.decideProjectAccess(actorId, projectId, requesterId, "rejected", now);
  }

  private async decideProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
    decision: "accepted" | "rejected",
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await ownedProjectContext(transaction, actorId, projectId, requesterId);
      const existing = await accessRecord(transaction, projectId, requesterId);
      if (existing?.status === decision) {
        return { replayed: true, state: decision };
      }
      if (!existing || existing.status !== "pending") {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      await accessUpdate(transaction, existing, decision, actorId, now);
      await appendNotification(transaction, {
        actorId,
        projectId,
        recipientId: requesterId,
        type:
          decision === "accepted"
            ? "project.access.accepted"
            : "project.access.rejected",
      });
      return { replayed: false, state: decision };
    });
  }

  async revokeProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
    now: Date,
  ): Promise<SocialMutationResult> {
    return this.mutation(actorId, async (transaction) => {
      await ownedProjectContext(transaction, actorId, projectId, requesterId);
      const existing = await accessRecord(transaction, projectId, requesterId);
      if (existing?.status === "revoked") return { replayed: true, state: "revoked" };
      if (!existing || existing.status !== "accepted") {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      await accessUpdate(transaction, existing, "revoked", actorId, now);
      await revokeProjectFollower(transaction, projectId, requesterId, now);
      return { replayed: false, state: "revoked" };
    });
  }
}

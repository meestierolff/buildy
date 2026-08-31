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
  userRelationships,
} from "../../db/schema/index.js";
import type {
  SocialMutationResult,
  SocialProfile,
} from "../../shared/contracts/social.js";
import type { BuildyDatabase } from "../db/client.js";
import { SocialError } from "./errors.js";
import type {
  ProfileListRecord,
  ProfileSearch,
  ConnectionListRecord,
  ConnectionListSearch,
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
  viewer_access: "owner" | "public" | "follower" | "requestable";
  viewer_follow_status: "self" | "none" | "pending" | "following";
};

type RawConnection = {
  avatar_content_type: string | null;
  avatar_height: number | null;
  avatar_id: string | null;
  avatar_width: number | null;
  display_name: string;
  follows_viewer: boolean;
  is_private: boolean;
  relationship_at: Date | string;
  slug: string;
  total_count: number | string;
  user_id: string;
  viewer_follow_status: "none" | "pending" | "following";
};

type LockedProfile = {
  isPrivate: boolean;
  userId: string;
};

type RelationshipRecord = {
  id: string;
  status: "active" | "pending" | "rejected" | "revoked";
  version: number;
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

function mapConnection(row: RawConnection): ConnectionListRecord {
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
    cursorTimestamp: iso(row.relationship_at),
    displayName: row.display_name,
    followsViewer: row.follows_viewer,
    id: row.user_id,
    isPrivate: row.is_private,
    relationshipAt: iso(row.relationship_at),
    slug: row.slug,
    totalCount: Number(row.total_count),
    viewerFollowStatus: row.viewer_follow_status,
  } satisfies ConnectionListRecord;
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
    recipientId: string;
    type: string;
  },
): Promise<void> {
  await transaction.execute(sql`
    select app_enqueue_social_notification(
      ${input.recipientId}::uuid,
      ${input.type}::text,
      null::uuid
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

async function revokeLegacyProjectRelationships(
  transaction: DatabaseTransaction,
  followerId: string,
  ownerId: string,
  decidedById: string,
  now: Date,
): Promise<void> {
  await transaction.execute(sql`
    update project_access_requests access
    set
      status = 'revoked',
      decided_by_id = ${decidedById}::uuid,
      decided_at = ${now},
      revoked_at = ${now},
      version = access.version + 1,
      updated_at = ${now}
    where access.status in ('pending', 'accepted')
      and access.requester_id = ${followerId}::uuid
      and access.project_owner_id = ${ownerId}::uuid
  `);
  await transaction.execute(sql`
    update project_followers follower
    set status = 'revoked', updated_at = ${now}
    where follower.status in ('active', 'muted')
      and follower.follower_id = ${followerId}::uuid
      and follower.project_owner_id = ${ownerId}::uuid
  `);
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

  async listConnections(
    actorId: SocialActorId,
    search: ConnectionListSearch,
  ): Promise<ConnectionListRecord[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute(sql<RawConnection>`
        select *
        from public.app_list_profile_connections(
          ${search.view}::text,
          ${search.cursor?.timestamp ?? null}::timestamptz,
          ${search.cursor?.id ?? null}::uuid,
          ${search.limit}::integer
        )
      `);
      return typedRows<RawConnection>(result.rows).map(mapConnection);
    });
  }

  async searchProfiles(
    viewerId: SocialViewerId,
    search: ProfileSearch,
  ): Promise<ProfileListRecord[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, viewerId);
      const query = search.normalizedQuery || null;
      const result = await transaction.execute(sql<RawProfile>`
        select *
        from public.app_search_profile_identities(
          ${query}::text,
          ${search.cursor?.timestamp ?? null}::timestamptz,
          ${search.cursor?.id ?? null}::uuid,
          ${search.limit}::integer
        )
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
      await revokeLegacyProjectRelationships(
        transaction,
        actorId,
        profileId,
        actorId,
        now,
      );
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
        if (decision === "rejected") {
          await revokeLegacyProjectRelationships(
            transaction,
            requesterId,
            actorId,
            actorId,
            now,
          );
        }
        return {
          replayed: true,
          state: decision === "active" ? "following" : "rejected",
        };
      }
      if (!existing || existing.status !== "pending") {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      await profileRelationshipUpdate(transaction, existing, decision, now);
      if (decision === "rejected") {
        await revokeLegacyProjectRelationships(
          transaction,
          requesterId,
          actorId,
          actorId,
          now,
        );
      }
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
      if (existing?.status === "revoked") {
        await revokeLegacyProjectRelationships(
          transaction,
          followerId,
          actorId,
          actorId,
          now,
        );
        return { replayed: true, state: "revoked" };
      }
      if (!existing || existing.status !== "active") {
        throw new SocialError("TARGET_NOT_FOUND");
      }
      await profileRelationshipUpdate(transaction, existing, "revoked", now);
      await revokeLegacyProjectRelationships(
        transaction,
        followerId,
        actorId,
        actorId,
        now,
      );
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

      await revokeLegacyProjectRelationships(
        transaction,
        actorId,
        profileId,
        actorId,
        now,
      );
      await revokeLegacyProjectRelationships(
        transaction,
        profileId,
        actorId,
        actorId,
        now,
      );
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

}

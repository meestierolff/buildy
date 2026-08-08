import { and, eq, sql } from "drizzle-orm";
import { outboxEvents, profiles } from "../../db/schema/index.js";
import type {
  OwnProfile,
  ProfileAvatar,
  ProfileMutationResult,
  PublicProfile,
} from "../../shared/contracts/profiles.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import { ProfileError } from "./errors.js";
import type { ProfileRepository, UpdateProfileCommand } from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

type RawProfile = {
  avatar_content_type: string | null;
  avatar_height: number | string | null;
  avatar_id: string | null;
  avatar_width: number | string | null;
  bio: string | null;
  display_name: string;
  is_private: boolean;
  is_pro: boolean;
  location: string | null;
  onboarded_at?: Date | string | null;
  slug: string;
  updated_at: Date | string;
  user_id: string;
  version: number | string;
  viewer_access?: "owner" | "public" | "follower";
};

type ProfileOutboxPayload = {
  schemaVersion: 1;
  requestHash: string;
  profileVersion: number;
};

function actorIdFor(viewer: ProjectActor): string | null {
  return viewer.kind === "authenticated" ? viewer.appUserId : null;
}

function typedRows<Row>(rows: unknown[]): Row[] {
  return rows as Row[];
}

function safeInteger(value: number | string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new ProfileError("INVALID_STATE");
  }
  return numeric;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAvatar(row: RawProfile): ProfileAvatar | null {
  if (
    !row.avatar_id
    || !row.avatar_content_type
    || row.avatar_width === null
    || row.avatar_height === null
  ) return null;
  const width = Number(row.avatar_width);
  const height = Number(row.avatar_height);
  if (
    !Number.isSafeInteger(width)
    || width < 1
    || !Number.isSafeInteger(height)
    || height < 1
    || !/^image\/[a-z0-9.+-]+$/i.test(row.avatar_content_type)
  ) return null;
  return {
    id: row.avatar_id,
    contentType: row.avatar_content_type,
    width,
    height,
    proxyPath: `/api/media/${row.avatar_id}`,
  };
}

function profileFields(row: RawProfile) {
  return {
    id: row.user_id,
    displayName: row.display_name,
    slug: row.slug,
    bio: row.bio,
    location: row.location,
    isPrivate: row.is_private,
    isPro: row.is_pro,
    avatar: mapAvatar(row),
  };
}

function mapOwnProfile(row: RawProfile): OwnProfile {
  return {
    ...profileFields(row),
    onboardedAt: row.onboarded_at ? iso(row.onboarded_at) : null,
    version: safeInteger(row.version),
    updatedAt: iso(row.updated_at),
  };
}

function mapPublicProfile(row: RawProfile): PublicProfile {
  if (!row.viewer_access) throw new ProfileError("INVALID_STATE");
  return {
    ...profileFields(row),
    viewerAccess: row.viewer_access,
  };
}

async function setActor(transaction: DatabaseTransaction, actorId: string | null): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId ?? ""}, true)`);
}

async function lockIdempotencyKey(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
  );
}

function isProfilePayload(value: unknown): value is ProfileOutboxPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ProfileOutboxPayload>;
  return payload.schemaVersion === 1
    && typeof payload.requestHash === "string"
    && /^[0-9a-f]{64}$/.test(payload.requestHash)
    && typeof payload.profileVersion === "number"
    && Number.isSafeInteger(payload.profileVersion)
    && payload.profileVersion > 0;
}

async function replayedMutation(
  transaction: DatabaseTransaction,
  command: UpdateProfileCommand,
): Promise<ProfileMutationResult | null> {
  const records = await transaction
    .select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload })
    .from(outboxEvents)
    .where(eq(outboxEvents.idempotencyKey, command.idempotencyKey))
    .limit(1);
  const existing = records[0];
  if (!existing) return null;
  if (
    existing.eventType !== "profile.updated.v1"
    || !isProfilePayload(existing.payload)
    || existing.payload.requestHash !== command.requestHash
  ) throw new ProfileError("IDEMPOTENCY_CONFLICT");
  return {
    id: command.actorId,
    version: existing.payload.profileVersion,
    replayed: true,
  };
}

async function lockActiveProfile(
  transaction: DatabaseTransaction,
  actorId: string,
): Promise<{ id: string; version: number }> {
  const result = await transaction.execute<{ profile_id: string; version: number | string }>(sql`
    select profile.id as profile_id, profile.version
    from profiles profile
    join app_users actor
      on actor.id = profile.user_id
     and actor.id = ${actorId}::uuid
     and actor.status = 'active'
     and actor.deleted_at is null
    where profile.user_id = ${actorId}::uuid
      and app_can_view_profile(profile.user_id)
    for update of profile
  `);
  const row = typedRows<{ profile_id: string; version: number | string }>(result.rows)[0];
  if (!row) throw new ProfileError("PROFILE_NOT_FOUND");
  return { id: row.profile_id, version: safeInteger(row.version) };
}

async function assertReadyOwnedAvatar(
  transaction: DatabaseTransaction,
  actorId: string,
  assetId: string,
): Promise<void> {
  const result = await transaction.execute<{ id: string }>(sql`
    select asset.id
    from media_assets asset
    where asset.id = ${assetId}::uuid
      and asset.owner_id = ${actorId}::uuid
      and asset.project_id is null
      and asset.original_asset_id is null
      and asset.purpose = 'avatar'
      and asset.status = 'ready'
      and asset.is_current
      and asset.exif_stripped
      and asset.deleted_at is null
      and asset.ready_at is not null
      and asset.object_key like 'originals/%'
      and asset.detected_content_type like 'image/%'
      and asset.size_bytes is not null
      and asset.sha256 is not null
      and asset.width_pixels > 0
      and asset.height_pixels > 0
    for share of asset
  `);
  if (!result.rows[0]) throw new ProfileError("AVATAR_UNAVAILABLE");
}

function databaseDetails(error: unknown): { code?: string; constraint?: string } {
  if (!error || typeof error !== "object") return {};
  const direct = {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    constraint: "constraint" in error && typeof error.constraint === "string"
      ? error.constraint
      : undefined,
  };
  if (direct.code || direct.constraint) return direct;
  return "cause" in error ? databaseDetails(error.cause) : {};
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof ProfileError) throw error;
  const details = databaseDetails(error);
  if (details.constraint === "profiles_slug_uq" || details.code === "23505") {
    throw new ProfileError("SLUG_CONFLICT", { cause: error });
  }
  if (details.code === "40001") {
    throw new ProfileError("VERSION_CONFLICT", { cause: error });
  }
  if (["23503", "23514", "42501"].includes(details.code ?? "")) {
    throw new ProfileError("INVALID_STATE", { cause: error });
  }
  throw error;
}

export function buildProfileOutboxRecord(
  command: Pick<UpdateProfileCommand, "actorId" | "idempotencyKey" | "requestHash">,
  profileVersion: number,
) {
  return {
    aggregateType: "profile" as const,
    aggregateId: command.actorId,
    eventType: "profile.updated.v1" as const,
    idempotencyKey: command.idempotencyKey,
    payload: {
      schemaVersion: 1 as const,
      requestHash: command.requestHash,
      profileVersion,
    },
  };
}

export class PostgresProfileRepository implements ProfileRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async findOwnProfile(actorId: string): Promise<OwnProfile | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<RawProfile>(sql`
        select
          profile.user_id,
          profile.display_name,
          profile.slug,
          profile.bio,
          profile.location,
          profile.onboarded_at,
          profile.is_private,
          profile.is_pro,
          profile.version,
          profile.updated_at,
          avatar.id as avatar_id,
          avatar.detected_content_type as avatar_content_type,
          avatar.width_pixels as avatar_width,
          avatar.height_pixels as avatar_height
        from profiles profile
        join app_users actor
          on actor.id = profile.user_id
         and actor.id = ${actorId}::uuid
         and actor.status = 'active'
         and actor.deleted_at is null
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
        where profile.user_id = ${actorId}::uuid
          and app_can_view_profile(profile.user_id)
        limit 1
      `);
      const row = typedRows<RawProfile>(result.rows)[0];
      return row ? mapOwnProfile(row) : null;
    });
  }

  async findPublicProfile(viewer: ProjectActor, slug: string): Promise<PublicProfile | null> {
    return this.database.transaction(async (transaction) => {
      const viewerId = actorIdFor(viewer);
      await setActor(transaction, viewerId);
      const result = await transaction.execute<RawProfile>(sql`
        select
          profile.user_id,
          profile.display_name,
          profile.slug,
          profile.bio,
          profile.location,
          profile.is_private,
          profile.is_pro,
          profile.version,
          profile.updated_at,
          avatar.id as avatar_id,
          avatar.detected_content_type as avatar_content_type,
          avatar.width_pixels as avatar_width,
          avatar.height_pixels as avatar_height,
          case
            when profile.user_id = ${viewerId}::uuid then 'owner'
            when profile.is_private then 'follower'
            else 'public'
          end as viewer_access
        from profiles profile
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
        where profile.slug = ${slug}
          and app_can_view_profile(profile.user_id)
        limit 1
      `);
      const row = typedRows<RawProfile>(result.rows)[0];
      return row ? mapPublicProfile(row) : null;
    });
  }

  async updateOwnProfile(command: UpdateProfileCommand): Promise<ProfileMutationResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await lockIdempotencyKey(transaction, command.idempotencyKey);
        const replay = await replayedMutation(transaction, command);
        if (replay) return replay;

        const current = await lockActiveProfile(transaction, command.actorId);
        if (current.version !== command.input.expectedVersion) {
          throw new ProfileError("VERSION_CONFLICT");
        }
        if (command.input.avatarAssetId) {
          await assertReadyOwnedAvatar(
            transaction,
            command.actorId,
            command.input.avatarAssetId,
          );
        }

        const rows = await transaction
          .update(profiles)
          .set({
            displayName: command.input.displayName,
            slug: command.input.slug,
            bio: command.input.bio,
            location: command.input.location,
            isPrivate: command.input.isPrivate,
            avatarAssetId: command.input.avatarAssetId,
            onboardedAt: command.input.onboardingCompleted
              ? sql`coalesce(${profiles.onboardedAt}, now())`
              : undefined,
            version: sql`${profiles.version} + 1`,
          })
          .where(and(
            eq(profiles.id, current.id),
            eq(profiles.userId, command.actorId),
            eq(profiles.version, command.input.expectedVersion),
          ))
          .returning({ version: profiles.version });
        const updated = rows[0];
        if (!updated) throw new ProfileError("VERSION_CONFLICT");
        const version = safeInteger(updated.version);

        await transaction.insert(outboxEvents).values(
          buildProfileOutboxRecord(command, version),
        );
        return { id: command.actorId, version, replayed: false };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

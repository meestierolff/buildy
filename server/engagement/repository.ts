import {
  and,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import {
  commentMentions,
  comments,
  notifications,
  outboxEvents,
  reactions,
} from "../../db/schema/index.js";
import type {
  EngagementComment,
  EngagementNotification,
  ReactionCount,
  ReactionMutationResult,
  ReactionSummary,
} from "../../shared/contracts/engagement.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import type { CommentCursor, NotificationCursor } from "./cursor.js";
import { EngagementError } from "./errors.js";
import type {
  CreateCommentCommand,
  DeleteCommentCommand,
  EngagementRepository,
  NotificationListStatus,
  ReactionCommand,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

export type UpdateAccessFacts = {
  acceptedAccess: boolean;
  blocked: boolean;
  lifecycleStatus: "active" | "deletion_pending" | "deleted";
  ownerId: string;
  updateStatus: "draft" | "published" | "deletion_pending" | "deleted";
  visibility: "private" | "public";
};

type RawUpdateAccessFacts = {
  accepted_access: boolean;
  blocked: boolean;
  lifecycle_status: UpdateAccessFacts["lifecycleStatus"];
  owner_id: string;
  update_status: UpdateAccessFacts["updateStatus"];
  update_author_id: string;
  visibility: UpdateAccessFacts["visibility"];
};

type RawComment = {
  author_avatar_content_type: string | null;
  author_avatar_height: number | null;
  author_avatar_id: string | null;
  author_avatar_width: number | null;
  author_display_name: string;
  author_id: string;
  author_slug: string;
  body: string;
  can_delete: boolean;
  created_at: Date | string;
  id: string;
  mention_count: number | string;
  parent_comment_id: string | null;
  project_id: string;
  update_id: string;
  updated_at: Date | string;
  version: number;
};

type RawCommentTarget = {
  author_id: string;
  parent_comment_id: string | null;
};

type RawReactionCount = {
  count: number | string;
  emoji: ReactionCount["emoji"];
  viewer_reacted: boolean;
};

type RawNotification = {
  actor_avatar_content_type: string | null;
  actor_avatar_height: number | null;
  actor_avatar_id: string | null;
  actor_avatar_width: number | null;
  actor_display_name: string;
  actor_id: string | null;
  actor_slug: string;
  comment_id: string | null;
  created_at: Date | string;
  id: string;
  project_id: string | null;
  read_at: Date | string | null;
  status: "unread" | "read";
  type: string;
  update_id: string | null;
};

type MutationEvent = {
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

const REACTION_ORDER = ["👍", "❤️", "🔥", "👏", "🔨"] as const;

export const ENGAGEMENT_NOTIFICATION_OUTBOX_PAYLOAD = Object.freeze({
  schemaVersion: 1 as const,
});

export function buildEngagementNotificationOutboxRecord(notificationId: string) {
  return {
    aggregateId: notificationId,
    aggregateType: "notification" as const,
    eventType: "engagement.notification.created.v1" as const,
    idempotencyKey: `engagement-notification:${notificationId}`,
    payload: ENGAGEMENT_NOTIFICATION_OUTBOX_PAYLOAD,
  };
}

export function canViewerAccessUpdate(
  viewer: ProjectActor,
  facts: UpdateAccessFacts,
): boolean {
  if (
    facts.lifecycleStatus !== "active" ||
    facts.updateStatus === "deletion_pending" ||
    facts.updateStatus === "deleted" ||
    facts.blocked
  ) {
    return false;
  }
  if (viewer.kind === "anonymous") {
    return facts.visibility === "public" && facts.updateStatus === "published";
  }
  if (facts.ownerId === viewer.appUserId) return true;
  return (
    facts.updateStatus === "published" &&
    (facts.visibility === "public" || facts.acceptedAccess)
  );
}

export function canActorDeleteComment(
  actorId: string,
  authorId: string,
  projectOwnerId: string,
): boolean {
  return actorId === authorId || actorId === projectOwnerId;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function typedRows<Row>(rows: unknown[]): Row[] {
  return rows as Row[];
}

function viewerId(viewer: ProjectActor): string | null {
  return viewer.kind === "authenticated" ? viewer.appUserId : null;
}

function accessFacts(row: RawUpdateAccessFacts): UpdateAccessFacts {
  return {
    acceptedAccess: row.accepted_access,
    blocked: row.blocked,
    lifecycleStatus: row.lifecycle_status,
    ownerId: row.owner_id,
    updateStatus: row.update_status,
    visibility: row.visibility,
  };
}

function mapComment(row: RawComment): EngagementComment {
  return {
    id: row.id,
    projectId: row.project_id,
    updateId: row.update_id,
    parentCommentId: row.parent_comment_id,
    author: {
      id: row.author_id,
      displayName: row.author_display_name,
      slug: row.author_slug,
      avatar: row.author_avatar_id
        ? {
            id: row.author_avatar_id,
            contentType: row.author_avatar_content_type,
            width: row.author_avatar_width === null ? null : Number(row.author_avatar_width),
            height: row.author_avatar_height === null ? null : Number(row.author_avatar_height),
            proxyPath: `/api/media/${row.author_avatar_id}`,
          }
        : null,
    },
    body: row.body,
    mentionCount: Number(row.mention_count),
    version: Number(row.version),
    canDelete: row.can_delete,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapNotification(row: RawNotification): EngagementNotification {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    actor: row.actor_id
      ? {
          id: row.actor_id,
          displayName: row.actor_display_name,
          slug: row.actor_slug,
          avatar: row.actor_avatar_id
            ? {
                id: row.actor_avatar_id,
                contentType: row.actor_avatar_content_type,
                width: row.actor_avatar_width === null
                  ? null
                  : Number(row.actor_avatar_width),
                height: row.actor_avatar_height === null
                  ? null
                  : Number(row.actor_avatar_height),
                proxyPath: `/api/media/${row.actor_avatar_id}`,
              }
            : null,
        }
      : null,
    projectId: row.project_id,
    updateId: row.update_id,
    commentId: row.comment_id,
    readAt: nullableIso(row.read_at),
    createdAt: iso(row.created_at),
  };
}

async function setActor(
  transaction: DatabaseTransaction,
  actorId: string | null,
): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId ?? ""}, true)`);
}

async function lockScopes(
  transaction: DatabaseTransaction,
  scopes: string[],
): Promise<void> {
  for (const scope of [...new Set(scopes)].sort()) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
    );
  }
}

function socialScope(leftUserId: string, rightUserId: string): string {
  const [left, right] = [leftUserId, rightUserId].sort();
  return `social:${left}:${right}`;
}

async function loadUpdateAccessFacts(
  transaction: DatabaseTransaction,
  actorId: string | null,
  projectId: string,
  updateId: string,
): Promise<RawUpdateAccessFacts | null> {
  const result = await transaction.execute(sql<RawUpdateAccessFacts>`
    select
      project.owner_id,
      project.visibility,
      project.lifecycle_status,
      item.status as update_status,
      item.author_id as update_author_id,
      exists (
        select 1
        from project_access_requests access_request
        where access_request.project_id = project.id
          and access_request.requester_id = ${actorId}::uuid
          and access_request.status = 'accepted'
      ) as accepted_access,
      exists (
        select 1
        from user_relationships relationship
        where relationship.kind = 'block'
          and relationship.status = 'active'
          and (
            (relationship.source_user_id = ${actorId}::uuid and relationship.target_user_id = project.owner_id)
            or (relationship.target_user_id = ${actorId}::uuid and relationship.source_user_id = project.owner_id)
          )
      ) as blocked
    from projects project
    join updates item on item.project_id = project.id
    where project.id = ${projectId}::uuid
      and item.id = ${updateId}::uuid
    limit 1
  `);
  return typedRows<RawUpdateAccessFacts>(result.rows)[0] ?? null;
}

async function visibleUpdate(
  transaction: DatabaseTransaction,
  viewer: ProjectActor,
  projectId: string,
  updateId: string,
): Promise<RawUpdateAccessFacts | null> {
  const row = await loadUpdateAccessFacts(
    transaction,
    viewerId(viewer),
    projectId,
    updateId,
  );
  return row && canViewerAccessUpdate(viewer, accessFacts(row)) ? row : null;
}

async function lockVisibleUpdate(
  transaction: DatabaseTransaction,
  actorId: string,
  projectId: string,
  updateId: string,
): Promise<RawUpdateAccessFacts> {
  const first = await loadUpdateAccessFacts(transaction, actorId, projectId, updateId);
  if (!first) throw new EngagementError("CONTENT_NOT_FOUND");
  await lockScopes(transaction, [
    `engagement:update:${updateId}`,
    socialScope(actorId, first.owner_id),
  ]);
  await transaction.execute(sql`
    select item.id
    from updates item
    join projects project on project.id = item.project_id
    where item.id = ${updateId}::uuid and project.id = ${projectId}::uuid
    for share of item, project
  `);
  const row = await loadUpdateAccessFacts(transaction, actorId, projectId, updateId);
  const viewer: ProjectActor = { kind: "authenticated", appUserId: actorId };
  if (!row || !canViewerAccessUpdate(viewer, accessFacts(row))) {
    throw new EngagementError("CONTENT_NOT_FOUND");
  }
  return row;
}

async function commentTarget(
  transaction: DatabaseTransaction,
  actorId: string | null,
  projectId: string,
  updateId: string,
  commentId: string,
): Promise<RawCommentTarget | null> {
  const result = await transaction.execute(sql<RawCommentTarget>`
    select comment.author_id, comment.parent_comment_id
    from comments comment
    where comment.id = ${commentId}::uuid
      and comment.project_id = ${projectId}::uuid
      and comment.update_id = ${updateId}::uuid
      and comment.status = 'published'
      and not exists (
        select 1
        from user_relationships relationship
        where relationship.kind = 'block'
          and relationship.status = 'active'
          and (
            (relationship.source_user_id = ${actorId}::uuid and relationship.target_user_id = comment.author_id)
            or (relationship.target_user_id = ${actorId}::uuid and relationship.source_user_id = comment.author_id)
          )
      )
    limit 1
  `);
  return typedRows<RawCommentTarget>(result.rows)[0] ?? null;
}

async function eligibleMentionIds(
  transaction: DatabaseTransaction,
  command: CreateCommentCommand,
  _context: RawUpdateAccessFacts,
): Promise<string[]> {
  try {
    const result = await transaction.execute(sql<{ ids: string[] }>`
      select app_resolve_engagement_mentions(
        ${command.projectId}::uuid,
        ${command.updateId}::uuid,
        ${command.input.mentionUserIds}::uuid[]
      ) as ids
    `);
    return typedRows<{ ids: string[] }>(result.rows)[0]?.ids ?? [];
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    if (code === "42501") {
      throw new EngagementError("CONTENT_NOT_FOUND", { cause: error });
    }
    throw error;
  }
}

async function replayedMutation(
  transaction: DatabaseTransaction,
  idempotencyKey: string,
  eventType: string,
  requestHash: string,
): Promise<string | null> {
  const rows = await transaction
    .select({
      aggregateId: outboxEvents.aggregateId,
      eventType: outboxEvents.eventType,
      payload: outboxEvents.payload,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.idempotencyKey, idempotencyKey))
    .limit(1);
  const existing = rows[0] as MutationEvent | undefined;
  if (!existing) return null;
  if (
    existing.eventType !== eventType ||
    existing.payload.requestHash !== requestHash
  ) {
    throw new EngagementError("IDEMPOTENCY_CONFLICT");
  }
  return existing.aggregateId;
}

async function appendMutationEvent(
  transaction: DatabaseTransaction,
  input: {
    aggregateId: string;
    eventType: "engagement.comment.created.v1" | "engagement.comment.deleted.v1";
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<void> {
  await transaction.insert(outboxEvents).values({
    aggregateType: "comment",
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    idempotencyKey: input.idempotencyKey,
    payload: { schemaVersion: 1, requestHash: input.requestHash },
  });
}

async function appendNotification(
  transaction: DatabaseTransaction,
  input: {
    recipientId: string;
    sourceAggregateId: string;
    type: string;
  },
): Promise<void> {
  await transaction.execute(sql`
    select app_enqueue_engagement_notification(
      ${input.recipientId}::uuid,
      ${input.type}::text,
      ${input.sourceAggregateId}::uuid
    )
  `);
}

async function notifyCommentAudience(
  transaction: DatabaseTransaction,
  command: CreateCommentCommand,
  context: RawUpdateAccessFacts,
  parentAuthorId: string | null,
  mentionIds: string[],
): Promise<void> {
  const audience = new Map<string, { priority: number; type: string }>();
  const offer = (recipientId: string | null, priority: number, type: string): void => {
    if (!recipientId || recipientId === command.actorId) return;
    const current = audience.get(recipientId);
    if (!current || priority < current.priority) audience.set(recipientId, { priority, type });
  };
  offer(parentAuthorId, 1, "comment.reply");
  for (const mentionedId of mentionIds) offer(mentionedId, 2, "comment.mention");
  offer(context.update_author_id, 3, "comment.created");

  for (const [recipientId, notification] of audience) {
    await appendNotification(transaction, {
      recipientId,
      sourceAggregateId: command.commentId,
      type: notification.type,
    });
  }
}

function reactionCommentId(command: ReactionCommand): string | null {
  return command.input.target === "comment" ? command.input.commentId : null;
}

export class PostgresEngagementRepository implements EngagementRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async listComments(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
    cursor: CommentCursor | undefined,
    limit: number,
  ): Promise<EngagementComment[] | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = viewerId(viewer);
      await setActor(transaction, actorId);
      if (!await visibleUpdate(transaction, viewer, projectId, updateId)) return null;
      const cursorFilter = cursor
        ? sql`and (comment.created_at, comment.id) > (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`
        : sql``;
      const result = await transaction.execute(sql<RawComment>`
        select
          comment.id,
          comment.project_id,
          comment.update_id,
          comment.parent_comment_id,
          comment.author_id,
          comment.body,
          comment.version,
          comment.created_at,
          comment.updated_at,
          coalesce(author_profile.display_name, 'Buildy-bouwer') as author_display_name,
          coalesce(author_profile.slug, 'gebruiker-' || left(comment.author_id::text, 8)) as author_slug,
          avatar.id as author_avatar_id,
          avatar.detected_content_type as author_avatar_content_type,
          avatar.width_pixels as author_avatar_width,
          avatar.height_pixels as author_avatar_height,
          coalesce(mention_stats.count, 0) as mention_count,
          (
            comment.author_id = ${actorId}::uuid
            or project.owner_id = ${actorId}::uuid
          ) as can_delete
        from comments comment
        join updates item
          on item.id = comment.update_id and item.project_id = comment.project_id
        join projects project on project.id = item.project_id
        left join project_access_requests accepted_access
          on accepted_access.project_id = project.id
         and accepted_access.requester_id = ${actorId}::uuid
         and accepted_access.status = 'accepted'
        left join profiles author_profile on author_profile.user_id = comment.author_id
        left join lateral (
          select asset.id, asset.detected_content_type, asset.width_pixels, asset.height_pixels
          from media_assets asset
          where asset.owner_id = comment.author_id
            and asset.project_id is null
            and asset.purpose = 'avatar'
            and asset.status = 'ready'
            and asset.is_current
          order by asset.updated_at desc, asset.id desc
          limit 1
        ) avatar on true
        left join lateral (
          select count(*)::integer as count
          from comment_mentions mention
          where mention.comment_id = comment.id and mention.update_id = comment.update_id
        ) mention_stats on true
        where project.id = ${projectId}::uuid
          and item.id = ${updateId}::uuid
          and project.lifecycle_status = 'active'
          and item.status in ('draft', 'published')
          and (project.owner_id = ${actorId}::uuid or item.status = 'published')
          and (
            project.owner_id = ${actorId}::uuid
            or project.visibility = 'public'
            or accepted_access.id is not null
          )
          and not app_users_are_blocked(${actorId}::uuid, project.owner_id)
          and not app_users_are_blocked(${actorId}::uuid, comment.author_id)
          and comment.status = 'published'
          ${cursorFilter}
        order by comment.created_at asc, comment.id asc
        limit ${limit}
      `);
      return typedRows<RawComment>(result.rows).map(mapComment);
    });
  }

  async createComment(command: CreateCommentCommand) {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      await lockScopes(transaction, [`engagement:idempotency:${command.idempotencyKey}`]);
      const replay = await replayedMutation(
        transaction,
        command.idempotencyKey,
        "engagement.comment.created.v1",
        command.requestHash,
      );
      if (replay) return { commentId: replay, replayed: true };

      const context = await lockVisibleUpdate(
        transaction,
        command.actorId,
        command.projectId,
        command.updateId,
      );
      let parentAuthorId: string | null = null;
      if (command.input.parentCommentId) {
        const parent = await commentTarget(
          transaction,
          command.actorId,
          command.projectId,
          command.updateId,
          command.input.parentCommentId,
        );
        if (!parent || parent.parent_comment_id) {
          throw new EngagementError("CONTENT_NOT_FOUND");
        }
        parentAuthorId = parent.author_id;
      }

      const mentionIds = await eligibleMentionIds(transaction, command, context);
      const inserted = await transaction
        .insert(comments)
        .values({
          id: command.commentId,
          projectId: command.projectId,
          updateId: command.updateId,
          authorId: command.actorId,
          parentCommentId: command.input.parentCommentId ?? null,
          body: command.input.body,
          status: "published",
          createdAt: command.now,
          updatedAt: command.now,
        })
        .returning({ id: comments.id });
      if (!inserted[0]) throw new EngagementError("CONTENT_NOT_FOUND");

      if (mentionIds.length > 0) {
        await transaction.insert(commentMentions).values(
          mentionIds.map((mentionedUserId) => ({
            commentId: command.commentId,
            updateId: command.updateId,
            mentionedUserId,
            createdAt: command.now,
          })),
        ).onConflictDoNothing();
      }

      await appendMutationEvent(transaction, {
        aggregateId: command.commentId,
        eventType: "engagement.comment.created.v1",
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
      });
      await notifyCommentAudience(
        transaction,
        command,
        context,
        parentAuthorId,
        mentionIds,
      );
      return { commentId: command.commentId, replayed: false };
    });
  }

  async deleteComment(command: DeleteCommentCommand) {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      await lockScopes(transaction, [
        `engagement:comment:${command.commentId}`,
        `engagement:idempotency:${command.idempotencyKey}`,
      ]);
      const replay = await replayedMutation(
        transaction,
        command.idempotencyKey,
        "engagement.comment.deleted.v1",
        command.requestHash,
      );
      if (replay) {
        if (replay !== command.commentId) throw new EngagementError("IDEMPOTENCY_CONFLICT");
        return { commentId: replay, replayed: true };
      }

      const context = await lockVisibleUpdate(
        transaction,
        command.actorId,
        command.projectId,
        command.updateId,
      );
      const rows = await transaction
        .select({
          authorId: comments.authorId,
          status: comments.status,
          version: comments.version,
        })
        .from(comments)
        .where(and(
          eq(comments.id, command.commentId),
          eq(comments.projectId, command.projectId),
          eq(comments.updateId, command.updateId),
        ))
        .limit(1)
        .for("update");
      const comment = rows[0];
      if (
        !comment ||
        comment.status === "deleted" ||
        !canActorDeleteComment(command.actorId, comment.authorId, context.owner_id)
      ) {
        throw new EngagementError("CONTENT_NOT_FOUND");
      }
      if (comment.version !== command.input.expectedVersion) {
        throw new EngagementError("VERSION_CONFLICT");
      }

      const deleted = await transaction
        .update(comments)
        .set({
          status: "deleted",
          deletedAt: command.now,
          updatedAt: command.now,
          version: sql`${comments.version} + 1`,
          ...(comment.authorId === command.actorId ? { body: "[verwijderd]" } : {}),
        })
        .where(and(
          eq(comments.id, command.commentId),
          eq(comments.version, command.input.expectedVersion),
        ))
        .returning({ id: comments.id });
      if (!deleted[0]) throw new EngagementError("VERSION_CONFLICT");
      await transaction
        .delete(commentMentions)
        .where(eq(commentMentions.commentId, command.commentId));
      await appendMutationEvent(transaction, {
        aggregateId: command.commentId,
        eventType: "engagement.comment.deleted.v1",
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
      });
      return { commentId: command.commentId, replayed: false };
    });
  }

  async reactionSummary(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
    commentId: string | null,
  ): Promise<ReactionSummary | null> {
    return this.database.transaction(async (transaction) => {
      const actorId = viewerId(viewer);
      await setActor(transaction, actorId);
      if (!await visibleUpdate(transaction, viewer, projectId, updateId)) return null;
      if (commentId && !await commentTarget(
        transaction,
        actorId,
        projectId,
        updateId,
        commentId,
      )) {
        return null;
      }
      const commentFilter = commentId
        ? sql`reaction.comment_id = ${commentId}::uuid and reaction.target = 'comment'`
        : sql`reaction.comment_id is null and reaction.target = 'update'`;
      const result = await transaction.execute(sql<RawReactionCount>`
        select
          reaction.emoji,
          count(*)::integer as count,
          coalesce(bool_or(reaction.actor_id = ${actorId}::uuid), false) as viewer_reacted
        from reactions reaction
        where reaction.project_id = ${projectId}::uuid
          and reaction.update_id = ${updateId}::uuid
          and ${commentFilter}
          and not app_users_are_blocked(${actorId}::uuid, reaction.actor_id)
        group by reaction.emoji
        order by array_position(array['👍', '❤️', '🔥', '👏', '🔨']::text[], reaction.emoji)
      `);
      const byEmoji = new Map(
        typedRows<RawReactionCount>(result.rows).map((row) => [row.emoji, row]),
      );
      const items = REACTION_ORDER.flatMap((emoji) => {
        const row = byEmoji.get(emoji);
        return row
          ? [{ emoji, count: Number(row.count), viewerReacted: row.viewer_reacted }]
          : [];
      });
      return {
        projectId,
        updateId,
        target: commentId ? "comment" : "update",
        commentId,
        items,
      };
    });
  }

  async addReaction(command: ReactionCommand): Promise<ReactionMutationResult> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      const context = await lockVisibleUpdate(
        transaction,
        command.actorId,
        command.projectId,
        command.updateId,
      );
      const commentId = reactionCommentId(command);
      await lockScopes(transaction, [
        `engagement:reaction:${command.actorId}:${command.updateId}:${commentId ?? "update"}:${command.input.emoji}`,
      ]);
      let targetAuthorId = context.update_author_id;
      if (commentId) {
        const target = await commentTarget(
          transaction,
          command.actorId,
          command.projectId,
          command.updateId,
          commentId,
        );
        if (!target) throw new EngagementError("CONTENT_NOT_FOUND");
        targetAuthorId = target.author_id;
      }

      const targetWhere = commentId
        ? eq(reactions.commentId, commentId)
        : isNull(reactions.commentId);
      const existing = await transaction
        .select({ id: reactions.id })
        .from(reactions)
        .where(and(
          eq(reactions.actorId, command.actorId),
          eq(reactions.projectId, command.projectId),
          eq(reactions.updateId, command.updateId),
          targetWhere,
          eq(reactions.emoji, command.input.emoji),
        ))
        .limit(1);
      if (existing[0]) {
        return { reactionId: existing[0].id, state: "active", replayed: true };
      }

      const inserted = await transaction
        .insert(reactions)
        .values({
          projectId: command.projectId,
          updateId: command.updateId,
          commentId,
          actorId: command.actorId,
          target: command.input.target,
          emoji: command.input.emoji,
          createdAt: command.now,
        })
        .onConflictDoNothing()
        .returning({ id: reactions.id });
      const reaction = inserted[0];
      if (!reaction) {
        const raced = await transaction
          .select({ id: reactions.id })
          .from(reactions)
          .where(and(
            eq(reactions.actorId, command.actorId),
            eq(reactions.updateId, command.updateId),
            targetWhere,
            eq(reactions.emoji, command.input.emoji),
          ))
          .limit(1);
        if (!raced[0]) throw new EngagementError("CONTENT_NOT_FOUND");
        return { reactionId: raced[0].id, state: "active", replayed: true };
      }

      if (targetAuthorId !== command.actorId) {
        await appendNotification(transaction, {
          recipientId: targetAuthorId,
          sourceAggregateId: reaction.id,
          type: "reaction.created",
        });
      }
      return { reactionId: reaction.id, state: "active", replayed: false };
    });
  }

  async removeReaction(command: ReactionCommand): Promise<ReactionMutationResult> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, command.actorId);
      await lockVisibleUpdate(
        transaction,
        command.actorId,
        command.projectId,
        command.updateId,
      );
      const commentId = reactionCommentId(command);
      await lockScopes(transaction, [
        `engagement:reaction:${command.actorId}:${command.updateId}:${commentId ?? "update"}:${command.input.emoji}`,
      ]);
      if (commentId && !await commentTarget(
        transaction,
        command.actorId,
        command.projectId,
        command.updateId,
        commentId,
      )) {
        throw new EngagementError("CONTENT_NOT_FOUND");
      }
      const targetWhere = commentId
        ? eq(reactions.commentId, commentId)
        : isNull(reactions.commentId);
      const removed = await transaction
        .delete(reactions)
        .where(and(
          eq(reactions.actorId, command.actorId),
          eq(reactions.projectId, command.projectId),
          eq(reactions.updateId, command.updateId),
          targetWhere,
          eq(reactions.emoji, command.input.emoji),
        ))
        .returning({ id: reactions.id });
      return removed[0]
        ? { reactionId: removed[0].id, state: "removed", replayed: false }
        : { reactionId: null, state: "removed", replayed: true };
    });
  }

  async listNotifications(
    recipientId: string,
    cursor: NotificationCursor | undefined,
    limit: number,
    status: NotificationListStatus,
  ): Promise<EngagementNotification[]> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, recipientId);
      const cursorFilter = cursor
        ? sql`and (notification.created_at, notification.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`
        : sql``;
      const statusFilter = status === "all"
        ? sql``
        : sql`and notification.status = ${status}::notification_status`;
      const result = await transaction.execute(sql<RawNotification>`
        select
          notification.id,
          notification.type,
          notification.status,
          notification.actor_id,
          notification.project_id,
          notification.update_id,
          notification.comment_id,
          notification.read_at,
          notification.created_at,
          coalesce(actor_profile.display_name, 'Buildy-bouwer') as actor_display_name,
          coalesce(actor_profile.slug, 'gebruiker-' || left(notification.actor_id::text, 8)) as actor_slug,
          avatar.id as actor_avatar_id,
          avatar.detected_content_type as actor_avatar_content_type,
          avatar.width_pixels as actor_avatar_width,
          avatar.height_pixels as actor_avatar_height
        from notifications notification
        left join profiles actor_profile on actor_profile.user_id = notification.actor_id
        left join lateral (
          select asset.id, asset.detected_content_type, asset.width_pixels, asset.height_pixels
          from media_assets asset
          where asset.owner_id = notification.actor_id
            and asset.project_id is null
            and asset.purpose = 'avatar'
            and asset.status = 'ready'
            and asset.is_current
          order by asset.updated_at desc, asset.id desc
          limit 1
        ) avatar on true
        where notification.recipient_id = ${recipientId}::uuid
          and notification.status in ('unread', 'read')
          ${statusFilter}
          and (
            notification.actor_id is null
            or not app_users_are_blocked(${recipientId}::uuid, notification.actor_id)
          )
          and (
            notification.project_id is null
            or app_can_view_project(notification.project_id)
          )
          and (
            notification.update_id is null
            or exists (
              select 1
              from updates item
              where item.id = notification.update_id
                and item.project_id = notification.project_id
                and item.status in ('draft', 'published')
                and (item.project_owner_id = ${recipientId}::uuid or item.status = 'published')
            )
          )
          and (
            notification.comment_id is null
            or exists (
              select 1
              from comments comment
              where comment.id = notification.comment_id
                and comment.update_id = notification.update_id
                and comment.project_id = notification.project_id
                and comment.status = 'published'
            )
          )
          ${cursorFilter}
        order by notification.created_at desc, notification.id desc
        limit ${limit}
      `);
      return typedRows<RawNotification>(result.rows).map(mapNotification);
    });
  }

  async updateNotification(
    recipientId: string,
    notificationId: string,
    action: "read" | "archive",
    now: Date,
  ): Promise<{
    notificationId: string;
    status: "read" | "archived";
    replayed: boolean;
  }> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, recipientId);
      const rows = await transaction
        .select({ status: notifications.status })
        .from(notifications)
        .where(and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, recipientId),
        ))
        .limit(1)
        .for("update");
      const notification = rows[0];
      if (!notification || (action === "read" && notification.status === "archived")) {
        throw new EngagementError("NOTIFICATION_NOT_FOUND");
      }
      const desired = action === "read" ? "read" : "archived";
      if (notification.status === desired) {
        return { notificationId, status: desired, replayed: true };
      }
      const updated = await transaction
        .update(notifications)
        .set({
          status: desired,
          readAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientId, recipientId),
          eq(notifications.status, notification.status),
        ))
        .returning({ id: notifications.id });
      if (!updated[0]) throw new EngagementError("NOTIFICATION_NOT_FOUND");
      return { notificationId, status: desired, replayed: false };
    });
  }
}

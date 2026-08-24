import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth.js";
import {
  commentStatusEnum,
  notificationStatusEnum,
  optimisticVersion,
  reactionTargetEnum,
  relationshipKindEnum,
  relationshipStatusEnum,
  timestamps,
} from "./common.js";
import { photobookOrders } from "./photobooks.js";
import { projects, updates } from "./projects.js";

export const userRelationships = pgTable(
  "user_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceUserId: uuid("source_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    kind: relationshipKindEnum("kind").notNull(),
    status: relationshipStatusEnum("status").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("user_relationships_direction_kind_uq").on(table.sourceUserId, table.targetUserId, table.kind),
    index("user_relationships_source_status_idx").on(table.sourceUserId, table.kind, table.status),
    index("user_relationships_target_status_idx").on(table.targetUserId, table.kind, table.status),
    check("user_relationships_not_self_ck", sql`${table.sourceUserId} <> ${table.targetUserId}`),
    check("user_relationships_version_ck", sql`${table.version} > 0`),
    check(
      "user_relationships_block_state_ck",
      sql`${table.kind} <> 'block' OR ${table.status} IN ('active', 'revoked')`,
    ),
    check(
      "user_relationships_decision_ck",
      sql`${table.status} = 'pending' OR ${table.decidedAt} IS NOT NULL`,
    ),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    updateId: uuid("update_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    parentCommentId: uuid("parent_comment_id"),
    body: text("body").notNull(),
    status: commentStatusEnum("status").default("published").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "comments_update_project_fk",
      columns: [table.updateId, table.projectId],
      foreignColumns: [updates.id, updates.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "comments_parent_update_fk",
      columns: [table.parentCommentId, table.updateId],
      foreignColumns: [table.id, table.updateId],
    }).onDelete("restrict"),
    unique("comments_id_update_uq").on(table.id, table.updateId),
    unique("comments_id_project_uq").on(table.id, table.projectId),
    index("comments_update_timeline_idx").on(table.updateId, table.status, table.createdAt),
    index("comments_author_idx").on(table.authorId, table.createdAt),
    check("comments_body_length_ck", sql`char_length(btrim(${table.body})) BETWEEN 1 AND 2000`),
    check("comments_parent_not_self_ck", sql`${table.parentCommentId} IS NULL OR ${table.parentCommentId} <> ${table.id}`),
    check("comments_version_ck", sql`${table.version} > 0`),
    check(
      "comments_deleted_state_ck",
      sql`${table.status} <> 'deleted' OR ${table.deletedAt} IS NOT NULL`,
    ),
  ],
);

export const commentMentions = pgTable(
  "comment_mentions",
  {
    commentId: uuid("comment_id").notNull(),
    updateId: uuid("update_id").notNull(),
    mentionedUserId: uuid("mentioned_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "comment_mentions_comment_update_fk",
      columns: [table.commentId, table.updateId],
      foreignColumns: [comments.id, comments.updateId],
    }).onDelete("cascade"),
    uniqueIndex("comment_mentions_comment_user_uq").on(table.commentId, table.mentionedUserId),
    index("comment_mentions_user_idx").on(table.mentionedUserId, table.createdAt),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    updateId: uuid("update_id").notNull(),
    commentId: uuid("comment_id"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    target: reactionTargetEnum("target").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "reactions_update_project_fk",
      columns: [table.updateId, table.projectId],
      foreignColumns: [updates.id, updates.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "reactions_comment_update_fk",
      columns: [table.commentId, table.updateId],
      foreignColumns: [comments.id, comments.updateId],
    }).onDelete("cascade"),
    uniqueIndex("reactions_actor_target_emoji_uq").on(
      table.actorId,
      table.updateId,
      sql`coalesce(${table.commentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.emoji,
    ),
    index("reactions_update_idx").on(table.updateId, table.createdAt),
    index("reactions_comment_idx").on(table.commentId, table.createdAt),
    check("reactions_target_shape_ck", sql`(${table.target} = 'update' AND ${table.commentId} IS NULL) OR (${table.target} = 'comment' AND ${table.commentId} IS NOT NULL)`),
    check("reactions_emoji_ck", sql`${table.emoji} IN ('👍', '❤️', '🔥', '👏', '🔨')`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => appUsers.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    updateId: uuid("update_id"),
    commentId: uuid("comment_id"),
    orderId: uuid("order_id").references(() => photobookOrders.id, { onDelete: "cascade" }),
    sourceAggregateId: uuid("source_aggregate_id"),
    sourceVersion: integer("source_version"),
    sourceOccurredAt: timestamp("source_occurred_at", { withTimezone: true }),
    type: text("type").notNull(),
    status: notificationStatusEnum("status").default("unread").notNull(),
    dedupeKey: text("dedupe_key"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "notifications_update_project_fk",
      columns: [table.updateId, table.projectId],
      foreignColumns: [updates.id, updates.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_comment_update_fk",
      columns: [table.commentId, table.updateId],
      foreignColumns: [comments.id, comments.updateId],
    }).onDelete("cascade"),
    uniqueIndex("notifications_dedupe_uq").on(table.dedupeKey),
    uniqueIndex("notifications_update_published_recipient_uq")
      .on(table.updateId, table.recipientId, table.type)
      .where(sql`${table.type} = 'update.published'`),
    uniqueIndex("notifications_social_version_recipient_uq")
      .on(table.type, table.sourceAggregateId, table.sourceVersion, table.recipientId)
      .where(sql`${table.type} IN ('profile.follow.requested', 'profile.followed', 'profile.follow.accepted', 'profile.follow.rejected', 'project.access.requested', 'project.access.accepted', 'project.access.rejected') AND ${table.sourceAggregateId} IS NOT NULL AND ${table.sourceVersion} IS NOT NULL`),
    uniqueIndex("notifications_project_follow_event_recipient_uq")
      .on(
        table.type,
        table.sourceAggregateId,
        table.sourceOccurredAt,
        table.actorId,
        table.recipientId,
      )
      .where(sql`${table.type} = 'project.followed' AND ${table.sourceAggregateId} IS NOT NULL AND ${table.sourceOccurredAt} IS NOT NULL AND ${table.actorId} IS NOT NULL`),
    uniqueIndex("notifications_engagement_source_recipient_uq")
      .on(table.type, table.sourceAggregateId, table.recipientId)
      .where(sql`${table.type} IN ('comment.created', 'comment.reply', 'comment.mention', 'reaction.created') AND ${table.sourceAggregateId} IS NOT NULL`),
    index("notifications_recipient_status_idx").on(table.recipientId, table.status, table.createdAt),
    index("notifications_recipient_order_idx")
      .on(table.recipientId, table.orderId, table.createdAt)
      .where(sql`${table.orderId} IS NOT NULL`),
    check("notifications_type_ck", sql`char_length(btrim(${table.type})) BETWEEN 1 AND 80`),
    check("notifications_read_state_ck", sql`${table.status} <> 'read' OR ${table.readAt} IS NOT NULL`),
    check("notifications_payload_object_ck", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check("notifications_source_version_ck", sql`${table.sourceVersion} IS NULL OR ${table.sourceVersion} > 0`),
  ],
);

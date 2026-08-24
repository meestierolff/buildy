import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

const uuidSchema = z.string().uuid();
const opaqueCursorSchema = z.string().min(1).max(512);
const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Idempotency-key bevat ongeldige tekens.");

export const engagementRoutes = {
  comments: "/api/projects/:projectId/updates/:updateId/comments",
  comment: "/api/projects/:projectId/updates/:updateId/comments/:commentId",
  reactions: "/api/projects/:projectId/updates/:updateId/reactions",
  notifications: "/api/notifications",
  notification: "/api/notifications/:notificationId",
} as const;

export const engagementPageQuerySchema = z.object({
  cursor: opaqueCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const notificationPageQuerySchema = engagementPageQuerySchema.extend({
  status: z.enum(["all", "unread", "read"]).default("all"),
}).strict();

export const createCommentInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  body: z.string().trim().min(1).max(2_000),
  parentCommentId: uuidSchema.optional(),
  mentionUserIds: z.array(uuidSchema).max(10).default([]),
}).strict().superRefine((input, context) => {
  const seen = new Set<string>();
  for (const [index, userId] of input.mentionUserIds.entries()) {
    const normalized = userId.toLowerCase();
    if (seen.has(normalized)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Een gebruiker kan maar één keer per reactie worden genoemd.",
        path: ["mentionUserIds", index],
      });
    }
    seen.add(normalized);
  }
});

export const deleteCommentInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
}).strict();

export const supportedReactionEmojiSchema = z.enum(["👍", "❤️", "🔥", "👏", "🔨"]);

export const reactionTargetInputSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("update"),
    emoji: supportedReactionEmojiSchema,
  }).strict(),
  z.object({
    target: z.literal("comment"),
    commentId: uuidSchema,
    emoji: supportedReactionEmojiSchema,
  }).strict(),
]);

export const reactionQuerySchema = z.object({
  commentId: uuidSchema.optional(),
}).strict();

export const notificationMutationInputSchema = z.object({
  action: z.enum(["read", "archive"]),
}).strict();

export const notificationMarkAllReadInputSchema = z.object({
  action: z.literal("read_all"),
}).strict();

export const engagementAvatarSchema = z.object({
  id: uuidSchema,
  contentType: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  proxyPath: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
});

export const engagementActorSchema = z.object({
  id: uuidSchema,
  displayName: z.string().min(1).max(80),
  slug: z.string().min(1).max(80),
  avatar: engagementAvatarSchema.nullable(),
});

export const engagementCommentSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  updateId: uuidSchema,
  parentCommentId: uuidSchema.nullable(),
  author: engagementActorSchema,
  body: z.string().min(1).max(2_000),
  mentionCount: z.number().int().min(0).max(10),
  version: z.number().int().positive(),
  canDelete: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const commentPageSchema = z.object({
  projectId: uuidSchema,
  updateId: uuidSchema,
  items: z.array(engagementCommentSchema),
  nextCursor: opaqueCursorSchema.nullable(),
});

export const commentMutationResultSchema = z.object({
  commentId: uuidSchema,
  replayed: z.boolean(),
});

export const reactionCountSchema = z.object({
  emoji: supportedReactionEmojiSchema,
  count: z.number().int().positive(),
  viewerReacted: z.boolean(),
});

export const reactionSummarySchema = z.object({
  projectId: uuidSchema,
  updateId: uuidSchema,
  target: z.enum(["update", "comment"]),
  commentId: uuidSchema.nullable(),
  items: z.array(reactionCountSchema).max(5),
});

export const reactionMutationResultSchema = z.object({
  reactionId: uuidSchema.nullable(),
  state: z.enum(["active", "removed"]),
  replayed: z.boolean(),
});

export const engagementNotificationTypeSchema = z.enum([
  "profile.follow.requested",
  "profile.followed",
  "profile.follow.accepted",
  "profile.follow.rejected",
  "project.followed",
  "project.access.requested",
  "project.access.accepted",
  "project.access.rejected",
  "comment.created",
  "comment.reply",
  "comment.mention",
  "reaction.created",
  "moderation.warning",
  "update.published",
  "order.payment.succeeded",
  "order.payment.failed",
  "order.payment.expired",
  "order.payment.partially_refunded",
  "order.payment.refunded",
  "order.manual_review",
  "order.fulfilment.ordered",
  "order.fulfilment.in_production",
  "order.fulfilment.shipped",
  "order.fulfilment.completed",
  "order.fulfilment.cancelled",
  "order.fulfilment.refund_review",
]);

export const engagementNotificationSchema = z.object({
  id: uuidSchema,
  type: engagementNotificationTypeSchema,
  status: z.enum(["unread", "read"]),
  actor: engagementActorSchema.nullable(),
  projectId: uuidSchema.nullable(),
  updateId: uuidSchema.nullable(),
  commentId: uuidSchema.nullable(),
  orderId: uuidSchema.nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const notificationPageSchema = z.object({
  items: z.array(engagementNotificationSchema),
  nextCursor: opaqueCursorSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
});

export const notificationMutationResultSchema = z.object({
  notificationId: uuidSchema,
  status: z.enum(["read", "archived"]),
  replayed: z.boolean(),
});

export const notificationMarkAllReadResultSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

export const commentPageResponseSchema = apiSuccessSchema(commentPageSchema);
export const commentMutationResponseSchema = apiSuccessSchema(commentMutationResultSchema);
export const reactionSummaryResponseSchema = apiSuccessSchema(reactionSummarySchema);
export const reactionMutationResponseSchema = apiSuccessSchema(reactionMutationResultSchema);
export const notificationPageResponseSchema = apiSuccessSchema(notificationPageSchema);
export const notificationMutationResponseSchema = apiSuccessSchema(notificationMutationResultSchema);
export const notificationMarkAllReadResponseSchema = apiSuccessSchema(
  notificationMarkAllReadResultSchema,
);

export type EngagementPageQuery = z.infer<typeof engagementPageQuerySchema>;
export type NotificationPageQuery = z.infer<typeof notificationPageQuerySchema>;
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
export type DeleteCommentInput = z.infer<typeof deleteCommentInputSchema>;
export type ReactionTargetInput = z.infer<typeof reactionTargetInputSchema>;
export type ReactionQuery = z.infer<typeof reactionQuerySchema>;
export type NotificationMutationInput = z.infer<typeof notificationMutationInputSchema>;
export type NotificationMarkAllReadInput = z.infer<typeof notificationMarkAllReadInputSchema>;
export type SupportedReactionEmoji = z.infer<typeof supportedReactionEmojiSchema>;
export type EngagementActor = z.infer<typeof engagementActorSchema>;
export type EngagementComment = z.infer<typeof engagementCommentSchema>;
export type CommentPage = z.infer<typeof commentPageSchema>;
export type CommentMutationResult = z.infer<typeof commentMutationResultSchema>;
export type ReactionCount = z.infer<typeof reactionCountSchema>;
export type ReactionSummary = z.infer<typeof reactionSummarySchema>;
export type ReactionMutationResult = z.infer<typeof reactionMutationResultSchema>;
export type EngagementNotificationType = z.infer<typeof engagementNotificationTypeSchema>;
export type EngagementNotification = z.infer<typeof engagementNotificationSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type NotificationMutationResult = z.infer<typeof notificationMutationResultSchema>;
export type NotificationMarkAllReadResult = z.infer<typeof notificationMarkAllReadResultSchema>;

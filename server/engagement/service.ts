import {
  createCommentInputSchema,
  deleteCommentInputSchema,
  engagementPageQuerySchema,
  notificationMarkAllReadInputSchema,
  notificationMutationInputSchema,
  notificationPageQuerySchema,
  reactionQuerySchema,
  reactionTargetInputSchema,
  type CommentMutationResult,
  type CommentPage,
  type NotificationMarkAllReadResult,
  type NotificationMutationResult,
  type NotificationPage,
  type ReactionMutationResult,
  type ReactionSummary,
} from "../../shared/contracts/engagement.js";
import {
  ANONYMOUS_PROJECT_ACTOR,
  type ProjectActor,
} from "../projects/actor.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import {
  decodeCommentCursor,
  decodeNotificationCursor,
  encodeEngagementCursor,
} from "./cursor.js";
import { EngagementError } from "./errors.js";
import {
  engagementRequestHash,
  scopedEngagementIdempotencyKey,
} from "./idempotency.js";
import type {
  EngagementClock,
  EngagementIdFactory,
  EngagementRepository,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function contentId(value: string): string {
  if (!UUID.test(value)) throw new EngagementError("CONTENT_NOT_FOUND");
  return value.toLowerCase();
}

function actorId(value: string): string {
  if (!UUID.test(value)) throw new EngagementError("ACTOR_MAPPING_UNAVAILABLE");
  return value.toLowerCase();
}

function notificationId(value: string): string {
  if (!UUID.test(value)) throw new EngagementError("NOTIFICATION_NOT_FOUND");
  return value.toLowerCase();
}

function normalizedViewer(viewer: ProjectActor): ProjectActor {
  return viewer.kind === "authenticated"
    ? { kind: "authenticated", appUserId: actorId(viewer.appUserId) }
    : ANONYMOUS_PROJECT_ACTOR;
}

function withoutIdempotencyKey<T extends { idempotencyKey: string }>(
  input: T,
): Omit<T, "idempotencyKey"> {
  const { idempotencyKey: _idempotencyKey, ...payload } = input;
  return payload;
}

export class EngagementService {
  constructor(
    private readonly repository: EngagementRepository,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly clock: EngagementClock = () => new Date(),
    private readonly createId: EngagementIdFactory = () => crypto.randomUUID(),
  ) {}

  async comments(
    viewer: ProjectActor,
    rawProjectId: string,
    rawUpdateId: string,
    rawQuery: unknown,
  ): Promise<CommentPage> {
    const projectId = contentId(rawProjectId);
    const updateId = contentId(rawUpdateId);
    const query = engagementPageQuerySchema.parse(rawQuery);
    const cursor = decodeCommentCursor(query.cursor, updateId);
    const rows = await this.repository.listComments(
      normalizedViewer(viewer),
      projectId,
      updateId,
      cursor,
      query.limit + 1,
    );
    if (!rows) throw new EngagementError("CONTENT_NOT_FOUND");
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      projectId,
      updateId,
      items,
      nextCursor: rows.length > query.limit && last
        ? encodeEngagementCursor({
            version: 1,
            kind: "comments",
            updateId,
            timestamp: last.createdAt,
            id: last.id,
          })
        : null,
    };
  }

  async createComment(
    rawActorId: string,
    rawProjectId: string,
    rawUpdateId: string,
    rawInput: unknown,
  ): Promise<CommentMutationResult> {
    const actor = actorId(rawActorId);
    const projectId = contentId(rawProjectId);
    const updateId = contentId(rawUpdateId);
    const input = createCommentInputSchema.parse(rawInput);
    const operation = "comment.create";
    return this.repository.createComment({
      actorId: actor,
      commentId: this.createId(),
      projectId,
      updateId,
      input: {
        ...input,
        mentionUserIds: input.mentionUserIds.map(contentId),
        ...(input.parentCommentId
          ? { parentCommentId: contentId(input.parentCommentId) }
          : {}),
      },
      idempotencyKey: scopedEngagementIdempotencyKey(
        operation,
        actor,
        updateId,
        input.idempotencyKey,
      ),
      requestHash: engagementRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
      now: this.clock(),
    });
  }

  async deleteComment(
    rawActorId: string,
    rawProjectId: string,
    rawUpdateId: string,
    rawCommentId: string,
    rawInput: unknown,
  ): Promise<CommentMutationResult> {
    const actor = actorId(rawActorId);
    const projectId = contentId(rawProjectId);
    const updateId = contentId(rawUpdateId);
    const commentId = contentId(rawCommentId);
    const input = deleteCommentInputSchema.parse(rawInput);
    const operation = "comment.delete";
    return this.repository.deleteComment({
      actorId: actor,
      projectId,
      updateId,
      commentId,
      input,
      idempotencyKey: scopedEngagementIdempotencyKey(
        operation,
        actor,
        commentId,
        input.idempotencyKey,
      ),
      requestHash: engagementRequestHash(operation, withoutIdempotencyKey(input), this.blindIndex),
      now: this.clock(),
    });
  }

  async reactions(
    viewer: ProjectActor,
    rawProjectId: string,
    rawUpdateId: string,
    rawQuery: unknown,
  ): Promise<ReactionSummary> {
    const projectId = contentId(rawProjectId);
    const updateId = contentId(rawUpdateId);
    const query = reactionQuerySchema.parse(rawQuery);
    const commentId = query.commentId ? contentId(query.commentId) : null;
    const summary = await this.repository.reactionSummary(
      normalizedViewer(viewer),
      projectId,
      updateId,
      commentId,
    );
    if (!summary) throw new EngagementError("CONTENT_NOT_FOUND");
    return summary;
  }

  async addReaction(
    rawActorId: string,
    rawProjectId: string,
    rawUpdateId: string,
    rawInput: unknown,
  ): Promise<ReactionMutationResult> {
    return this.mutateReaction("add", rawActorId, rawProjectId, rawUpdateId, rawInput);
  }

  async removeReaction(
    rawActorId: string,
    rawProjectId: string,
    rawUpdateId: string,
    rawInput: unknown,
  ): Promise<ReactionMutationResult> {
    return this.mutateReaction("remove", rawActorId, rawProjectId, rawUpdateId, rawInput);
  }

  private async mutateReaction(
    action: "add" | "remove",
    rawActorId: string,
    rawProjectId: string,
    rawUpdateId: string,
    rawInput: unknown,
  ): Promise<ReactionMutationResult> {
    const input = reactionTargetInputSchema.parse(rawInput);
    const command = {
      actorId: actorId(rawActorId),
      projectId: contentId(rawProjectId),
      updateId: contentId(rawUpdateId),
      input: input.target === "comment"
        ? { ...input, commentId: contentId(input.commentId) }
        : input,
      now: this.clock(),
    };
    return action === "add"
      ? this.repository.addReaction(command)
      : this.repository.removeReaction(command);
  }

  async notifications(rawActorId: string, rawQuery: unknown): Promise<NotificationPage> {
    const recipientId = actorId(rawActorId);
    const query = notificationPageQuerySchema.parse(rawQuery);
    const cursor = decodeNotificationCursor(query.cursor, query.status);
    const result = await this.repository.listNotifications(
      recipientId,
      cursor,
      query.limit + 1,
      query.status,
    );
    const items = result.items.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: result.items.length > query.limit && last
        ? encodeEngagementCursor({
            version: 1,
            kind: "notifications",
            status: query.status,
            timestamp: last.createdAt,
            id: last.id,
          })
        : null,
      unreadCount: result.unreadCount,
    };
  }

  async updateNotification(
    rawActorId: string,
    rawNotificationId: string,
    rawInput: unknown,
  ): Promise<NotificationMutationResult> {
    const input = notificationMutationInputSchema.parse(rawInput);
    return this.repository.updateNotification(
      actorId(rawActorId),
      notificationId(rawNotificationId),
      input.action,
      this.clock(),
    );
  }

  async markAllNotificationsRead(
    rawActorId: string,
    rawInput: unknown,
  ): Promise<NotificationMarkAllReadResult> {
    notificationMarkAllReadInputSchema.parse(rawInput);
    return this.repository.markAllNotificationsRead(
      actorId(rawActorId),
      this.clock(),
    );
  }
}

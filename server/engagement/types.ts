import type {
  CommentMutationResult,
  CreateCommentInput,
  DeleteCommentInput,
  EngagementComment,
  EngagementNotification,
  NotificationMarkAllReadResult,
  NotificationMutationResult,
  ReactionMutationResult,
  ReactionSummary,
  ReactionTargetInput,
} from "../../shared/contracts/engagement.js";
import type { ProjectActor } from "../projects/actor.js";
import type { CommentCursor, NotificationCursor } from "./cursor.js";

export type CreateCommentCommand = {
  actorId: string;
  commentId: string;
  projectId: string;
  updateId: string;
  input: CreateCommentInput;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type DeleteCommentCommand = {
  actorId: string;
  projectId: string;
  updateId: string;
  commentId: string;
  input: DeleteCommentInput;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type ReactionCommand = {
  actorId: string;
  projectId: string;
  updateId: string;
  input: ReactionTargetInput;
  now: Date;
};

export type NotificationListStatus = "all" | "unread" | "read";

export interface EngagementRepository {
  listComments(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
    cursor: CommentCursor | undefined,
    limit: number,
  ): Promise<EngagementComment[] | null>;
  createComment(command: CreateCommentCommand): Promise<CommentMutationResult>;
  deleteComment(command: DeleteCommentCommand): Promise<CommentMutationResult>;
  reactionSummary(
    viewer: ProjectActor,
    projectId: string,
    updateId: string,
    commentId: string | null,
  ): Promise<ReactionSummary | null>;
  addReaction(command: ReactionCommand): Promise<ReactionMutationResult>;
  removeReaction(command: ReactionCommand): Promise<ReactionMutationResult>;
  listNotifications(
    recipientId: string,
    cursor: NotificationCursor | undefined,
    limit: number,
    status: NotificationListStatus,
  ): Promise<{ items: EngagementNotification[]; unreadCount: number }>;
  updateNotification(
    recipientId: string,
    notificationId: string,
    action: "read" | "archive",
    now: Date,
  ): Promise<NotificationMutationResult>;
  markAllNotificationsRead(
    recipientId: string,
    now: Date,
  ): Promise<NotificationMarkAllReadResult>;
}

export type EngagementClock = () => Date;
export type EngagementIdFactory = () => string;

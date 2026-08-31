import { z } from "zod";
import {
  commentMutationResponseSchema,
  commentPageResponseSchema,
  createCommentInputSchema,
  deleteCommentInputSchema,
  engagementPageQuerySchema,
  notificationMutationInputSchema,
  notificationMutationResponseSchema,
  notificationMarkAllReadInputSchema,
  notificationMarkAllReadResponseSchema,
  notificationPageQuerySchema,
  notificationPageResponseSchema,
  reactionQuerySchema,
  reactionMutationResponseSchema,
  reactionSummaryResponseSchema,
  reactionTargetInputSchema,
  type CommentMutationResult,
  type CommentPage,
  type CreateCommentInput,
  type DeleteCommentInput,
  type NotificationMutationResult,
  type NotificationMarkAllReadResult,
  type NotificationPage,
  type NotificationPageQuery,
  type ReactionMutationResult,
  type ReactionQuery,
  type ReactionSummary,
  type ReactionTargetInput,
} from "../../shared/contracts/engagement";
import { apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();

function encodedId(value: string): string {
  return encodeURIComponent(uuidSchema.parse(value));
}

function updatePath(projectId: string, updateId: string): `/api/projects/${string}/updates/${string}` {
  return `/api/projects/${encodedId(projectId)}/updates/${encodedId(updateId)}`;
}

function commentsPath(projectId: string, updateId: string): `/api/${string}` {
  return `${updatePath(projectId, updateId)}/comments`;
}

function reactionsPath(projectId: string, updateId: string): `/api/${string}` {
  return `${updatePath(projectId, updateId)}/reactions`;
}

export function extractMentionSlugs(value: string): string[] {
  const slugs = new Set<string>();
  for (const match of value.matchAll(/(?:^|\s)@([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi)) {
    if (match[1]) slugs.add(match[1].toLocaleLowerCase("nl-NL"));
  }
  return [...slugs];
}

export async function getEngagementComments(
  projectId: string,
  updateId: string,
  input: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<CommentPage> {
  const parsed = engagementPageQuerySchema.parse(input);
  const query = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) query.set("cursor", parsed.cursor);
  return (await apiRequest(
    `${commentsPath(projectId, updateId)}?${query.toString()}`,
    commentPageResponseSchema,
    { signal },
  )).data;
}

export async function createEngagementComment(
  projectId: string,
  updateId: string,
  input: CreateCommentInput,
): Promise<CommentMutationResult> {
  const parsed = createCommentInputSchema.parse(input);
  return (await apiRequest(
    commentsPath(projectId, updateId),
    commentMutationResponseSchema,
    { method: "POST", body: parsed },
  )).data;
}

export async function deleteEngagementComment(
  projectId: string,
  updateId: string,
  commentId: string,
  input: DeleteCommentInput,
): Promise<CommentMutationResult> {
  const parsed = deleteCommentInputSchema.parse(input);
  return (await apiRequest(
    `${commentsPath(projectId, updateId)}/${encodedId(commentId)}`,
    commentMutationResponseSchema,
    { method: "DELETE", body: parsed },
  )).data;
}

export async function getEngagementReactions(
  projectId: string,
  updateId: string,
  input: ReactionQuery = {},
  signal?: AbortSignal,
): Promise<ReactionSummary> {
  const parsed = reactionQuerySchema.parse(input);
  const query = new URLSearchParams();
  if (parsed.commentId) query.set("commentId", encodedId(parsed.commentId));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return (await apiRequest(
    `${reactionsPath(projectId, updateId)}${suffix}`,
    reactionSummaryResponseSchema,
    { signal },
  )).data;
}

async function mutateReaction(
  method: "PUT" | "DELETE",
  projectId: string,
  updateId: string,
  input: ReactionTargetInput,
): Promise<ReactionMutationResult> {
  const parsed = reactionTargetInputSchema.parse(input);
  return (await apiRequest(
    reactionsPath(projectId, updateId),
    reactionMutationResponseSchema,
    { method, body: parsed },
  )).data;
}

export function addEngagementReaction(
  projectId: string,
  updateId: string,
  input: ReactionTargetInput,
): Promise<ReactionMutationResult> {
  return mutateReaction("PUT", projectId, updateId, input);
}

export function removeEngagementReaction(
  projectId: string,
  updateId: string,
  input: ReactionTargetInput,
): Promise<ReactionMutationResult> {
  return mutateReaction("DELETE", projectId, updateId, input);
}

export async function getEngagementNotifications(
  input: Partial<NotificationPageQuery> = {},
  signal?: AbortSignal,
): Promise<NotificationPage> {
  const parsed = notificationPageQuerySchema.parse(input);
  const query = new URLSearchParams({
    limit: String(parsed.limit),
    status: parsed.status,
  });
  if (parsed.cursor) query.set("cursor", parsed.cursor);
  return (await apiRequest(
    `/api/notifications?${query.toString()}`,
    notificationPageResponseSchema,
    { signal },
  )).data;
}

export async function updateEngagementNotification(
  notificationId: string,
  action: "read" | "archive",
): Promise<NotificationMutationResult> {
  const input = notificationMutationInputSchema.parse({ action });
  return (await apiRequest(
    `/api/notifications/${encodedId(notificationId)}`,
    notificationMutationResponseSchema,
    { method: "PATCH", body: input },
  )).data;
}

export async function markAllEngagementNotificationsRead(): Promise<NotificationMarkAllReadResult> {
  const input = notificationMarkAllReadInputSchema.parse({ action: "read_all" });
  return (await apiRequest(
    "/api/notifications",
    notificationMarkAllReadResponseSchema,
    { method: "PATCH", body: input },
  )).data;
}

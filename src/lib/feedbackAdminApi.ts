import type {
  FeedbackAdminDetail,
  FeedbackAdminQueuePage,
  FeedbackAdminQueueQuery,
  FeedbackAdminSession,
  FeedbackAdminStatusInput,
  FeedbackAdminStatusResult,
} from "../../shared/contracts/feedbackAdmin";
import {
  feedbackAdminDetailResponseSchema,
  feedbackAdminQueueResponseSchema,
  feedbackAdminSessionResponseSchema,
  feedbackAdminStatusResponseSchema,
} from "../../shared/contracts/feedbackAdmin";
import { apiRequest } from "@/lib/apiClient";

export async function getFeedbackAdminSession(signal?: AbortSignal): Promise<FeedbackAdminSession> {
  return (await apiRequest(
    "/api/admin/feedback/session",
    feedbackAdminSessionResponseSchema,
    { signal },
  )).data;
}

export async function getFeedbackAdminQueue(
  query: FeedbackAdminQueueQuery,
  signal?: AbortSignal,
): Promise<FeedbackAdminQueuePage> {
  const search = new URLSearchParams({ status: query.status, limit: String(query.limit) });
  if (query.kind) search.set("kind", query.kind);
  if (query.cursor) search.set("cursor", query.cursor);
  return (await apiRequest(
    `/api/admin/feedback?${search.toString()}`,
    feedbackAdminQueueResponseSchema,
    { signal },
  )).data;
}

export async function getFeedbackAdminDetail(
  submissionId: string,
  signal?: AbortSignal,
): Promise<FeedbackAdminDetail> {
  return (await apiRequest(
    `/api/admin/feedback/${encodeURIComponent(submissionId)}`,
    feedbackAdminDetailResponseSchema,
    { signal },
  )).data;
}

export async function updateFeedbackAdminStatus(
  submissionId: string,
  input: FeedbackAdminStatusInput,
): Promise<FeedbackAdminStatusResult> {
  return (await apiRequest(
    `/api/admin/feedback/${encodeURIComponent(submissionId)}/status`,
    feedbackAdminStatusResponseSchema,
    { method: "POST", body: input },
  )).data;
}

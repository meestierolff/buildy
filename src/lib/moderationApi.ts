import type {
  CreateFeedbackInput,
  CreateModerationReportInput,
  CreateSupportInput,
  FeedbackSubmissionReceipt,
  ModerationAdminActionInput,
  ModerationAdminActionResult,
  ModerationAdminQueuePage,
  ModerationAdminQueueQuery,
  ModerationAdminReportDetail,
  ModerationAdminSession,
  ModerationReportReceipt,
} from "../../shared/contracts/moderation";
import {
  feedbackSubmissionResponseSchema,
  moderationAdminActionResponseSchema,
  moderationAdminQueueResponseSchema,
  moderationAdminReportDetailResponseSchema,
  moderationAdminSessionResponseSchema,
  moderationReportResponseSchema,
} from "../../shared/contracts/moderation";
import { apiRequest } from "@/lib/apiClient";

export async function submitModerationReport(
  input: CreateModerationReportInput,
): Promise<ModerationReportReceipt> {
  const response = await apiRequest(
    "/api/moderation/reports",
    moderationReportResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function submitFeedback(
  input: CreateFeedbackInput,
): Promise<FeedbackSubmissionReceipt> {
  const response = await apiRequest(
    "/api/feedback",
    feedbackSubmissionResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function submitSupport(
  input: CreateSupportInput,
): Promise<FeedbackSubmissionReceipt> {
  const response = await apiRequest(
    "/api/support",
    feedbackSubmissionResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function getModerationAdminSession(signal?: AbortSignal): Promise<ModerationAdminSession> {
  return (await apiRequest(
    "/api/moderation/admin/session",
    moderationAdminSessionResponseSchema,
    { signal },
  )).data;
}

export async function getModerationAdminQueue(
  query: ModerationAdminQueueQuery,
  signal?: AbortSignal,
): Promise<ModerationAdminQueuePage> {
  const search = new URLSearchParams({
    status: query.status,
    limit: String(query.limit),
  });
  if (query.urgency) search.set("urgency", query.urgency);
  if (query.targetType) search.set("targetType", query.targetType);
  if (query.cursor) search.set("cursor", query.cursor);
  return (await apiRequest(
    `/api/moderation/admin/reports?${search.toString()}`,
    moderationAdminQueueResponseSchema,
    { signal },
  )).data;
}

export async function getModerationAdminReport(
  reportId: string,
  signal?: AbortSignal,
): Promise<ModerationAdminReportDetail> {
  return (await apiRequest(
    `/api/moderation/admin/reports/${encodeURIComponent(reportId)}`,
    moderationAdminReportDetailResponseSchema,
    { signal },
  )).data;
}

export async function applyModerationAdminAction(
  reportId: string,
  input: ModerationAdminActionInput,
): Promise<ModerationAdminActionResult> {
  return (await apiRequest(
    `/api/moderation/admin/reports/${encodeURIComponent(reportId)}/actions`,
    moderationAdminActionResponseSchema,
    { method: "POST", body: input },
  )).data;
}

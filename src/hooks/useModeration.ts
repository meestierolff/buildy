import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateFeedbackInput,
  CreateModerationReportInput,
  CreateSupportInput,
  ModerationAdminActionInput,
  ModerationAdminQueueQuery,
} from "../../shared/contracts/moderation";
import {
  applyModerationAdminAction,
  getModerationAdminQueue,
  getModerationAdminReport,
  getModerationAdminSession,
  submitFeedback,
  submitModerationReport,
  submitSupport,
} from "@/lib/moderationApi";

export const moderationAdminQueryKeys = {
  root: ["moderation-admin"] as const,
  session: ["moderation-admin", "session"] as const,
  queues: ["moderation-admin", "queue"] as const,
  queue: (filters: Omit<ModerationAdminQueueQuery, "cursor">) => [
    "moderation-admin",
    "queue",
    filters,
  ] as const,
  report: (reportId: string) => ["moderation-admin", "report", reportId] as const,
};

export function useSubmitModerationReportMutation() {
  return useMutation({ mutationFn: (input: CreateModerationReportInput) => submitModerationReport(input) });
}

export function useSubmitFeedbackMutation() {
  return useMutation({ mutationFn: (input: CreateFeedbackInput) => submitFeedback(input) });
}

export function useSubmitSupportMutation() {
  return useMutation({ mutationFn: (input: CreateSupportInput) => submitSupport(input) });
}

export function useModerationAdminSession(enabled = true) {
  return useQuery({
    queryKey: moderationAdminQueryKeys.session,
    queryFn: ({ signal }) => getModerationAdminSession(signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useInfiniteModerationAdminQueue(
  filters: Omit<ModerationAdminQueueQuery, "cursor">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: moderationAdminQueryKeys.queue(filters),
    queryFn: ({ pageParam, signal }) => getModerationAdminQueue({
      ...filters,
      cursor: pageParam,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
}

export function useModerationAdminReport(reportId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: moderationAdminQueryKeys.report(reportId ?? ""),
    queryFn: ({ signal }) => getModerationAdminReport(reportId!, signal),
    enabled: enabled && Boolean(reportId),
    retry: false,
  });
}

export function useModerationAdminActionMutation(reportId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModerationAdminActionInput) => applyModerationAdminAction(reportId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: moderationAdminQueryKeys.report(reportId) }),
        queryClient.invalidateQueries({ queryKey: moderationAdminQueryKeys.queues }),
      ]);
    },
  });
}

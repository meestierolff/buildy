import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FeedbackAdminQueueQuery,
  FeedbackAdminStatusInput,
} from "../../shared/contracts/feedbackAdmin";
import {
  getFeedbackAdminDetail,
  getFeedbackAdminQueue,
  getFeedbackAdminSession,
  updateFeedbackAdminStatus,
} from "@/lib/feedbackAdminApi";

export const feedbackAdminQueryKeys = {
  root: ["feedback-admin"] as const,
  session: ["feedback-admin", "session"] as const,
  queues: ["feedback-admin", "queue"] as const,
  queue: (filters: Omit<FeedbackAdminQueueQuery, "cursor">) => [
    "feedback-admin",
    "queue",
    filters,
  ] as const,
  detail: (submissionId: string) => ["feedback-admin", "detail", submissionId] as const,
};

export function useFeedbackAdminSession(enabled = true) {
  return useQuery({
    queryKey: feedbackAdminQueryKeys.session,
    queryFn: ({ signal }) => getFeedbackAdminSession(signal),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useInfiniteFeedbackAdminQueue(
  filters: Omit<FeedbackAdminQueueQuery, "cursor">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: feedbackAdminQueryKeys.queue(filters),
    queryFn: ({ pageParam, signal }) => getFeedbackAdminQueue({
      ...filters,
      cursor: pageParam,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
}

export function useFeedbackAdminDetail(submissionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: feedbackAdminQueryKeys.detail(submissionId ?? ""),
    queryFn: ({ signal }) => getFeedbackAdminDetail(submissionId!, signal),
    enabled: enabled && Boolean(submissionId),
    retry: false,
  });
}

export function useFeedbackAdminStatusMutation(submissionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackAdminStatusInput) => updateFeedbackAdminStatus(submissionId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: feedbackAdminQueryKeys.detail(submissionId) }),
        queryClient.invalidateQueries({ queryKey: feedbackAdminQueryKeys.queues }),
      ]);
    },
  });
}

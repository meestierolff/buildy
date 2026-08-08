import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  CreateCommentInput,
  DeleteCommentInput,
  NotificationMutationResult,
  ReactionTargetInput,
} from "../../shared/contracts/engagement";
import {
  addEngagementReaction,
  createEngagementComment,
  deleteEngagementComment,
  getEngagementComments,
  getEngagementNotifications,
  getEngagementReactions,
  removeEngagementReaction,
  updateEngagementNotification,
} from "@/lib/engagementApi";

export const engagementQueryKeys = {
  all: ["engagement"] as const,
  comments: (projectId: string, updateId: string) =>
    ["engagement", "comments", projectId, updateId] as const,
  reactions: (projectId: string, updateId: string) =>
    ["engagement", "reactions", projectId, updateId] as const,
  notifications: ["engagement", "notifications"] as const,
};

export function useInfiniteComments(projectId: string, updateId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: engagementQueryKeys.comments(projectId, updateId),
    queryFn: ({ pageParam, signal }) => getEngagementComments(
      projectId,
      updateId,
      pageParam ? { cursor: pageParam, limit: 20 } : { limit: 20 },
      signal,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && Boolean(projectId) && Boolean(updateId),
  });
}

export function useCreateCommentMutation(projectId: string, updateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => createEngagementComment(projectId, updateId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: engagementQueryKeys.comments(projectId, updateId),
      });
    },
  });
}

export function useDeleteCommentMutation(projectId: string, updateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, input }: { commentId: string; input: DeleteCommentInput }) =>
      deleteEngagementComment(projectId, updateId, commentId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: engagementQueryKeys.comments(projectId, updateId),
      });
    },
  });
}

export function useReactionSummary(projectId: string, updateId: string, enabled = true) {
  return useQuery({
    queryKey: engagementQueryKeys.reactions(projectId, updateId),
    queryFn: ({ signal }) => getEngagementReactions(projectId, updateId, {}, signal),
    enabled: enabled && Boolean(projectId) && Boolean(updateId),
  });
}

export function useReactionMutation(projectId: string, updateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, input }: {
      action: "add" | "remove";
      input: ReactionTargetInput;
    }) => action === "add"
      ? addEngagementReaction(projectId, updateId, input)
      : removeEngagementReaction(projectId, updateId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: engagementQueryKeys.reactions(projectId, updateId),
      });
    },
  });
}

export function useInfiniteNotifications(enabled = true) {
  return useInfiniteQuery({
    queryKey: engagementQueryKeys.notifications,
    queryFn: ({ pageParam, signal }) => getEngagementNotifications({
      ...(pageParam ? { cursor: pageParam } : {}),
      limit: 20,
      status: "all",
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useNotificationMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    NotificationMutationResult,
    Error,
    { action: "read" | "archive"; notificationId: string }
  >({
    mutationFn: ({ action, notificationId }) =>
      updateEngagementNotification(notificationId, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: engagementQueryKeys.notifications });
    },
  });
}

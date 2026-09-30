import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  SocialConnectionView,
  SocialMutationResult,
} from "../../shared/contracts/social";
import {
  acceptSocialFollowRequest,
  blockSocialProfile,
  followSocialProfile,
  getSocialConnections,
  getSocialProfile,
  getProfileProjects,
  rejectSocialFollowRequest,
  removeSocialFollower,
  removeSocialProfileFollow,
  searchSocialProfiles,
  unblockSocialProfile,
} from "@/lib/socialApi";

export const socialQueryKeys = {
  all: ["social"] as const,
  profiles: (query: string) => ["social", "profiles", query] as const,
  connections: (view: SocialConnectionView) => ["social", "connections", view] as const,
  profile: (profileId: string) => ["social", "profile", profileId] as const,
  profileProjects: (profileId: string) => ["projects", "profile", profileId] as const,
};

export function useProfileProjects(profileId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: socialQueryKeys.profileProjects(profileId),
    queryFn: ({ pageParam, signal }) => getProfileProjects(profileId, {
      ...(pageParam ? { cursor: pageParam } : {}),
      limit: 20,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && Boolean(profileId),
  });
}

export function useSocialProfile(profileId: string, enabled = true) {
  return useQuery({
    queryKey: socialQueryKeys.profile(profileId),
    queryFn: ({ signal }) => getSocialProfile(profileId, signal),
    enabled: enabled && Boolean(profileId),
  });
}

export function useInfiniteSocialProfiles(query = "", enabled = true) {
  const normalizedQuery = query.trim();
  return useInfiniteQuery({
    queryKey: socialQueryKeys.profiles(normalizedQuery),
    queryFn: ({ pageParam, signal }) => searchSocialProfiles({
      ...(pageParam ? { cursor: pageParam } : {}),
      ...(normalizedQuery ? { q: normalizedQuery } : {}),
      limit: 50,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && (!normalizedQuery || normalizedQuery.length >= 2),
  });
}

export function useInfiniteSocialConnections(
  view: SocialConnectionView,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: socialQueryKeys.connections(view),
    queryFn: ({ pageParam, signal }) => getSocialConnections({
      ...(pageParam ? { cursor: pageParam } : {}),
      limit: 50,
      view,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

type ProfileFollowVariables = {
  action: "follow" | "remove";
  profileId: string;
};

export function useProfileFollowMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, ProfileFollowVariables>({
    mutationFn: ({ action, profileId }) => action === "follow"
      ? followSocialProfile(profileId)
      : removeSocialProfileFollow(profileId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: socialQueryKeys.all }),
        variables.action === "remove"
          ? queryClient.resetQueries({ queryKey: ["projects"] })
          : queryClient.invalidateQueries({ queryKey: ["projects"] }),
        variables.action === "remove"
          ? queryClient.resetQueries({ queryKey: ["engagement"] })
          : queryClient.invalidateQueries({ queryKey: ["engagement"] }),
      ]);
    },
  });
}

export function useRemoveProfileFollowerMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, { followerId: string }>({
    mutationFn: ({ followerId }) => removeSocialFollower(followerId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.resetQueries({ queryKey: ["projects"] }),
        queryClient.resetQueries({ queryKey: ["engagement"] }),
        queryClient.invalidateQueries({ queryKey: socialQueryKeys.all }),
      ]);
    },
  });
}

type ProfileBlockVariables = {
  action: "block" | "unblock";
  profileId: string;
};

export function useProfileBlockMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, ProfileBlockVariables>({
    mutationFn: ({ action, profileId }) => action === "block"
      ? blockSocialProfile(profileId)
      : unblockSocialProfile(profileId),
    onSuccess: async (_result, variables) => {
      if (variables.action === "block") {
        // Clear old private content and refetch mounted readers with the new
        // access state; removing a query alone can leave an active observer stale.
        await Promise.all([
          queryClient.resetQueries({ queryKey: ["projects"] }),
          queryClient.resetQueries({ queryKey: ["engagement"] }),
        ]);
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
          queryClient.invalidateQueries({ queryKey: ["engagement"] }),
        ]);
      }
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.all });
    },
  });
}

export type SocialRequestDecisionVariables = {
  actorId: string;
  decision: "accept" | "reject";
  kind: "profile";
};

export function useSocialRequestDecisionMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, SocialRequestDecisionVariables>({
    mutationFn: (variables) => variables.decision === "accept"
      ? acceptSocialFollowRequest(variables.actorId)
      : rejectSocialFollowRequest(variables.actorId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: socialQueryKeys.all }),
        variables.decision === "reject"
          ? queryClient.resetQueries({ queryKey: ["projects"] })
          : queryClient.invalidateQueries({ queryKey: ["projects"] }),
        variables.decision === "reject"
          ? queryClient.resetQueries({ queryKey: ["engagement"] })
          : queryClient.invalidateQueries({ queryKey: ["engagement"] }),
      ]);
    },
  });
}

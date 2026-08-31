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
};

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.all });
    },
  });
}

export function useRemoveProfileFollowerMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, { followerId: string }>({
    mutationFn: ({ followerId }) => removeSocialFollower(followerId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.all });
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
        // A block revokes follows and project access server-side. Drop cached
        // project/activity DTOs immediately so they cannot survive that boundary.
        queryClient.removeQueries({ queryKey: ["projects"] });
        queryClient.removeQueries({ queryKey: ["engagement"] });
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.all });
    },
  });
}

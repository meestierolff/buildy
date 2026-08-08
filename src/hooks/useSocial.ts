import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SocialMutationResult } from "../../shared/contracts/social";
import {
  acceptSocialFollowRequest,
  acceptSocialProjectAccess,
  blockSocialProfile,
  cancelSocialProjectAccess,
  followSocialProfile,
  followSocialProject,
  getSocialProjectAccess,
  getSocialProjectState,
  getSocialProfile,
  rejectSocialFollowRequest,
  rejectSocialProjectAccess,
  removeSocialFollower,
  removeSocialProfileFollow,
  requestSocialProjectAccess,
  revokeSocialProjectAccess,
  searchSocialProfiles,
  unblockSocialProfile,
  unfollowSocialProject,
} from "@/lib/socialApi";

export const socialQueryKeys = {
  all: ["social"] as const,
  profiles: (query: string) => ["social", "profiles", query] as const,
  profile: (profileId: string) => ["social", "profile", profileId] as const,
  projectState: (projectId: string) => ["social", "project", projectId, "state"] as const,
  projectAccess: (projectId: string) => ["social", "project", projectId, "access"] as const,
};

export function useSocialProjectState(projectId: string, enabled = true) {
  return useQuery({
    queryKey: socialQueryKeys.projectState(projectId),
    queryFn: ({ signal }) => getSocialProjectState(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useSocialProjectAccess(projectId: string, enabled = true) {
  return useQuery({
    queryKey: socialQueryKeys.projectAccess(projectId),
    queryFn: ({ signal }) => getSocialProjectAccess(projectId, signal),
    enabled: enabled && Boolean(projectId),
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

type ProjectFollowVariables = {
  action: "follow" | "remove";
  projectId: string;
};

export function useProjectFollowMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, ProjectFollowVariables>({
    mutationFn: ({ action, projectId }) => action === "follow"
      ? followSocialProject(projectId)
      : unfollowSocialProject(projectId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: socialQueryKeys.projectState(variables.projectId) }),
        queryClient.invalidateQueries({ queryKey: ["projects", "following"] }),
      ]);
    },
  });
}

type ProjectAccessVariables = {
  action: "request" | "cancel";
  projectId: string;
};

export function useProjectAccessMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, ProjectAccessVariables>({
    mutationFn: ({ action, projectId }) => action === "request"
      ? requestSocialProjectAccess(projectId)
      : cancelSocialProjectAccess(projectId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: socialQueryKeys.projectState(variables.projectId) }),
        queryClient.invalidateQueries({ queryKey: ["projects", "following"] }),
      ]);
    },
  });
}

export function useRevokeProjectAccessMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    SocialMutationResult,
    Error,
    { projectId: string; requesterId: string }
  >({
    mutationFn: ({ projectId, requesterId }) =>
      revokeSocialProjectAccess(projectId, requesterId),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: socialQueryKeys.projectAccess(variables.projectId) }),
        queryClient.invalidateQueries({ queryKey: ["projects", "following"] }),
      ]);
    },
  });
}

export type SocialRequestDecisionVariables =
  | {
      actorId: string;
      decision: "accept" | "reject";
      kind: "profile";
    }
  | {
      actorId: string;
      decision: "accept" | "reject";
      kind: "project";
      projectId: string;
    };

export function useSocialRequestDecisionMutation() {
  const queryClient = useQueryClient();
  return useMutation<SocialMutationResult, Error, SocialRequestDecisionVariables>({
    mutationFn: (variables) => {
      if (variables.kind === "profile") {
        return variables.decision === "accept"
          ? acceptSocialFollowRequest(variables.actorId)
          : rejectSocialFollowRequest(variables.actorId);
      }
      return variables.decision === "accept"
        ? acceptSocialProjectAccess(variables.projectId, variables.actorId)
        : rejectSocialProjectAccess(variables.projectId, variables.actorId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.all });
    },
  });
}

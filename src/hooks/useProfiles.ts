import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateOwnProfileInput } from "../../shared/contracts/profiles";
import {
  getOwnProfile,
  getPublicProfile,
  updateOwnProfile,
} from "@/lib/profileApi";
import { ApiClientError } from "@/lib/apiClient";

export const profileQueryKeys = {
  all: ["profiles"] as const,
  own: ["profiles", "own"] as const,
  public: (slug: string) => ["profiles", "public", slug] as const,
};

export function useOwnProfile(enabled = true) {
  return useQuery({
    queryKey: profileQueryKeys.own,
    queryFn: ({ signal }) => getOwnProfile(signal),
    enabled,
  });
}

export function usePublicProfile(slug: string, enabled = true) {
  return useQuery({
    queryKey: profileQueryKeys.public(slug),
    queryFn: ({ signal }) => getPublicProfile(slug, signal),
    enabled: enabled && Boolean(slug),
  });
}

export function useUpdateOwnProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateOwnProfileInput) => updateOwnProfile(input),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: profileQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["social"] }),
      ]).catch((error) => {
        console.error("Refresh profile queries failed", error);
      });
    },
    onError: (error) => {
      // A conflict always means at least one cached profile representation may
      // be stale. Refreshing is safe and keeps the next explicit write based
      // on the server-owned optimistic version.
      if (error instanceof ApiClientError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: profileQueryKeys.all });
      }
    },
  });
}

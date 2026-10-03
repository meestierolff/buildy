import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPhotobookDraft,
  replacePhotobookExclusions,
  requestPhotobookProof,
  updatePhotobookSettings,
  type ReplacePhotobookExclusionsInput,
  type RequestPhotobookProofInput,
  type UpdatePhotobookSettingsInput,
} from "@/lib/photobookApi";

export const photobookQueryKeys = {
  all: ["photobook"] as const,
  project: (projectId: string) => ["photobook", "project", projectId] as const,
};

export function usePhotobookDraft(projectId: string, enabled = true) {
  return useQuery({
    queryKey: photobookQueryKeys.project(projectId),
    queryFn: ({ signal }) => getPhotobookDraft(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useUpdatePhotobookSettings(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePhotobookSettingsInput) =>
      updatePhotobookSettings(projectId, input),
    onSuccess: (draft) => {
      queryClient.setQueryData(photobookQueryKeys.project(projectId), draft);
    },
  });
}

export function useReplacePhotobookExclusions(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReplacePhotobookExclusionsInput) =>
      replacePhotobookExclusions(projectId, input),
    onSuccess: (draft) => {
      queryClient.setQueryData(photobookQueryKeys.project(projectId), draft);
    },
  });
}

export function useRequestPhotobookProof(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestPhotobookProofInput) =>
      requestPhotobookProof(projectId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: photobookQueryKeys.project(projectId) });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  IssueProjectShareLinkInput,
  RevokeProjectShareLinkInput,
  RotateProjectShareLinkInput,
} from "../../shared/contracts/projectShares";
import {
  createProjectShareLink,
  getProjectShareLink,
  revokeProjectShareLink,
  rotateProjectShareLink,
} from "@/lib/projectShareApi";

export const projectShareQueryKeys = {
  all: ["project-share-links"] as const,
  owner: (projectId: string) => ["project-share-links", projectId] as const,
};

export function useProjectShareLink(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: projectShareQueryKeys.owner(projectId),
    queryFn: ({ signal }) => getProjectShareLink(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useCreateProjectShareLink(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueProjectShareLinkInput) => createProjectShareLink(projectId, input),
    onSuccess: ({ link }) => queryClient.setQueryData(
      projectShareQueryKeys.owner(projectId),
      { projectId, link },
    ),
  });
}

export function useRotateProjectShareLink(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RotateProjectShareLinkInput) => rotateProjectShareLink(projectId, input),
    onSuccess: ({ link }) => queryClient.setQueryData(
      projectShareQueryKeys.owner(projectId),
      { projectId, link },
    ),
  });
}

export function useRevokeProjectShareLink(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RevokeProjectShareLinkInput) => revokeProjectShareLink(projectId, input),
    onSuccess: () => queryClient.setQueryData(
      projectShareQueryKeys.owner(projectId),
      { projectId, link: null },
    ),
  });
}

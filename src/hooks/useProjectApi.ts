import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  CreateProjectPhaseInput,
  CreateUpdateInput,
  DeleteProjectInput,
  DeleteUpdateInput,
  EditUpdateInput,
  ProjectOverview,
  TimelinePage,
  UpdateProjectInput,
} from "../../shared/contracts/projects";
import {
  createProjectPhase,
  createProjectUpdate,
  createProjectWithVisibility,
  deleteProject,
  deleteProjectUpdate,
  editProjectUpdate,
  getFollowingFeed,
  getProjectDashboard,
  getProjectDiscovery,
  getProjectOverview,
  getProjectTimeline,
  updateProject,
} from "@/lib/projectApi";
import { ApiClientError } from "@/lib/apiClient";
import type { CreateProjectFlowCommand } from "@/lib/projectWriteFlow";

export const projectQueryKeys = {
  all: ["projects"] as const,
  dashboard: ["projects", "dashboard"] as const,
  discovery: ["projects", "discovery"] as const,
  following: ["projects", "following"] as const,
  overview: (projectId: string) => ["projects", "overview", projectId] as const,
  timeline: (projectId: string) => ["projects", "timeline", projectId] as const,
};

export function useProjectDashboard(enabled = true) {
  return useInfiniteQuery({
    queryKey: projectQueryKeys.dashboard,
    queryFn: ({ pageParam, signal }) => getProjectDashboard(
      pageParam ? { cursor: pageParam, limit: 50 } : { limit: 50 },
      signal,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

export function useProjectDiscovery(enabled = true) {
  return useInfiniteQuery({
    queryKey: projectQueryKeys.discovery,
    queryFn: ({ pageParam, signal }) => getProjectDiscovery(
      pageParam ? { cursor: pageParam, limit: 50 } : { limit: 50 },
      signal,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

export function useFollowingFeed(enabled = true) {
  return useQuery({
    queryKey: projectQueryKeys.following,
    queryFn: ({ signal }) => getFollowingFeed({}, signal),
    enabled,
  });
}

export function useProjectOverview(projectId: string, enabled = true) {
  return useQuery({
    queryKey: projectQueryKeys.overview(projectId),
    queryFn: ({ signal }) => getProjectOverview(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useProjectTimeline(projectId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: projectQueryKeys.timeline(projectId),
    queryFn: ({ pageParam, signal }) => getProjectTimeline(
      projectId,
      pageParam ? { cursor: pageParam, limit: 50 } : { limit: 50 },
      signal,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: enabled && Boolean(projectId),
  });
}

/**
 * Canonical project readflow. Both readmodels start together so the detail page
 * does not introduce an overview-to-timeline waterfall.
 */
export function useProject(projectId: string, enabled = true) {
  const overviewQuery = useProjectOverview(projectId, enabled);
  const timelineQuery = useProjectTimeline(projectId, enabled);
  return { overviewQuery, timelineQuery };
}

export function useUpdateProjectMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => updateProject(projectId, input),
    onSuccess: ({ project }) => {
      queryClient.setQueryData(projectQueryKeys.overview(projectId), project);
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }).catch((error) => {
        console.error("Refresh project queries failed", error);
      });
    },
    onError: (error) => {
      // A version conflict means the cached overview is stale; refreshing it
      // makes the next explicit owner action safe.
      if (error instanceof ApiClientError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) });
      }
    },
  });
}

export function useDeleteProjectMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteProjectInput) => deleteProject(projectId, input),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: projectQueryKeys.overview(projectId) });
      queryClient.removeQueries({ queryKey: projectQueryKeys.timeline(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }).catch((error) => {
        console.error("Refresh projects after deletion failed", error);
      });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) });
      }
    },
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateProjectFlowCommand) => createProjectWithVisibility(command),
    onSuccess: ({ project }) => {
      queryClient.setQueryData(projectQueryKeys.overview(project.id), project);
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }).catch((error) => {
        console.error("Refresh project queries failed", error);
      });
    },
  });
}

export function useCreateProjectUpdateMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUpdateInput) => createProjectUpdate(projectId, input),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.timeline(projectId) }),
      ]).catch((error) => {
        console.error("Refresh project update queries failed", error);
      });
    },
  });
}

export function useEditProjectUpdateMutation(projectId: string, updateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditUpdateInput) => editProjectUpdate(projectId, updateId, input),
    onMutate: async (input) => {
      const timelineKey = projectQueryKeys.timeline(projectId);
      await queryClient.cancelQueries({ queryKey: timelineKey });
      const previous = queryClient.getQueryData<InfiniteData<TimelinePage>>(timelineKey);
      const overview = queryClient.getQueryData<ProjectOverview>(projectQueryKeys.overview(projectId));
      queryClient.setQueryData<InfiniteData<TimelinePage>>(timelineKey, (current) => current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((update) => {
                if (update.id !== updateId) return update;
                const phase = input.phaseId === undefined
                  ? update.phase
                  : input.phaseId === null
                    ? null
                    : overview?.phases.find((candidate) => candidate.id === input.phaseId) ?? update.phase;
                const media = input.media === undefined
                  ? update.media
                  : input.media.map((item) => {
                      const existing = update.media.find((candidate) => candidate.id === item.assetId);
                      return {
                        id: item.assetId,
                        contentType: existing?.contentType ?? null,
                        width: existing?.width ?? null,
                        height: existing?.height ?? null,
                        proxyPath: `/api/media/${item.assetId}`,
                        role: item.role,
                        sortOrder: item.sortOrder,
                        caption: item.caption ?? null,
                      };
                    });
                return {
                  ...update,
                  ...(input.updateDate !== undefined ? { updateDate: input.updateDate } : {}),
                  ...(input.title !== undefined ? { title: input.title } : {}),
                  ...(input.room !== undefined ? { room: input.room } : {}),
                  ...(input.description !== undefined ? { description: input.description } : {}),
                  ...(input.isMilestone !== undefined ? { isMilestone: input.isMilestone } : {}),
                  ...(input.publish ? { status: "published" as const } : {}),
                  phase,
                  media,
                };
              }),
            })),
          }
        : current);
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectQueryKeys.timeline(projectId), context.previous);
      }
      if (error instanceof ApiClientError && error.status === 409) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) }),
          queryClient.invalidateQueries({ queryKey: projectQueryKeys.timeline(projectId) }),
        ]);
      }
    },
    onSuccess: ({ update }) => {
      queryClient.setQueryData<InfiniteData<TimelinePage>>(
        projectQueryKeys.timeline(projectId),
        (current) => current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((item) => item.id === update.id ? update : item),
              })),
            }
          : current,
      );
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.timeline(projectId) }),
      ]).catch((error) => {
        console.error("Refresh edited update queries failed", error);
      });
    },
  });
}

export function useDeleteProjectUpdateMutation(projectId: string, updateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteUpdateInput) => deleteProjectUpdate(projectId, updateId, input),
    onMutate: async () => {
      const timelineKey = projectQueryKeys.timeline(projectId);
      await queryClient.cancelQueries({ queryKey: timelineKey });
      const previous = queryClient.getQueryData<InfiniteData<TimelinePage>>(timelineKey);
      queryClient.setQueryData<InfiniteData<TimelinePage>>(timelineKey, (current) => current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.filter((update) => update.id !== updateId),
            })),
          }
        : current);
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectQueryKeys.timeline(projectId), context.previous);
      }
      if (error instanceof ApiClientError && error.status === 409) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) }),
          queryClient.invalidateQueries({ queryKey: projectQueryKeys.timeline(projectId) }),
        ]);
      }
    },
    onSuccess: ({ project }) => {
      queryClient.setQueryData(projectQueryKeys.overview(projectId), project);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectQueryKeys.timeline(projectId) }),
      ]).catch((error) => {
        console.error("Refresh deleted update queries failed", error);
      });
    },
  });
}

export function useCreateProjectPhaseMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectPhaseInput) => createProjectPhase(projectId, input),
    onSuccess: ({ project }) => {
      queryClient.setQueryData(projectQueryKeys.overview(projectId), project);
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all }).catch((error) => {
        console.error("Refresh project phases failed", error);
      });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.overview(projectId) });
      }
    },
  });
}

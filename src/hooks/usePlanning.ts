import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  CreateBudgetItemInput,
  CreateFloorplanInput,
  CreateFloorplanPinInput,
  CreateProjectBudgetInput,
  DeletePlanningResourceInput,
  FloorplanBoard,
  PlanningMutationResult,
  ProjectBudget,
  UpdateBudgetItemInput,
  UpdateFloorplanInput,
  UpdateFloorplanPinInput,
  UpdateProjectBudgetInput,
} from "../../shared/contracts/planning";
import {
  createBudgetItem,
  createFloorplan,
  createFloorplanPin,
  createProjectBudget,
  deleteBudgetItem,
  deleteFloorplan,
  deleteFloorplanPin,
  deleteProjectBudget,
  getFloorplanBoard,
  getProjectBudget,
  updateBudgetItem,
  updateFloorplan,
  updateFloorplanPin,
  updateProjectBudget,
} from "@/lib/planningApi";
import { ApiClientError } from "@/lib/apiClient";

export const planningQueryKeys = {
  all: ["planning"] as const,
  floorplans: (projectId: string) => ["planning", "floorplans", projectId] as const,
  budget: (projectId: string) => ["planning", "budget", projectId] as const,
};

export function useFloorplanBoard(projectId: string, enabled = true) {
  return useQuery<FloorplanBoard>({
    queryKey: planningQueryKeys.floorplans(projectId),
    queryFn: ({ signal }) => getFloorplanBoard(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

export function useProjectBudget(projectId: string, enabled = true) {
  return useQuery<ProjectBudget>({
    queryKey: planningQueryKeys.budget(projectId),
    queryFn: ({ signal }) => getProjectBudget(projectId, signal),
    enabled: enabled && Boolean(projectId),
  });
}

function usePlanningMutation<TVariables>(
  queryKey: QueryKey,
  mutationFn: (variables: TVariables) => Promise<PlanningMutationResult>,
): UseMutationResult<PlanningMutationResult, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: async (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export type CreateFloorplanVariables = { projectId: string; input: CreateFloorplanInput };
export type UpdateFloorplanVariables = {
  projectId: string;
  floorplanId: string;
  input: UpdateFloorplanInput;
};
export type DeleteFloorplanVariables = {
  projectId: string;
  floorplanId: string;
  input: DeletePlanningResourceInput;
};
export type CreateFloorplanPinVariables = {
  projectId: string;
  floorplanId: string;
  input: CreateFloorplanPinInput;
};
export type UpdateFloorplanPinVariables = {
  projectId: string;
  floorplanId: string;
  pinId: string;
  input: UpdateFloorplanPinInput;
};
export type DeleteFloorplanPinVariables = {
  projectId: string;
  floorplanId: string;
  pinId: string;
  input: DeletePlanningResourceInput;
};

export function useCreateFloorplan(projectId: string) {
  return usePlanningMutation(planningQueryKeys.floorplans(projectId), (variables: CreateFloorplanVariables) =>
    createFloorplan(variables.projectId, variables.input));
}

export function useUpdateFloorplan(projectId: string) {
  return usePlanningMutation(planningQueryKeys.floorplans(projectId), (variables: UpdateFloorplanVariables) =>
    updateFloorplan(variables.projectId, variables.floorplanId, variables.input));
}

export function useDeleteFloorplan(projectId: string) {
  return usePlanningMutation(planningQueryKeys.floorplans(projectId), (variables: DeleteFloorplanVariables) =>
    deleteFloorplan(variables.projectId, variables.floorplanId, variables.input));
}

export function useCreateFloorplanPin(projectId: string) {
  return usePlanningMutation(
    planningQueryKeys.floorplans(projectId),
    (variables: CreateFloorplanPinVariables) =>
      createFloorplanPin(variables.projectId, variables.floorplanId, variables.input),
  );
}

export function useUpdateFloorplanPin(projectId: string) {
  return usePlanningMutation(
    planningQueryKeys.floorplans(projectId),
    (variables: UpdateFloorplanPinVariables) =>
      updateFloorplanPin(
        variables.projectId,
        variables.floorplanId,
        variables.pinId,
        variables.input,
      ),
  );
}

export function useDeleteFloorplanPin(projectId: string) {
  return usePlanningMutation(
    planningQueryKeys.floorplans(projectId),
    (variables: DeleteFloorplanPinVariables) =>
      deleteFloorplanPin(
        variables.projectId,
        variables.floorplanId,
        variables.pinId,
        variables.input,
      ),
  );
}

export type CreateProjectBudgetVariables = { projectId: string; input: CreateProjectBudgetInput };
export type UpdateProjectBudgetVariables = { projectId: string; input: UpdateProjectBudgetInput };
export type DeleteProjectBudgetVariables = {
  projectId: string;
  input: DeletePlanningResourceInput;
};
export type CreateBudgetItemVariables = { projectId: string; input: CreateBudgetItemInput };
export type UpdateBudgetItemVariables = {
  projectId: string;
  itemId: string;
  input: UpdateBudgetItemInput;
};
export type DeleteBudgetItemVariables = {
  projectId: string;
  itemId: string;
  input: DeletePlanningResourceInput;
};

export function useCreateProjectBudget(projectId: string) {
  return usePlanningMutation(planningQueryKeys.budget(projectId), (variables: CreateProjectBudgetVariables) =>
    createProjectBudget(variables.projectId, variables.input));
}

export function useUpdateProjectBudget(projectId: string) {
  return usePlanningMutation(planningQueryKeys.budget(projectId), (variables: UpdateProjectBudgetVariables) =>
    updateProjectBudget(variables.projectId, variables.input));
}

export function useDeleteProjectBudget(projectId: string) {
  return usePlanningMutation(planningQueryKeys.budget(projectId), (variables: DeleteProjectBudgetVariables) =>
    deleteProjectBudget(variables.projectId, variables.input));
}

export function useCreateBudgetItem(projectId: string) {
  return usePlanningMutation(planningQueryKeys.budget(projectId), (variables: CreateBudgetItemVariables) =>
    createBudgetItem(variables.projectId, variables.input));
}

export function useUpdateBudgetItem(projectId: string) {
  return usePlanningMutation(planningQueryKeys.budget(projectId), (variables: UpdateBudgetItemVariables) =>
    updateBudgetItem(variables.projectId, variables.itemId, variables.input));
}

export function useDeleteBudgetItem(projectId: string) {
  return usePlanningMutation(planningQueryKeys.budget(projectId), (variables: DeleteBudgetItemVariables) =>
    deleteBudgetItem(variables.projectId, variables.itemId, variables.input));
}

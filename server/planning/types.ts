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
} from "../../shared/contracts/planning.js";
import type { ProjectActor } from "../projects/actor.js";

type PlanningCommand = {
  actorId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateFloorplanCommand = PlanningCommand & {
  floorplanId: string;
  input: CreateFloorplanInput;
};

export type UpdateFloorplanCommand = PlanningCommand & {
  floorplanId: string;
  input: UpdateFloorplanInput;
};

export type DeleteFloorplanCommand = PlanningCommand & {
  floorplanId: string;
  input: DeletePlanningResourceInput;
};

export type CreatePinCommand = PlanningCommand & {
  floorplanId: string;
  pinId: string;
  input: CreateFloorplanPinInput;
};

export type UpdatePinCommand = PlanningCommand & {
  floorplanId: string;
  pinId: string;
  input: UpdateFloorplanPinInput;
};

export type DeletePinCommand = PlanningCommand & {
  floorplanId: string;
  pinId: string;
  input: DeletePlanningResourceInput;
};

export type CreateBudgetCommand = PlanningCommand & {
  budgetId: string;
  currency: "EUR";
  input: CreateProjectBudgetInput;
};

export type UpdateBudgetCommand = PlanningCommand & {
  input: UpdateProjectBudgetInput;
};

export type DeleteBudgetCommand = PlanningCommand & {
  input: DeletePlanningResourceInput;
};

export type CreateBudgetItemCommand = PlanningCommand & {
  itemId: string;
  input: CreateBudgetItemInput;
};

export type UpdateBudgetItemCommand = PlanningCommand & {
  itemId: string;
  input: UpdateBudgetItemInput;
};

export type DeleteBudgetItemCommand = PlanningCommand & {
  itemId: string;
  input: DeletePlanningResourceInput;
};

export interface PlanningRepository {
  listFloorplans(viewer: ProjectActor, projectId: string): Promise<FloorplanBoard | null>;
  createFloorplan(command: CreateFloorplanCommand): Promise<PlanningMutationResult>;
  updateFloorplan(command: UpdateFloorplanCommand): Promise<PlanningMutationResult>;
  deleteFloorplan(command: DeleteFloorplanCommand): Promise<PlanningMutationResult>;
  createPin(command: CreatePinCommand): Promise<PlanningMutationResult>;
  updatePin(command: UpdatePinCommand): Promise<PlanningMutationResult>;
  deletePin(command: DeletePinCommand): Promise<PlanningMutationResult>;

  getBudget(actorId: string, projectId: string): Promise<ProjectBudget | null>;
  createBudget(command: CreateBudgetCommand): Promise<PlanningMutationResult>;
  updateBudget(command: UpdateBudgetCommand): Promise<PlanningMutationResult>;
  deleteBudget(command: DeleteBudgetCommand): Promise<PlanningMutationResult>;
  createBudgetItem(command: CreateBudgetItemCommand): Promise<PlanningMutationResult>;
  updateBudgetItem(command: UpdateBudgetItemCommand): Promise<PlanningMutationResult>;
  deleteBudgetItem(command: DeleteBudgetItemCommand): Promise<PlanningMutationResult>;
}

export type PlanningIdFactory = () => string;

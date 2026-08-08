import { z } from "zod";
import {
  floorplanBoardResponseSchema,
  planningMutationResponseSchema,
  projectBudgetResponseSchema,
  type CreateBudgetItemInput,
  type CreateFloorplanInput,
  type CreateFloorplanPinInput,
  type CreateProjectBudgetInput,
  type DeletePlanningResourceInput,
  type FloorplanBoard,
  type PlanningMutationResult,
  type ProjectBudget,
  type UpdateBudgetItemInput,
  type UpdateFloorplanInput,
  type UpdateFloorplanPinInput,
  type UpdateProjectBudgetInput,
} from "../../shared/contracts/planning";
import { ApiClientError, apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();
const MAX_MINOR_AMOUNT = 2_147_483_647;

export type PlanningOperation =
  | "budget-create"
  | "budget-update"
  | "budget-delete"
  | "budget-item-create"
  | "budget-item-update"
  | "budget-item-delete"
  | "floorplan-create"
  | "floorplan-update"
  | "floorplan-delete"
  | "pin-create"
  | "pin-update"
  | "pin-delete";

function projectPath(projectId: string, suffix: string): `/api/${string}` {
  const id = uuidSchema.parse(projectId);
  return `/api/projects/${encodeURIComponent(id)}${suffix}`;
}

function nestedId(value: string): string {
  return encodeURIComponent(uuidSchema.parse(value));
}

function requireEurBudget(budget: ProjectBudget): ProjectBudget {
  if (budget.currency === "EUR") return budget;
  throw new ApiClientError({
    code: "INTERNAL_ERROR",
    message: "Dit budget gebruikt een valuta die Buildy nog niet veilig ondersteunt.",
    status: 500,
  });
}

export function createPlanningIdempotencyKey(operation: PlanningOperation): string {
  return `planning:${operation}:${crypto.randomUUID()}`;
}

export function parseEuroInputToMinor(rawValue: string): number | null {
  const value = rawValue.trim();
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(MAX_MINOR_AMOUNT)) return null;
  return Number(minor);
}

export function minorToEuroInput(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return "";
  return (minor / 100).toFixed(2).replace(".", ",");
}

export function formatMinorCurrency(minor: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export async function getFloorplanBoard(
  projectId: string,
  signal?: AbortSignal,
): Promise<FloorplanBoard> {
  const response = await apiRequest(
    projectPath(projectId, "/floorplans"),
    floorplanBoardResponseSchema,
    { signal },
  );
  return response.data;
}

export async function createFloorplan(
  projectId: string,
  input: CreateFloorplanInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, "/floorplans"),
    planningMutationResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function updateFloorplan(
  projectId: string,
  floorplanId: string,
  input: UpdateFloorplanInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, `/floorplans/${nestedId(floorplanId)}`),
    planningMutationResponseSchema,
    { method: "PATCH", body: input },
  );
  return response.data;
}

export async function deleteFloorplan(
  projectId: string,
  floorplanId: string,
  input: DeletePlanningResourceInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, `/floorplans/${nestedId(floorplanId)}`),
    planningMutationResponseSchema,
    { method: "DELETE", body: input },
  );
  return response.data;
}

export async function createFloorplanPin(
  projectId: string,
  floorplanId: string,
  input: CreateFloorplanPinInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, `/floorplans/${nestedId(floorplanId)}/pins`),
    planningMutationResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function updateFloorplanPin(
  projectId: string,
  floorplanId: string,
  pinId: string,
  input: UpdateFloorplanPinInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(
      projectId,
      `/floorplans/${nestedId(floorplanId)}/pins/${nestedId(pinId)}`,
    ),
    planningMutationResponseSchema,
    { method: "PATCH", body: input },
  );
  return response.data;
}

export async function deleteFloorplanPin(
  projectId: string,
  floorplanId: string,
  pinId: string,
  input: DeletePlanningResourceInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(
      projectId,
      `/floorplans/${nestedId(floorplanId)}/pins/${nestedId(pinId)}`,
    ),
    planningMutationResponseSchema,
    { method: "DELETE", body: input },
  );
  return response.data;
}

export async function getProjectBudget(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectBudget> {
  const response = await apiRequest(
    projectPath(projectId, "/budget"),
    projectBudgetResponseSchema,
    { signal },
  );
  return requireEurBudget(response.data);
}

export async function createProjectBudget(
  projectId: string,
  input: CreateProjectBudgetInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, "/budget"),
    planningMutationResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function updateProjectBudget(
  projectId: string,
  input: UpdateProjectBudgetInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, "/budget"),
    planningMutationResponseSchema,
    { method: "PATCH", body: input },
  );
  return response.data;
}

export async function deleteProjectBudget(
  projectId: string,
  input: DeletePlanningResourceInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, "/budget"),
    planningMutationResponseSchema,
    { method: "DELETE", body: input },
  );
  return response.data;
}

export async function createBudgetItem(
  projectId: string,
  input: CreateBudgetItemInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, "/budget/items"),
    planningMutationResponseSchema,
    { method: "POST", body: input },
  );
  return response.data;
}

export async function updateBudgetItem(
  projectId: string,
  itemId: string,
  input: UpdateBudgetItemInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, `/budget/items/${nestedId(itemId)}`),
    planningMutationResponseSchema,
    { method: "PATCH", body: input },
  );
  return response.data;
}

export async function deleteBudgetItem(
  projectId: string,
  itemId: string,
  input: DeletePlanningResourceInput,
): Promise<PlanningMutationResult> {
  const response = await apiRequest(
    projectPath(projectId, `/budget/items/${nestedId(itemId)}`),
    planningMutationResponseSchema,
    { method: "DELETE", body: input },
  );
  return response.data;
}

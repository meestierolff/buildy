import {
  createBudgetItemInputSchema,
  createFloorplanInputSchema,
  createFloorplanPinInputSchema,
  createProjectBudgetInputSchema,
  deletePlanningResourceInputSchema,
  updateBudgetItemInputSchema,
  updateFloorplanInputSchema,
  updateFloorplanPinInputSchema,
  updateProjectBudgetInputSchema,
  type FloorplanBoard,
  type PlanningMutationResult,
  type ProjectBudget,
} from "../../shared/contracts/planning.js";
import type { ProjectActor } from "../projects/actor.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import { PlanningError } from "./errors.js";
import { planningRequestHash, scopedPlanningIdempotencyKey } from "./idempotency.js";
import type { PlanningIdFactory, PlanningRepository } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resourceId(value: string): string {
  if (!UUID.test(value)) throw new PlanningError("RESOURCE_NOT_FOUND");
  return value.toLowerCase();
}

function actorId(value: string): string {
  if (!UUID.test(value)) throw new PlanningError("ACTOR_MAPPING_UNAVAILABLE");
  return value.toLowerCase();
}

function normalizedViewer(viewer: ProjectActor): ProjectActor {
  return viewer.kind === "anonymous"
    ? viewer
    : { kind: "authenticated", appUserId: actorId(viewer.appUserId) };
}

function withoutIdempotencyKey<T extends { idempotencyKey: string }>(
  input: T,
): Omit<T, "idempotencyKey"> {
  const { idempotencyKey: _idempotencyKey, ...payload } = input;
  return payload;
}

function commandIdentity(
  operation: string,
  actor: string,
  projectId: string,
  clientKey: string,
  blindIndex: PrivacyBlindIndex,
  payload: unknown,
): { idempotencyKey: string; requestHash: string } {
  return {
    idempotencyKey: scopedPlanningIdempotencyKey(operation, actor, projectId, clientKey),
    requestHash: planningRequestHash(operation, payload, blindIndex),
  };
}

export class PlanningService {
  constructor(
    private readonly repository: PlanningRepository,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly createId: PlanningIdFactory = () => crypto.randomUUID(),
  ) {}

  async floorplans(viewer: ProjectActor, projectIdValue: string): Promise<FloorplanBoard> {
    const projectId = resourceId(projectIdValue);
    const board = await this.repository.listFloorplans(normalizedViewer(viewer), projectId);
    if (!board) throw new PlanningError("RESOURCE_NOT_FOUND");
    return board;
  }

  async createFloorplan(
    actorIdValue: string,
    projectIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const input = createFloorplanInputSchema.parse(rawInput);
    const operation = "floorplan.create";
    return this.repository.createFloorplan({
      actorId: actor,
      projectId,
      floorplanId: this.createId(),
      input,
      ...commandIdentity(
        operation,
        actor,
        projectId,
        input.idempotencyKey,
        this.blindIndex,
        withoutIdempotencyKey(input),
      ),
    });
  }

  async updateFloorplan(
    actorIdValue: string,
    projectIdValue: string,
    floorplanIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const floorplanId = resourceId(floorplanIdValue);
    const input = updateFloorplanInputSchema.parse(rawInput);
    const operation = "floorplan.update";
    return this.repository.updateFloorplan({
      actorId: actor,
      projectId,
      floorplanId,
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        floorplanId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }

  async deleteFloorplan(
    actorIdValue: string,
    projectIdValue: string,
    floorplanIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const floorplanId = resourceId(floorplanIdValue);
    const input = deletePlanningResourceInputSchema.parse(rawInput);
    const operation = "floorplan.delete";
    return this.repository.deleteFloorplan({
      actorId: actor,
      projectId,
      floorplanId,
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        floorplanId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }

  async createPin(
    actorIdValue: string,
    projectIdValue: string,
    floorplanIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const floorplanId = resourceId(floorplanIdValue);
    const input = createFloorplanPinInputSchema.parse(rawInput);
    const operation = "floorplan-pin.create";
    return this.repository.createPin({
      actorId: actor,
      projectId,
      floorplanId,
      pinId: this.createId(),
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        floorplanId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }

  async updatePin(
    actorIdValue: string,
    projectIdValue: string,
    floorplanIdValue: string,
    pinIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const floorplanId = resourceId(floorplanIdValue);
    const pinId = resourceId(pinIdValue);
    const input = updateFloorplanPinInputSchema.parse(rawInput);
    const operation = "floorplan-pin.update";
    return this.repository.updatePin({
      actorId: actor,
      projectId,
      floorplanId,
      pinId,
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        floorplanId,
        pinId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }

  async deletePin(
    actorIdValue: string,
    projectIdValue: string,
    floorplanIdValue: string,
    pinIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const floorplanId = resourceId(floorplanIdValue);
    const pinId = resourceId(pinIdValue);
    const input = deletePlanningResourceInputSchema.parse(rawInput);
    const operation = "floorplan-pin.delete";
    return this.repository.deletePin({
      actorId: actor,
      projectId,
      floorplanId,
      pinId,
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        floorplanId,
        pinId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }

  async budget(actorIdValue: string, projectIdValue: string): Promise<ProjectBudget> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const budget = await this.repository.getBudget(actor, projectId);
    if (!budget) throw new PlanningError("RESOURCE_NOT_FOUND");
    return budget;
  }

  async createBudget(
    actorIdValue: string,
    projectIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const input = createProjectBudgetInputSchema.parse(rawInput);
    const operation = "budget.create";
    return this.repository.createBudget({
      actorId: actor,
      projectId,
      budgetId: this.createId(),
      currency: "EUR",
      input,
      ...commandIdentity(
        operation,
        actor,
        projectId,
        input.idempotencyKey,
        this.blindIndex,
        withoutIdempotencyKey(input),
      ),
    });
  }

  async updateBudget(
    actorIdValue: string,
    projectIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const input = updateProjectBudgetInputSchema.parse(rawInput);
    const operation = "budget.update";
    return this.repository.updateBudget({
      actorId: actor,
      projectId,
      input,
      ...commandIdentity(
        operation,
        actor,
        projectId,
        input.idempotencyKey,
        this.blindIndex,
        withoutIdempotencyKey(input),
      ),
    });
  }

  async deleteBudget(
    actorIdValue: string,
    projectIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const input = deletePlanningResourceInputSchema.parse(rawInput);
    const operation = "budget.delete";
    return this.repository.deleteBudget({
      actorId: actor,
      projectId,
      input,
      ...commandIdentity(
        operation,
        actor,
        projectId,
        input.idempotencyKey,
        this.blindIndex,
        withoutIdempotencyKey(input),
      ),
    });
  }

  async createBudgetItem(
    actorIdValue: string,
    projectIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const input = createBudgetItemInputSchema.parse(rawInput);
    const operation = "budget-item.create";
    return this.repository.createBudgetItem({
      actorId: actor,
      projectId,
      itemId: this.createId(),
      input,
      ...commandIdentity(
        operation,
        actor,
        projectId,
        input.idempotencyKey,
        this.blindIndex,
        withoutIdempotencyKey(input),
      ),
    });
  }

  async updateBudgetItem(
    actorIdValue: string,
    projectIdValue: string,
    itemIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const itemId = resourceId(itemIdValue);
    const input = updateBudgetItemInputSchema.parse(rawInput);
    const operation = "budget-item.update";
    return this.repository.updateBudgetItem({
      actorId: actor,
      projectId,
      itemId,
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        itemId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }

  async deleteBudgetItem(
    actorIdValue: string,
    projectIdValue: string,
    itemIdValue: string,
    rawInput: unknown,
  ): Promise<PlanningMutationResult> {
    const actor = actorId(actorIdValue);
    const projectId = resourceId(projectIdValue);
    const itemId = resourceId(itemIdValue);
    const input = deletePlanningResourceInputSchema.parse(rawInput);
    const operation = "budget-item.delete";
    return this.repository.deleteBudgetItem({
      actorId: actor,
      projectId,
      itemId,
      input,
      ...commandIdentity(operation, actor, projectId, input.idempotencyKey, this.blindIndex, {
        itemId,
        ...withoutIdempotencyKey(input),
      }),
    });
  }
}

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlanningHttpHandler,
  type PlanningHttpService,
} from "../../server/planning/http";
import { PlanningError } from "../../server/planning/errors";
import type { ProjectActorResolver } from "../../server/projects/actor";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000002";
const FLOORPLAN_ID = "30000000-0000-4000-8000-000000000003";
const PIN_ID = "40000000-0000-4000-8000-000000000004";
const ITEM_ID = "50000000-0000-4000-8000-000000000005";
const REQUEST_ID = "90000000-0000-4000-8000-000000000009";

function serviceMocks(): PlanningHttpService {
  const mutation = { resourceType: "floorplan" as const, id: FLOORPLAN_ID, version: 1, replayed: false };
  return {
    floorplans: vi.fn().mockResolvedValue({
      projectId: PROJECT_ID,
      viewerAccess: "public",
      canEdit: false,
      floorplans: [],
    }),
    createFloorplan: vi.fn().mockResolvedValue(mutation),
    updateFloorplan: vi.fn().mockResolvedValue(mutation),
    deleteFloorplan: vi.fn().mockResolvedValue({ ...mutation, version: null }),
    createPin: vi.fn().mockResolvedValue({ ...mutation, resourceType: "floorplan_pin", id: PIN_ID }),
    updatePin: vi.fn().mockResolvedValue({ ...mutation, resourceType: "floorplan_pin", id: PIN_ID }),
    deletePin: vi.fn().mockResolvedValue({
      ...mutation,
      resourceType: "floorplan_pin",
      id: PIN_ID,
      version: null,
    }),
    budget: vi.fn().mockResolvedValue({
      id: FLOORPLAN_ID,
      projectId: PROJECT_ID,
      currency: "EUR",
      plannedAmountMinor: 0,
      version: 1,
      totals: { allocatedAmountMinor: 0, actualAmountMinor: 0, remainingAmountMinor: 0 },
      items: [],
    }),
    createBudget: vi.fn().mockResolvedValue({ ...mutation, resourceType: "budget" }),
    updateBudget: vi.fn().mockResolvedValue({ ...mutation, resourceType: "budget" }),
    deleteBudget: vi.fn().mockResolvedValue({ ...mutation, resourceType: "budget", version: null }),
    createBudgetItem: vi.fn().mockResolvedValue({
      ...mutation,
      resourceType: "budget_item",
      id: ITEM_ID,
    }),
    updateBudgetItem: vi.fn().mockResolvedValue({
      ...mutation,
      resourceType: "budget_item",
      id: ITEM_ID,
    }),
    deleteBudgetItem: vi.fn().mockResolvedValue({
      ...mutation,
      resourceType: "budget_item",
      id: ITEM_ID,
      version: null,
    }),
  };
}

describe("planning HTTP handler", () => {
  let actors: ProjectActorResolver;
  let service: PlanningHttpService;

  beforeEach(() => {
    actors = {
      resolve: vi.fn().mockResolvedValue({ kind: "authenticated", appUserId: ACTOR_ID }),
    };
    service = serviceMocks();
  });

  it("allows anonymous floorplan reads and forwards only trusted viewer state", async () => {
    vi.mocked(actors.resolve).mockResolvedValue({ kind: "anonymous" });
    const handler = createPlanningHttpHandler({ actors, service });

    const response = await handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/floorplans`),
      REQUEST_ID,
    );

    expect(response.status).toBe(200);
    expect(service.floorplans).toHaveBeenCalledWith({ kind: "anonymous" }, PROJECT_ID);
  });

  it("rejects anonymous budget access before disclosing project or budget existence", async () => {
    vi.mocked(actors.resolve).mockResolvedValue({ kind: "anonymous" });
    const handler = createPlanningHttpHandler({ actors, service });

    await expect(handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/budget`),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(service.budget).not.toHaveBeenCalled();
  });

  it("uses the server actor for mutations and returns 201 only for a new command", async () => {
    const handler = createPlanningHttpHandler({ actors, service });
    const input = {
      idempotencyKey: "planning-http-key-0001",
      mediaAssetId: FLOORPLAN_ID,
      name: "Begane grond",
      ownerId: "spoofed-client-owner",
    };

    const response = await handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/floorplans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      REQUEST_ID,
    );

    expect(response.status).toBe(201);
    expect(service.createFloorplan).toHaveBeenCalledWith(ACTOR_ID, PROJECT_ID, input);

    vi.mocked(service.createFloorplan).mockResolvedValue({
      resourceType: "floorplan",
      id: FLOORPLAN_ID,
      version: 1,
      replayed: true,
    });
    const replay = await handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/floorplans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      REQUEST_ID,
    );
    expect(replay.status).toBe(200);
  });

  it("routes nested pin and budget-item commands without trusting body IDs", async () => {
    const handler = createPlanningHttpHandler({ actors, service });
    const pinInput = { idempotencyKey: "planning-http-key-0002", expectedVersion: 3, x: 0.5 };
    const itemInput = {
      idempotencyKey: "planning-http-key-0003",
      expectedVersion: 2,
      amountMinor: 125_00,
    };

    await handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/floorplans/${FLOORPLAN_ID}/pins/${PIN_ID}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(pinInput) },
      ),
      REQUEST_ID,
    );
    await handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/budget/items/${ITEM_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(itemInput),
      }),
      REQUEST_ID,
    );

    expect(service.updatePin).toHaveBeenCalledWith(
      ACTOR_ID, PROJECT_ID, FLOORPLAN_ID, PIN_ID, pinInput,
    );
    expect(service.updateBudgetItem).toHaveBeenCalledWith(ACTOR_ID, PROJECT_ID, ITEM_ID, itemInput);
  });

  it("maps blocked, missing and inaccessible resources to one 404 shape", async () => {
    vi.mocked(service.floorplans).mockRejectedValue(new PlanningError("RESOURCE_NOT_FOUND"));
    const handler = createPlanningHttpHandler({ actors, service });

    await expect(handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/floorplans`),
      REQUEST_ID,
    )).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Deze projectinhoud bestaat niet of is niet toegankelijk.",
      status: 404,
    });
  });

  it("rejects query smuggling and unsupported routes locally", async () => {
    const handler = createPlanningHttpHandler({ actors, service });

    await expect(handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/floorplans?owner=${ACTOR_ID}`),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    const response = await handler(
      new Request(`https://app.buildy.test/api/projects/${PROJECT_ID}/planning/onbekend`),
      REQUEST_ID,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId: REQUEST_ID },
    });
  });
});

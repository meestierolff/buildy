// @vitest-environment node

import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  floorplanBoardSchema,
  projectBudgetSchema,
  type FloorplanBoard,
  type PlanningMutationResult,
  type ProjectBudget,
} from "../../shared/contracts/planning";
import {
  buildPlanningOutboxRecord,
} from "../../server/planning/repository";
import { PlanningService } from "../../server/planning/service";
import type { PlanningRepository } from "../../server/planning/types";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const VIEWER_ID = "20000000-0000-4000-8000-000000000002";
const BLOCKED_ID = "30000000-0000-4000-8000-000000000003";
const PROJECT_ID = "40000000-0000-4000-8000-000000000004";
const FLOORPLAN_ID = "50000000-0000-4000-8000-000000000005";
const PIN_ID = "60000000-0000-4000-8000-000000000006";
const MEDIA_ID = "70000000-0000-4000-8000-000000000007";
const UPDATE_ID = "80000000-0000-4000-8000-000000000008";
const BUDGET_ID = "90000000-0000-4000-8000-000000000009";
const ITEM_ID = "a0000000-0000-4000-8000-00000000000a";
const CLIENT_KEY = "planning-test-key-0001";
const BLIND_INDEX = new PrivacyBlindIndex(Buffer.alloc(32, 16).toString("base64"));

const mutation: PlanningMutationResult = {
  resourceType: "floorplan",
  id: FLOORPLAN_ID,
  version: 1,
  replayed: false,
};

const board: FloorplanBoard = {
  projectId: PROJECT_ID,
  viewerAccess: "public",
  canEdit: false,
  floorplans: [{
    id: FLOORPLAN_ID,
    name: "Begane grond",
    floorNumber: 0,
    sortOrder: 0,
    version: 1,
    media: {
      id: MEDIA_ID,
      status: "ready",
      contentType: "image/webp",
      width: 1800,
      height: 1200,
      proxyPath: `/api/media/${MEDIA_ID}`,
    },
    pins: [{
      id: PIN_ID,
      updateId: UPDATE_ID,
      x: 0.25,
      y: 0.75,
      label: "Nieuwe keuken",
      version: 1,
      update: {
        title: "Leidingen verlegd",
        updateDate: "2026-08-01",
        status: "published",
      },
    }],
  }],
};

const budget: ProjectBudget = {
  id: BUDGET_ID,
  projectId: PROJECT_ID,
  currency: "EUR",
  plannedAmountMinor: 2_500_000,
  version: 2,
  totals: {
    allocatedAmountMinor: 2_000_000,
    actualAmountMinor: 1_750_000,
    remainingAmountMinor: 750_000,
  },
  items: [{
    id: ITEM_ID,
    updateId: UPDATE_ID,
    kind: "actual",
    category: "Keuken",
    description: "Installatie",
    amountMinor: 1_750_000,
    occurredOn: "2026-08-01",
    sortOrder: 0,
    version: 1,
  }],
};

function repository(overrides: Partial<PlanningRepository> = {}): PlanningRepository {
  const defaultMutation = async (): Promise<PlanningMutationResult> => mutation;
  return {
    listFloorplans: async () => null,
    createFloorplan: defaultMutation,
    updateFloorplan: defaultMutation,
    deleteFloorplan: defaultMutation,
    createPin: defaultMutation,
    updatePin: defaultMutation,
    deletePin: defaultMutation,
    getBudget: async () => null,
    createBudget: defaultMutation,
    updateBudget: defaultMutation,
    deleteBudget: defaultMutation,
    createBudgetItem: defaultMutation,
    updateBudgetItem: defaultMutation,
    deleteBudgetItem: defaultMutation,
    ...overrides,
  };
}

describe("PlanningService floorplan visibility", () => {
  it("returns one nested set-based board for anonymous public viewers", async () => {
    const listFloorplans = vi.fn(async () => board);
    const service = new PlanningService(repository({ listFloorplans }), BLIND_INDEX);

    await expect(service.floorplans({ kind: "anonymous" }, PROJECT_ID)).resolves.toEqual(board);
    expect(listFloorplans).toHaveBeenCalledOnce();
    expect(listFloorplans).toHaveBeenCalledWith({ kind: "anonymous" }, PROJECT_ID);
    expect(floorplanBoardSchema.parse(board).floorplans[0]?.pins).toHaveLength(1);
  });

  it.each([
    ["unrelated private viewer", VIEWER_ID],
    ["pending viewer", VIEWER_ID],
    ["blocked viewer", BLOCKED_ID],
  ])("uses the same non-enumerating error for a %s", async (_case, viewerId) => {
    const service = new PlanningService(repository({ listFloorplans: async () => null }), BLIND_INDEX);

    await expect(service.floorplans(
      { kind: "authenticated", appUserId: viewerId },
      PROJECT_ID,
    )).rejects.toMatchObject({
      reason: "RESOURCE_NOT_FOUND",
      status: 404,
    });
  });

  it.each(["follower", "link", "owner"] as const)("returns visible floorplans for a %s", async (access) => {
    const visible = { ...board, viewerAccess: access, canEdit: access === "owner" };
    const service = new PlanningService(repository({ listFloorplans: async () => visible }), BLIND_INDEX);

    await expect(service.floorplans(
      { kind: "authenticated", appUserId: access === "owner" ? OWNER_ID : VIEWER_ID },
      PROJECT_ID,
    )).resolves.toMatchObject({ viewerAccess: access, canEdit: access === "owner" });
  });

  it("requires the repository readmodel to expose only ready media", () => {
    expect(floorplanBoardSchema.parse(board).floorplans[0]?.media.status).toBe("ready");
    expect(() => floorplanBoardSchema.parse({
      ...board,
      floorplans: [{ ...board.floorplans[0], media: { ...board.floorplans[0]!.media, status: "processing" } }],
    })).toThrow(ZodError);
  });
});

describe("PlanningService mutations", () => {
  it("takes owner identity from the service boundary and fixes new budgets to EUR", async () => {
    const createBudget = vi.fn(async (command: Parameters<PlanningRepository["createBudget"]>[0]) => ({
      resourceType: "budget" as const,
      id: command.budgetId,
      version: 1,
      replayed: false,
    }));
    const service = new PlanningService(repository({ createBudget }), BLIND_INDEX, () => BUDGET_ID);

    await service.createBudget(OWNER_ID, PROJECT_ID, {
      idempotencyKey: CLIENT_KEY,
      plannedAmountMinor: 2_500_000,
    });

    expect(createBudget).toHaveBeenCalledOnce();
    expect(createBudget.mock.calls[0]?.[0]).toMatchObject({
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      budgetId: BUDGET_ID,
      currency: "EUR",
    });
    expect(createBudget.mock.calls[0]?.[0].input).not.toHaveProperty("currency");
  });

  it("rejects client-owned currency, totals and owner fields", async () => {
    const service = new PlanningService(repository(), BLIND_INDEX);

    await expect(service.createBudget(OWNER_ID, PROJECT_ID, {
      idempotencyKey: CLIENT_KEY,
      plannedAmountMinor: 100,
      currency: "USD",
      totals: { actualAmountMinor: 0 },
      ownerId: VIEWER_ID,
    })).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects out-of-bounds, non-finite and over-precise pin coordinates", async () => {
    const service = new PlanningService(repository(), BLIND_INDEX);
    const input = (x: number, y: number) => ({
      idempotencyKey: CLIENT_KEY,
      updateId: UPDATE_ID,
      x,
      y,
    });

    await expect(service.createPin(OWNER_ID, PROJECT_ID, FLOORPLAN_ID, input(-0.1, 0.5)))
      .rejects.toBeInstanceOf(ZodError);
    await expect(service.createPin(OWNER_ID, PROJECT_ID, FLOORPLAN_ID, input(0.5, 1.1)))
      .rejects.toBeInstanceOf(ZodError);
    await expect(service.createPin(OWNER_ID, PROJECT_ID, FLOORPLAN_ID, input(Number.NaN, 0.5)))
      .rejects.toBeInstanceOf(ZodError);
    await expect(service.createPin(OWNER_ID, PROJECT_ID, FLOORPLAN_ID, input(0.123456, 0.5)))
      .rejects.toBeInstanceOf(ZodError);
  });

  it("requires optimistic versions for updates and deletes", async () => {
    const service = new PlanningService(repository(), BLIND_INDEX);

    await expect(service.updatePin(OWNER_ID, PROJECT_ID, FLOORPLAN_ID, PIN_ID, {
      idempotencyKey: CLIENT_KEY,
      x: 0.4,
    })).rejects.toBeInstanceOf(ZodError);
    await expect(service.deleteFloorplan(OWNER_ID, PROJECT_ID, FLOORPLAN_ID, {
      idempotencyKey: CLIENT_KEY,
    })).rejects.toBeInstanceOf(ZodError);
  });

  it("produces one transition and one replay for concurrent identical commands", async () => {
    const records = new Map<string, PlanningMutationResult>();
    const createFloorplan: PlanningRepository["createFloorplan"] = async (command) => {
      const existing = records.get(command.idempotencyKey);
      if (existing) return { ...existing, replayed: true };
      const created: PlanningMutationResult = {
        resourceType: "floorplan",
        id: command.floorplanId,
        version: 1,
        replayed: false,
      };
      records.set(command.idempotencyKey, created);
      await Promise.resolve();
      return created;
    };
    let sequence = 0;
    const service = new PlanningService(repository({ createFloorplan }), BLIND_INDEX, () =>
      sequence++ === 0 ? FLOORPLAN_ID : PIN_ID);
    const input = {
      idempotencyKey: CLIENT_KEY,
      mediaAssetId: MEDIA_ID,
      name: "Begane grond",
      floorNumber: 0,
      sortOrder: 0,
    };

    const results = await Promise.all([
      service.createFloorplan(OWNER_ID, PROJECT_ID, input),
      service.createFloorplan(OWNER_ID, PROJECT_ID, input),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.id))).toEqual(new Set([FLOORPLAN_ID]));
    expect(records).toHaveLength(1);
  });
});

describe("planning budget and outbox DTOs", () => {
  it("returns an owner-only server-computed budget readmodel", async () => {
    const getBudget = vi.fn(async (actorId: string) => actorId === OWNER_ID ? budget : null);
    const service = new PlanningService(repository({ getBudget }), BLIND_INDEX);

    await expect(service.budget(OWNER_ID, PROJECT_ID)).resolves.toEqual(budget);
    await expect(service.budget(VIEWER_ID, PROJECT_ID)).rejects.toMatchObject({
      reason: "RESOURCE_NOT_FOUND",
      status: 404,
    });
    expect(projectBudgetSchema.parse(budget).totals.remainingAmountMinor).toBe(750_000);
  });

  it("keeps event payloads free of names, coordinates and monetary values", () => {
    const record = buildPlanningOutboxRecord(
      {
        actorId: OWNER_ID,
        projectId: PROJECT_ID,
        idempotencyKey: "planning-command:v1:test:deadbeef",
        requestHash: "f".repeat(64),
      },
      "budget_item",
      "budget.item.updated.v1",
      { id: ITEM_ID, version: 2 },
    );

    expect(record.aggregateType).toBe("project");
    expect(record.aggregateId).toBe(PROJECT_ID);
    expect(record.payload).toEqual({
      schemaVersion: 1,
      requestHashVersion: 2,
      requestHash: "f".repeat(64),
      resourceId: ITEM_ID,
      resourceType: "budget_item",
      resourceVersion: 2,
    });
    expect(JSON.stringify(record.payload)).not.toMatch(/amount|currency|category|label|name|\bx\b|\by\b/i);
  });
});

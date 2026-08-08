// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/apiClient";
import {
  createFloorplanPin,
  createPlanningIdempotencyKey,
  formatMinorCurrency,
  getProjectBudget,
  minorToEuroInput,
  parseEuroInputToMinor,
  updateProjectBudget,
} from "@/lib/planningApi";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const FLOORPLAN_ID = "22222222-2222-4222-8222-222222222222";
const UPDATE_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

function successResponse(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

function budgetResponse(currency = "EUR") {
  return {
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    currency,
    plannedAmountMinor: 150_000,
    version: 7,
    totals: {
      allocatedAmountMinor: 25_000,
      actualAmountMinor: 40_000,
      remainingAmountMinor: 110_000,
    },
    items: [],
  };
}

function mutationResponse() {
  return {
    resourceType: "budget" as const,
    id: RESOURCE_ID,
    version: 8,
    replayed: false,
  };
}

describe("planning API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leest een owner-only EUR-budget via de cookie-API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(budgetResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const budget = await getProjectBudget(PROJECT_ID);

    expect(budget.currency).toBe("EUR");
    expect(budget.totals.actualAmountMinor).toBe(40_000);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/budget`,
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("weigert een geldige response met een niet-ondersteunde valuta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse(budgetResponse("USD"))));

    await expect(getProjectBudget(PROJECT_ID)).rejects.toMatchObject({
      name: "ApiClientError",
      code: "INTERNAL_ERROR",
      status: 500,
    } satisfies Partial<ApiClientError>);
  });

  it("stuurt uitsluitend minor units, versie en idempotency-key bij een budgetwijziging", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(mutationResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      idempotencyKey: "planning:budget-update:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedVersion: 7,
      plannedAmountMinor: 123_456,
    };

    await updateProjectBudget(PROJECT_ID, input);

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.method).toBe("PATCH");
    expect(JSON.parse(String(request.body))).toEqual(input);
    expect(JSON.parse(String(request.body))).not.toHaveProperty("currency");
    expect(JSON.parse(String(request.body))).not.toHaveProperty("totals");
  });

  it("bouwt de geneste pinroute en normaliseert de requestbody niet stilzwijgend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse({
      ...mutationResponse(),
      resourceType: "floorplan_pin",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      idempotencyKey: "planning:pin-create:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      updateId: UPDATE_ID,
      x: 0.12345,
      y: 0.75,
      label: "Keuken",
    };

    await createFloorplanPin(PROJECT_ID, FLOORPLAN_ID, input);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/projects/${PROJECT_ID}/floorplans/${FLOORPLAN_ID}/pins`,
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(input);
  });
});

describe("planningbedragen", () => {
  it.each([
    ["0", 0],
    ["12,3", 1_230],
    ["12.34", 1_234],
    ["001,05", 105],
    ["21474836,47", 2_147_483_647],
  ])("zet %s exact om naar %i minor units", (input, expected) => {
    expect(parseEuroInputToMinor(input)).toBe(expected);
  });

  it.each(["", "-1", "1,234", "1.000,00", "21474836,48", "NaN"])(
    "weigert onveilige euro-invoer %s",
    (input) => expect(parseEuroInputToMinor(input)).toBeNull(),
  );

  it("maakt Nederlandse invoer en uitvoer zonder floatberekeningen in requestdata", () => {
    expect(minorToEuroInput(123_456)).toBe("1234,56");
    expect(formatMinorCurrency(123_456)).toMatch(/€\s*1\.234,56/);
    expect(createPlanningIdempotencyKey("budget-create")).toMatch(
      /^planning:budget-create:[0-9a-f-]{36}$/i,
    );
  });
});

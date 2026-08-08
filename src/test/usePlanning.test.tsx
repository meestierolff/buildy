import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/apiClient";

const apiMocks = vi.hoisted(() => ({
  getProjectBudget: vi.fn(),
  updateProjectBudget: vi.fn(),
}));

vi.mock("@/lib/planningApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/planningApi")>(),
  getProjectBudget: apiMocks.getProjectBudget,
  updateProjectBudget: apiMocks.updateProjectBudget,
}));

import {
  planningQueryKeys,
  useProjectBudget,
  useUpdateProjectBudget,
} from "@/hooks/usePlanning";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BUDGET_ID = "22222222-2222-4222-8222-222222222222";
const budget = {
  id: BUDGET_ID,
  projectId: PROJECT_ID,
  currency: "EUR",
  plannedAmountMinor: 100_000,
  version: 3,
  totals: {
    allocatedAmountMinor: 20_000,
    actualAmountMinor: 15_000,
    remainingAmountMinor: 85_000,
  },
  items: [],
} as const;

function testClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("planning query hooks", () => {
  beforeEach(() => {
    apiMocks.getProjectBudget.mockReset();
    apiMocks.updateProjectBudget.mockReset();
  });

  it("cachet budgetdata per project en geeft het abortsignaal door", async () => {
    apiMocks.getProjectBudget.mockResolvedValue(budget);
    const client = testClient();
    const { result } = renderHook(() => useProjectBudget(PROJECT_ID), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMocks.getProjectBudget).toHaveBeenCalledWith(PROJECT_ID, expect.any(AbortSignal));
    expect(client.getQueryData(planningQueryKeys.budget(PROJECT_ID))).toEqual(budget);
  });

  it("invalideert alleen het projectbudget na een geslaagde versiegebonden mutatie", async () => {
    apiMocks.updateProjectBudget.mockResolvedValue({
      resourceType: "budget",
      id: BUDGET_ID,
      version: 4,
      replayed: false,
    });
    const client = testClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const variables = {
      projectId: PROJECT_ID,
      input: {
        idempotencyKey: "planning:budget-update:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedVersion: 3,
        plannedAmountMinor: 125_000,
      },
    };
    const { result } = renderHook(() => useUpdateProjectBudget(PROJECT_ID), {
      wrapper: wrapper(client),
    });

    act(() => result.current.mutate(variables));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiMocks.updateProjectBudget).toHaveBeenCalledWith(PROJECT_ID, variables.input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: planningQueryKeys.budget(PROJECT_ID) });
  });

  it("ververst de serverversie na een conflict", async () => {
    apiMocks.updateProjectBudget.mockRejectedValue(new ApiClientError({
      code: "CONFLICT",
      message: "Versieconflict.",
      status: 409,
    }));
    const client = testClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProjectBudget(PROJECT_ID), {
      wrapper: wrapper(client),
    });

    act(() => result.current.mutate({
      projectId: PROJECT_ID,
      input: {
        idempotencyKey: "planning:budget-update:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        expectedVersion: 3,
        plannedAmountMinor: 125_000,
      },
    }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: planningQueryKeys.budget(PROJECT_ID) });
  });
});

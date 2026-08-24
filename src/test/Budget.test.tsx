import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBudget } from "../../shared/contracts/planning";
import { ApiClientError } from "@/lib/apiClient";

const hooks = vi.hoisted(() => {
  const mutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  });
  return {
    useAuth: vi.fn(),
    useProjectBudget: vi.fn(),
    createBudget: mutation(),
    updateBudget: mutation(),
    deleteBudget: mutation(),
    createItem: mutation(),
    updateItem: mutation(),
    deleteItem: mutation(),
  };
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: hooks.useAuth }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: vi.fn() }));
vi.mock("@/hooks/usePlanning", () => ({
  useProjectBudget: hooks.useProjectBudget,
  useCreateProjectBudget: () => hooks.createBudget,
  useUpdateProjectBudget: () => hooks.updateBudget,
  useDeleteProjectBudget: () => hooks.deleteBudget,
  useCreateBudgetItem: () => hooks.createItem,
  useUpdateBudgetItem: () => hooks.updateItem,
  useDeleteBudgetItem: () => hooks.deleteItem,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/router", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  Link: ({ to, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    children?: ReactNode;
  }) => <a href={to} {...props}>{children}</a>,
}));

import Budget from "@/pages/Budget";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BUDGET_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const budget: ProjectBudget = {
  id: BUDGET_ID,
  projectId: PROJECT_ID,
  currency: "EUR",
  plannedAmountMinor: 100_000,
  version: 7,
  totals: {
    allocatedAmountMinor: 25_000,
    actualAmountMinor: 43_210,
    remainingAmountMinor: 56_790,
  },
  items: [{
    id: ITEM_ID,
    updateId: null,
    kind: "actual",
    category: "Keuken",
    description: "Nieuwe kastjes",
    amountMinor: 12_345,
    occurredOn: "2026-08-01",
    sortOrder: 0,
    version: 4,
  }],
};

const mutationMocks = [
  hooks.createBudget,
  hooks.updateBudget,
  hooks.deleteBudget,
  hooks.createItem,
  hooks.updateItem,
  hooks.deleteItem,
];

describe("Budgetpagina", () => {
  beforeEach(() => {
    hooks.useAuth.mockReset().mockReturnValue({ user: { id: "cookie-user" }, loading: false });
    hooks.useProjectBudget.mockReset().mockReturnValue({
      data: budget,
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mutationMocks.forEach((mutation) => mutation.mutate.mockReset());
  });

  it("toont uitsluitend server-totalen in EUR en geen openbare budgetinstelling", () => {
    render(<Budget />);

    expect(screen.getByText(/€\s*1\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/€\s*432,10/)).toBeInTheDocument();
    expect(screen.getByText(/€\s*567,90/)).toBeInTheDocument();
    expect(screen.getByText(/€\s*250,00 verdeeld over geplande posten/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Werkelijk besteed budget" })).toHaveAttribute(
      "aria-valuenow",
      "43",
    );
    expect(screen.queryByText(/openbaar/i)).not.toBeInTheDocument();
  });

  it("wijzigt het budget met exacte centen, de serverversie en een idempotency-key", () => {
    render(<Budget />);

    fireEvent.click(screen.getByRole("button", { name: "Wijzig" }));
    fireEvent.change(screen.getByLabelText("Totaal verbouwingsbudget in euro"), {
      target: { value: "1234,56" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    expect(hooks.updateBudget.mutate).toHaveBeenCalledOnce();
    const variables = hooks.updateBudget.mutate.mock.calls[0]?.[0];
    expect(variables).toMatchObject({
      projectId: PROJECT_ID,
      input: {
        expectedVersion: 7,
        plannedAmountMinor: 123_456,
      },
    });
    expect(variables.input.idempotencyKey).toMatch(/^planning:budget-update:/);
    expect(variables.input).not.toHaveProperty("currency");
    expect(variables.input).not.toHaveProperty("totals");
  });

  it("maakt een budgetpost met minor units en zonder client-afgeleide totalen", () => {
    render(<Budget />);

    fireEvent.click(screen.getByRole("button", { name: "Budgetpost toevoegen" }));
    const form = screen.getByRole("form", { name: "Nieuwe budgetpost" });
    fireEvent.change(within(form).getByLabelText("Bedrag in euro"), {
      target: { value: "89,95" },
    });
    fireEvent.change(within(form).getByLabelText("Categorie"), {
      target: { value: "Schilderwerk" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Toevoegen" }));

    expect(hooks.createItem.mutate).toHaveBeenCalledOnce();
    const variables = hooks.createItem.mutate.mock.calls[0]?.[0];
    expect(variables).toMatchObject({
      projectId: PROJECT_ID,
      input: {
        kind: "actual",
        category: "Schilderwerk",
        amountMinor: 8_995,
        sortOrder: 1,
      },
    });
    expect(variables.input.idempotencyKey).toMatch(/^planning:budget-item-create:/);
    expect(variables.input).not.toHaveProperty("totals");
  });

  it("houdt een 404 privacyveilig en laat de server het aanmaken autoriseren", () => {
    hooks.useProjectBudget.mockReturnValue({
      data: undefined,
      error: new ApiClientError({ code: "NOT_FOUND", message: "Niet gevonden.", status: 404 }),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<Budget />);

    expect(screen.getByText(/geen budget beschikbaar of je hebt geen toegang/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Totaal verbouwingsbudget in euro"), {
      target: { value: "50000,00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Budget instellen" }));

    expect(hooks.createBudget.mutate).toHaveBeenCalledOnce();
    expect(hooks.createBudget.mutate.mock.calls[0]?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      input: { plannedAmountMinor: 5_000_000 },
    });
  });

  it("biedt een herhaalactie bij een laadfout", () => {
    const refetch = vi.fn();
    hooks.useProjectBudget.mockReturnValue({
      data: undefined,
      error: new ApiClientError({ code: "INTERNAL_ERROR", message: "Tijdelijk mislukt.", status: 500 }),
      isLoading: false,
      isFetching: false,
      refetch,
    });
    render(<Budget />);

    expect(screen.getByText("Tijdelijk mislukt.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

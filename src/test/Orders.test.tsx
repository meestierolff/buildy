import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authenticated: true,
  query: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: state.authenticated ? { id: "owner" } : null,
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({ useCustomerOrders: () => state.query }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => <span>Navigate {to}</span>,
}));

import Orders from "@/pages/Orders";

describe("Orders", () => {
  beforeEach(() => {
    state.authenticated = true;
    state.query = {
      data: {
        pages: [{
          items: [{
            orderId: "22222222-2222-4222-8222-222222222222",
            orderNumber: "BLD-20260804-ABCDEF12",
            projectId: "33333333-3333-4333-8333-333333333333",
            projectTitle: "Ons jaren-dertighuis",
            pageCount: 48,
            quantity: 2,
            amounts: {
              currency: "EUR",
              subtotalMinor: 8_000,
              shippingMinor: 800,
              taxMinor: 1_848,
              totalMinor: 10_648,
            },
            status: "paid",
            paymentStatus: "paid",
            fulfilmentStatus: "in_production",
            createdAt: "2026-08-04T12:00:00.000Z",
            paidAt: "2026-08-04T12:05:00.000Z",
          }],
          nextCursor: null,
        }],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  });

  it("maakt de eigen bestelling vindbaar met serverstatus en opaque detailroute", () => {
    render(<Orders />);

    expect(screen.getByRole("heading", { name: "Bestellingen" })).toBeInTheDocument();
    expect(screen.getByText("Ons jaren-dertighuis")).toBeInTheDocument();
    expect(screen.getByText("In productie")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bekijk voortgang/i })).toHaveAttribute(
      "href",
      "/bestellingen/22222222-2222-4222-8222-222222222222",
    );
  });

  it("stuurt een bezoeker via de beveiligde loginroute", () => {
    state.authenticated = false;
    render(<Orders />);

    expect(screen.getByText("Navigate /auth?next=%2Fbestellingen")).toBeInTheDocument();
  });
});

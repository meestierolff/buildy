import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotobookOrderDetail } from "../../shared/contracts/orders";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  search: "checkout=success",
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "owner" }, loading: false }),
}));
vi.mock("@/hooks/useOrders", () => ({
  usePhotobookOrder: () => state.query,
}));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => <span>Navigate {to}</span>,
  useParams: () => ({ orderId: "22222222-2222-4222-8222-222222222222" }),
  useSearchParams: () => [new URLSearchParams(state.search)],
}));

import OrderConfirmation from "@/pages/OrderConfirmation";

const order: PhotobookOrderDetail = {
  orderId: "22222222-2222-4222-8222-222222222222",
  orderNumber: "BLD-ABCD-1234",
  projectId: "33333333-3333-4333-8333-333333333333",
  projectTitle: "Ons huis",
  proofRevisionId: "11111111-1111-4111-8111-111111111111",
  sku: "a4-landscape-hardcover-v1",
  format: "a4-landscape-hardcover-v1",
  pageCount: 24,
  quantity: 1,
  destinationCountry: "NL",
  amounts: {
    currency: "EUR",
    subtotalMinor: 10_000,
    shippingMinor: 1_000,
    taxMinor: 2_310,
    totalMinor: 13_310,
  },
  deliveryEstimate: "5–8 werkdagen",
  termsVersion: "2026-08-01",
  status: "checkout_open",
  paymentStatus: "processing",
  refundedMinor: 0,
  fulfilmentStatus: "awaiting_review",
  trackingUrl: null,
  createdAt: "2026-08-04T12:00:00.000Z",
  paidAt: null,
  statusHistory: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      eventType: "order.checkout_reserved.v1",
      fromStatus: null,
      toStatus: "awaiting_payment",
      occurredAt: "2026-08-04T12:00:00.000Z",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      eventType: "order.checkout_opened.v1",
      fromStatus: "awaiting_payment",
      toStatus: "checkout_open",
      occurredAt: "2026-08-04T12:01:00.000Z",
    },
  ],
};

function query(data: PhotobookOrderDetail) {
  return {
    data,
    isPending: false,
    isError: false,
    isFetching: true,
    refetch: vi.fn(),
  };
}

describe("OrderConfirmation", () => {
  beforeEach(() => {
    state.search = "checkout=success";
    state.query = query(order);
  });

  it("behandelt een Stripe-successredirect uitsluitend als te bevestigen status", () => {
    render(<OrderConfirmation />);

    expect(screen.getByRole("heading", { name: "Betaling wordt bevestigd" })).toBeInTheDocument();
    expect(screen.getByText(/alleen de webhookbevestiging geldt als betaalbewijs/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Betaling bevestigd" })).not.toBeInTheDocument();
    expect(screen.getByText(/automatisch iedere vier seconden/i)).toBeInTheDocument();
  });

  it("toont betaald pas wanneer de authenticated order-DTO dit bevestigt", () => {
    state.query = query({
      ...order,
      status: "paid",
      paymentStatus: "paid",
      fulfilmentStatus: "reviewed",
      paidAt: "2026-08-04T12:05:00.000Z",
    });
    render(<OrderConfirmation />);

    expect(screen.getByRole("heading", { name: "Betaling bevestigd" })).toBeInTheDocument();
    expect(screen.getAllByText("Betaald")).not.toHaveLength(0);
    expect(screen.queryByText(/automatisch iedere vier seconden/i)).not.toBeInTheDocument();
  });

  it("toont de werkelijk vastgelegde ordergebeurtenissen en geen afgeleide mijlpalen", () => {
    render(<OrderConfirmation />);

    expect(screen.getByRole("heading", { name: "Vastgelegde voortgang" })).toBeInTheDocument();
    expect(screen.getAllByText("Betaalpagina geopend")).toHaveLength(2);
    expect(screen.getByText("Bestelling aangemaakt")).toBeInTheDocument();
    expect(screen.queryByText("Productie", { selector: "span" })).not.toBeInTheDocument();
  });
});

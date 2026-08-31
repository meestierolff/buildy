// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../server/http/errors";
import { OrderError } from "../../server/orders/errors";
import { createOrderHttpHandler, type OrderHttpService } from "../../server/orders/http";
import type { ProjectActorResolver } from "../../server/projects/actor";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

const actors: ProjectActorResolver = {
  resolve: vi.fn().mockResolvedValue({ kind: "authenticated", appUserId: ACTOR_ID }),
};

function service(): OrderHttpService {
  return {
    quote: vi.fn().mockResolvedValue({ proofRevisionId: REVISION_ID }),
    checkout: vi.fn().mockResolvedValue({
      orderId: ORDER_ID,
      replayed: false,
      checkoutUrl: "https://checkout.stripe.com/test",
    }),
    order: vi.fn().mockResolvedValue({ orderId: ORDER_ID }),
    orders: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  } as unknown as OrderHttpService;
}

describe("order HTTP boundary", () => {
  it("routes an authenticated quote with parsed JSON", async () => {
    const orders = service();
    const handler = createOrderHttpHandler({ actors, service: orders });
    const input = { destinationCountry: "NL" };

    const response = await handler(new Request(
      `https://app.buildy.test/api/photobooks/proofs/${REVISION_ID}/quote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    ), "request-quote", { revisionId: REVISION_ID });

    expect(response.status).toBe(200);
    expect(orders.quote).toHaveBeenCalledWith(ACTOR_ID, REVISION_ID, input);
  });

  it("creates checkout with 201 and does not serialize internal reservation PII", async () => {
    const orders = service();
    const handler = createOrderHttpHandler({ actors, service: orders });

    const response = await handler(new Request(
      `https://app.buildy.test/api/photobooks/proofs/${REVISION_ID}/checkout`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ), "request-checkout", { revisionId: REVISION_ID });

    expect(response.status).toBe(201);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      orderId: ORDER_ID,
      replayed: false,
      checkoutUrl: "https://checkout.stripe.com/test",
    });
    expect(JSON.stringify(body)).not.toContain("customerEmail");
    expect(JSON.stringify(body)).not.toContain("shippingAddress");
  });

  it("returns an owner-scoped order status readmodel", async () => {
    const orders = service();
    const handler = createOrderHttpHandler({ actors, service: orders });

    const response = await handler(
      new Request(`https://app.buildy.test/api/orders/${ORDER_ID}`),
      "request-order",
      { orderId: ORDER_ID },
    );

    expect(response.status).toBe(200);
    expect(orders.order).toHaveBeenCalledWith(ACTOR_ID, ORDER_ID);
  });

  it("lists only the authenticated actor's orders with typed paging input", async () => {
    const orders = service();
    const handler = createOrderHttpHandler({ actors, service: orders });

    const response = await handler(
      new Request("https://app.buildy.test/api/orders?limit=12&cursor=opaque-page"),
      "request-orders",
    );

    expect(response.status).toBe(200);
    expect(orders.orders).toHaveBeenCalledWith(ACTOR_ID, {
      limit: "12",
      cursor: "opaque-page",
    });
  });

  it("does not expose the customer order list without an authenticated actor", async () => {
    const orders = service();
    const anonymousActors: ProjectActorResolver = {
      resolve: vi.fn().mockResolvedValue({ kind: "anonymous" }),
    };
    const handler = createOrderHttpHandler({ actors: anonymousActors, service: orders });

    await expect(handler(
      new Request("https://app.buildy.test/api/orders"),
      "request-anonymous-orders",
    )).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(orders.orders).not.toHaveBeenCalled();
  });

  it("requires JSON and rejects malformed identifiers before service access", async () => {
    const orders = service();
    const handler = createOrderHttpHandler({ actors, service: orders });

    await expect(handler(new Request(
      `https://app.buildy.test/api/photobooks/proofs/${REVISION_ID}/quote`,
      { method: "POST", body: "{}" },
    ), "request-content", { revisionId: REVISION_ID })).rejects.toBeInstanceOf(HttpError);

    await expect(handler(
      new Request("https://app.buildy.test/api/orders/not-a-uuid"),
      "request-id",
      { orderId: "not-a-uuid" },
    )).rejects.toMatchObject({ status: 404 });
    expect(orders.order).not.toHaveBeenCalled();
  });

  it("maps domain failures without exposing implementation details", async () => {
    const orders = service();
    vi.mocked(orders.checkout).mockRejectedValue(new OrderError("PRICE_UNAVAILABLE"));
    const handler = createOrderHttpHandler({ actors, service: orders });

    await expect(handler(new Request(
      `https://app.buildy.test/api/photobooks/proofs/${REVISION_ID}/checkout`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ), "request-error", { revisionId: REVISION_ID })).rejects.toMatchObject({
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
    });
  });
});

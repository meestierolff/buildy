// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PaymentProviderError,
  type VerifiedPaymentEvent,
} from "../../server/payments/paymentProvider";
import {
  createStripePaymentWebhookHandler,
  type ApplyStripePaymentEventCommand,
  type StripePaymentEventRepository,
  type StripePaymentEventResult,
} from "../../server/orders/paymentWebhook";

const ORDER_ID = "9d061f28-8a45-4e3b-a57c-a036d3799957";
const rawBody = '{"id":"evt_buildy_paid_1","object":"event"}';

function event(overrides: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent {
  return {
    provider: "stripe",
    providerEventId: "evt_buildy_paid_1",
    type: "checkout.session.completed",
    objectId: "cs_test_buildy_paid",
    checkoutSessionId: "cs_test_buildy_paid",
    paymentIntentId: "pi_buildy_paid_1",
    createdAt: new Date().toISOString(),
    environment: "test",
    orderId: ORDER_ID,
    orderNumber: "BLD-2026-TEST01",
    merchantReference: "buildy-order-reference",
    paymentStatus: "paid",
    amountTotalMinor: 30_450,
    currency: "EUR",
    rawEvent: { deliberately: "not persisted" },
    ...overrides,
  };
}

class FakeRepository implements StripePaymentEventRepository {
  readonly commands: ApplyStripePaymentEventCommand[] = [];

  constructor(private readonly result: StripePaymentEventResult = {
    applied: true,
    orderId: ORDER_ID,
    outcome: "paid",
  }) {}

  async apply(command: ApplyStripePaymentEventCommand): Promise<StripePaymentEventResult> {
    this.commands.push(command);
    return this.result;
  }
}

function request(body = rawBody): Request {
  return new Request("https://app.buildy.test/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1785850000,v1=synthetic",
    },
    body,
  });
}

describe("Stripe payment webhook boundary", () => {
  it("verifies the untouched body and persists only normalized payment facts", async () => {
    const repository = new FakeRepository();
    const verifyWebhook = vi.fn().mockResolvedValue(event());
    const handler = createStripePaymentWebhookHandler({
      applicationEnvironment: "test",
      payments: { verifyWebhook },
      repository,
    });

    const response = await handler(request(), crypto.randomUUID());

    expect(response.status).toBe(200);
    expect(verifyWebhook).toHaveBeenCalledWith(rawBody, "t=1785850000,v1=synthetic");
    expect(repository.commands).toEqual([expect.objectContaining({
      applicationEnvironment: "test",
      providerEnvironment: "test",
      providerEventId: "evt_buildy_paid_1",
      eventType: "checkout.session.completed",
      orderId: ORDER_ID,
      checkoutSessionId: "cs_test_buildy_paid",
      paymentIntentId: "pi_buildy_paid_1",
      amountTotalMinor: 30_450,
      currency: "EUR",
      payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    })]);
    expect(JSON.stringify(repository.commands)).not.toContain("deliberately");
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: true, applied: true, outcome: "paid" },
    });
  });

  it("acknowledges unrelated signed events without touching the order ledger", async () => {
    const repository = new FakeRepository();
    const handler = createStripePaymentWebhookHandler({
      applicationEnvironment: "test",
      payments: { verifyWebhook: vi.fn().mockResolvedValue(event({ type: "customer.updated" })) },
      repository,
    });

    const response = await handler(request(), crypto.randomUUID());

    expect(response.status).toBe(202);
    expect(repository.commands).toHaveLength(0);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: false, reason: "event_ignored" },
    });
  });

  it("fails before persistence when signature verification fails", async () => {
    const repository = new FakeRepository();
    const handler = createStripePaymentWebhookHandler({
      applicationEnvironment: "test",
      payments: {
        verifyWebhook: vi.fn().mockRejectedValue(
          new PaymentProviderError("INVALID_SIGNATURE", "bad signature", false),
        ),
      },
      repository,
    });

    await expect(handler(request(), crypto.randomUUID())).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    expect(repository.commands).toHaveLength(0);
  });

  it("rejects supported events with missing Buildy references", async () => {
    const repository = new FakeRepository();
    const handler = createStripePaymentWebhookHandler({
      applicationEnvironment: "production",
      payments: { verifyWebhook: vi.fn().mockResolvedValue(event({ merchantReference: undefined })) },
      repository,
    });

    await expect(handler(request(), crypto.randomUUID())).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
    expect(repository.commands).toHaveLength(0);
  });

  it("returns a durable duplicate outcome as a successful webhook response", async () => {
    const repository = new FakeRepository({
      applied: false,
      orderId: ORDER_ID,
      outcome: "duplicate",
    });
    const handler = createStripePaymentWebhookHandler({
      applicationEnvironment: "test",
      payments: { verifyWebhook: vi.fn().mockResolvedValue(event()) },
      repository,
    });

    const response = await handler(request(), crypto.randomUUID());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: true, applied: false, outcome: "duplicate" },
    });
  });
});

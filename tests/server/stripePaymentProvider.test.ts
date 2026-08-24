import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { StripePaymentProvider } from "../../server/payments/stripePaymentProvider";

const webhookSecret = "whsec_test_buildy_signature_secret";
const stripe = new Stripe("sk_test_not_used_in_unit_tests");

function provider(environment: "test" | "live" = "test") {
  return new StripePaymentProvider({
    secretKey: "sk_test_not_used_in_unit_tests",
    webhookSecret,
    expectedAccountId: "acct_BUILDYTEST",
    environment,
  }, stripe);
}

describe("Stripe payment provider", () => {
  it("verifies a signed Buildy event and returns only the normalized facts", async () => {
    const payload = JSON.stringify({
      id: "evt_buildy_1",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_test_buildy",
          object: "checkout.session",
          amount_total: 12900,
          currency: "eur",
          payment_intent: "pi_buildy_test_1",
          payment_status: "paid",
          metadata: {
            app: "buildy",
            order_id: "9d061f28-8a45-4e3b-a57c-a036d3799957",
            order_number: "BLD-2026-TEST01",
            merchant_reference: "buildy-test-reference",
          },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await expect(provider().verifyWebhook(payload, signature)).resolves.toMatchObject({
      providerEventId: "evt_buildy_1",
      type: "checkout.session.completed",
      orderNumber: "BLD-2026-TEST01",
      amountTotalMinor: 12900,
      currency: "EUR",
      environment: "test",
      checkoutSessionId: "cs_test_buildy",
      paymentIntentId: "pi_buildy_test_1",
    });
  });

  it("rejects tampered payloads", async () => {
    const payload = JSON.stringify({ id: "evt_tampered" });
    const signature = stripe.webhooks.generateTestHeaderString({ payload: "different", secret: webhookSecret });

    await expect(provider().verifyWebhook(payload, signature)).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
      retryable: false,
    });
  });

  it("rejects cross-environment events after signature verification", async () => {
    const payload = JSON.stringify({
      id: "evt_live_1",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: { object: { id: "pi_live", object: "payment_intent", metadata: { app: "buildy" } } },
      livemode: true,
      pending_webhooks: 1,
      request: null,
      type: "payment_intent.succeeded",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await expect(provider("test").verifyWebhook(payload, signature)).rejects.toMatchObject({
      code: "ENVIRONMENT_MISMATCH",
    });
  });

  it("rejects a signed checkout event whose session identity crosses environments", async () => {
    const payload = JSON.stringify({
      id: "evt_cross_session_1",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_live_foreign",
          object: "checkout.session",
          metadata: {
            app: "buildy",
            order_id: "9d061f28-8a45-4e3b-a57c-a036d3799957",
            order_number: "BLD-2026-TEST01",
            merchant_reference: "buildy-test-reference",
          },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await expect(provider().verifyWebhook(payload, signature)).rejects.toMatchObject({
      code: "ENVIRONMENT_MISMATCH",
      retryable: false,
    });
  });

  it("normalizes cumulative partial refunds without persisting customer payload fields", async () => {
    const payload = JSON.stringify({
      id: "evt_buildy_refund_1",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "ch_buildy_test_1",
          object: "charge",
          amount: 12_900,
          amount_refunded: 2_500,
          currency: "eur",
          refunded: false,
          payment_intent: "pi_buildy_test_1",
          billing_details: { email: "must-not-be-normalized@example.test" },
          metadata: {
            app: "buildy",
            order_id: "9d061f28-8a45-4e3b-a57c-a036d3799957",
            order_number: "BLD-2026-TEST01",
            merchant_reference: "buildy-test-reference",
          },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "charge.refunded",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    const normalized = await provider().verifyWebhook(payload, signature);

    expect(normalized).toMatchObject({
      objectId: "ch_buildy_test_1",
      paymentIntentId: "pi_buildy_test_1",
      amountTotalMinor: 12_900,
      amountRefundedMinor: 2_500,
      refunded: false,
      currency: "EUR",
    });
    expect(JSON.stringify({ ...normalized, rawEvent: undefined })).not.toContain("must-not-be-normalized");
  });

  it("rejects signed provider events that are not explicitly owned by Buildy", async () => {
    const payload = JSON.stringify({
      id: "evt_foreign_1",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_foreign",
          object: "checkout.session",
          metadata: { order_id: "9d061f28-8a45-4e3b-a57c-a036d3799957" },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await expect(provider().verifyWebhook(payload, signature)).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
      retryable: false,
    });
  });

  it("verifies the bound Stripe account once and preserves exact checkout quantities", async () => {
    const retrieveCurrent = vi.fn().mockResolvedValue({ id: "acct_BUILDYTEST" });
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_buildy_checkout",
      url: "https://checkout.stripe.com/c/pay/cs_test_buildy_checkout",
      expires_at: 1_785_851_800,
    });
    const fakeStripe = {
      accounts: { retrieveCurrent },
      checkout: { sessions: { create } },
    } as unknown as Stripe;
    const paymentProvider = new StripePaymentProvider({
      secretKey: "sk_test_not_used_in_unit_tests",
      webhookSecret,
      expectedAccountId: "acct_BUILDYTEST",
      environment: "test",
    }, fakeStripe);
    const input = {
      orderId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
      orderNumber: "BLD-2026-TEST01",
      merchantReference: "buildy-test-reference",
      currency: "EUR" as const,
      lines: [
        { label: "Bouwboek", unitAmountMinor: 9_900, quantity: 3 },
        { label: "Verzending", unitAmountMinor: 750, quantity: 1 },
      ],
      customerEmail: "bouwer@example.com",
      successUrl: "https://app.buildy.nl/bestelling/9d061f28-8a45-4e3b-a57c-a036d3799957",
      cancelUrl: "https://app.buildy.nl/bouwboek/annuleren",
      idempotencyKey: "checkout:test:9d061f28-8a45-4e3b-a57c-a036d3799957",
    };

    await expect(paymentProvider.createCheckout(input)).resolves.toMatchObject({
      sessionId: "cs_test_buildy_checkout",
    });
    await paymentProvider.createCheckout(input);

    expect(retrieveCurrent).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      client_reference_id: input.orderId,
      line_items: [
        { quantity: 3, price_data: { unit_amount: 9_900 } },
        { quantity: 1, price_data: { unit_amount: 750 } },
      ],
      metadata: { app: "buildy", order_id: input.orderId },
    });
    const expiresAt = create.mock.calls[0]?.[0].expires_at;
    expect(expiresAt).toBeTypeOf("number");
    expect(expiresAt! - Math.floor(Date.now() / 1_000)).toBeGreaterThanOrEqual(34 * 60);
    expect(expiresAt! - Math.floor(Date.now() / 1_000)).toBeLessThanOrEqual(35 * 60);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("shipping_address_collection");
    expect(create.mock.calls[0]?.[1]).toEqual({ idempotencyKey: input.idempotencyKey });
  });

  it("fails closed when the configured Stripe key resolves to another account", async () => {
    const fakeStripe = {
      accounts: { retrieveCurrent: vi.fn().mockResolvedValue({ id: "acct_OTHER" }) },
      checkout: { sessions: { create: vi.fn() } },
    } as unknown as Stripe;
    const paymentProvider = new StripePaymentProvider({
      secretKey: "sk_test_not_used_in_unit_tests",
      webhookSecret,
      expectedAccountId: "acct_BUILDYTEST",
      environment: "test",
    }, fakeStripe);

    await expect(paymentProvider.createCheckout({
      orderId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
      orderNumber: "BLD-2026-TEST01",
      merchantReference: "buildy-test-reference",
      currency: "EUR",
      lines: [{ label: "Bouwboek", unitAmountMinor: 9_900, quantity: 1 }],
      successUrl: "https://app.buildy.nl/bestelling/9d061f28-8a45-4e3b-a57c-a036d3799957",
      cancelUrl: "https://app.buildy.nl/bouwboek/annuleren",
      idempotencyKey: "checkout:test:9d061f28-8a45-4e3b-a57c-a036d3799957",
    })).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH", retryable: false });
  });

  it("accepts only a hosted Stripe Checkout URL from the adapter response", async () => {
    const fakeStripe = {
      accounts: { retrieveCurrent: vi.fn().mockResolvedValue({ id: "acct_BUILDYTEST" }) },
      checkout: { sessions: { create: vi.fn().mockResolvedValue({
        id: "cs_test_buildy_checkout",
        url: "https://payments.example.test/cs_test_buildy_checkout",
        expires_at: 1_785_851_800,
      }) } },
    } as unknown as Stripe;
    const paymentProvider = new StripePaymentProvider({
      secretKey: "sk_test_not_used_in_unit_tests",
      webhookSecret,
      expectedAccountId: "acct_BUILDYTEST",
      environment: "test",
    }, fakeStripe);

    await expect(paymentProvider.createCheckout({
      orderId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
      orderNumber: "BLD-2026-TEST01",
      merchantReference: "buildy-test-reference",
      currency: "EUR",
      lines: [{ label: "Bouwboek", unitAmountMinor: 9_900, quantity: 1 }],
      successUrl: "https://app.buildy.nl/bestelling/9d061f28-8a45-4e3b-a57c-a036d3799957",
      cancelUrl: "https://app.buildy.nl/bouwboek/annuleren",
      idempotencyKey: "checkout:test:9d061f28-8a45-4e3b-a57c-a036d3799957",
    })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false });
  });
});

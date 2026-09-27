import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { StripePaymentProvider } from "../../server/payments/stripePaymentProvider";

const webhookSecret = "whsec_test_buildy_signature_secret";
const stripe = new Stripe("sk_test_not_used_in_unit_tests");

interface StripeEventFixture {
  account?: string;
  api_version?: string | null;
  created: number;
  data: { object: Record<string, unknown> & { id?: string } };
  id: string;
  livemode: boolean;
  object: "event";
  pending_webhooks?: number;
  request?: unknown;
  type: string;
}

function parsedEvent(payload: string): StripeEventFixture {
  return JSON.parse(payload) as StripeEventFixture;
}

function provider(
  environment: "test" | "live" = "test",
  options: {
    accountFailure?: Error;
    canonicalEvent?: StripeEventFixture;
    canonicalFailure?: Error;
    resolvedAccountId?: string;
  } = {},
) {
  const fakeStripe = {
    accounts: {
      retrieveCurrent: vi.fn(async () => {
        if (options.accountFailure) throw options.accountFailure;
        return { id: options.resolvedAccountId ?? "acct_BUILDYTEST" };
      }),
    },
    events: {
      retrieve: vi.fn(async () => {
        if (options.canonicalFailure) throw options.canonicalFailure;
        if (!options.canonicalEvent) throw new Error("Canonical test event ontbreekt.");
        return options.canonicalEvent;
      }),
    },
    webhooks: stripe.webhooks,
  } as unknown as Stripe;
  return new StripePaymentProvider({
    secretKey: "sk_test_not_used_in_unit_tests",
    webhookSecret,
    expectedAccountId: "acct_BUILDYTEST",
    environment,
  }, fakeStripe);
}

function checkoutInput() {
  return {
    orderId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
    orderNumber: "BLD-2026-TEST01",
    merchantReference: "buildy-test-reference",
    currency: "EUR" as const,
    lines: [{ label: "Bouwboek", unitAmountMinor: 9_900, quantity: 1 }],
    successUrl: "https://app.buildy.nl/bestellingen/9d061f28-8a45-4e3b-a57c-a036d3799957",
    cancelUrl: "https://app.buildy.nl/bouwboek/annuleren",
    idempotencyKey: "checkout:test:9d061f28-8a45-4e3b-a57c-a036d3799957",
    expiresAt: new Date(Date.now() + 35 * 60_000).toISOString(),
  };
}

function checkoutProviderWithFailure(checkoutFailure: Error): StripePaymentProvider {
  const fakeStripe = {
    accounts: { retrieveCurrent: vi.fn().mockResolvedValue({ id: "acct_BUILDYTEST" }) },
    checkout: { sessions: { create: vi.fn().mockRejectedValue(checkoutFailure) } },
  } as unknown as Stripe;
  return new StripePaymentProvider({
    secretKey: "sk_test_not_used_in_unit_tests",
    webhookSecret,
    expectedAccountId: "acct_BUILDYTEST",
    environment: "test",
  }, fakeStripe);
}

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error rejection.");
  }
  throw new Error("Expected the promise to reject.");
}

type CanonicalMismatch = "account" | "event_id" | "event_type" | "livemode" | "object_id";

const canonicalMismatchCases: Array<[string, CanonicalMismatch]> = [
  ["event identity", "event_id"],
  ["event type", "event_type"],
  ["livemode", "livemode"],
  ["account", "account"],
  ["object identity", "object_id"],
];

function mismatchedCanonicalEvent(event: StripeEventFixture, mismatch: CanonicalMismatch): StripeEventFixture {
  const changed = parsedEvent(JSON.stringify(event));
  const mutable = changed as unknown as {
    account?: string;
    data: { object: { id?: string } };
    id: string;
    livemode: boolean;
    type: string;
  };
  if (mismatch === "event_id") mutable.id = "evt_canonical_other";
  if (mismatch === "event_type") mutable.type = "checkout.session.expired";
  if (mismatch === "livemode") mutable.livemode = true;
  if (mismatch === "account") mutable.account = "acct_OTHER";
  if (mismatch === "object_id") mutable.data.object.id = "cs_test_canonical_other";
  return changed;
}

const accountFailureCases: Array<[string, Error]> = [
  ["authentication", new Stripe.errors.StripeAuthenticationError({
    message: "sensitive-auth-provider-detail",
    statusCode: 401,
    type: "authentication_error",
  })],
  ["permission", new Stripe.errors.StripePermissionError({
    message: "sensitive-permission-provider-detail",
    statusCode: 403,
    type: "invalid_request_error",
  })],
];

const canonicalMissingCases: Array<[string, Error]> = [
  ["HTTP 404", new Stripe.errors.StripeInvalidRequestError({
    message: "sensitive-missing-event-detail",
    statusCode: 404,
    type: "invalid_request_error",
  })],
  ["resource_missing", new Stripe.errors.StripeInvalidRequestError({
    code: "resource_missing",
    message: "sensitive-foreign-account-detail",
    statusCode: 400,
    type: "invalid_request_error",
  })],
];

const checkoutInvalidCases: Array<[string, Error]> = [
  ["invalid request", new Stripe.errors.StripeInvalidRequestError({
    message: "sensitive-invalid-checkout-detail",
    statusCode: 400,
    type: "invalid_request_error",
  })],
  ["idempotency", new Stripe.errors.StripeIdempotencyError({
    message: "sensitive-idempotency-detail",
    statusCode: 400,
    type: "idempotency_error",
  })],
];

const checkoutTransientCases: Array<[string, Error]> = [
  ["connection", new Stripe.errors.StripeConnectionError({
    message: "sensitive-connection-detail",
  })],
  ["rate limit", new Stripe.errors.StripeRateLimitError({
    message: "sensitive-rate-limit-detail",
    statusCode: 429,
    type: "rate_limit_error",
  })],
  ["HTTP 5xx", new Stripe.errors.StripeAPIError({
    message: "sensitive-api-detail",
    statusCode: 503,
    type: "api_error",
  })],
];

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

    await expect(provider("test", { canonicalEvent: parsedEvent(payload) }).verifyWebhook(payload, signature))
      .resolves.toMatchObject({
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

    const failure = await rejectedError(provider().verifyWebhook(payload, signature));
    expect(failure).toMatchObject({
      code: "INVALID_SIGNATURE",
      retryable: false,
    });
    expect(failure.cause).toBeUndefined();
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

    await expect(provider("test", { canonicalEvent: parsedEvent(payload) }).verifyWebhook(payload, signature))
      .rejects.toMatchObject({
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

    await expect(provider("test", { canonicalEvent: parsedEvent(payload) }).verifyWebhook(payload, signature))
      .rejects.toMatchObject({
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

    const normalized = await provider("test", { canonicalEvent: parsedEvent(payload) })
      .verifyWebhook(payload, signature);

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

    await expect(provider("test", { canonicalEvent: parsedEvent(payload) }).verifyWebhook(payload, signature))
      .rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
      retryable: false,
    });
  });

  it("fails closed when the webhook API key resolves to another Stripe account", async () => {
    const payload = JSON.stringify({
      id: "evt_webhook_account_mismatch",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_test_webhook_account_mismatch",
          object: "checkout.session",
          metadata: { app: "buildy" },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await expect(provider("test", {
      canonicalEvent: parsedEvent(payload),
      resolvedAccountId: "acct_OTHER",
    }).verifyWebhook(payload, signature)).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
      retryable: false,
    });
  });

  it.each(accountFailureCases)("classifies Stripe account %s failures as non-retryable without leaking details", async (
    _label,
    accountFailure,
  ) => {
    const failure = await rejectedError(provider("test", { accountFailure }).verifyAccount());
    expect(failure).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: false,
    });
    expect(failure.message).toBe("Stripe-account kon niet worden geverifieerd.");
    expect(failure.cause).toBeUndefined();
  });

  it.each(canonicalMismatchCases)("rejects a canonical %s mismatch", async (_label, mismatch) => {
    const signedEvent = parsedEvent(JSON.stringify({
      id: "evt_signed_identity",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_test_signed_identity",
          object: "checkout.session",
          amount_total: 12_900,
          currency: "eur",
          metadata: { app: "buildy" },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    }));
    const payload = JSON.stringify(signedEvent);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const canonicalEvent = mismatchedCanonicalEvent(signedEvent, mismatch);

    await expect(provider("test", { canonicalEvent }).verifyWebhook(payload, signature))
      .rejects.toMatchObject({
        code: "ACCOUNT_MISMATCH",
        retryable: false,
      });
  });

  it("normalizes the event retrieved through the configured Stripe account", async () => {
    const signedEvent = parsedEvent(JSON.stringify({
      id: "evt_canonical_facts",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_test_canonical_facts",
          object: "checkout.session",
          amount_total: 1,
          currency: "eur",
          metadata: { app: "buildy", order_number: "BLD-2026-SIGNED" },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    }));
    const canonicalEvent = {
      ...signedEvent,
      data: {
        ...signedEvent.data,
        object: {
          ...signedEvent.data.object,
          amount_total: 12_900,
          metadata: { app: "buildy", order_number: "BLD-2026-CANONICAL" },
        },
      },
    };
    const payload = JSON.stringify(signedEvent);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await expect(provider("test", { canonicalEvent }).verifyWebhook(payload, signature))
      .resolves.toMatchObject({
        amountTotalMinor: 12_900,
        orderNumber: "BLD-2026-CANONICAL",
        rawEvent: canonicalEvent,
      });
  });

  it("fails closed when the canonical Stripe event cannot be retrieved", async () => {
    const payload = JSON.stringify({
      id: "evt_canonical_unavailable",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_test_canonical_unavailable",
          object: "checkout.session",
          metadata: { app: "buildy" },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    const failure = await rejectedError(provider("test", {
      canonicalFailure: new Stripe.errors.StripeConnectionError({
        message: "synthetic Stripe lookup failure",
      }),
    }).verifyWebhook(payload, signature));
    expect(failure).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(failure.message).toBe("Stripe-event kon niet bij het verwachte account worden geverifieerd.");
    expect(failure.cause).toBeUndefined();
  });

  it.each(canonicalMissingCases)("classifies canonical event %s as a non-retryable account mismatch", async (
    _label,
    canonicalFailure,
  ) => {
    const payload = JSON.stringify({
      id: "evt_canonical_missing",
      object: "event",
      api_version: null,
      created: 1_785_850_000,
      data: {
        object: {
          id: "cs_test_canonical_missing",
          object: "checkout.session",
          metadata: { app: "buildy" },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    const failure = await rejectedError(
      provider("test", { canonicalFailure }).verifyWebhook(payload, signature),
    );
    expect(failure).toMatchObject({ code: "ACCOUNT_MISMATCH", retryable: false });
    expect(failure.message).toBe("Stripe-event kon niet bij het verwachte account worden geverifieerd.");
    expect(failure.cause).toBeUndefined();
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
      expiresAt: new Date(Date.now() + 35 * 60_000).toISOString(),
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
      expiresAt: new Date(Date.now() + 35 * 60_000).toISOString(),
    })).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH", retryable: false });
  });

  it.each(checkoutInvalidCases)("classifies Stripe Checkout %s failures as invalid and non-retryable", async (
    _label,
    checkoutFailure,
  ) => {
    const failure = await rejectedError(
      checkoutProviderWithFailure(checkoutFailure).createCheckout(checkoutInput()),
    );
    expect(failure).toMatchObject({ code: "INVALID_CHECKOUT", retryable: false });
    expect(failure.message).toBe("Stripe Checkout kon niet worden aangemaakt.");
    expect(failure.cause).toBeUndefined();
  });

  it.each(checkoutTransientCases)("classifies Stripe Checkout %s failures as retryable unavailability", async (
    _label,
    checkoutFailure,
  ) => {
    const failure = await rejectedError(
      checkoutProviderWithFailure(checkoutFailure).createCheckout(checkoutInput()),
    );
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(failure.message).toBe("Stripe Checkout kon niet worden aangemaakt.");
    expect(failure.cause).toBeUndefined();
  });

  it("recovers a lost Checkout response on another instance without changing Stripe parameters", async () => {
    const firstAttemptAt = Date.parse("2026-08-31T12:00:00.000Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(firstAttemptAt);
    const input = {
      orderId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
      orderNumber: "BLD-2026-TEST01",
      merchantReference: "buildy-test-reference",
      currency: "EUR" as const,
      lines: [{ label: "Bouwboek", unitAmountMinor: 9_900, quantity: 1 }],
      successUrl: "https://app.buildy.nl/bestellingen/9d061f28-8a45-4e3b-a57c-a036d3799957",
      cancelUrl: "https://app.buildy.nl/bouwboek/annuleren",
      idempotencyKey: "checkout:test:9d061f28-8a45-4e3b-a57c-a036d3799957",
      expiresAt: "2026-08-31T13:05:00.000Z",
    };
    let recorded: { parameters: Stripe.Checkout.SessionCreateParams; idempotencyKey?: string } | undefined;
    const create = vi.fn(async (
      parameters: Stripe.Checkout.SessionCreateParams,
      options: Stripe.RequestOptions,
    ) => {
      if (!recorded) {
        recorded = { parameters, idempotencyKey: options.idempotencyKey };
        throw new Stripe.errors.StripeConnectionError({
          message: "Response lost after Stripe created the session",
        });
      }
      // Stripe rejects changed parameters for an already-used key. Reproduce
      // that boundary instead of accepting any second call from the adapter.
      expect(options.idempotencyKey).toBe(recorded.idempotencyKey);
      expect(parameters).toEqual(recorded.parameters);
      return {
        id: "cs_test_buildy_recovered",
        url: "https://checkout.stripe.com/c/pay/cs_test_buildy_recovered",
        expires_at: recorded.parameters.expires_at,
      };
    });
    const fakeStripe = {
      accounts: { retrieveCurrent: vi.fn().mockResolvedValue({ id: "acct_BUILDYTEST" }) },
      checkout: { sessions: { create } },
    } as unknown as Stripe;
    const instance = () => new StripePaymentProvider({
      secretKey: "sk_test_not_used_in_unit_tests",
      webhookSecret,
      expectedAccountId: "acct_BUILDYTEST",
      environment: "test",
    }, fakeStripe);

    try {
      await expect(instance().createCheckout(input)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
        retryable: true,
      });
      now.mockReturnValue(firstAttemptAt + 28 * 60_000);
      await expect(instance().createCheckout(input)).resolves.toMatchObject({
        sessionId: "cs_test_buildy_recovered",
        expiresAt: input.expiresAt,
      });
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
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
      expiresAt: new Date(Date.now() + 35 * 60_000).toISOString(),
    })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: false });
  });
});

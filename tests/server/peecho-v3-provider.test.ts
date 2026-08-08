import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  PrintProviderError,
  type CreatePrintOrderInput,
} from "../../server/print/printProvider";
import {
  PEECHO_V3_BASE_URLS,
  PeechoV3HttpProvider,
  type PeechoV3Clock,
} from "../../server/print/peechoV3Provider";
import { requireSandboxMutation } from "../../scripts/peecho/_shared";

const MERCHANT_KEY = "merchant-test-key:ABCD1234";
const SECRET_KEY = "SECRETABCD";
const NOW = new Date("2026-08-04T12:00:00.000Z");

const fixedClock: PeechoV3Clock = {
  now: () => new Date(NOW),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const offeringCatalog = {
  BO: {
    HC: [{
      id: 233309,
      name: "A4 landscape hardcover",
      paperType: "Matte",
      catalogueItemCode: "AB-hc-M-l",
      minimumQuantity: 1,
      minNumberOfPages: 24,
      maxNumberOfPages: 300,
      dimensionWidth: 297,
      dimensionHeight: 210,
      dynamicSize: false,
      minDimensionWidth: 210,
      minDimensionHeight: 148,
      pricingDto: { currency: "EUR", price: 596, pricePerPage: 4 },
    }],
  },
};

const createInput: CreatePrintOrderInput = {
  idempotencyKey: "peecho-create:11111111-1111-4111-8111-111111111111",
  currency: "EUR",
  customerEmail: "customer@example.com",
  shippingAddress: {
    firstName: "Noor",
    lastName: "Bouwer",
    addressLine1: "Teststraat 1",
    postalCode: "1234 AB",
    city: "Utrecht",
    countryCode: "NL",
  },
  items: [{
    reference: "bouwboek-1",
    offeringId: "233309",
    quantity: 1,
    file: {
      contentUrl: "https://media.buildy.example/proof.pdf?token=opaque",
      widthMm: 297,
      heightMm: 210,
      pageCount: 24,
    },
  }],
};

function provider(fetchMock: typeof fetch, environment: "test" | "live" = "test") {
  return new PeechoV3HttpProvider({
    environment,
    merchantApiKey: MERCHANT_KEY,
    secretKey: SECRET_KEY,
    fetch: fetchMock,
    clock: fixedClock,
    timeoutMs: 1_000,
  });
}

describe("Peecho v3 HTTP print provider", () => {
  it("uses the fixed test boundary and normalizes account-specific offerings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(offeringCatalog));
    const adapter = provider(fetchMock as typeof fetch);

    const offerings = await adapter.getOfferings({ countryCode: "nl", currency: "eur" });

    expect(offerings).toEqual([expect.objectContaining({
      id: "233309",
      categoryCode: "BO",
      subcategoryCode: "HC",
      minimumPageCount: 24,
      widthMm: 297,
      basePrice: { currency: "EUR", amountMinor: 596 },
    })]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(`${PEECHO_V3_BASE_URLS.test}offering/list`);
    expect(requestUrl.searchParams.get("merchantApiKey")).toBe(MERCHANT_KEY);
    expect(requestUrl.searchParams.get("countryIsoCode2")).toBe("NL");
  });

  it("derives a product specification from the exact offering list and rejects unknown IDs", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(offeringCatalog)));
    const adapter = provider(fetchMock as typeof fetch);

    await expect(adapter.getProductSpecification({ offeringId: "233309" })).resolves.toMatchObject({
      id: "233309",
      name: "A4 landscape hardcover",
    });
    await expect(adapter.getProductSpecification({ offeringId: "999999" })).rejects.toMatchObject({
      code: "OFFERING_NOT_FOUND",
      retry: { action: "do_not_retry" },
    });
  });

  it("fails closed when an offering response contains undocumented fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      BO: { HC: [{ ...offeringCatalog.BO.HC[0], leakedField: "customer@example.com" }] },
    }));
    const adapter = provider(fetchMock as typeof fetch);

    const error = await adapter.getOfferings().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PrintProviderError);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE", operation: "getOfferings" });
    expect(String((error as Error).message)).not.toContain("customer@example.com");
  });

  it("requires documented JSON content types on successful responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(offeringCatalog), {
      status: 200,
    }));
    const adapter = provider(fetchMock as typeof fetch);

    await expect(adapter.getOfferings()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      retry: { action: "do_not_retry", reason: "invalid_response" },
    });
  });

  it("rejects provider IDs that cannot be converted to safe request integers", async () => {
    const fetchMock = vi.fn();
    const adapter = provider(fetchMock as unknown as typeof fetch);

    await expect(adapter.getQuote({
      countryCode: "NL",
      items: [{ offeringId: "9999999999999999", quantity: 1 }],
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates and converts a quote to integer minor units", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      quoteDetails: { countryCode: "NL", state: null, currency: "EUR", exchangeRate: "1" },
      quotedItems: [{
        offeringId: 233309,
        numberOfPages: 24,
        quantity: 1,
        basePrice: 5.96,
        pricePerPage: 0.04,
        productPrice: 6.12,
        shippingWholesale: 4.5,
        totalQuantityDiscount: 0,
        vatPercentage: 21,
        vat: 2.23,
        totalItemPrice: 12.85,
      }],
      quoteSummary: {
        numberOfItems: 1,
        totalWholesalePrice: 6.12,
        totalShippingPrice: 4.5,
        vatSummary: [{ vatPercentage: 21, vat: 2.23 }],
        totalQuantityDiscount: 0,
      },
    }));
    const adapter = provider(fetchMock as typeof fetch);

    const quote = await adapter.getQuote({
      countryCode: "NL",
      currency: "EUR",
      items: [{ offeringId: "233309", pageCount: 24, quantity: 1 }],
    });

    expect(quote.items[0]?.total.amountMinor).toBe(1_285);
    expect(quote.summary.shippingPrice.amountMinor).toBe(450);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      apiKey: MERCHANT_KEY,
      countryCode: "NL",
      currency: "EUR",
      items: [{ offeringId: 233309, numberOfPages: 24, quantity: 1 }],
    });
  });

  it("surfaces create idempotency through Peecho's unique order_reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ order_id: 1234 }, { status: 201 }));
    const adapter = provider(fetchMock as typeof fetch);

    const created = await adapter.createOrder(createInput);

    expect(adapter.idempotency).toEqual({
      createOrder: "unique-merchant-reference",
      payOrder: "status-reconciliation-required",
    });
    expect(created).toMatchObject({ providerOrderId: "1234", merchantReference: createInput.idempotencyKey });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.order_reference).toBe(createInput.idempotencyKey);
    expect(body).not.toHaveProperty("idempotency_key");
  });

  it("classifies a create timeout before any response as reconcile, never blind retry", async () => {
    const immediateClock: PeechoV3Clock = {
      now: () => new Date(NOW),
      setTimeout: (callback) => {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeout: () => undefined,
    };
    const fetchMock = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
    const adapter = new PeechoV3HttpProvider({
      environment: "test",
      merchantApiKey: MERCHANT_KEY,
      secretKey: SECRET_KEY,
      fetch: fetchMock as typeof fetch,
      clock: immediateClock,
      timeoutMs: 250,
    });

    const error = await adapter.createOrder(createInput).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "TIMEOUT",
      operation: "createOrder",
      retry: { action: "reconcile", reason: "mutation_outcome_unknown" },
    });
    expect(adapter.classifyRetry(error)).toEqual({
      action: "reconcile",
      reason: "mutation_outcome_unknown",
    });
  });

  it("maps unknown provider statuses without treating them as terminal success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      order_id: 1234,
      order_state: "FUTURE_PEECHO_STATE",
    }, { status: 201 }));
    const adapter = provider(fetchMock as typeof fetch);

    expect(adapter.mapStatus("FUTURE_PEECHO_STATE")).toEqual({
      status: "unknown",
      providerStatus: "FUTURE_PEECHO_STATE",
      known: false,
      terminal: false,
    });
    await expect(adapter.getOrder({ providerOrderId: "1234" })).resolves.toMatchObject({
      status: { status: "unknown", known: false, terminal: false },
    });
  });

  it("signs payment exactly as SHA-256(secretKey + orderId)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ order_state: "PAID" }));
    const adapter = provider(fetchMock as typeof fetch);

    await expect(adapter.payOrder({ providerOrderId: "1234" })).resolves.toMatchObject({
      status: { status: "paid" },
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.secret).toBe(createHash("sha256").update(`${SECRET_KEY}1234`).digest("hex"));
    expect(body.merchant_api_key).toBe(MERCHANT_KEY);
  });

  it("strictly rejects invalid callbacks and normalizes a valid signed callback", () => {
    const adapter = provider(vi.fn() as unknown as typeof fetch);
    const payload = {
      signature: createHash("sha256").update(`${SECRET_KEY}1234`).digest("hex"),
      order_id: "1234",
      order_reference: "peecho-create:11111111-1111-4111-8111-111111111111",
      old_status: "IN_PRODUCTION",
      new_status: "SHIPPED",
      tracking_code: "TRACK-123",
      tracking_url: "https://carrier.example/track/TRACK-123",
    };

    expect(() => adapter.verifyCallback({ ...payload, signature: "0".repeat(64) })).toThrowError(
      expect.objectContaining({ code: "INVALID_CALLBACK" }),
    );
    expect(() => adapter.verifyCallback({ ...payload, unexpected: true })).toThrowError(
      expect.objectContaining({ code: "INVALID_CALLBACK" }),
    );
    expect(adapter.verifyCallback(payload)).toMatchObject({
      providerOrderId: "1234",
      newStatus: { status: "shipped", terminal: true },
      verifiedAt: NOW.toISOString(),
    });
  });

  it("redacts provider details and reconciles duplicate references", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      url: "https://test.www.peecho.com/rest/v3/order/?email=customer@example.com",
      details: "Duplicate file https://private.example/proof.pdf?secret=sensitive",
      custom_code: "ORD_DUPLICATE",
      timestamp: NOW.toISOString(),
    }, { status: 400 }));
    const adapter = provider(fetchMock as typeof fetch);

    const error = await adapter.createOrder(createInput).catch((caught: unknown) => caught) as PrintProviderError;

    expect(error.retry).toEqual({ action: "reconcile", reason: "duplicate_reference" });
    expect(error.options.providerCode).toBe("ORD_DUPLICATE");
    expect(error.message).not.toMatch(/customer@example|private\.example|sensitive/);
  });

  it("uses the fixed live origin for reads and hard-blocks script mutations in production", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(offeringCatalog));
    const adapter = provider(fetchMock as typeof fetch, "live");

    await adapter.getOfferings();

    expect(String(fetchMock.mock.calls[0]?.[0]).startsWith(PEECHO_V3_BASE_URLS.live)).toBe(true);
    expect(() => requireSandboxMutation("live", {
      options: {},
      flags: new Set(["confirm-sandbox-create"]),
    }, "create")).toThrow(/hard geblokkeerd/i);
  });
});

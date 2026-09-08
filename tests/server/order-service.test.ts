// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PhotobookOrderDetail } from "../../shared/contracts/orders";
import {
  PaymentProviderError,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../../server/payments/paymentProvider";
import type { ApprovedSellerConfiguration } from "../../server/orders/checkoutConfiguration";
import { parsePersistedCheckoutSnapshot } from "../../server/orders/repository";
import { OrderService } from "../../server/orders/service";
import { canonicalJson } from "../../server/security/canonicalJson";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";
import type {
  CheckoutProofContext,
  CheckoutReservation,
  OrderPiiProtector,
  OrderQuote,
  OrderQuoteProvider,
  OrderRepository,
  RecordCheckoutSessionCommand,
  ReserveCheckoutCommand,
  SellerSnapshot,
} from "../../server/orders/types";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const RENEWED_COMMAND_ID = "66666666-6666-4666-8666-666666666666";
const DOCUMENT_HASH = "a".repeat(64);
const PDF_HASH = "b".repeat(64);
const BLIND_INDEX = new PrivacyBlindIndex(Buffer.alloc(32, 19).toString("base64"));

const input = {
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  documentSha256: DOCUMENT_HASH,
  pdfSha256: PDF_HASH,
  quantity: 2,
  shippingAddress: {
    firstName: "Mila",
    lastName: "Bouwer",
    addressLine1: "Teststraat 12",
    addressLine2: null,
    postalCode: "1234 AB",
    city: "Utrecht",
    state: null,
    countryCode: "NL",
  },
  expectedQuoteReference: "quote-test-1",
  expectedQuoteExpiresAt: "2026-08-04T12:30:00.000Z",
  expectedAmounts: {
    currency: "EUR" as const,
    subtotalMinor: 8_000,
    shippingMinor: 800,
    taxMinor: 1_848,
    totalMinor: 10_648,
  },
  termsVersion: "2026-08-01",
  termsAccepted: true as const,
  personalisedProductAccepted: true as const,
};

const proof: CheckoutProofContext = {
  projectId: PROJECT_ID,
  projectTitle: "Ons huis",
  revisionId: REVISION_ID,
  status: "approved",
  documentSha256: DOCUMENT_HASH,
  pdfSha256: PDF_HASH,
  pageCount: 24,
  format: "a4-landscape-hardcover-v1",
  customerEmail: "mila@example.test",
};

const quote: OrderQuote = {
  quoteReference: "quote-test-1",
  productReference: "buildy-a4-landscape-hardcover",
  sku: "a4-landscape-hardcover-v1",
  pageCount: 24,
  quantity: 2,
  destinationCountry: "NL",
  unitAmountMinor: 4_000,
  amounts: {
    currency: "EUR",
    subtotalMinor: 8_000,
    shippingMinor: 800,
    taxMinor: 1_848,
    totalMinor: 10_648,
  },
  deliveryEstimate: "5–8 werkdagen na productie",
  taxTreatment: "vat_exclusive",
  commercialApprovalId: "approved-test-price-v1",
  expiresAt: new Date("2026-08-04T12:30:00.000Z"),
};

const seller: SellerSnapshot = {
  legalName: "Buildy Test B.V.",
  tradeName: "Buildy",
  registrationNumber: "TEST-ONLY",
  vatNumber: null,
  address: "Testadres",
  countryCode: "NL",
  supportEmail: "support@example.test",
};

const sellerConfiguration: ApprovedSellerConfiguration = {
  version: 1,
  environment: "test",
  approvalStatus: "approved",
  approvalId: "seller-test-2026-08",
  approvedBy: "Test legal owner",
  approvedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:00:00.000Z",
  seller,
};

class MemoryOrderRepository implements OrderRepository {
  readonly reservations: ReserveCheckoutCommand[] = [];
  readonly sessions: RecordCheckoutSessionCommand[] = [];
  readonly cancelledOrderIds: string[] = [];
  stored: CheckoutReservation | null = null;
  proof: CheckoutProofContext | null = proof;
  listCalls: Array<{ actorId: string; cursor: unknown; limit: number }> = [];
  listResult: Awaited<ReturnType<OrderRepository["listOrders"]>> = {
    items: [],
    hasMore: false,
  };
  recordCheckoutFailuresRemaining = 0;
  checkoutSessionRecorded = false;

  async findCheckoutReservation(
    actorId: string,
    proofRevisionId: string,
    idempotencyKey: string,
  ) {
    if (!this.stored || this.stored.actorId !== actorId) {
      return null;
    }
    const sameKey = this.stored.idempotencyKey === idempotencyKey;
    const sameProof = this.stored.proofRevisionId === proofRevisionId
      && !["payment_failed", "expired", "cancelled", "manual_review"].includes(this.stored.status);
    if (!sameKey && !sameProof) return null;
    return { ...this.stored, replayed: true };
  }

  async loadCheckoutProof() {
    return this.proof;
  }

  async reserveCheckout(command: ReserveCheckoutCommand) {
    this.reservations.push(command);
    this.checkoutSessionRecorded = false;
    this.stored = {
      ...command,
      requestHashScheme: "blind-v2",
      status: "awaiting_payment",
      replayed: false,
    };
    return this.stored;
  }

  async cancelExpiredCheckoutReservation(
    command: Parameters<OrderRepository["cancelExpiredCheckoutReservation"]>[0],
  ) {
    if (
      !this.stored
      || this.stored.actorId !== command.actorId
      || this.stored.orderId !== command.orderId
      || this.stored.quoteExpiresAt.getTime() > command.now.getTime()
      || this.checkoutSessionRecorded
    ) return false;
    this.cancelledOrderIds.push(this.stored.orderId);
    this.stored = null;
    return true;
  }

  async recordCheckoutSession(command: RecordCheckoutSessionCommand) {
    if (this.recordCheckoutFailuresRemaining > 0) {
      this.recordCheckoutFailuresRemaining -= 1;
      throw new Error("database timeout");
    }
    this.sessions.push(command);
    this.checkoutSessionRecorded = true;
    if (this.stored?.orderId === command.orderId) this.stored.status = "checkout_open";
  }

  async listOrders(actorId: string, cursor: Parameters<OrderRepository["listOrders"]>[1], limit: number) {
    this.listCalls.push({ actorId, cursor, limit });
    return this.listResult;
  }

  async getOrder(): Promise<PhotobookOrderDetail | null> {
    return null;
  }
}

function dependencies(options?: {
  checkoutEnabled?: boolean;
  quote?: OrderQuote | null;
  paymentError?: Error;
  now?: Date;
  clock?: () => Date;
  sellerConfiguration?: ApprovedSellerConfiguration;
  orderIds?: string[];
}) {
  const repository = new MemoryOrderRepository();
  const quoteProvider: OrderQuoteProvider = {
    quote: vi.fn().mockResolvedValue(options && "quote" in options ? options.quote : quote),
  };
  const checkoutCalls: CreateCheckoutInput[] = [];
  const payments: PaymentProvider = {
    verifyAccount: vi.fn().mockResolvedValue(undefined),
    createCheckout: vi.fn(async (checkout) => {
      checkoutCalls.push(checkout);
      if (options?.paymentError) throw options.paymentError;
      const now = options?.clock?.() ?? options?.now ?? new Date("2026-08-04T12:00:00.000Z");
      const sessionId = `cs_test_${checkout.orderId.replaceAll("-", "")}`;
      return {
        provider: "stripe" as const,
        sessionId,
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
        expiresAt: new Date(now.getTime() + 20 * 60_000).toISOString(),
      };
    }),
    verifyWebhook: vi.fn(),
  };
  const protectedInputs: Parameters<OrderPiiProtector["protect"]>[0][] = [];
  const pii: OrderPiiProtector = {
    protect(value) {
      protectedInputs.push(value);
      return {
        customerEmailCiphertext: "v1.1.email",
        shippingDetailsCiphertext: "v1.1.address",
        encryptionKeyVersion: 1,
      };
    },
  };
  const service = new OrderService(
    repository,
    quoteProvider,
    payments,
    pii,
    BLIND_INDEX,
    options?.sellerConfiguration ?? sellerConfiguration,
    "https://app.buildy.test",
    "2026-08-01",
    options?.checkoutEnabled ?? true,
    () => options?.clock?.() ?? options?.now ?? new Date("2026-08-04T12:00:00.000Z"),
    (() => {
      const ids = [...(options?.orderIds ?? [ORDER_ID])];
      return () => ids.shift() ?? ORDER_ID;
    })(),
  );
  return { repository, quoteProvider, payments, checkoutCalls, protectedInputs, service };
}

describe("OrderService", () => {
  it.each([1, 2, 3] as const)(
    "parses a schema-v%s account-erasure marker without recreating a replay hash",
    (schemaVersion) => {
      const snapshot = {
        schemaVersion,
        sku: "a4-landscape-hardcover-v1",
        format: "a4-landscape-hardcover-v1",
        projectTitle: "Verwijderd account",
        pageCount: 24,
        documentSha256: DOCUMENT_HASH,
        pdfSha256: PDF_HASH,
        unitAmountMinor: 4_000,
        quoteReference: "retained-legal-quote",
        commercialApprovalId: "retained-price-v1",
        taxTreatment: "vat_exclusive",
        quoteExpiresAt: "2026-08-04T12:30:00.000Z",
        personalisedProduct: true,
        requestHashRedacted: true,
        requestHashRedactionReason: "ACCOUNT_ERASURE",
        ...(schemaVersion === 3
          ? {
              productReference: "buildy-a4-landscape-hardcover",
              priceVersion: "retained-price-v1",
              termsAccepted: true,
            }
          : {
              offeringId: "legacy-provider-offering",
              ...(schemaVersion === 2 ? { termsAccepted: true } : {}),
            }),
      };

      const parsed = parsePersistedCheckoutSnapshot(snapshot);
      expect(parsed).toMatchObject({
        schemaVersion,
        requestHashRedacted: true,
        requestHashRedactionReason: "ACCOUNT_ERASURE",
      });
      expect("requestHash" in parsed).toBe(false);
      expect(() => parsePersistedCheckoutSnapshot({
        ...snapshot,
        requestHash: "f".repeat(64),
      })).toThrow();
    },
  );

  it("paginates the authenticated customer's server-owned order list with an opaque cursor", async () => {
    const context = dependencies({ checkoutEnabled: false });
    context.repository.listResult = {
      items: [{
        orderId: ORDER_ID,
        orderNumber: "BLD-20260804-ABCDEF12",
        projectId: PROJECT_ID,
        projectTitle: "Ons huis",
        pageCount: 24,
        quantity: 1,
        amounts: quote.amounts,
        status: "paid",
        paymentStatus: "paid",
        fulfilmentStatus: "awaiting_review",
        createdAt: "2026-08-04T12:00:00.000Z",
        paidAt: "2026-08-04T12:05:00.000Z",
      }],
      hasMore: true,
    };

    const first = await context.service.orders(ACTOR_ID, { limit: "1" });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toContain(ORDER_ID);
    expect(context.repository.listCalls[0]).toEqual({ actorId: ACTOR_ID, cursor: undefined, limit: 1 });

    await context.service.orders(ACTOR_ID, { limit: 1, cursor: first.nextCursor });
    expect(context.repository.listCalls[1]).toMatchObject({
      actorId: ACTOR_ID,
      cursor: {
        kind: "customer-orders",
        version: 1,
        createdAt: "2026-08-04T12:00:00.000Z",
        orderId: ORDER_ID,
      },
      limit: 1,
    });
  });

  it("rejects a forged customer-order cursor before repository access", async () => {
    const context = dependencies();

    await expect(context.service.orders(ACTOR_ID, { cursor: "not-a-cursor" }))
      .rejects.toMatchObject({ reason: "INVALID_CURSOR" });
    expect(context.repository.listCalls).toHaveLength(0);
  });

  it("keeps quote and checkout closed until the explicit launch flag is enabled", async () => {
    const context = dependencies({ checkoutEnabled: false });

    await expect(context.service.quote(ACTOR_ID, REVISION_ID, {}))
      .rejects.toMatchObject({ reason: "CHECKOUT_UNAVAILABLE" });
    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, {}))
      .rejects.toMatchObject({ reason: "CHECKOUT_UNAVAILABLE" });
    expect(context.repository.reservations).toHaveLength(0);
    expect(context.quoteProvider.quote).not.toHaveBeenCalled();
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("returns an exact, expiring pre-checkout quote with seller and terms", async () => {
    const context = dependencies();

    const result = await context.service.quote(ACTOR_ID, REVISION_ID, {
      documentSha256: input.documentSha256,
      pdfSha256: input.pdfSha256,
      quantity: input.quantity,
      shippingAddress: input.shippingAddress,
    });

    expect(result).toEqual({
      proofRevisionId: REVISION_ID,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 2,
      destinationCountry: "NL",
      quoteReference: quote.quoteReference,
      amounts: quote.amounts,
      deliveryEstimate: quote.deliveryEstimate,
      taxTreatment: quote.taxTreatment,
      expiresAt: quote.expiresAt.toISOString(),
      termsVersion: "2026-08-01",
      seller,
      personalisedProduct: true,
    });
    expect(context.repository.reservations).toHaveLength(0);
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("fails closed when the approved seller envelope expires after a warm start", async () => {
    const context = dependencies({ now: new Date("2026-09-01T00:00:00.000Z") });

    await expect(context.service.quote(ACTOR_ID, REVISION_ID, {
      documentSha256: input.documentSha256,
      pdfSha256: input.pdfSha256,
      quantity: input.quantity,
      shippingAddress: input.shippingAddress,
    })).rejects.toMatchObject({ reason: "PRICE_UNAVAILABLE" });
    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "PRICE_UNAVAILABLE" });
    expect(context.quoteProvider.quote).not.toHaveBeenCalled();
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("binds the approved proof, server quote, seller snapshot and exact Stripe quantity", async () => {
    const context = dependencies();

    const result = await context.service.checkout(ACTOR_ID, REVISION_ID, input);

    expect(result).toMatchObject({
      orderId: ORDER_ID,
      projectId: PROJECT_ID,
      proofRevisionId: REVISION_ID,
      pageCount: 24,
      quantity: 2,
      destinationCountry: "NL",
      amounts: quote.amounts,
      status: "checkout_open",
      replayed: false,
    });
    expect(context.repository.reservations).toHaveLength(1);
    expect(context.repository.reservations[0]).toMatchObject({
      documentSha256: DOCUMENT_HASH,
      pdfSha256: PDF_HASH,
      termsAccepted: true,
      sellerSnapshot: seller,
      quoteReference: quote.quoteReference,
      commercialApprovalId: quote.commercialApprovalId,
      pii: {
        customerEmailCiphertext: "v1.1.email",
        shippingDetailsCiphertext: "v1.1.address",
      },
    });
    expect(context.protectedInputs).toEqual([{
      orderId: ORDER_ID,
      customerEmail: proof.customerEmail,
      shippingAddress: input.shippingAddress,
    }]);
    const {
      idempotencyKey: _idempotencyKey,
      expectedQuoteReference: _quoteReference,
      expectedQuoteExpiresAt: _quoteExpiry,
      ...semanticInput
    } = input;
    const rawCanonicalDigest = createHash("sha256")
      .update(canonicalJson({ actorId: ACTOR_ID, revisionId: REVISION_ID, input: semanticInput }))
      .digest("hex");
    expect(context.repository.reservations[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(context.repository.reservations[0]?.requestHash).not.toBe(rawCanonicalDigest);
    expect(context.repository.reservations[0]?.requestHash).not.toContain("mila");
    expect(context.checkoutCalls[0]).toMatchObject({
      orderId: ORDER_ID,
      currency: "EUR",
      lines: [
        { unitAmountMinor: 4_000, quantity: 2 },
        { unitAmountMinor: 800, quantity: 1 },
        { unitAmountMinor: 1_848, quantity: 1 },
      ],
      idempotencyKey: `buildy:checkout:${ORDER_ID}:v1`,
    });
    expect(context.checkoutCalls[0]?.lines[0]?.label).toBe("Persoonlijk Bouwboek");
    expect(JSON.stringify(context.checkoutCalls[0])).not.toContain(proof.projectTitle);
    expect(context.repository.sessions).toHaveLength(1);
  });

  it.each([
    {
      taxTreatment: "vat_included" as const,
      quoteReference: "quote-vat-included",
      unitAmountMinor: 3_306,
      amounts: {
        currency: "EUR" as const,
        subtotalMinor: 6_612,
        shippingMinor: 661,
        taxMinor: 1_527,
        totalMinor: 8_800,
      },
    },
    {
      taxTreatment: "vat_exclusive" as const,
      quoteReference: "quote-vat-exclusive",
      unitAmountMinor: 4_000,
      amounts: quote.amounts,
    },
    {
      taxTreatment: "vat_exempt" as const,
      quoteReference: "quote-vat-exempt",
      unitAmountMinor: 4_000,
      amounts: {
        currency: "EUR" as const,
        subtotalMinor: 8_000,
        shippingMinor: 800,
        taxMinor: 0,
        totalMinor: 8_800,
      },
    },
  ])("sends a $taxTreatment Stripe line sum equal to the exact order total", async (variant) => {
    const variantQuote: OrderQuote = { ...quote, ...variant };
    const context = dependencies({ quote: variantQuote });

    await context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      expectedQuoteReference: variantQuote.quoteReference,
      expectedAmounts: variantQuote.amounts,
    });

    const lines = context.checkoutCalls[0]?.lines ?? [];
    expect(lines.reduce(
      (total, line) => total + line.unitAmountMinor * line.quantity,
      0,
    )).toBe(variantQuote.amounts.totalMinor);
    expect(lines).toEqual([
      expect.objectContaining({ unitAmountMinor: variantQuote.unitAmountMinor, quantity: 2 }),
      expect.objectContaining({ unitAmountMinor: variantQuote.amounts.shippingMinor, quantity: 1 }),
      expect.objectContaining({ unitAmountMinor: variantQuote.amounts.taxMinor, quantity: 1 }),
    ]);
    if (variantQuote.taxTreatment === "vat_included") {
      expect(lines.map((line) => line.label)).toEqual([
        "Persoonlijk Bouwboek (excl. btw)",
        "Verzending (excl. btw)",
        "Btw (in totaal inbegrepen)",
      ]);
    }
  });

  it("replays the same reserved order and stable provider idempotency key", async () => {
    const context = dependencies();

    const first = await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    const second = await context.service.checkout(ACTOR_ID, REVISION_ID, input);

    expect(first.orderId).toBe(ORDER_ID);
    expect(second).toMatchObject({ orderId: ORDER_ID, replayed: true });
    expect(context.repository.reservations).toHaveLength(1);
    expect(context.quoteProvider.quote).toHaveBeenCalledTimes(1);
    expect(context.checkoutCalls).toHaveLength(2);
    expect(context.checkoutCalls[0].idempotencyKey).toBe(context.checkoutCalls[1].idempotencyKey);
  });

  it("reconstructs the pre-terms v1 request shape for an exact legacy retry", async () => {
    const context = dependencies();
    await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    const {
      expectedQuoteExpiresAt: _quoteExpiry,
      expectedAmounts,
      termsAccepted: _termsAccepted,
      ...v1Input
    } = input;
    const legacyHash = createHash("sha256")
      .update("buildy-photobook-checkout-request:v1\0")
      .update(canonicalJson({
        actorId: ACTOR_ID,
        revisionId: REVISION_ID,
        input: { ...v1Input, expectedTotalMinor: expectedAmounts.totalMinor },
      }))
      .digest("hex");
    context.repository.stored = {
      ...context.repository.stored!,
      requestHash: legacyHash,
      requestHashScheme: "legacy-v1",
    };

    const replay = await context.service.checkout(ACTOR_ID, REVISION_ID, input);

    expect(replay).toMatchObject({ orderId: ORDER_ID, replayed: true });
    expect(context.repository.reservations).toHaveLength(1);
    expect(context.quoteProvider.quote).toHaveBeenCalledTimes(1);
    expect(context.checkoutCalls).toHaveLength(2);
  });

  it("recovers the same semantic proof reservation with a renewed client UUID", async () => {
    const context = dependencies();

    await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    const recovered = await context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      idempotencyKey: RENEWED_COMMAND_ID,
      expectedQuoteReference: "fresh-transport-quote",
      expectedQuoteExpiresAt: "2026-08-04T12:29:00.000Z",
    });

    expect(recovered).toMatchObject({ orderId: ORDER_ID, replayed: true });
    expect(context.repository.reservations).toHaveLength(1);
    expect(context.quoteProvider.quote).toHaveBeenCalledTimes(1);
    expect(context.checkoutCalls).toHaveLength(2);
    expect(context.checkoutCalls[1]?.idempotencyKey).toBe(`buildy:checkout:${ORDER_ID}:v1`);
  });

  it("keeps a reused client key conflict-closed for a different semantic payload", async () => {
    const context = dependencies();

    await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      shippingAddress: { ...input.shippingAddress, addressLine1: "Andere straat 99" },
    })).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });

    expect(context.repository.reservations).toHaveLength(1);
    expect(context.checkoutCalls).toHaveLength(1);
  });

  it("retries the exact provider order after Stripe succeeds but session persistence times out", async () => {
    let now = new Date("2026-08-04T12:00:00.000Z");
    const context = dependencies({ clock: () => now });
    context.repository.recordCheckoutFailuresRemaining = 1;

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toThrow("database timeout");
    now = new Date("2026-08-04T12:28:00.000Z");
    const recovered = await context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      idempotencyKey: RENEWED_COMMAND_ID,
      expectedQuoteReference: "fresh-transport-quote",
      expectedQuoteExpiresAt: "2026-08-04T12:29:00.000Z",
    });

    expect(recovered).toMatchObject({ orderId: ORDER_ID, replayed: true });
    expect(context.repository.reservations).toHaveLength(1);
    expect(context.checkoutCalls).toHaveLength(2);
    expect(context.checkoutCalls[0]).toEqual(context.checkoutCalls[1]);
    expect(context.checkoutCalls[1]?.expiresAt).toBe("2026-08-04T13:05:00.000Z");
    expect(Date.parse(context.checkoutCalls[1]!.expiresAt) - now.getTime())
      .toBeGreaterThan(35 * 60_000);
    expect(context.repository.sessions).toHaveLength(1);
  });

  it("cancels an expired unopened reservation and creates a freshly quoted replacement", async () => {
    let now = new Date("2026-08-04T12:00:00.000Z");
    const context = dependencies({
      clock: () => now,
      orderIds: [ORDER_ID, RENEWED_COMMAND_ID],
    });
    context.repository.recordCheckoutFailuresRemaining = 1;
    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toThrow("database timeout");

    now = new Date("2026-08-04T12:31:00.000Z");
    const freshQuote = {
      ...quote,
      quoteReference: "quote-test-fresh",
      expiresAt: new Date("2026-08-04T13:00:00.000Z"),
    };
    vi.mocked(context.quoteProvider.quote).mockResolvedValue(freshQuote);
    const replacement = await context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      idempotencyKey: RENEWED_COMMAND_ID,
      expectedQuoteReference: freshQuote.quoteReference,
      expectedQuoteExpiresAt: "2026-08-04T13:00:00.000Z",
    });

    expect(replacement.orderId).toBe(RENEWED_COMMAND_ID);
    expect(context.repository.cancelledOrderIds).toEqual([ORDER_ID]);
    expect(context.repository.reservations).toHaveLength(2);
    expect(context.checkoutCalls.map((call) => call.orderId)).toEqual([
      ORDER_ID,
      RENEWED_COMMAND_ID,
    ]);
  });

  it("never replays an account-erasure-redacted request fingerprint", async () => {
    const context = dependencies();
    await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    context.repository.stored = {
      ...context.repository.stored!,
      status: "awaiting_payment",
      requestHash: null,
      requestHashScheme: "redacted",
    };

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "ORDER_STATE_CONFLICT" });
    expect(context.checkoutCalls).toHaveLength(1);
  });

  it("requires a renewed key but permits a fresh order after provider-confirmed payment failure", async () => {
    const context = dependencies({ orderIds: [ORDER_ID, RENEWED_COMMAND_ID] });
    await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    context.repository.stored = {
      ...context.repository.stored!,
      status: "payment_failed",
    };
    context.repository.checkoutSessionRecorded = false;

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "ORDER_STATE_CONFLICT" });
    const replacement = await context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      idempotencyKey: RENEWED_COMMAND_ID,
    });

    expect(replacement.orderId).toBe(RENEWED_COMMAND_ID);
    expect(context.repository.reservations).toHaveLength(2);
    expect(context.checkoutCalls.map((call) => call.orderId)).toEqual([
      ORDER_ID,
      RENEWED_COMMAND_ID,
    ]);
  });

  it("keeps a reconciliation review proof locked and unavailable for a new order", async () => {
    const context = dependencies({ orderIds: [ORDER_ID, RENEWED_COMMAND_ID] });
    await context.service.checkout(ACTOR_ID, REVISION_ID, input);
    context.repository.stored = {
      ...context.repository.stored!,
      status: "manual_review",
    };
    context.repository.proof = { ...proof, status: "locked" };

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      idempotencyKey: RENEWED_COMMAND_ID,
    })).rejects.toMatchObject({ reason: "PROOF_NOT_APPROVED" });
    expect(context.checkoutCalls).toHaveLength(1);
  });

  it("rejects stale proof bytes before pricing or payment", async () => {
    const context = dependencies();

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      pdfSha256: "c".repeat(64),
    })).rejects.toMatchObject({ reason: "PROOF_MISMATCH" });
    expect(context.quoteProvider.quote).not.toHaveBeenCalled();
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("fails closed when no approved destination price exists", async () => {
    const context = dependencies({ quote: null });

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "PRICE_UNAVAILABLE" });
    expect(context.repository.reservations).toHaveLength(0);
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("rejects inconsistent provider totals and expired quotes", async () => {
    const badTotal = dependencies({
      quote: { ...quote, amounts: { ...quote.amounts, totalMinor: quote.amounts.totalMinor + 1 } },
    });
    await expect(badTotal.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "PRICE_UNAVAILABLE" });

    const expired = dependencies({
      quote: { ...quote, expiresAt: new Date("2026-08-04T11:59:59.000Z") },
    });
    await expect(expired.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "QUOTE_EXPIRED" });
  });

  it("does not redirect when the confirmed quote changed", async () => {
    const context = dependencies({
      quote: { ...quote, quoteReference: "quote-test-2", amounts: { ...quote.amounts, totalMinor: 10_649, taxMinor: 1_849 } },
    });

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "QUOTE_EXPIRED" });
    expect(context.repository.reservations).toHaveLength(0);
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("rejects a client-modified amount breakdown or quote expiry", async () => {
    const changedBreakdown = dependencies();
    await expect(changedBreakdown.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      expectedAmounts: {
        ...input.expectedAmounts,
        subtotalMinor: 7_999,
        shippingMinor: 801,
      },
    })).rejects.toMatchObject({ reason: "QUOTE_EXPIRED" });
    expect(changedBreakdown.repository.reservations).toHaveLength(0);

    const extendedExpiry = dependencies();
    await expect(extendedExpiry.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      expectedQuoteExpiresAt: "2026-08-04T12:31:00.000Z",
    })).rejects.toMatchObject({ reason: "QUOTE_EXPIRED" });
    expect(extendedExpiry.repository.reservations).toHaveLength(0);

    const expiredInput = dependencies();
    await expect(expiredInput.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      expectedQuoteExpiresAt: "2026-08-04T11:59:59.000Z",
    })).rejects.toMatchObject({ reason: "QUOTE_EXPIRED" });
    expect(expiredInput.quoteProvider.quote).not.toHaveBeenCalled();
  });

  it("requires the exact current terms version", async () => {
    const context = dependencies();

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      termsVersion: "older",
    })).rejects.toMatchObject({ reason: "TERMS_MISMATCH" });
    expect(context.repository.proof).toBe(proof);
    expect(context.quoteProvider.quote).not.toHaveBeenCalled();
  });

  it.each([
    ["omitted", undefined],
    ["false", false],
  ])("rejects checkout when termsAccepted is %s", async (_label, acceptance) => {
    const context = dependencies();
    const request = { ...input } as Record<string, unknown>;
    if (acceptance === undefined) delete request.termsAccepted;
    else request.termsAccepted = acceptance;

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, request))
      .rejects.toMatchObject({ name: "ZodError" });
    expect(context.repository.reservations).toHaveLength(0);
    expect(context.quoteProvider.quote).not.toHaveBeenCalled();
    expect(context.payments.createCheckout).not.toHaveBeenCalled();
  });

  it("maps Stripe outages to a retry-safe checkout error after reservation", async () => {
    const context = dependencies({
      paymentError: new PaymentProviderError("PROVIDER_UNAVAILABLE", "offline", true),
    });

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, input))
      .rejects.toMatchObject({ reason: "CHECKOUT_UNAVAILABLE" });
    expect(context.repository.reservations).toHaveLength(1);
    expect(context.repository.sessions).toHaveLength(0);
  });
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { PhotobookOrderDetail } from "../../shared/contracts/orders";
import {
  PaymentProviderError,
  type CreateCheckoutInput,
  type PaymentProvider,
} from "../../server/payments/paymentProvider";
import { OrderError } from "../../server/orders/errors";
import { OrderService } from "../../server/orders/service";
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
const DOCUMENT_HASH = "a".repeat(64);
const PDF_HASH = "b".repeat(64);

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
  expectedTotalMinor: 10_648,
  termsVersion: "2026-08-01",
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
  offeringId: "offering-test-a4-landscape-hardcover",
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

class MemoryOrderRepository implements OrderRepository {
  readonly reservations: ReserveCheckoutCommand[] = [];
  readonly sessions: RecordCheckoutSessionCommand[] = [];
  stored: CheckoutReservation | null = null;
  proof: CheckoutProofContext | null = proof;

  async findCheckoutReservation(actorId: string, idempotencyKey: string, requestHash: string) {
    if (!this.stored || this.stored.actorId !== actorId || this.stored.idempotencyKey !== idempotencyKey) {
      return null;
    }
    if (this.stored.requestHash !== requestHash) throw new OrderError("IDEMPOTENCY_CONFLICT");
    return { ...this.stored, replayed: true };
  }

  async loadCheckoutProof() {
    return this.proof;
  }

  async reserveCheckout(command: ReserveCheckoutCommand) {
    this.reservations.push(command);
    this.stored = { ...command, replayed: false };
    return this.stored;
  }

  async recordCheckoutSession(command: RecordCheckoutSessionCommand) {
    this.sessions.push(command);
  }

  async getOrder(): Promise<PhotobookOrderDetail | null> {
    return null;
  }
}

function dependencies(options?: {
  checkoutEnabled?: boolean;
  quote?: OrderQuote | null;
  paymentError?: Error;
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
      return {
        provider: "stripe" as const,
        sessionId: "cs_test_buildy",
        url: "https://checkout.stripe.com/c/pay/cs_test_buildy",
        expiresAt: "2026-08-04T12:20:00.000Z",
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
    seller,
    "https://app.buildy.test",
    "2026-08-01",
    options?.checkoutEnabled ?? true,
    () => new Date("2026-08-04T12:00:00.000Z"),
    () => ORDER_ID,
  );
  return { repository, quoteProvider, payments, checkoutCalls, protectedInputs, service };
}

describe("OrderService", () => {
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
    expect(context.checkoutCalls[0]).toMatchObject({
      orderId: ORDER_ID,
      currency: "EUR",
      allowedShippingCountries: ["NL"],
      lines: [
        { unitAmountMinor: 4_000, quantity: 2 },
        { unitAmountMinor: 800, quantity: 1 },
        { unitAmountMinor: 1_848, quantity: 1 },
      ],
      idempotencyKey: `buildy:checkout:${ORDER_ID}:v1`,
    });
    expect(context.repository.sessions).toHaveLength(1);
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

  it("requires the exact current terms version", async () => {
    const context = dependencies();

    await expect(context.service.checkout(ACTOR_ID, REVISION_ID, {
      ...input,
      termsVersion: "older",
    })).rejects.toMatchObject({ reason: "TERMS_MISMATCH" });
    expect(context.repository.proof).toBe(proof);
    expect(context.quoteProvider.quote).not.toHaveBeenCalled();
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

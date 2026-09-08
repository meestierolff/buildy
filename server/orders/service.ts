import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createPhotobookCheckoutInputSchema,
  customerOrderListQuerySchema,
  requestPhotobookQuoteInputSchema,
  type CreatePhotobookCheckoutInput,
} from "../../shared/contracts/orders.js";
import { canonicalJson } from "../security/canonicalJson.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import { PaymentProviderError, type PaymentProvider } from "../payments/paymentProvider.js";
import { OrderError } from "./errors.js";
import { decodeCustomerOrderCursor, encodeCustomerOrderCursor } from "./cursor.js";
import {
  approvedSellerConfigurationIsCurrent,
  type ApprovedSellerConfiguration,
} from "./checkoutConfiguration.js";
import type {
  OrderClock,
  OrderIdFactory,
  OrderPiiProtector,
  OrderQuote,
  OrderQuoteProvider,
  OrderRepository,
  SellerSnapshot,
} from "./types.js";

const SHA256 = /^[0-9a-f]{64}$/;
const COUNTRY = /^[A-Z]{2}$/;
const PRODUCT_REFERENCE = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_QUOTE_TTL_MILLISECONDS = 30 * 60_000;
const CHECKOUT_AFTER_QUOTE_MILLISECONDS = 35 * 60_000;

function scopedIdempotencyKey(actorId: string, clientKey: string): string {
  return createHash("sha256")
    .update("buildy-photobook-checkout:v1\0")
    .update(actorId)
    .update("\0")
    .update(clientKey)
    .digest("hex");
}

function legacyRequestHash(
  actorId: string,
  revisionId: string,
  input: CreatePhotobookCheckoutInput,
  scheme: "legacy-v1" | "legacy-v2",
): string {
  const legacyInput = (() => {
    if (scheme === "legacy-v2") return input;
    const {
      expectedQuoteExpiresAt: _quoteExpiry,
      expectedAmounts,
      termsAccepted: _termsAccepted,
      ...v1Input
    } = input;
    return { ...v1Input, expectedTotalMinor: expectedAmounts.totalMinor };
  })();
  return createHash("sha256")
    .update("buildy-photobook-checkout-request:v1\0")
    .update(canonicalJson({ actorId, revisionId, input: legacyInput }))
    .digest("hex");
}

function semanticRequestHash(
  blindIndex: PrivacyBlindIndex,
  actorId: string,
  revisionId: string,
  input: CreatePhotobookCheckoutInput,
): string {
  const {
    idempotencyKey: _transportKey,
    expectedQuoteReference: _quoteReference,
    expectedQuoteExpiresAt: _quoteExpiry,
    ...purchaseRequest
  } = input;
  // Quote reference/expiry are freshness proofs, not purchase semantics. The
  // immutable reservation's original expiry remains authoritative on replay.
  return blindIndex.create(
    "orders.photobook-checkout-request-v2",
    canonicalJson({ actorId, revisionId, input: purchaseRequest }),
  );
}

function orderNumber(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `BLD-${date}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function assertQuote(quote: OrderQuote, now: Date): void {
  const amounts = quote.amounts;
  if (
    quote.sku !== "a4-landscape-hardcover-v1"
    || quote.pageCount < 24
    || quote.pageCount > 400
    || quote.pageCount % 2 !== 0
    || quote.quantity < 1
    || quote.quantity > 5
    || !COUNTRY.test(quote.destinationCountry)
    || !PRODUCT_REFERENCE.test(quote.productReference)
    || !quote.quoteReference.trim()
    || !quote.commercialApprovalId.trim()
    || !quote.deliveryEstimate.trim()
    || amounts.currency !== "EUR"
    || ![quote.unitAmountMinor, amounts.subtotalMinor, amounts.shippingMinor, amounts.taxMinor, amounts.totalMinor]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
    || amounts.subtotalMinor !== quote.unitAmountMinor * quote.quantity
    || amounts.totalMinor !== amounts.subtotalMinor + amounts.shippingMinor + amounts.taxMinor
  ) throw new OrderError("PRICE_UNAVAILABLE");
  if (quote.expiresAt.getTime() <= now.getTime()) throw new OrderError("QUOTE_EXPIRED");
  if (quote.expiresAt.getTime() > now.getTime() + MAX_QUOTE_TTL_MILLISECONDS) {
    throw new OrderError("PRICE_UNAVAILABLE");
  }
}

function amountsMatch(left: OrderQuote["amounts"], right: OrderQuote["amounts"]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export interface PhotobookCheckoutResult {
  orderId: string;
  orderNumber: string;
  projectId: string;
  proofRevisionId: string;
  sku: "a4-landscape-hardcover-v1";
  format: "a4-landscape-hardcover-v1";
  pageCount: number;
  quantity: number;
  destinationCountry: string;
  amounts: OrderQuote["amounts"];
  deliveryEstimate: string;
  termsVersion: string;
  checkoutUrl: string;
  checkoutExpiresAt: string;
  status: "checkout_open";
  replayed: boolean;
}

export interface PhotobookQuoteResult {
  proofRevisionId: string;
  sku: "a4-landscape-hardcover-v1";
  format: "a4-landscape-hardcover-v1";
  pageCount: number;
  quantity: number;
  destinationCountry: string;
  quoteReference: string;
  amounts: OrderQuote["amounts"];
  deliveryEstimate: string;
  taxTreatment: OrderQuote["taxTreatment"];
  expiresAt: string;
  termsVersion: string;
  seller: SellerSnapshot;
  personalisedProduct: true;
}

export class OrderService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly quotes: OrderQuoteProvider,
    private readonly payments: PaymentProvider,
    private readonly pii: OrderPiiProtector,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly sellerConfiguration: ApprovedSellerConfiguration,
    private readonly appOrigin: string,
    private readonly termsVersion: string,
    private readonly checkoutEnabled: boolean,
    private readonly clock: OrderClock = () => new Date(),
    private readonly createId: OrderIdFactory = randomUUID,
  ) {}

  private currentSeller(): SellerSnapshot {
    if (!approvedSellerConfigurationIsCurrent(this.sellerConfiguration, this.clock())) {
      throw new OrderError("PRICE_UNAVAILABLE");
    }
    return this.sellerConfiguration.seller;
  }

  private async approvedProof(actorId: string, revisionId: string, input: {
    documentSha256: string;
    pdfSha256: string;
  }) {
    const proof = await this.repository.loadCheckoutProof(actorId, revisionId);
    if (!proof) throw new OrderError("ORDER_NOT_FOUND");
    if (proof.status !== "approved") throw new OrderError("PROOF_NOT_APPROVED");
    if (
      proof.documentSha256 !== input.documentSha256
      || proof.pdfSha256 !== input.pdfSha256
      || !SHA256.test(proof.documentSha256)
      || !SHA256.test(proof.pdfSha256)
      || proof.format !== "a4-landscape-hardcover-v1"
      || proof.pageCount < 24
      || proof.pageCount > 400
      || proof.pageCount % 2 !== 0
    ) throw new OrderError("PROOF_MISMATCH");
    return proof;
  }

  private async currentQuote(proof: Awaited<ReturnType<OrderService["approvedProof"]>>, input: {
    quantity: number;
    shippingAddress: Parameters<OrderQuoteProvider["quote"]>[0]["shippingAddress"];
    quoteExpiresAt?: Date;
  }): Promise<OrderQuote> {
    const now = this.clock();
    const quote = await this.quotes.quote({
      sku: proof.format,
      pageCount: proof.pageCount,
      quantity: input.quantity,
      shippingAddress: input.shippingAddress,
      ...(input.quoteExpiresAt ? { quoteExpiresAt: input.quoteExpiresAt } : {}),
    });
    if (!quote) throw new OrderError("PRICE_UNAVAILABLE");
    assertQuote(quote, now);
    if (
      quote.sku !== proof.format
      || quote.pageCount !== proof.pageCount
      || quote.quantity !== input.quantity
      || quote.destinationCountry !== input.shippingAddress.countryCode
    ) throw new OrderError("PRICE_UNAVAILABLE");
    return quote;
  }

  async quote(actorId: string, revisionId: string, rawInput: unknown): Promise<PhotobookQuoteResult> {
    if (!this.checkoutEnabled) throw new OrderError("CHECKOUT_UNAVAILABLE");
    const seller = this.currentSeller();
    const input = requestPhotobookQuoteInputSchema.parse(rawInput);
    const proof = await this.approvedProof(actorId, revisionId, input);
    const quote = await this.currentQuote(proof, input);
    return {
      proofRevisionId: proof.revisionId,
      sku: proof.format,
      format: proof.format,
      pageCount: proof.pageCount,
      quantity: quote.quantity,
      destinationCountry: quote.destinationCountry,
      quoteReference: quote.quoteReference,
      amounts: quote.amounts,
      deliveryEstimate: quote.deliveryEstimate,
      taxTreatment: quote.taxTreatment,
      expiresAt: quote.expiresAt.toISOString(),
      termsVersion: this.termsVersion,
      seller,
      personalisedProduct: true,
    };
  }

  async checkout(
    actorId: string,
    revisionId: string,
    rawInput: unknown,
  ): Promise<PhotobookCheckoutResult> {
    if (!this.checkoutEnabled) throw new OrderError("CHECKOUT_UNAVAILABLE");
    const seller = this.currentSeller();
    const input = createPhotobookCheckoutInputSchema.parse(rawInput);
    if (input.termsVersion !== this.termsVersion) throw new OrderError("TERMS_MISMATCH");

    const idempotencyKey = scopedIdempotencyKey(actorId, input.idempotencyKey);
    const hash = semanticRequestHash(this.blindIndex, actorId, revisionId, input);
    let reservation = await this.repository.findCheckoutReservation(
      actorId,
      revisionId,
      idempotencyKey,
    );
    if (reservation && !["awaiting_payment", "checkout_open"].includes(reservation.status)) {
      throw new OrderError("ORDER_STATE_CONFLICT");
    }
    if (reservation && reservation.quoteExpiresAt.getTime() <= this.clock().getTime()) {
      const cancelled = await this.repository.cancelExpiredCheckoutReservation({
        actorId,
        orderId: reservation.orderId,
        now: this.clock(),
      });
      if (!cancelled || reservation.idempotencyKey === idempotencyKey) {
        throw new OrderError("QUOTE_EXPIRED");
      }
      reservation = null;
    }
    if (reservation) {
      if (reservation.requestHashScheme === "redacted" || reservation.requestHash === null) {
        throw new OrderError("ORDER_STATE_CONFLICT");
      }
      const matchingRequest = reservation.requestHashScheme === "blind-v2"
        ? reservation.requestHash === hash
        : reservation.requestHash === legacyRequestHash(
            actorId,
            revisionId,
            input,
            reservation.requestHashScheme,
          );
      if (!matchingRequest) throw new OrderError("IDEMPOTENCY_CONFLICT");
    }

    if (!reservation) {
      const proof = await this.approvedProof(actorId, revisionId, input);
      const now = this.clock();
      const expectedQuoteExpiresAt = new Date(input.expectedQuoteExpiresAt);
      if (expectedQuoteExpiresAt.getTime() <= now.getTime()) throw new OrderError("QUOTE_EXPIRED");
      const quote = await this.currentQuote(proof, { ...input, quoteExpiresAt: expectedQuoteExpiresAt });
      if (
        quote.quoteReference !== input.expectedQuoteReference
        || !amountsMatch(quote.amounts, input.expectedAmounts)
        || expectedQuoteExpiresAt.getTime() !== quote.expiresAt.getTime()
      ) throw new OrderError("QUOTE_EXPIRED");

      const orderId = this.createId();
      reservation = await this.repository.reserveCheckout({
        orderId,
        orderNumber: orderNumber(now),
        merchantReference: `buildy:${orderId}`,
        actorId,
        projectId: proof.projectId,
        projectTitle: proof.projectTitle,
        proofRevisionId: proof.revisionId,
        documentSha256: proof.documentSha256,
        pdfSha256: proof.pdfSha256,
        sku: proof.format,
        format: proof.format,
        pageCount: proof.pageCount,
        quantity: input.quantity,
        destinationCountry: input.shippingAddress.countryCode,
        unitAmountMinor: quote.unitAmountMinor,
        amounts: quote.amounts,
        deliveryEstimate: quote.deliveryEstimate,
        termsVersion: this.termsVersion,
        termsAccepted: input.termsAccepted,
        customerEmail: proof.customerEmail,
        requestHash: hash,
        idempotencyKey,
        quoteReference: quote.quoteReference,
        productReference: quote.productReference,
        priceVersion: quote.commercialApprovalId,
        commercialApprovalId: quote.commercialApprovalId,
        taxTreatment: quote.taxTreatment,
        sellerSnapshot: seller,
        shippingAddress: input.shippingAddress,
        pii: this.pii.protect({
          orderId,
          customerEmail: proof.customerEmail,
          shippingAddress: input.shippingAddress,
        }),
        reservedAt: now,
        quoteExpiresAt: expectedQuoteExpiresAt,
      });
    }

    let session;
    try {
      const inclusiveVat = reservation.taxTreatment === "vat_included";
      const lines = [
        {
          label: inclusiveVat ? "Persoonlijk Bouwboek (excl. btw)" : "Persoonlijk Bouwboek",
          description: `A4 liggend hardcover, ${reservation.pageCount} pagina's; na betaling handmatig gecontroleerd en besteld`,
          unitAmountMinor: reservation.unitAmountMinor,
          quantity: reservation.quantity,
        },
        {
          label: inclusiveVat ? "Verzending (excl. btw)" : "Verzending",
          unitAmountMinor: reservation.amounts.shippingMinor,
          quantity: 1,
        },
        {
          label: inclusiveVat ? "Btw (in totaal inbegrepen)" : "Belasting",
          unitAmountMinor: reservation.amounts.taxMinor,
          quantity: 1,
        },
      ];
      const stripeTotalMinor = lines.reduce(
        (total, line) => total + line.unitAmountMinor * line.quantity,
        0,
      );
      if (!Number.isSafeInteger(stripeTotalMinor) || stripeTotalMinor !== reservation.amounts.totalMinor) {
        throw new OrderError("PRICE_UNAVAILABLE");
      }
      session = await this.payments.createCheckout({
        orderId: reservation.orderId,
        orderNumber: reservation.orderNumber,
        merchantReference: reservation.merchantReference,
        currency: "EUR",
        lines,
        customerEmail: reservation.customerEmail,
        successUrl: new URL(`/bestellingen/${reservation.orderId}?checkout=success`, this.appOrigin).toString(),
        cancelUrl: new URL(`/project/${reservation.projectId}/bouwboek?checkout=cancelled`, this.appOrigin).toString(),
        idempotencyKey: `buildy:checkout:${reservation.orderId}:v1`,
        // The persisted quote deadline never changes on replay. Starting from
        // it also leaves Stripe's 30-minute minimum plus transport margin on
        // any first attempt that still has a valid quote.
        expiresAt: new Date(
          reservation.quoteExpiresAt.getTime() + CHECKOUT_AFTER_QUOTE_MILLISECONDS,
        ).toISOString(),
      });
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new OrderError("CHECKOUT_UNAVAILABLE", { cause: error });
      }
      throw error;
    }

    await this.repository.recordCheckoutSession({
      actorId,
      orderId: reservation.orderId,
      sessionId: session.sessionId,
      expiresAt: new Date(session.expiresAt),
      now: this.clock(),
    });

    return {
      orderId: reservation.orderId,
      orderNumber: reservation.orderNumber,
      projectId: reservation.projectId,
      proofRevisionId: reservation.proofRevisionId,
      sku: reservation.sku,
      format: reservation.format,
      pageCount: reservation.pageCount,
      quantity: reservation.quantity,
      destinationCountry: reservation.destinationCountry,
      amounts: reservation.amounts,
      deliveryEstimate: reservation.deliveryEstimate,
      termsVersion: reservation.termsVersion,
      checkoutUrl: session.url,
      checkoutExpiresAt: session.expiresAt,
      status: "checkout_open",
      replayed: reservation.replayed,
    };
  }

  async order(actorId: string, orderId: string) {
    const order = await this.repository.getOrder(actorId, orderId);
    if (!order) throw new OrderError("ORDER_NOT_FOUND");
    return order;
  }

  async orders(actorId: string, rawQuery: unknown) {
    const query = customerOrderListQuerySchema.parse(rawQuery);
    const result = await this.repository.listOrders(
      actorId,
      decodeCustomerOrderCursor(query.cursor),
      query.limit,
    );
    const last = result.items.at(-1);
    return {
      items: result.items,
      nextCursor: result.hasMore && last
        ? encodeCustomerOrderCursor({
            kind: "customer-orders",
            version: 1,
            createdAt: last.createdAt,
            orderId: last.orderId,
          })
        : null,
    };
  }
}

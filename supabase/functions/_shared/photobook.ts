export const PEECHO_MIN_PAGES = 24;
export const PEECHO_MAX_PAGES = 400;

export const PEECHO_FORMATS = {
  A4_LANDSCAPE: { widthMm: 297, heightMm: 210 },
  A4_PORTRAIT: { widthMm: 210, heightMm: 297 },
  SQUARE_210: { widthMm: 210, heightMm: 210 },
} as const;

export type PeechoFormat = keyof typeof PEECHO_FORMATS;

export interface PhotobookCheckoutQuote {
  baseCents: number;
  pageCents: number;
  shippingCents: number;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  vatIncluded: boolean;
  shippingCountries: string[];
  deliveryEstimate: string;
  termsVersion: string;
  seller: {
    legalName: string;
    contactEmail: string;
    contactPhone: string;
    postalAddress: string;
    registrationNumber: string;
  };
}

export const buildPhotobookCheckoutSnapshot = ({
  quote,
  format,
  pageCount,
  acceptedAt,
}: {
  quote: PhotobookCheckoutQuote;
  format: PeechoFormat;
  pageCount: number;
  acceptedAt: string;
}) => ({
  product: "Buildy Bouwboek hardcover",
  format,
  page_count: pageCount,
  base_cents: quote.baseCents,
  page_price_cents: quote.pageCents,
  subtotal_cents: quote.subtotalCents,
  shipping_cents: quote.shippingCents,
  total_cents: quote.totalCents,
  currency: quote.currency,
  vat_included: quote.vatIncluded,
  shipping_countries: quote.shippingCountries,
  delivery_estimate: quote.deliveryEstimate,
  seller: quote.seller,
  terms_version: quote.termsVersion,
  customized_product_no_withdrawal: true,
  accepted_at: acceptedAt,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * An idempotent retry may only reuse an unpaid order while its exact commercial
 * terms still equal the current server quote. Otherwise the customer must see
 * and accept a fresh checkout instead of silently paying stale terms.
 */
export const photobookOrderMatchesQuote = (
  order: Record<string, unknown>,
  quote: PhotobookCheckoutQuote,
) => {
  if (
    order.payment_subtotal_cents !== quote.subtotalCents
    || order.payment_shipping_cents !== quote.shippingCents
    || order.payment_amount_cents !== quote.totalCents
    || String(order.payment_currency || "").toLowerCase() !== quote.currency.toLowerCase()
    || order.terms_version !== quote.termsVersion
  ) return false;

  if (!isRecord(order.checkout_snapshot)) return false;
  const snapshot = order.checkout_snapshot;
  const seller = isRecord(snapshot.seller) ? snapshot.seller : {};
  return snapshot.base_cents === quote.baseCents
    && snapshot.page_price_cents === quote.pageCents
    && snapshot.subtotal_cents === quote.subtotalCents
    && snapshot.shipping_cents === quote.shippingCents
    && snapshot.total_cents === quote.totalCents
    && snapshot.currency === quote.currency
    && snapshot.vat_included === quote.vatIncluded
    && snapshot.delivery_estimate === quote.deliveryEstimate
    && JSON.stringify(snapshot.shipping_countries) === JSON.stringify(quote.shippingCountries)
    && snapshot.terms_version === quote.termsVersion
    && seller.legalName === quote.seller.legalName
    && seller.contactEmail === quote.seller.contactEmail
    && seller.contactPhone === quote.seller.contactPhone
    && seller.postalAddress === quote.seller.postalAddress
    && seller.registrationNumber === quote.seller.registrationNumber;
};

export const isPeechoFormat = (value: unknown): value is PeechoFormat =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(PEECHO_FORMATS, value);

export const isValidPeechoPageCount = (value: unknown): value is number =>
  typeof value === "number"
  && Number.isInteger(value)
  && value >= PEECHO_MIN_PAGES
  && value <= PEECHO_MAX_PAGES
  && value % 2 === 0;

export const getPeechoPaymentUrl = (orderUrl: string) => {
  const parsed = new URL(orderUrl);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/payment`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

export const getPeechoDetailsUrl = (
  orderUrl: string,
  merchantApiKey: string,
  lookup: { orderId?: string; orderReference?: string },
) => {
  const parsed = new URL(orderUrl);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/details`;
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("merchantApiKey", merchantApiKey);
  if (lookup.orderId) parsed.searchParams.set("orderId", lookup.orderId);
  if (lookup.orderReference) parsed.searchParams.set("orderReference", lookup.orderReference);
  return parsed.toString();
};

export const assertTrustedPeechoUrl = (value: string) => {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (hostname !== "peecho.com" && !hostname.endsWith(".peecho.com"))
  ) {
    throw new Error("Peecho API URL must be an HTTPS peecho.com endpoint");
  }
  return parsed.toString();
};

export const toPeechoCountryCode = (value: unknown) => {
  const code = String(value || "").trim().toUpperCase();
  // Peecho v3 AddressDetails explicitly requires ISO Code 2 (e.g. US, NL),
  // which is the same format Stripe Checkout returns.
  if (!/^[A-Z]{2}$/.test(code)) throw new Error("Stripe leverde geen geldige ISO-landcode aan");
  return code;
};

const textEncoder = new TextEncoder();

export const sha256Hex = async (value: string) => {
  const buffer = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

type Fetcher = typeof fetch;

const readJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
};

const getPeechoId = (body: Record<string, unknown>) => {
  const value = body.order_id ?? body.orderId ?? body.id;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
};

export interface PeechoCreateAndPayArgs {
  orderUrl: string;
  paymentUrl?: string;
  merchantApiKey: string;
  secretKey: string;
  createPayload: Record<string, unknown>;
  existingPeechoId?: string | null;
  fetcher?: Fetcher;
  onOrderCreated?: (peechoId: string, response: Record<string, unknown>) => Promise<void> | void;
}

/**
 * Peecho Direct API is deliberately a two-step flow: creating an order leaves
 * it OPEN, then /order/payment submits it to production. Persist the Peecho ID
 * through onOrderCreated before payment so a retry never creates a second book.
 */
export const createAndPayPeechoOrder = async ({
  orderUrl,
  paymentUrl = getPeechoPaymentUrl(orderUrl),
  merchantApiKey,
  secretKey,
  createPayload,
  existingPeechoId,
  fetcher = fetch,
  onOrderCreated,
}: PeechoCreateAndPayArgs) => {
  let peechoId = existingPeechoId || null;
  let createResponse: Record<string, unknown> | null = null;
  let reconciledOrderState: string | null = null;

  if (!peechoId) {
    const response = await fetcher(orderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });
    createResponse = await readJsonResponse(response);
    if (!response.ok) {
      const createErrorBody = JSON.stringify(createResponse).toUpperCase();
      if (!createErrorBody.includes("ORD_DUPLICATE")) {
        const detail = createResponse.details || createResponse.error || `HTTP ${response.status}`;
        throw new Error(`Peecho order aanmaken mislukt: ${String(detail)}`);
      }

      const expectedReference = typeof createPayload.order_reference === "string"
        ? createPayload.order_reference
        : "";
      if (!expectedReference) throw new Error("Peecho duplicate kon niet aan een orderreferentie worden gekoppeld");
      const detailsResponse = await fetcher(
        getPeechoDetailsUrl(orderUrl, merchantApiKey, { orderReference: expectedReference }),
        { method: "GET" },
      );
      const detailsBody = await readJsonResponse(detailsResponse);
      if (!detailsResponse.ok) throw new Error("Bestaande Peecho-order kon niet worden opgehaald");
      const returnedReference = detailsBody.merchant_order_reference ?? detailsBody.order_reference;
      if (String(returnedReference || "") !== expectedReference) {
        throw new Error("Bestaande Peecho-order hoort niet bij deze orderreferentie");
      }
      peechoId = getPeechoId(detailsBody);
      if (!peechoId) throw new Error("Bestaande Peecho-order heeft geen order-id");
      reconciledOrderState = String(detailsBody.order_state || detailsBody.status || "").toUpperCase();
      createResponse = { ...detailsBody, reconciled_duplicate: true };
    }

    peechoId = peechoId || getPeechoId(createResponse);
    if (!peechoId) throw new Error("Peecho gaf geen order-id terug");
    await onOrderCreated?.(peechoId, createResponse);
  }

  const acceptedPostPaymentStates = new Set([
    "PAID",
    "WAITING_TO_DISPATCH",
    "SUBMITTED",
    "IN_PRINT_QUEUE",
    "IN_PRODUCTION",
    "REPROCESSING",
    "MODERATION",
    "CHECK_ORDER",
    "HOLD_ORDER_CHECK",
    "SHIPPED",
  ]);
  if (reconciledOrderState && acceptedPostPaymentStates.has(reconciledOrderState)) {
    return {
      peechoId,
      orderState: reconciledOrderState,
      createResponse,
      paymentResponse: createResponse,
    };
  }

  const paymentSecret = await sha256Hex(`${secretKey}${peechoId}`);
  const paymentResponse = await fetcher(paymentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: /^\d+$/.test(peechoId) ? Number(peechoId) : peechoId,
      merchant_api_key: merchantApiKey,
      secret: paymentSecret,
    }),
  });
  const paymentBody = await readJsonResponse(paymentResponse);
  const paymentErrorBody = JSON.stringify(paymentBody).toUpperCase();
  const alreadyPaid = paymentErrorBody.includes("ORD_PAID_STATE");
  if (!paymentResponse.ok && !alreadyPaid) {
    const detail = paymentBody.details || paymentBody.error || `HTTP ${paymentResponse.status}`;
    throw new Error(`Peecho betaling indienen mislukt: ${String(detail)}`);
  }

  let reconciledPaymentBody = paymentBody;
  if (alreadyPaid) {
    // Peecho explicitly recommends checking the status endpoint for
    // ORD_PAID_STATE. Bind both provider id and merchant reference before
    // accepting it as proof that this exact order entered production.
    const expectedReference = typeof createPayload.order_reference === "string"
      ? createPayload.order_reference
      : "";
    if (!expectedReference) throw new Error("Peecho betaalstatus kon niet veilig worden gekoppeld");
    const detailsResponse = await fetcher(
      getPeechoDetailsUrl(orderUrl, merchantApiKey, {
        orderId: peechoId,
        orderReference: expectedReference,
      }),
      { method: "GET" },
    );
    const detailsBody = await readJsonResponse(detailsResponse);
    if (!detailsResponse.ok) throw new Error("Peecho betaalstatus kon niet worden opgehaald");
    const detailsId = getPeechoId(detailsBody);
    const detailsReference = detailsBody.merchant_order_reference ?? detailsBody.order_reference;
    if (detailsId !== peechoId || String(detailsReference || "") !== expectedReference) {
      throw new Error("Peecho betaalstatus hoort niet bij deze bestelling");
    }
    reconciledPaymentBody = detailsBody;
  }

  const orderState = String(
    reconciledPaymentBody.order_state || reconciledPaymentBody.status || "PAID",
  ).toUpperCase();
  if (!acceptedPostPaymentStates.has(orderState)) {
    throw new Error(`Peecho bevestigde de productiebetaling niet (status ${orderState})`);
  }

  return { peechoId, orderState, createResponse, paymentResponse: reconciledPaymentBody };
};

export const normalizePeechoStatus = (rawStatus: unknown) => {
  const raw = String(rawStatus || "").trim().toUpperCase();
  const mapping: Record<string, { status: string; fulfillmentStatus: string }> = {
    OPEN: { status: "peecho_open", fulfillmentStatus: "awaiting_peecho_payment" },
    PAID: { status: "submitted_to_peecho", fulfillmentStatus: "submitted" },
    SUBMITTED: { status: "submitted_to_peecho", fulfillmentStatus: "submitted" },
    WAITING_TO_DISPATCH: { status: "submitted_to_peecho", fulfillmentStatus: "submitted" },
    IN_PRINT_QUEUE: { status: "in_production", fulfillmentStatus: "in_production" },
    IN_PRODUCTION: { status: "in_production", fulfillmentStatus: "in_production" },
    REPROCESSING: { status: "in_production", fulfillmentStatus: "in_production" },
    MODERATION: { status: "peecho_review", fulfillmentStatus: "review" },
    CHECK_ORDER: { status: "peecho_review", fulfillmentStatus: "review" },
    HOLD_ORDER_CHECK: { status: "peecho_review", fulfillmentStatus: "review" },
    SHIPPED: { status: "shipped", fulfillmentStatus: "shipped" },
    DELIVERED: { status: "delivered", fulfillmentStatus: "delivered" },
    CANCELLED: { status: "cancelled", fulfillmentStatus: "cancelled" },
    REFUNDED: { status: "refunded", fulfillmentStatus: "cancelled" },
    PAYMENT_ERROR: { status: "peecho_payment_failed", fulfillmentStatus: "failed" },
    NO_PRINT_FACILITY_ERROR: { status: "peecho_failed", fulfillmentStatus: "failed" },
    SUBMISSION_ERROR: { status: "peecho_failed", fulfillmentStatus: "failed" },
    PRODUCTION_ERROR: { status: "peecho_failed", fulfillmentStatus: "failed" },
    ERROR: { status: "peecho_failed", fulfillmentStatus: "failed" },
  };

  return mapping[raw] || {
    status: "peecho_review",
    fulfillmentStatus: "review",
  };
};

export const PHOTOBOOK_STATUS_RANK: Record<string, number> = {
  pdf_ready: 5,
  payment_pending: 5,
  paid: 10,
  paid_pending_fulfillment: 25,
  peecho_open: 20,
  submitted_to_peecho: 30,
  in_production: 50,
  peecho_review: 55,
  peecho_payment_failed: 58,
  peecho_failed: 58,
  shipped: 60,
  delivered: 70,
  refund_review: 90,
  cancelled: 100,
  refunded: 100,
};

export const canAdvancePhotobookStatus = (currentStatus: unknown, nextStatus: unknown) =>
  (PHOTOBOOK_STATUS_RANK[String(nextStatus || "")] || 0)
  >= (PHOTOBOOK_STATUS_RANK[String(currentStatus || "")] || 0);

export const canAdvanceRefundFulfillment = (currentStatus: unknown, nextStatus: unknown) => {
  const current = String(currentStatus || "");
  const next = String(nextStatus || "");
  if (current === "shipped") return next === "delivered";
  if (["delivered", "cancelled"].includes(current)) return false;
  return ["shipped", "delivered", "cancelled"].includes(next);
};

export const isPhotobookOrderTerminalForDeletion = (order: {
  payment_status?: unknown;
  fulfillment_status?: unknown;
  status?: unknown;
}) => ["cancelled", "expired", "failed"].includes(String(order.payment_status || ""))
  || ["shipped", "delivered", "cancelled"].includes(String(order.fulfillment_status || ""))
  || [
    "shipped",
    "delivered",
    "cancelled",
    "payment_cancelled",
    "payment_expired",
    "payment_failed",
  ].includes(String(order.status || ""));

export const STRIPE_PHOTOBOOK_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
]);

export const classifyStripeRefund = ({
  amountRefunded,
  expectedTotal,
  chargeFullyRefunded,
}: {
  amountRefunded: unknown;
  expectedTotal: unknown;
  chargeFullyRefunded: unknown;
}) => {
  const refunded = Number(amountRefunded);
  const expected = Number(expectedTotal);
  if (
    !Number.isSafeInteger(refunded)
    || !Number.isSafeInteger(expected)
    || refunded <= 0
    || expected <= 0
    || refunded > expected
  ) return "review" as const;
  if (chargeFullyRefunded === true || refunded === expected) return "full" as const;
  return "partial" as const;
};

export const FULFILLMENT_CLAIMABLE_STATUSES = [
  "not_started",
  "pending",
  "failed",
  "needs_configuration",
  "awaiting_peecho_payment",
] as const;

export const FULFILLMENT_RETRYABLE_ORDER_STATUSES = [
  "paid",
  "paid_pending_fulfillment",
  "peecho_open",
] as const;

export const isFulfillmentLeaseStale = (
  claimedAt: unknown,
  nowMs = Date.now(),
  leaseMinutes = 15,
) => {
  if (!claimedAt) return true;
  const claimedAtMs = new Date(String(claimedAt)).getTime();
  return !Number.isFinite(claimedAtMs) || claimedAtMs < nowMs - leaseMinutes * 60 * 1000;
};

export const classifyStripeCheckoutForPdfCleanup = (
  session: Record<string, unknown>,
  paymentIntent?: Record<string, unknown> | null,
) => {
  const paymentStatus = String(session.payment_status || "");
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") return "paid_review" as const;
  const sessionStatus = String(session.status || "");
  if (sessionStatus === "open") return "defer" as const;
  if (sessionStatus === "expired") return "delete" as const;

  const intentStatus = String(paymentIntent?.status || "");
  if (intentStatus === "succeeded") return "paid_review" as const;
  if (["canceled", "requires_payment_method"].includes(intentStatus)) return "delete" as const;
  // `processing` and any future/unknown state remain retained until Stripe
  // resolves them; accepting money after deleting the print source is worse
  // than retaining an explicitly pending checkout for another review cycle.
  return "defer" as const;
};

export interface CheckoutOrderForValidation {
  id: string;
  trip_id: string;
  merchant_reference: string;
  stripe_checkout_session_id?: string | null;
  payment_amount_cents?: number | null;
  payment_subtotal_cents?: number | null;
  payment_shipping_cents?: number | null;
  payment_currency?: string | null;
}

export const buildMonotonicStripePaidUpdate = ({
  order,
  sessionId,
  paymentIntentId,
  totalCents,
  shippingCents,
  stripePayload,
  customerEmail,
  pdfDeleteAfter,
  now,
}: {
  order: Record<string, unknown>;
  sessionId: unknown;
  paymentIntentId: unknown;
  totalCents: number;
  shippingCents: number;
  stripePayload: Record<string, unknown>;
  customerEmail: unknown;
  pdfDeleteAfter: string;
  now: string;
}) => {
  const paymentWasCaptured = ["paid", "partially_refunded", "refunded"]
    .includes(String(order.payment_status || ""));
  return {
    // A duplicate Stripe event must never move submitted/production/shipped or
    // a later refund back to the generic `paid` order state.
    ...(paymentWasCaptured ? {} : { status: "paid", payment_status: "paid" }),
    payment_amount_cents: Number.isFinite(totalCents) ? totalCents : order.payment_amount_cents,
    payment_shipping_cents: Number.isFinite(shippingCents) ? shippingCents : order.payment_shipping_cents,
    stripe_checkout_session_id: sessionId || order.stripe_checkout_session_id,
    stripe_payment_intent_id: paymentIntentId || order.stripe_payment_intent_id,
    stripe_payload: stripePayload,
    customer_email: customerEmail || order.customer_email,
    paid_at: order.paid_at || now,
    pdf_delete_after: paymentWasCaptured && order.pdf_delete_after
      ? order.pdf_delete_after
      : pdfDeleteAfter,
    status_updated_at: now,
  };
};

export const validatePaidCheckoutSession = (
  order: CheckoutOrderForValidation,
  session: Record<string, unknown>,
) => {
  const metadata = (session.metadata || {}) as Record<string, unknown>;
  if (metadata.order_id !== order.id || metadata.trip_id !== order.trip_id) {
    return "Stripe metadata hoort niet bij deze bestelling";
  }
  if (metadata.merchant_reference !== order.merchant_reference) {
    return "Stripe referentie hoort niet bij deze bestelling";
  }
  if (
    order.stripe_checkout_session_id
    && session.id
    && session.id !== order.stripe_checkout_session_id
  ) {
    return "Stripe sessie-id komt niet overeen";
  }

  const expectedSubtotal = order.payment_subtotal_cents ?? order.payment_amount_cents;
  const stripeSubtotal = Number(session.amount_subtotal);
  if (expectedSubtotal != null && (!Number.isFinite(stripeSubtotal) || stripeSubtotal !== expectedSubtotal)) {
    return "Stripe subtotaal komt niet overeen";
  }

  const expectedTotal = order.payment_amount_cents;
  const stripeTotal = Number(session.amount_total);
  if (expectedTotal != null && (!Number.isFinite(stripeTotal) || stripeTotal !== expectedTotal)) {
    return "Stripe totaalbedrag komt niet overeen";
  }

  const totalDetails = (session.total_details || {}) as Record<string, unknown>;
  const expectedShipping = order.payment_shipping_cents;
  const stripeShipping = Number(totalDetails.amount_shipping);
  if (expectedShipping != null && (!Number.isFinite(stripeShipping) || stripeShipping !== expectedShipping)) {
    return "Stripe verzendkosten komen niet overeen";
  }

  const currency = String(session.currency || "").toLowerCase();
  if (order.payment_currency && currency !== order.payment_currency.toLowerCase()) {
    return "Stripe valuta komt niet overeen";
  }
  return null;
};

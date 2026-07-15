import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertTrustedPeechoUrl,
  buildMonotonicStripePaidUpdate,
  buildPhotobookCheckoutSnapshot,
  canAdvancePhotobookStatus,
  canAdvanceRefundFulfillment,
  classifyStripeCheckoutForPdfCleanup,
  classifyStripeRefund,
  createAndPayPeechoOrder,
  FULFILLMENT_CLAIMABLE_STATUSES,
  FULFILLMENT_RETRYABLE_ORDER_STATUSES,
  getPeechoDetailsUrl,
  getPeechoPaymentUrl,
  isFulfillmentLeaseStale,
  isPhotobookOrderTerminalForDeletion,
  normalizePeechoStatus,
  photobookOrderMatchesQuote,
  sha256Hex,
  STRIPE_PHOTOBOOK_EVENT_TYPES,
  toPeechoCountryCode,
  validatePaidCheckoutSession,
} from "../../supabase/functions/_shared/photobook";

describe("photobook checkout contracts", () => {
  const quote = {
    baseCents: 1295,
    pageCents: 75,
    shippingCents: 695,
    subtotalCents: 3095,
    totalCents: 3790,
    currency: "eur",
    vatIncluded: true,
    shippingCountries: ["NL", "BE"],
    deliveryEstimate: "5–10 werkdagen na productie",
    termsVersion: "2026-07-15",
    seller: {
      legalName: "Buildy B.V.",
      contactEmail: "orders@buildy.test",
      contactPhone: "+31 20 123 45 67",
      postalAddress: "Teststraat 1, 1000 AA Amsterdam",
      registrationNumber: "KvK 12345678",
    },
  };

  it("creates, persists and pays a Peecho order before treating it as submitted", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body || "{}"));
      calls.push({ url, body });
      if (calls.length === 1) return new Response(JSON.stringify({ order_id: 4321 }), { status: 201 });
      return new Response(JSON.stringify({ order_state: "PAID" }), { status: 200 });
    }) as unknown as typeof fetch;
    const persisted: string[] = [];

    const result = await createAndPayPeechoOrder({
      orderUrl: "https://test.www.peecho.com/rest/v3/order/",
      merchantApiKey: "merchant-key",
      secretKey: "secret-key",
      createPayload: { purchase_order: "buildy-order" },
      fetcher,
      onOrderCreated: async (id) => { persisted.push(id); },
    });

    expect(result).toMatchObject({ peechoId: "4321", orderState: "PAID" });
    expect(persisted).toEqual(["4321"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://test.www.peecho.com/rest/v3/order/",
      "https://test.www.peecho.com/rest/v3/order/payment",
    ]);
    expect(calls[1].body).toEqual({
      order_id: 4321,
      merchant_api_key: "merchant-key",
      secret: await sha256Hex("secret-key4321"),
    });
  });

  it("resumes payment with a persisted Peecho id without creating a duplicate order", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ order_state: "IN_PRINT_QUEUE" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await createAndPayPeechoOrder({
      orderUrl: "https://www.peecho.com/rest/v3/order/",
      merchantApiKey: "merchant-key",
      secretKey: "secret-key",
      createPayload: {},
      existingPeechoId: "99",
      fetcher,
    });
    expect(result.orderState).toBe("IN_PRINT_QUEUE");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls[0]).toContain("/order/payment");
  });

  it("reconciles Peecho ORD_PAID_STATE after payment succeeded but the final DB write failed", async () => {
    let callCount = 0;
    const calls: string[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request) => {
      calls.push(String(_input));
      callCount += 1;
      if (callCount === 1) {
        return new Response(JSON.stringify({ details: [{ code: "ORD_PAID_STATE" }] }), { status: 409 });
      }
      return new Response(JSON.stringify({
        order_id: 99,
        order_state: "WAITING_TO_DISPATCH",
        merchant_order_reference: "buildy-order",
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await createAndPayPeechoOrder({
      orderUrl: "https://www.peecho.com/rest/v3/order/",
      merchantApiKey: "merchant-key",
      secretKey: "secret-key",
      createPayload: { order_reference: "buildy-order" },
      existingPeechoId: "99",
      fetcher,
    });

    expect(result).toMatchObject({ peechoId: "99", orderState: "WAITING_TO_DISPATCH" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls[1]).toContain("/order/details");
  });

  it("reconciles ORD_DUPLICATE by merchant reference before paying the existing order", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) {
        return new Response(JSON.stringify({ details: [{ code: "ORD_DUPLICATE" }] }), { status: 409 });
      }
      if (calls.length === 2) {
        return new Response(JSON.stringify({
          order_id: 4321,
          order_state: "OPEN",
          merchant_order_reference: "buildy-order",
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ order_state: "PAID" }), { status: 200 });
    }) as unknown as typeof fetch;
    const persisted: string[] = [];

    const result = await createAndPayPeechoOrder({
      orderUrl: "https://www.peecho.com/rest/v3/order/",
      merchantApiKey: "merchant-key",
      secretKey: "secret-key",
      createPayload: { order_reference: "buildy-order" },
      fetcher,
      onOrderCreated: (id) => { persisted.push(id); },
    });

    expect(result).toMatchObject({ peechoId: "4321", orderState: "PAID" });
    expect(persisted).toEqual(["4321"]);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toBe(getPeechoDetailsUrl(
      "https://www.peecho.com/rest/v3/order/",
      "merchant-key",
      { orderReference: "buildy-order" },
    ));
    expect(calls[2]).toContain("/order/payment");
  });

  it("normalizes Peecho pingbacks through production and delivery", () => {
    expect(normalizePeechoStatus("PAID")).toEqual({
      status: "submitted_to_peecho",
      fulfillmentStatus: "submitted",
    });
    expect(normalizePeechoStatus("IN_PRODUCTION")).toEqual({
      status: "in_production",
      fulfillmentStatus: "in_production",
    });
    expect(normalizePeechoStatus("SHIPPED")).toEqual({
      status: "shipped",
      fulfillmentStatus: "shipped",
    });
    expect(normalizePeechoStatus("SUBMITTED")).toEqual({
      status: "submitted_to_peecho",
      fulfillmentStatus: "submitted",
    });
    for (const providerError of ["NO_PRINT_FACILITY_ERROR", "SUBMISSION_ERROR", "PRODUCTION_ERROR"]) {
      expect(normalizePeechoStatus(providerError)).toEqual({
        status: "peecho_failed",
        fulfillmentStatus: "failed",
      });
    }
    expect(normalizePeechoStatus("FUTURE_UNKNOWN_STATE")).toEqual({
      status: "peecho_review",
      fulfillmentStatus: "review",
    });
    expect(canAdvancePhotobookStatus("submitted_to_peecho", "shipped")).toBe(true);
    expect(canAdvancePhotobookStatus("shipped", "in_production")).toBe(false);
    expect(canAdvancePhotobookStatus("shipped", "peecho_failed")).toBe(false);
  });

  it("includes the initial not_started state in the atomic fulfillment claim", () => {
    expect(FULFILLMENT_CLAIMABLE_STATUSES).toContain("not_started");
    expect(FULFILLMENT_CLAIMABLE_STATUSES).toContain("awaiting_peecho_payment");
    expect(FULFILLMENT_RETRYABLE_ORDER_STATUSES).toContain("peecho_open");
    expect(FULFILLMENT_RETRYABLE_ORDER_STATUSES).not.toContain("peecho_failed");
  });

  it("expires only a genuinely stale fulfillment lease", () => {
    const now = Date.parse("2026-07-15T12:30:00.000Z");
    expect(isFulfillmentLeaseStale("2026-07-15T12:00:00.000Z", now, 15)).toBe(true);
    expect(isFulfillmentLeaseStale("2026-07-15T12:20:00.000Z", now, 15)).toBe(false);
    expect(isFulfillmentLeaseStale(null, now, 15)).toBe(true);
  });

  it("preserves PDFs while Stripe is open or asynchronously processing", () => {
    expect(classifyStripeCheckoutForPdfCleanup({ status: "open", payment_status: "unpaid" })).toBe("defer");
    expect(classifyStripeCheckoutForPdfCleanup(
      { status: "complete", payment_status: "unpaid" },
      { status: "processing" },
    )).toBe("defer");
    expect(classifyStripeCheckoutForPdfCleanup(
      { status: "complete", payment_status: "unpaid" },
      { status: "requires_payment_method" },
    )).toBe("delete");
    expect(classifyStripeCheckoutForPdfCleanup({ status: "expired", payment_status: "unpaid" })).toBe("delete");
    expect(classifyStripeCheckoutForPdfCleanup({ status: "complete", payment_status: "paid" })).toBe("paid_review");
  });

  it("validates Peecho's ISO alpha-2 country code contract", () => {
    expect(toPeechoCountryCode("nl")).toBe("NL");
    expect(() => toPeechoCountryCode("NLD")).toThrow(/ISO-landcode/i);
    expect(() => toPeechoCountryCode("ARE")).toThrow(/ISO-landcode/i);
  });

  it("classifies exact cumulative Stripe refunds and subscribes to refund events", () => {
    expect(classifyStripeRefund({ amountRefunded: 3595, expectedTotal: 3595, chargeFullyRefunded: true })).toBe("full");
    expect(classifyStripeRefund({ amountRefunded: 500, expectedTotal: 3595, chargeFullyRefunded: false })).toBe("partial");
    expect(classifyStripeRefund({ amountRefunded: 4000, expectedTotal: 3595, chargeFullyRefunded: true })).toBe("review");
    expect(STRIPE_PHOTOBOOK_EVENT_TYPES).toContain("charge.refunded");
    expect(STRIPE_PHOTOBOOK_EVENT_TYPES).toContain("refund.updated");
  });

  it("keeps refund payment state separate from terminal Peecho fulfillment", () => {
    expect(canAdvanceRefundFulfillment("refund_review", "shipped")).toBe(true);
    expect(canAdvanceRefundFulfillment("refund_review", "cancelled")).toBe(true);
    expect(canAdvanceRefundFulfillment("shipped", "delivered")).toBe(true);
    expect(canAdvanceRefundFulfillment("shipped", "in_production")).toBe(false);
    expect(canAdvanceRefundFulfillment("cancelled", "shipped")).toBe(false);
  });

  it("validates Stripe session identity, subtotal and currency", () => {
    const order = {
      id: "order-1",
      trip_id: "trip-1",
      merchant_reference: "buildy-trip-1-ref",
      stripe_checkout_session_id: "cs_1",
      payment_subtotal_cents: 3095,
      payment_shipping_cents: 500,
      payment_amount_cents: 3595,
      payment_currency: "eur",
    };
    const session = {
      id: "cs_1",
      amount_subtotal: 3095,
      amount_total: 3595,
      currency: "eur",
      total_details: { amount_shipping: 500 },
      metadata: {
        order_id: "order-1",
        trip_id: "trip-1",
        merchant_reference: "buildy-trip-1-ref",
      },
    };
    expect(validatePaidCheckoutSession(order, session)).toBeNull();
    expect(validatePaidCheckoutSession(order, { ...session, amount_subtotal: 1 })).toMatch(/subtotaal/i);
    expect(validatePaidCheckoutSession(order, { ...session, amount_total: 1 })).toMatch(/totaalbedrag/i);
    expect(validatePaidCheckoutSession(order, { ...session, total_details: { amount_shipping: 1 } })).toMatch(/verzendkosten/i);
    expect(validatePaidCheckoutSession(order, { ...session, id: "cs_other" })).toMatch(/sessie-id/i);
  });

  it("keeps fulfillment status monotonic when Stripe resends a paid event", () => {
    const shippedOrder = {
      status: "shipped",
      fulfillment_status: "shipped",
      payment_status: "paid",
      payment_amount_cents: 3595,
      payment_shipping_cents: 500,
      paid_at: "2026-07-15T10:00:00.000Z",
    };
    const update = buildMonotonicStripePaidUpdate({
      order: shippedOrder,
      sessionId: "cs_1",
      paymentIntentId: "pi_1",
      totalCents: 3595,
      shippingCents: 500,
      stripePayload: { session_id: "cs_1" },
      customerEmail: "buyer@example.test",
      pdfDeleteAfter: "2026-10-15T12:00:00.000Z",
      now: "2026-07-15T12:00:00.000Z",
    });

    expect(update).not.toHaveProperty("status");
    expect(update).not.toHaveProperty("payment_status");
    expect({ ...shippedOrder, ...update }).toMatchObject({
      status: "shipped",
      fulfillment_status: "shipped",
      payment_status: "paid",
    });

    const refundedOrder = {
      ...shippedOrder,
      status: "refunded",
      payment_status: "refunded",
      payment_refunded_cents: 3595,
      pdf_delete_after: "2026-09-01T12:00:00.000Z",
    };
    const duplicateAfterRefund = buildMonotonicStripePaidUpdate({
      order: refundedOrder,
      sessionId: "cs_1",
      paymentIntentId: "pi_1",
      totalCents: 3595,
      shippingCents: 500,
      stripePayload: { session_id: "cs_1" },
      customerEmail: "buyer@example.test",
      pdfDeleteAfter: "2026-10-15T12:00:00.000Z",
      now: "2026-07-16T12:00:00.000Z",
    });
    expect(duplicateAfterRefund).not.toHaveProperty("status");
    expect(duplicateAfterRefund).not.toHaveProperty("payment_status");
    expect(duplicateAfterRefund.pdf_delete_after).toBe(refundedOrder.pdf_delete_after);
  });

  it("blocks account deletion for every open checkout and active fulfillment", () => {
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "unpaid", status: "pdf_ready" })).toBe(false);
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "pending", status: "payment_pending" })).toBe(false);
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "paid", status: "in_production" })).toBe(false);
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "failed", status: "payment_failed" })).toBe(true);
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "paid", status: "shipped" })).toBe(true);
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "refunded", fulfillment_status: "refund_review", status: "refunded" })).toBe(false);
    expect(isPhotobookOrderTerminalForDeletion({ payment_status: "refunded", fulfillment_status: "cancelled", status: "refunded" })).toBe(true);
  });

  it("derives the official Peecho payment endpoint from the order endpoint", () => {
    expect(getPeechoPaymentUrl("https://www.peecho.com/rest/v3/order/")).toBe(
      "https://www.peecho.com/rest/v3/order/payment",
    );
  });

  it("allows only HTTPS Peecho API endpoints for fulfillment credentials", () => {
    expect(assertTrustedPeechoUrl("https://test.www.peecho.com/rest/v3/order/")).toContain("peecho.com");
    expect(() => assertTrustedPeechoUrl("http://www.peecho.com/rest/v3/order/")).toThrow(/HTTPS/i);
    expect(() => assertTrustedPeechoUrl("https://peecho.com.evil.test/rest/v3/order/")).toThrow(/peecho\.com/i);
  });

  it("persists an immutable price, seller and terms snapshot for checkout retries", () => {
    const snapshot = buildPhotobookCheckoutSnapshot({
      quote,
      format: "A4_LANDSCAPE",
      pageCount: 24,
      acceptedAt: "2026-07-15T12:00:00.000Z",
    });
    const order = {
      payment_subtotal_cents: quote.subtotalCents,
      payment_shipping_cents: quote.shippingCents,
      payment_amount_cents: quote.totalCents,
      payment_currency: quote.currency,
      terms_version: quote.termsVersion,
      checkout_snapshot: snapshot,
    };

    expect(snapshot).toMatchObject({
      total_cents: 3790,
      vat_included: true,
      terms_version: "2026-07-15",
      customized_product_no_withdrawal: true,
      seller: { legalName: "Buildy B.V.", contactPhone: "+31 20 123 45 67" },
    });
    expect(photobookOrderMatchesQuote(order, quote)).toBe(true);
    expect(photobookOrderMatchesQuote(order, { ...quote, totalCents: 3791 })).toBe(false);
    expect(photobookOrderMatchesQuote(order, { ...quote, termsVersion: "2026-07-16" })).toBe(false);
  });

  it("migrates the durable checkout evidence written by the Edge Function", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/20260715123000_photobook_checkout_hardening.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS terms_version text/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS checkout_snapshot jsonb/);
    expect(migration).toMatch(/OLD\.terms_version/);
    expect(migration).toMatch(/OLD\.checkout_snapshot/);
    expect(migration).toMatch(/CREATE TRIGGER enforce_photobook_order_status_monotonic/);
    expect(migration).toMatch(/ACCOUNT_DELETION_IN_PROGRESS/);
    expect(migration).toMatch(/CREATE TRIGGER guard_storage_upload_during_account_deletion/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/account_deletion_cleanup_failures/);
    expect(migration).toMatch(/photobook_orders_checkout_snapshot_seller_phone_check/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS fulfillment_claimed_at timestamptz/);
    expect(migration.match(/pg_advisory_xact_lock\(hashtextextended\([^;]+724932\)\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toMatch(/'avatars'/);
  });

  it("queues storage cleanup before auth deletion and only sweeps after deletion", () => {
    const source = readFileSync(
      new URL("../../supabase/functions/delete-account/index.ts", import.meta.url),
      "utf8",
    );
    const sweeps = source.match(/cleanupUserStorage\(admin, userId\)/g) || [];

    expect(sweeps).toHaveLength(1);
    expect(source).toMatch(/account_deletion_cleanup_failures/);
    expect(source.indexOf('from("account_deletion_cleanup_failures").upsert')).toBeLessThan(
      source.indexOf("admin.auth.admin.deleteUser"),
    );
    expect(source.indexOf("admin.auth.admin.deleteUser")).toBeLessThan(
      source.indexOf("cleanupUserStorage(admin, userId)"),
    );
    expect(source).toMatch(/"avatars"/);

    const cleanupSource = readFileSync(
      new URL("../../supabase/functions/cleanup-photobook-retention/index.ts", import.meta.url),
      "utf8",
    );
    expect(cleanupSource).toMatch(/from\("account_deletion_cleanup_failures"\)/);
    expect(cleanupSource).toMatch(/recoveredAccountCleanups/);
    expect(cleanupSource).toMatch(/admin\.auth\.admin\.getUserById/);
    expect(cleanupSource).toMatch(/classifyStripeCheckoutForPdfCleanup/);
    expect(cleanupSource).toMatch(/"avatars"/);
  });

  it("keeps delayed Stripe checkout cancellation from deleting a processing order", () => {
    const source = readFileSync(
      new URL("../../supabase/functions/create-photobook-checkout/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/session\.status === "complete"/);
    expect(source).toMatch(/betaling wordt nog verwerkt/i);
    expect(source).toMatch(/payment_intent_data\[metadata\]\[order_id\]/);
  });

  it("uses a dedicated fulfillment lease and keeps Stripe refunds in manual Peecho review", () => {
    const source = readFileSync(
      new URL("../../supabase/functions/stripe-webhook/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/fulfillment_claimed_at\.lt/);
    expect(source).not.toMatch(/\.lt\("status_updated_at", staleBefore\)/);
    expect(source).toMatch(/processStripeRefund/);
    expect(source).toMatch(/no Peecho cancellation call is made/);
  });
});

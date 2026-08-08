// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPhotobookCheckout,
  getPhotobookOrder,
  requestPhotobookQuote,
  safeTrackingUrl,
  stripeCheckoutUrl,
} from "@/lib/orderApi";

const REVISION_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const COMMAND_ID = "55555555-5555-4555-8555-555555555555";
const DOCUMENT_SHA = "a".repeat(64);
const PDF_SHA = "b".repeat(64);

const address = {
  firstName: "Ada",
  lastName: "Bakker",
  addressLine1: "Bouwstraat 12",
  addressLine2: null,
  postalCode: "1234 AB",
  city: "Utrecht",
  state: null,
  countryCode: "NL",
};

const amounts = {
  currency: "EUR" as const,
  subtotalMinor: 10_000,
  shippingMinor: 1_000,
  taxMinor: 2_310,
  totalMinor: 13_310,
};

const quote = {
  proofRevisionId: REVISION_ID,
  sku: "a4-landscape-hardcover-v1" as const,
  format: "a4-landscape-hardcover-v1" as const,
  pageCount: 24,
  quantity: 1,
  destinationCountry: "NL",
  quoteReference: "quote-exact-1",
  amounts,
  deliveryEstimate: "5–8 werkdagen",
  taxTreatment: "vat_included" as const,
  expiresAt: "2030-01-01T12:00:00.000Z",
  termsVersion: "2026-08-01",
  seller: {
    legalName: "Buildy B.V.",
    tradeName: "Buildy",
    registrationNumber: "12345678",
    vatNumber: "NL001234567B01",
    address: "Bouwstraat 1, Utrecht, Nederland",
    countryCode: "NL",
    supportEmail: "support@example.com",
  },
  personalisedProduct: true as const,
};

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

describe("order API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("vraagt de exacte serverquote aan zonder clientprijs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success(quote));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPhotobookQuote(REVISION_ID, {
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      quantity: 1,
      shippingAddress: address,
    });

    expect(result.amounts.totalMinor).toBe(13_310);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/photobooks/proofs/${REVISION_ID}/quote`,
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      quantity: 1,
      shippingAddress: address,
    });
  });

  it("bindt checkout idempotent aan quote, totaal, voorwaarden en hashes", async () => {
    const checkout = {
      orderId: ORDER_ID,
      orderNumber: "BLD-ABCD-1234",
      projectId: PROJECT_ID,
      proofRevisionId: REVISION_ID,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 1,
      destinationCountry: "NL",
      amounts,
      deliveryEstimate: "5–8 werkdagen",
      termsVersion: "2026-08-01",
      status: "checkout_open",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_buildy",
      checkoutExpiresAt: "2030-01-01T12:30:00.000Z",
      replayed: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(success(checkout));
    vi.stubGlobal("fetch", fetchMock);

    await createPhotobookCheckout(REVISION_ID, {
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      quantity: 1,
      shippingAddress: address,
      idempotencyKey: COMMAND_ID,
      expectedQuoteReference: quote.quoteReference,
      expectedTotalMinor: quote.amounts.totalMinor,
      termsVersion: quote.termsVersion,
      personalisedProductAccepted: true,
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      idempotencyKey: COMMAND_ID,
      expectedQuoteReference: "quote-exact-1",
      expectedTotalMinor: 13_310,
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      personalisedProductAccepted: true,
    });
  });

  it("haalt uitsluitend de authenticated serverstatus van de order op", async () => {
    const detail = {
      orderId: ORDER_ID,
      orderNumber: "BLD-ABCD-1234",
      projectId: PROJECT_ID,
      proofRevisionId: REVISION_ID,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 1,
      destinationCountry: "NL",
      amounts,
      deliveryEstimate: "5–8 werkdagen",
      termsVersion: "2026-08-01",
      status: "checkout_open",
      paymentStatus: "processing",
      refundedMinor: 0,
      fulfilmentStatus: "unclaimed",
      trackingUrl: null,
      createdAt: "2026-08-04T12:00:00.000Z",
      paidAt: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(success(detail));
    vi.stubGlobal("fetch", fetchMock);

    expect((await getPhotobookOrder(ORDER_ID)).paymentStatus).toBe("processing");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/orders/${ORDER_ID}`,
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });
});

describe("veilige externe orderlinks", () => {
  it("staat uitsluitend HTTPS Stripe Checkout als betaalbestemming toe", () => {
    expect(stripeCheckoutUrl("https://checkout.stripe.com/c/pay/test")).toBe("https://checkout.stripe.com/c/pay/test");
    expect(() => stripeCheckoutUrl("https://checkout.stripe.com.evil.example/pay")).toThrow();
    expect(() => stripeCheckoutUrl("http://checkout.stripe.com/pay")).toThrow();
    expect(() => stripeCheckoutUrl("https://evil@checkout.stripe.com/pay")).toThrow();
  });

  it("verbergt onveilige trackinglinks", () => {
    expect(safeTrackingUrl("https://tracking.example/pakket")).toBe("https://tracking.example/pakket");
    expect(safeTrackingUrl("javascript:alert(1)")).toBeNull();
    expect(safeTrackingUrl("geen-url")).toBeNull();
  });
});

describe("oude bestelbrowser verwijderd", () => {
  it("bevat geen Supabase-query of providerwidget en noemt terugkeer geen betaling", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/OrderConfirmation.tsx"), "utf8").toLowerCase();
    expect(source).not.toContain("supabase");
    expect(source).not.toContain(".from(");
    expect(source).not.toContain("peecho_id");
    expect(source).toContain("terug van stripe");
    expect(source).toContain("webhookbevestiging");
  });
});

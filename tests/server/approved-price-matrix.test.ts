// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  ApprovedPriceMatrixQuoteProvider,
  parseApprovedPriceMatrix,
} from "../../server/orders/approvedPriceMatrix";

const matrix = {
  version: 1,
  environment: "test",
  currency: "EUR",
  approvalStatus: "approved",
  commercialApprovalId: "approval-test-2026-08",
  approvedBy: "Test commerce owner",
  approvedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:00:00.000Z",
  entries: [{
    sku: "a4-landscape-hardcover-v1",
    countryCode: "NL",
    minimumPages: 24,
    maximumPages: 100,
    minimumQuantity: 1,
    maximumQuantity: 5,
    unitBaseMinor: 4_000,
    unitAdditionalPageMinor: 25,
    shippingBaseMinor: 800,
    shippingAdditionalCopyMinor: 200,
    taxRateBasisPoints: 2_100,
    taxTreatment: "vat_exclusive",
    deliveryEstimate: "5–8 werkdagen na productie",
    offeringId: "test-offering-a4-landscape-hardcover",
  }],
} as const;

const shippingAddress = {
  firstName: "Mila",
  lastName: "Bouwer",
  addressLine1: "Teststraat 12",
  addressLine2: null,
  postalCode: "1234 AB",
  city: "Utrecht",
  state: null,
  countryCode: "NL",
};

describe("ApprovedPriceMatrixQuoteProvider", () => {
  it("derives one deterministic, internally reconciled destination quote", async () => {
    const provider = new ApprovedPriceMatrixQuoteProvider(
      matrix,
      "test",
      () => new Date("2026-08-04T12:00:00.000Z"),
    );

    const quote = await provider.quote({
      sku: "a4-landscape-hardcover-v1",
      pageCount: 28,
      quantity: 2,
      shippingAddress,
    });

    expect(quote).toMatchObject({
      destinationCountry: "NL",
      unitAmountMinor: 4_100,
      amounts: {
        subtotalMinor: 8_200,
        shippingMinor: 1_000,
        taxMinor: 1_932,
        totalMinor: 11_132,
      },
      commercialApprovalId: matrix.commercialApprovalId,
    });
    expect(quote?.quoteReference).toMatch(/^matrix:approval-test-2026-08:[0-9a-f]{32}$/);
    expect(await provider.quote({
      sku: "a4-landscape-hardcover-v1",
      pageCount: 28,
      quantity: 2,
      shippingAddress,
    })).toEqual(quote);
  });

  it("fails closed for an unapproved country, odd pages, expired or cross-environment matrix", async () => {
    const provider = new ApprovedPriceMatrixQuoteProvider(
      matrix,
      "test",
      () => new Date("2026-08-04T12:00:00.000Z"),
    );
    expect(await provider.quote({
      sku: "a4-landscape-hardcover-v1",
      pageCount: 25,
      quantity: 1,
      shippingAddress,
    })).toBeNull();
    expect(await provider.quote({
      sku: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 1,
      shippingAddress: { ...shippingAddress, countryCode: "BE" },
    })).toBeNull();
    expect(() => new ApprovedPriceMatrixQuoteProvider(matrix, "live"))
      .toThrow(/Bestellen is voor deze bestemming/);
    const expired = new ApprovedPriceMatrixQuoteProvider(
      matrix,
      "test",
      () => new Date("2026-09-02T00:00:00.000Z"),
    );
    await expect(expired.quote({
      sku: "a4-landscape-hardcover-v1",
      pageCount: 24,
      quantity: 1,
      shippingAddress,
    })).rejects.toMatchObject({ reason: "PRICE_UNAVAILABLE" });
  });

  it("rejects duplicate rows, malformed JSON and fake exempt tax", () => {
    expect(() => parseApprovedPriceMatrix(JSON.stringify({
      ...matrix,
      entries: [matrix.entries[0], matrix.entries[0]],
    }))).toThrow();
    expect(() => parseApprovedPriceMatrix("not-json")).toThrow();
    expect(() => parseApprovedPriceMatrix(JSON.stringify({
      ...matrix,
      entries: [{
        ...matrix.entries[0],
        taxTreatment: "vat_exempt",
        taxRateBasisPoints: 2_100,
      }],
    }))).toThrow();
  });
});

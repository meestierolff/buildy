// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createPhotobookCheckoutInputSchema } from "../../shared/contracts/orders";

const validCheckoutRequest = {
  documentSha256: "a".repeat(64),
  pdfSha256: "b".repeat(64),
  quantity: 1,
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
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  expectedQuoteReference: "matrix:approved:test",
  expectedQuoteExpiresAt: "2026-08-04T12:15:00.000Z",
  expectedAmounts: {
    currency: "EUR",
    subtotalMinor: 4_000,
    shippingMinor: 800,
    taxMinor: 1_008,
    totalMinor: 5_808,
  },
  termsVersion: "2026-08-01",
  termsAccepted: true,
  personalisedProductAccepted: true,
} as const;

describe("photobook checkout request contract", () => {
  it("accepts only an explicit positive terms attestation", () => {
    expect(createPhotobookCheckoutInputSchema.parse(validCheckoutRequest).termsAccepted).toBe(true);

    const omitted = { ...validCheckoutRequest } as Record<string, unknown>;
    delete omitted.termsAccepted;
    expect(createPhotobookCheckoutInputSchema.safeParse(omitted).success).toBe(false);
    expect(createPhotobookCheckoutInputSchema.safeParse({
      ...validCheckoutRequest,
      termsAccepted: false,
    }).success).toBe(false);
  });
});

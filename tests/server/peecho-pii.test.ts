// @vitest-environment node

import { describe, expect, it } from "vitest";

import { FulfilmentError } from "../../server/fulfilment/errors";
import { KeyringFulfilmentPiiReader } from "../../server/fulfilment/pii";
import type { PeechoFulfilmentJob } from "../../server/fulfilment/types";
import { DataProtectionKeyring } from "../../server/security/dataProtection";

const ORDER_ID = "10000000-0000-4000-8000-000000000001";
const keyring = new DataProtectionKeyring({
  currentVersion: 1,
  keys: { 1: Buffer.alloc(32, 7).toString("base64") },
});

const address = {
  firstName: "Ada",
  lastName: "Bouwer",
  addressLine1: "Bouwstraat 1",
  addressLine2: null,
  postalCode: "1234 AB",
  city: "Utrecht",
  state: null,
  countryCode: "NL",
} as const;

function job(overrides: Partial<PeechoFulfilmentJob> = {}): PeechoFulfilmentJob {
  return {
    workerId: "peecho-worker:test:claim",
    orderId: ORDER_ID,
    orderNumber: "BLD-20260804-ABCDEF1234",
    merchantReference: `buildy:${ORDER_ID}`,
    providerEnvironment: "test",
    phase: "create",
    providerOrderId: null,
    providerStatus: null,
    attemptCount: 1,
    offeringId: "233309",
    currency: "EUR",
    quantity: 1,
    pageCount: 24,
    shippingCountry: "NL",
    customerEmailCiphertext: keyring.encrypt(
      "ada@example.test",
      `photobook-order:${ORDER_ID}:customer-email`,
    ),
    shippingDetailsCiphertext: keyring.encrypt(
      JSON.stringify(address),
      `photobook-order:${ORDER_ID}:shipping-address`,
    ),
    piiEncryptionKeyVersion: 1,
    pdfObjectKey: "photobook-pdfs/20/20000000-0000-4000-8000-000000000001",
    pdfBucket: "buildy-private",
    pdfSizeBytes: 12_345,
    pdfSha256: "a".repeat(64),
    ...overrides,
  };
}

describe("Peecho fulfilment PII boundary", () => {
  it("decrypts only the exact order-bound fields and validates the destination country", () => {
    const reader = new KeyringFulfilmentPiiReader(keyring);

    expect(reader.reveal(job())).toEqual({ customerEmail: "ada@example.test", shippingAddress: address });
  });

  it.each([
    { orderId: "20000000-0000-4000-8000-000000000002" },
    { piiEncryptionKeyVersion: 2 },
    { shippingCountry: "BE" },
  ])("fails closed when ciphertext context or immutable metadata changes: %o", (overrides) => {
    const reader = new KeyringFulfilmentPiiReader(keyring);

    expect(() => reader.reveal(job(overrides))).toThrowError(FulfilmentError);
    try {
      reader.reveal(job(overrides));
    } catch (error) {
      expect(error).toMatchObject({ code: "PII_INVALID" });
    }
  });
});

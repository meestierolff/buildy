// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  OrderEmailPayloadError,
  prepareOrderEmail,
  type OrderEmailContext,
} from "../../server/email/orderEmailPayload";
import { EmailTemplateCatalog } from "../../server/email/templates";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";

const orderId = "10000000-0000-4000-8000-000000000021";
const ownerId = "10000000-0000-4000-8000-000000000022";
const encryptionKey = Buffer.alloc(32, 31).toString("base64");
const blindIndexKey = Buffer.alloc(32, 32).toString("base64");

function dependencies() {
  return {
    keyring: new DataProtectionKeyring({ currentVersion: 1, keys: { 1: encryptionKey } }),
    blindIndex: new PrivacyBlindIndex(blindIndexKey),
    templates: new EmailTemplateCatalog({
      "order.confirmation": { id: 201, version: "content-2026-08-04" },
      "order.payment_failed": { id: 202, version: "content-2026-08-04" },
      "order.in_production": { id: 203, version: "content-2026-08-04" },
      "order.shipped": { id: 204, version: "content-2026-08-04" },
      "order.refund_review": { id: 205, version: "content-2026-08-04" },
    }),
  };
}

function context(): OrderEmailContext {
  const { keyring } = dependencies();
  return {
    orderId,
    ownerId,
    orderNumber: "BLD-2026-ABC12345",
    currency: "EUR",
    quantity: 2,
    subtotalMinor: 8_000,
    shippingMinor: 695,
    taxMinor: 1_827,
    totalMinor: 10_522,
    refundedMinor: 0,
    shippingCountry: "NL",
    customerEmailCiphertext: keyring.encrypt(
      "bouwer@example.test",
      `photobook-order:${orderId}:customer-email`,
    ),
    shippingDetailsCiphertext: keyring.encrypt(JSON.stringify({
      firstName: "Ada",
      lastName: "Bouwer",
      addressLine1: "Steigerstraat 42",
      addressLine2: null,
      postalCode: "1234 AB",
      city: "Utrecht",
      state: null,
      countryCode: "NL",
    }), `photobook-order:${orderId}:shipping-address`),
    checkoutSnapshot: {
      schemaVersion: 1,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      projectTitle: "Ons jaren-dertighuis",
      pageCount: 48,
      taxTreatment: "vat_included",
      personalisedProduct: true,
    },
    sellerSnapshot: {
      legalName: "Buildy B.V.",
      tradeName: "Buildy",
      registrationNumber: "12345678",
      vatNumber: "NL001234567B01",
      address: "Bouwlaan 1, 3511 AA Utrecht",
      countryCode: "NL",
      supportEmail: "support@buildy.test",
    },
    termsVersion: "voorwaarden-2026-08",
    deliveryEstimate: "5–8 werkdagen na productie",
    status: "paid",
    paymentStatus: "paid",
    fulfilmentStatus: "unclaimed",
    trackingUrl: null,
    createdAt: new Date("2026-08-04T10:15:00.000Z"),
    paidAt: new Date("2026-08-04T10:16:00.000Z"),
  };
}

function confirmationEvent() {
  return {
    id: "10000000-0000-4000-8000-000000000023",
    aggregateId: orderId,
    aggregateType: "photobook_order" as const,
    eventType: "order.email.confirmation.requested.v1",
    idempotencyKey: `order:${orderId}:email:confirmation:v1`,
    payload: { schemaVersion: 1, orderId },
    attemptCount: 1,
  };
}

describe("protected order e-mail payload", () => {
  it("renders the immutable legal order facts and persists only delivery-safe metadata", () => {
    const { keyring, blindIndex, templates } = dependencies();
    const rawContext = context();
    const { prepared } = prepareOrderEmail({
      rawEvent: confirmationEvent(),
      rawContext,
      keyring,
      blindIndex,
      templates,
      appOrigin: "https://app.buildy.test",
    });

    expect(prepared.message.content?.subject).toContain(rawContext.orderNumber);
    expect(prepared.message.content?.text).toContain("Pagina’s: 48");
    expect(prepared.message.content?.text).toContain("Aantal: 2");
    expect(prepared.message.content?.text).toContain("Steigerstraat 42");
    expect(prepared.message.content?.text).toContain("Buildy B.V.");
    expect(prepared.message.content?.text).toContain("voorwaarden-2026-08");
    expect(prepared.message.content?.text).toContain("Gepersonaliseerd maatwerk");
    expect(prepared.message.content?.text).toContain(`/bestellingen/${orderId}`);

    expect(prepared.delivery).toEqual({
      idempotencyKey: `order:${orderId}:email:confirmation:v1`,
      recipientHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      templateKey: "order.confirmation",
      templateVersion: "content-2026-08-04",
    });
    const durableMetadata = JSON.stringify(prepared.delivery);
    expect(durableMetadata).not.toContain("bouwer@example.test");
    expect(durableMetadata).not.toContain("Steigerstraat");
    expect(durableMetadata).not.toContain(rawContext.customerEmailCiphertext);
  });

  it("rejects event/order mismatches and ciphertext copied under the wrong AAD", () => {
    const { keyring, blindIndex, templates } = dependencies();
    const wrongOrder = { ...context(), orderId: "10000000-0000-4000-8000-000000000099" };

    expect(() => prepareOrderEmail({
      rawEvent: confirmationEvent(),
      rawContext: wrongOrder,
      keyring,
      blindIndex,
      templates,
      appOrigin: "https://app.buildy.test",
    })).toThrow(OrderEmailPayloadError);

    const copiedCiphertext = {
      ...context(),
      customerEmailCiphertext: keyring.encrypt(
        "attacker@example.test",
        "photobook-order:10000000-0000-4000-8000-000000000099:customer-email",
      ),
    };
    expect(() => prepareOrderEmail({
      rawEvent: confirmationEvent(),
      rawContext: copiedCiphertext,
      keyring,
      blindIndex,
      templates,
      appOrigin: "https://app.buildy.test",
    })).toThrow(OrderEmailPayloadError);
  });

  it("refuses a non-HTTPS order-status origin", () => {
    const { keyring, blindIndex, templates } = dependencies();
    expect(() => prepareOrderEmail({
      rawEvent: confirmationEvent(),
      rawContext: context(),
      keyring,
      blindIndex,
      templates,
      appOrigin: "http://app.buildy.test",
    })).toThrow("veilige applicatie-origin");
  });

  it("dead-letters misleading mail intent after the server state has moved on", () => {
    const { keyring, blindIndex, templates } = dependencies();
    const staleFailure = {
      ...confirmationEvent(),
      eventType: "order.email.payment_failed.requested.v1",
      idempotencyKey: `order:${orderId}:email:payment-failed:v1`,
    };

    expect(() => prepareOrderEmail({
      rawEvent: staleFailure,
      rawContext: context(),
      keyring,
      blindIndex,
      templates,
      appOrigin: "https://app.buildy.test",
    })).toThrow("actuele serverstatus");
  });
});

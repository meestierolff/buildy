// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { getCapabilities, getProductProfile } from "../../server/config/runtime";

const priceMatrix = JSON.stringify({
  version: 1,
  environment: "test",
  currency: "EUR",
  approvalStatus: "approved",
  commercialApprovalId: "approval-test-2026-08",
  approvedBy: "Test commerce owner",
  approvedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2030-09-01T00:00:00.000Z",
  entries: [{
    sku: "a4-landscape-hardcover-v1",
    countryCode: "NL",
    minimumPages: 24,
    maximumPages: 400,
    minimumQuantity: 1,
    maximumQuantity: 5,
    unitBaseMinor: 4_000,
    unitAdditionalPageMinor: 25,
    shippingBaseMinor: 800,
    shippingAdditionalCopyMinor: 200,
    taxRateBasisPoints: 2_100,
    taxTreatment: "vat_exclusive",
    deliveryEstimate: "5–8 werkdagen na handmatige drukopdracht",
    productReference: "buildy-a4-landscape-hardcover-v1",
  }],
});

const sellerConfiguration = JSON.stringify({
  version: 1,
  environment: "test",
  approvalStatus: "approved",
  approvalId: "seller-test-2026-08",
  approvedBy: "Test legal owner",
  approvedAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2030-09-01T00:00:00.000Z",
  seller: {
    legalName: "Buildy Test B.V.",
    tradeName: "Buildy",
    registrationNumber: "TEST-ONLY",
    vatNumber: null,
    address: "Testadres 1, Utrecht",
    countryCode: "NL",
    supportEmail: "support@example.test",
  },
});

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    PRODUCT_PROFILE: "feedback_beta",
    CHECKOUT_MODE: "off",
    BETA_MODE: true,
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:secret@127.0.0.1:5432/buildy_test",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PHOTOBOOK_WORKER_URL: "postgresql://photobook:secret@127.0.0.1:5432/buildy_test",
    ACCOUNT_RETENTION_POLICY_VERSION: "policy-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-08-14T10:00:00.000Z",
    CRON_SECRET: "b".repeat(32),
    BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${"b".repeat(48)}`,
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    ...overrides,
  };
}

describe("product profile", () => {
  it("publishes the server-owned feedback-beta profile", () => {
    const profile = getProductProfile(configured());

    expect(profile.profile).toBe("feedback_beta");
    expect(profile.checkoutMode).toBe("off");
    expect(profile.capabilities.emailAuth).toBe(false);
    expect(profile.capabilities.checkout).toBe(false);
    expect(profile.capabilities.googleSignIn).toBe(true);
  });

  it("keeps the digital photobook available without the isolated media worker", () => {
    const profile = getProductProfile(configured({
      DATABASE_MEDIA_WORKER_URL: undefined,
      DATABASE_PHOTOBOOK_WORKER_URL: undefined,
    }));

    expect(profile.capabilities.media).toBe(false);
    expect(profile.capabilities.photobookPreview).toBe(true);
  });

  it("publishes approved Stripe Checkout while automated fulfilment remains disabled", () => {
    const runtime = configured({
      CHECKOUT_MODE: "test",
      DATABASE_PAYMENT_WORKER_URL: "postgresql://payment:secret@127.0.0.1:5432/buildy_test",
      STRIPE_SECRET_KEY: "sk_test_synthetic",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
      STRIPE_EXPECTED_ACCOUNT_ID: "acct_BUILDYTEST",
      STRIPE_ENVIRONMENT: "test",
      ORDER_PRICE_MATRIX_JSON: priceMatrix,
      ORDER_SELLER_JSON: sellerConfiguration,
      ORDER_TERMS_VERSION: "2026-08-01",
    });
    const capabilities = getCapabilities(runtime);
    const profile = getProductProfile(runtime);

    expect(capabilities.email).toBe("disabled");
    expect(capabilities.payments).toBe("ready");
    expect(capabilities.printFulfilment).toBe("disabled");
    expect(profile.checkoutMode).toBe("test");
    expect(profile.capabilities.checkout).toBe(true);
  });
});

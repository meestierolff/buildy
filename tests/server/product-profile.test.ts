// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import {
  getCapabilities,
  getProductProfile,
  getRuntimeConfig,
  resetRuntimeConfigForTests,
} from "../../server/config/runtime";

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
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it("accepts public_demo as the single unauthenticated runtime profile", () => {
    vi.stubEnv("PRODUCT_PROFILE", "public_demo");
    resetRuntimeConfigForTests();

    expect(getRuntimeConfig().PRODUCT_PROFILE).toBe("public_demo");
  });

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

  it("publishes a provider-independent public demo without account or social promises", () => {
    const runtime = configured({
      PRODUCT_PROFILE: "public_demo",
      BETA_MODE: true,
      CHECKOUT_MODE: "test",
    });
    const capabilities = getCapabilities(runtime);
    const profile = getProductProfile(runtime);

    expect(capabilities).toMatchObject({
      database: "ready",
      authentication: "disabled",
      accountLifecycle: "disabled",
      media: "disabled",
      photobooks: "disabled",
      email: "disabled",
      payments: "disabled",
      printFulfilment: "disabled",
      privateBeta: "disabled",
    });
    expect(profile).toEqual({
      profile: "public_demo",
      checkoutMode: "off",
      betaMode: false,
      inviteRequiredForNewAccounts: false,
      capabilities: {
        googleSignIn: false,
        emailAuth: false,
        renovations: false,
        updates: false,
        story: false,
        media: false,
        photobookPreview: true,
        sharing: false,
        feedback: true,
        accountDeletion: false,
        checkout: false,
      },
    });
  });

  it("keeps the static demo available when every account provider is absent", () => {
    const runtime = configured({
      PRODUCT_PROFILE: "public_demo",
      DATABASE_URL: undefined,
      DATABASE_ACCOUNT_WORKER_URL: undefined,
      DATABASE_MEDIA_WORKER_URL: undefined,
      DATABASE_PHOTOBOOK_WORKER_URL: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
    });

    expect(getCapabilities(runtime)).toMatchObject({
      database: "unconfigured",
      authentication: "disabled",
      accountLifecycle: "disabled",
      media: "disabled",
      photobooks: "disabled",
    });
    expect(getProductProfile(runtime).capabilities).toMatchObject({
      googleSignIn: false,
      renovations: false,
      updates: false,
      story: false,
      media: false,
      photobookPreview: true,
      sharing: false,
      feedback: false,
      accountDeletion: false,
      checkout: false,
    });
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

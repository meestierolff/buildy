// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { getCapabilities, getProductProfile } from "../../server/config/runtime";

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    PRODUCT_PROFILE: "feedback_beta",
    CHECKOUT_MODE: "off",
    CHECKOUT_ENABLED: false,
    BETA_MODE: true,
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    BETTER_AUTH_SECRET: "a".repeat(32),
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:secret@127.0.0.1:5432/buildy_test",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PHOTOBOOK_WORKER_URL: "postgresql://photobook:secret@127.0.0.1:5432/buildy_test",
    ACCOUNT_RETENTION_POLICY_VERSION: "policy-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-08-14T10:00:00.000Z",
    CRON_SECRET: "b".repeat(32),
    R2_ACCOUNT_ID: "legacy-r2-account",
    R2_BUCKET_NAME: "legacy-r2-bucket",
    R2_WEB_ACCESS_KEY_ID: "legacy-web-key",
    R2_WEB_SECRET_ACCESS_KEY: "legacy-web-secret",
    R2_ACCOUNT_WORKER_ACCESS_KEY_ID: "legacy-account-key",
    R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY: "legacy-account-secret",
    R2_MEDIA_WORKER_ACCESS_KEY_ID: "legacy-media-key",
    R2_MEDIA_WORKER_SECRET_ACCESS_KEY: "legacy-media-secret",
    R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID: "legacy-photobook-key",
    R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY: "legacy-photobook-secret",
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

  it("does not advertise media or photobook preview when those capabilities are unavailable", () => {
    const profile = getProductProfile(configured({
      DATABASE_MEDIA_WORKER_URL: undefined,
      DATABASE_PHOTOBOOK_WORKER_URL: undefined,
    }));

    expect(profile.capabilities.media).toBe(false);
    expect(profile.capabilities.photobookPreview).toBe(false);
  });

  it("keeps disabled providers out of active capability truth", () => {
    const capabilities = getCapabilities(configured({
      CHECKOUT_ENABLED: true,
      DATABASE_PAYMENT_WORKER_URL: "postgresql://payment:secret@127.0.0.1:5432/buildy_test",
      DATABASE_FULFILMENT_WORKER_URL: "postgresql://fulfilment:secret@127.0.0.1:5432/buildy_test",
      STRIPE_SECRET_KEY: "sk_test_synthetic",
      STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
      STRIPE_EXPECTED_ACCOUNT_ID: "acct_BUILDYTEST",
      STRIPE_ENVIRONMENT: "test",
      ORDER_PRICE_MATRIX_JSON: "{}",
      ORDER_SELLER_JSON: "{}",
      ORDER_TERMS_VERSION: "2026-08-01",
      R2_FULFILMENT_WORKER_ACCESS_KEY_ID: "fulfilment-key",
      R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY: "fulfilment-secret",
      PEECHO_ENVIRONMENT: "test",
      PEECHO_MERCHANT_API_KEY: "merchant-key",
      PEECHO_SECRET_KEY: "provider-secret",
      PEECHO_OFFERING_ID_A4_LANDSCAPE: "123",
      PEECHO_PDF_SIGNED_URL_TTL_SECONDS: 604800,
    }));

    expect(capabilities.email).toBe("disabled");
    expect(capabilities.payments).toBe("disabled");
    expect(capabilities.printFulfilment).toBe("disabled");
  });
});
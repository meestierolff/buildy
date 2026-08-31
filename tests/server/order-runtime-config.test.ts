// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { getCapabilities } from "../../server/config/runtime";
import {
  checkoutConfigurationIssues,
  parseApprovedSellerSnapshot,
} from "../../server/orders/checkoutConfiguration";
import { hasCompleteOrderRuntime } from "../../server/orders/config";

function priceMatrix(environment: "test" | "live") {
  return JSON.stringify({
    version: 1,
    environment,
    currency: "EUR",
    approvalStatus: "approved",
    commercialApprovalId: `approval-${environment}-2026-08`,
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
}

function sellerConfiguration(environment: "test" | "live") {
  return JSON.stringify({
    version: 1,
    environment,
    approvalStatus: "approved",
    approvalId: `seller-${environment}-2026-08`,
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
}

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    PRODUCT_PROFILE: "feedback_beta",
    CHECKOUT_MODE: "test",
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PAYMENT_WORKER_URL: "postgresql://payment:secret@127.0.0.1:5432/buildy_test",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_EXPECTED_ACCOUNT_ID: "acct_BUILDYTEST",
    STRIPE_ENVIRONMENT: "test",
    ORDER_PRICE_MATRIX_JSON: priceMatrix("test"),
    ORDER_SELLER_JSON: sellerConfiguration("test"),
    ORDER_TERMS_VERSION: "2026-08-01",
    ...overrides,
  };
}

describe("order runtime configuration", () => {
  it("activates test checkout only from the exact mode and complete approved configuration", () => {
    const runtime = configured();

    expect(hasCompleteOrderRuntime(runtime)).toBe(true);
    expect(checkoutConfigurationIssues(runtime)).toEqual([]);
    expect(getCapabilities(runtime).payments).toBe("ready");
  });

  it("activates live checkout only with matching live Stripe and commercial configuration", () => {
    const runtime = configured({
      APP_ENV: "production",
      CHECKOUT_MODE: "live",
      STRIPE_ENVIRONMENT: "live",
      STRIPE_SECRET_KEY: "sk_live_synthetic",
      ORDER_PRICE_MATRIX_JSON: priceMatrix("live"),
      ORDER_SELLER_JSON: sellerConfiguration("live"),
    });

    expect(hasCompleteOrderRuntime(runtime)).toBe(true);
    expect(getCapabilities(runtime).payments).toBe("ready");
  });

  it("never permits live Stripe outside production or test Stripe in production", () => {
    const previewLive = configured({
      APP_ENV: "preview",
      CHECKOUT_MODE: "live",
      STRIPE_ENVIRONMENT: "live",
      STRIPE_SECRET_KEY: "sk_live_synthetic",
      ORDER_PRICE_MATRIX_JSON: priceMatrix("live"),
      ORDER_SELLER_JSON: sellerConfiguration("live"),
    });
    const productionTest = configured({ APP_ENV: "production" });

    expect(checkoutConfigurationIssues(previewLive)).toContain(
      "checkout_application_environment_mismatch",
    );
    expect(checkoutConfigurationIssues(productionTest)).toContain(
      "checkout_application_environment_mismatch",
    );
    expect(getCapabilities(previewLive).payments).toBe("unconfigured");
    expect(getCapabilities(productionTest).payments).toBe("unconfigured");
  });

  it("fails closed in off mode regardless of the retired boolean flag", () => {
    const runtime = {
      ...configured({ CHECKOUT_MODE: "off" }),
      CHECKOUT_ENABLED: true,
    };

    expect(hasCompleteOrderRuntime(runtime)).toBe(false);
    expect(getCapabilities(runtime).payments).toBe("disabled");
  });

  it("reports active checkout as unconfigured when webhook, key or matrix mode mismatches", () => {
    const webhookMissing = configured({ STRIPE_WEBHOOK_SECRET: undefined });
    const liveModeWithTestConfig = configured({ CHECKOUT_MODE: "live" });

    expect(hasCompleteOrderRuntime(webhookMissing)).toBe(false);
    expect(getCapabilities(webhookMissing).payments).toBe("unconfigured");
    expect(checkoutConfigurationIssues(liveModeWithTestConfig)).toEqual(expect.arrayContaining([
      "stripe_environment_mismatch",
      "stripe_key_mode_mismatch",
      "price_matrix_environment_mismatch",
      "seller_configuration_invalid",
    ]));
    expect(hasCompleteOrderRuntime(liveModeWithTestConfig)).toBe(false);
  });

  it("requires a current, explicitly approved seller envelope", () => {
    const plainSeller = JSON.stringify({
      legalName: "Buildy Test B.V.",
      tradeName: "Buildy",
      registrationNumber: "TEST-ONLY",
      vatNumber: null,
      address: "Testadres",
      countryCode: "NL",
      supportEmail: "support@example.test",
    });

    expect(() => parseApprovedSellerSnapshot(plainSeller, "test")).toThrow();
    expect(hasCompleteOrderRuntime(configured({ ORDER_SELLER_JSON: plainSeller }))).toBe(false);
  });
});

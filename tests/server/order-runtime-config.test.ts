// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { getCapabilities } from "../../server/config/runtime";
import { hasCompleteOrderRuntime } from "../../server/orders/config";

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    CHECKOUT_ENABLED: true,
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PAYMENT_WORKER_URL: "postgresql://payment:secret@127.0.0.1:5432/buildy_test",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_EXPECTED_ACCOUNT_ID: "acct_BUILDYTEST",
    STRIPE_ENVIRONMENT: "test",
    ORDER_PRICE_MATRIX_JSON: "{}",
    ORDER_SELLER_JSON: "{}",
    ORDER_TERMS_VERSION: "2026-08-01",
    ...overrides,
  };
}

describe("order runtime configuration", () => {
  it("enables checkout and webhook processing only as one complete capability", () => {
    const runtime = configured();

    expect(hasCompleteOrderRuntime(runtime)).toBe(true);
    expect(getCapabilities(runtime).payments).toBe("ready");
  });

  it("keeps payments closed when the isolated webhook credential is absent", () => {
    const runtime = configured({ DATABASE_PAYMENT_WORKER_URL: undefined });

    expect(hasCompleteOrderRuntime(runtime)).toBe(false);
    expect(getCapabilities(runtime).payments).toBe("unconfigured");
  });

  it("keeps checkout capability closed until it is explicitly activated", () => {
    const runtime = configured({ CHECKOUT_ENABLED: false });

    expect(hasCompleteOrderRuntime(runtime)).toBe(true);
    expect(getCapabilities(runtime).payments).toBe("unconfigured");
  });
});

// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getCapabilities, type RuntimeConfig } from "../../server/config/runtime";

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    PRODUCT_PROFILE: "feedback_beta",
    CHECKOUT_MODE: "off",
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:secret@127.0.0.1:5432/buildy_test",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PHOTOBOOK_WORKER_URL: "postgresql://photobook:secret@127.0.0.1:5432/buildy_test",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    ACCOUNT_RETENTION_POLICY_VERSION: "owner-approved-policy-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-08-04T12:00:00.000Z",
    CRON_SECRET: "b".repeat(32),
    BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${"b".repeat(48)}`,
    ...overrides,
  };
}

describe("private Vercel Blob runtime configuration", () => {
  it("reports Blob-backed feedback-beta capabilities as ready", () => {
    const capabilities = getCapabilities(configured());

    expect(capabilities.accountLifecycle).toBe("ready");
    expect(capabilities.media).toBe("ready");
    expect(capabilities.photobooks).toBe("ready");
    expect(capabilities.email).toBe("disabled");
    expect(capabilities.printFulfilment).toBe("disabled");
  });

  it("keeps every Blob-backed capability fail-closed when the token is absent", () => {
    const capabilities = getCapabilities(configured({ BLOB_READ_WRITE_TOKEN: undefined }));

    expect(capabilities.accountLifecycle).toBe("unconfigured");
    expect(capabilities.media).toBe("unconfigured");
    expect(capabilities.photobooks).toBe("unconfigured");
  });

  it("keeps request-driven media and Bouwboek ready without a cron secret", () => {
    const capabilities = getCapabilities(configured({ CRON_SECRET: undefined }));

    expect(capabilities.accountLifecycle).toBe("unconfigured");
    expect(capabilities.media).toBe("ready");
    expect(capabilities.photobooks).toBe("ready");
  });

  it("keeps the digital Bouwboek ready without the dormant print worker", () => {
    const capabilities = getCapabilities(configured({ DATABASE_PHOTOBOOK_WORKER_URL: undefined }));

    expect(capabilities.photobooks).toBe("ready");
  });
});

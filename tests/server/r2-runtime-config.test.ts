// @vitest-environment node

import { describe, expect, it } from "vitest";
import { getCapabilities, type RuntimeConfig } from "../../server/config/runtime";

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    CHECKOUT_ENABLED: false,
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:secret@127.0.0.1:5432/buildy_test",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PHOTOBOOK_WORKER_URL: "postgresql://photobook:secret@127.0.0.1:5432/buildy_test",
    DATABASE_FULFILMENT_WORKER_URL: "postgresql://fulfilment:secret@127.0.0.1:5432/buildy_test",
    BETTER_AUTH_SECRET: "a".repeat(32),
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    ACCOUNT_RETENTION_POLICY_VERSION: "owner-approved-policy-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-08-04T12:00:00.000Z",
    CRON_SECRET: "b".repeat(32),
    R2_ACCOUNT_ID: "synthetic-account",
    R2_BUCKET_NAME: "buildy-test-private",
    R2_WEB_ACCESS_KEY_ID: "web-access-key",
    R2_WEB_SECRET_ACCESS_KEY: "web-secret-key",
    R2_ACCOUNT_WORKER_ACCESS_KEY_ID: "account-worker-access-key",
    R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY: "account-worker-secret-key",
    R2_MEDIA_WORKER_ACCESS_KEY_ID: "media-worker-access-key",
    R2_MEDIA_WORKER_SECRET_ACCESS_KEY: "media-worker-secret-key",
    R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID: "photobook-worker-access-key",
    R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY: "photobook-worker-secret-key",
    R2_FULFILMENT_WORKER_ACCESS_KEY_ID: "fulfilment-worker-access-key",
    R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY: "fulfilment-worker-secret-key",
    PEECHO_ENVIRONMENT: "test",
    PEECHO_MERCHANT_API_KEY: "merchant-key",
    PEECHO_SECRET_KEY: "provider-secret",
    PEECHO_OFFERING_ID_A4_LANDSCAPE: "123",
    PEECHO_PDF_SIGNED_URL_TTL_SECONDS: 604_800,
    ...overrides,
  };
}

describe("R2 boundary runtime configuration", () => {
  it("reports every R2-backed capability ready with all isolated credentialpairs", () => {
    const capabilities = getCapabilities(configured());

    expect(capabilities.accountLifecycle).toBe("ready");
    expect(capabilities.media).toBe("ready");
    expect(capabilities.photobooks).toBe("ready");
    expect(capabilities.printFulfilment).toBe("ready");
  });

  it.each([
    ["accountLifecycle", "R2_WEB_ACCESS_KEY_ID"],
    ["accountLifecycle", "R2_WEB_SECRET_ACCESS_KEY"],
    ["accountLifecycle", "R2_ACCOUNT_WORKER_ACCESS_KEY_ID"],
    ["accountLifecycle", "R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY"],
    ["media", "R2_WEB_ACCESS_KEY_ID"],
    ["media", "R2_WEB_SECRET_ACCESS_KEY"],
    ["media", "R2_MEDIA_WORKER_ACCESS_KEY_ID"],
    ["media", "R2_MEDIA_WORKER_SECRET_ACCESS_KEY"],
    ["photobooks", "R2_WEB_ACCESS_KEY_ID"],
    ["photobooks", "R2_WEB_SECRET_ACCESS_KEY"],
    ["photobooks", "R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID"],
    ["photobooks", "R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY"],
    ["printFulfilment", "R2_FULFILMENT_WORKER_ACCESS_KEY_ID"],
    ["printFulfilment", "R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY"],
  ] as const)("keeps %s fail-closed when %s is absent", (capability, key) => {
    expect(getCapabilities(configured({ [key]: undefined }))[capability]).toBe("unconfigured");
  });

  it("does not accept the retired generic keypair as a fallback", () => {
    const legacyOnly: RuntimeConfig & {
      R2_ACCESS_KEY_ID: string;
      R2_SECRET_ACCESS_KEY: string;
    } = {
      ...configured({
        R2_WEB_ACCESS_KEY_ID: undefined,
        R2_WEB_SECRET_ACCESS_KEY: undefined,
        R2_ACCOUNT_WORKER_ACCESS_KEY_ID: undefined,
        R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY: undefined,
        R2_MEDIA_WORKER_ACCESS_KEY_ID: undefined,
        R2_MEDIA_WORKER_SECRET_ACCESS_KEY: undefined,
        R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID: undefined,
        R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY: undefined,
        R2_FULFILMENT_WORKER_ACCESS_KEY_ID: undefined,
        R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY: undefined,
      }),
      R2_ACCESS_KEY_ID: "retired-access-key",
      R2_SECRET_ACCESS_KEY: "retired-secret-key",
    };
    const capabilities = getCapabilities(legacyOnly);

    expect(capabilities.accountLifecycle).toBe("unconfigured");
    expect(capabilities.media).toBe("unconfigured");
    expect(capabilities.photobooks).toBe("unconfigured");
    expect(capabilities.printFulfilment).toBe("unconfigured");
  });
});

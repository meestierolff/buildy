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
    BETTER_AUTH_SECRET: "a".repeat(32),
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    ACCOUNT_RETENTION_POLICY_VERSION: "owner-approved-policy-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-08-04T12:00:00.000Z",
    CRON_SECRET: "b".repeat(32),
    R2_ACCOUNT_ID: "synthetic-account",
    R2_BUCKET_NAME: "buildy-test-private",
    R2_WEB_ACCESS_KEY_ID: "synthetic-web-access-key",
    R2_WEB_SECRET_ACCESS_KEY: "synthetic-web-secret-key",
    R2_ACCOUNT_WORKER_ACCESS_KEY_ID: "synthetic-account-worker-access-key",
    R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY: "synthetic-account-worker-secret-key",
    ...overrides,
  };
}

describe("account lifecycle runtime configuration", () => {
  it("wordt alleen ready met auth, private storage, worker en expliciet goedgekeurd retentiebeleid", () => {
    expect(getCapabilities(configured()).accountLifecycle).toBe("ready");
  });

  it.each([
    "DATABASE_URL",
    "DATABASE_ACCOUNT_WORKER_URL",
    "BETTER_AUTH_SECRET",
    "PII_ENCRYPTION_KEYS",
    "PII_ENCRYPTION_CURRENT_VERSION",
    "PII_BLIND_INDEX_KEY",
    "ACCOUNT_RETENTION_POLICY_VERSION",
    "ACCOUNT_RETENTION_POLICY_APPROVED_AT",
    "CRON_SECRET",
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_WEB_ACCESS_KEY_ID",
    "R2_WEB_SECRET_ACCESS_KEY",
    "R2_ACCOUNT_WORKER_ACCESS_KEY_ID",
    "R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY",
  ] as const)("blijft fail-closed wanneer %s ontbreekt", (key) => {
    expect(getCapabilities(configured({ [key]: undefined })).accountLifecycle)
      .toBe("unconfigured");
  });
});

// @vitest-environment node

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureServerComposition,
  resetServerCompositionForTests,
} from "../../server/composition";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { closeBuildyDatabaseForTests } from "../../server/db/client";

const { capturedR2Configurations } = vi.hoisted(() => ({
  capturedR2Configurations: [] as Array<{
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }>,
}));

vi.mock("../../server/storage/r2ObjectStorage", () => ({
  R2ObjectStorage: class R2ObjectStorage {
    constructor(configuration: (typeof capturedR2Configurations)[number]) {
      capturedR2Configurations.push(configuration);
    }
  },
}));

function stubBaseEnvironment(): void {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("APP_ORIGIN", "https://app.buildy.test");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  vi.stubEnv("PII_ENCRYPTION_KEYS", "");
  vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "");
  vi.stubEnv("PII_BLIND_INDEX_KEY", "");
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_BUCKET_NAME",
    "R2_WEB_ACCESS_KEY_ID",
    "R2_WEB_SECRET_ACCESS_KEY",
    "R2_ACCOUNT_WORKER_ACCESS_KEY_ID",
    "R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY",
    "R2_MEDIA_WORKER_ACCESS_KEY_ID",
    "R2_MEDIA_WORKER_SECRET_ACCESS_KEY",
    "R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID",
    "R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY",
    "R2_FULFILMENT_WORKER_ACCESS_KEY_ID",
    "R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY",
  ]) vi.stubEnv(name, "");
}

function stubAuthEnvironment(): void {
  vi.stubEnv("DATABASE_URL", "postgresql://buildy:buildy@127.0.0.1:5432/buildy");
  vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
  vi.stubEnv("PII_ENCRYPTION_KEYS", JSON.stringify({ 1: randomBytes(32).toString("base64") }));
  vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "1");
  vi.stubEnv("PII_BLIND_INDEX_KEY", randomBytes(32).toString("base64"));
}

describe("server composition", () => {
  beforeEach(() => {
    stubBaseEnvironment();
    capturedR2Configurations.length = 0;
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();
    await closeBuildyDatabaseForTests();
  });

  it("keeps protected runtimes fail-closed when credentials are absent", () => {
    expect(ensureServerComposition()).toBe("unconfigured");
    expect(ensureServerComposition()).toBe("unconfigured");
  });

  it("composes auth and projects exactly once from validated server-only keys", () => {
    stubAuthEnvironment();
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(ensureServerComposition()).toBe("ready");
  });

  it("remembers malformed key configuration as failed without retrying initialization", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://buildy:buildy@127.0.0.1:5432/buildy");
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("PII_ENCRYPTION_KEYS", "not-json");
    vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "1");
    vi.stubEnv("PII_BLIND_INDEX_KEY", randomBytes(32).toString("base64"));
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("failed");
    expect(ensureServerComposition()).toBe("failed");
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("not-json");
  });

  it("does not compose a web or worker storage for an incomplete R2 credentialpair", () => {
    stubAuthEnvironment();
    vi.stubEnv("DATABASE_MEDIA_WORKER_URL", "postgresql://media:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("CRON_SECRET", "c".repeat(32));
    vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account");
    vi.stubEnv("R2_BUCKET_NAME", "buildy-test-private");
    vi.stubEnv("R2_WEB_ACCESS_KEY_ID", "web-access");
    vi.stubEnv("R2_WEB_SECRET_ACCESS_KEY", "web-secret");
    vi.stubEnv("R2_MEDIA_WORKER_ACCESS_KEY_ID", "media-access");
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(capturedR2Configurations).toHaveLength(0);
  });

  it("composes one web storage and a distinct credential boundary for every R2 worker", () => {
    stubAuthEnvironment();
    vi.stubEnv("DATABASE_ACCOUNT_WORKER_URL", "postgresql://account:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("DATABASE_MEDIA_WORKER_URL", "postgresql://media:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("DATABASE_PHOTOBOOK_WORKER_URL", "postgresql://photobook:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("DATABASE_FULFILMENT_WORKER_URL", "postgresql://fulfilment:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("ACCOUNT_RETENTION_POLICY_VERSION", "approved-v1");
    vi.stubEnv("ACCOUNT_RETENTION_POLICY_APPROVED_AT", "2026-08-04T12:00:00.000Z");
    vi.stubEnv("CRON_SECRET", "c".repeat(32));
    vi.stubEnv("R2_ACCOUNT_ID", "synthetic-account");
    vi.stubEnv("R2_BUCKET_NAME", "buildy-test-private");
    for (const [name, value] of [
      ["R2_WEB_ACCESS_KEY_ID", "web-access"],
      ["R2_WEB_SECRET_ACCESS_KEY", "web-secret"],
      ["R2_ACCOUNT_WORKER_ACCESS_KEY_ID", "account-access"],
      ["R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY", "account-secret"],
      ["R2_MEDIA_WORKER_ACCESS_KEY_ID", "media-access"],
      ["R2_MEDIA_WORKER_SECRET_ACCESS_KEY", "media-secret"],
      ["R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID", "photobook-access"],
      ["R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY", "photobook-secret"],
      ["R2_FULFILMENT_WORKER_ACCESS_KEY_ID", "fulfilment-access"],
      ["R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY", "fulfilment-secret"],
    ] as const) vi.stubEnv(name, value);
    vi.stubEnv("PEECHO_ENVIRONMENT", "test");
    vi.stubEnv("PEECHO_MERCHANT_API_KEY", "merchant-key");
    vi.stubEnv("PEECHO_SECRET_KEY", "provider-secret");
    vi.stubEnv("PEECHO_OFFERING_ID_A4_LANDSCAPE", "123");
    vi.stubEnv("PEECHO_PDF_SIGNED_URL_TTL_SECONDS", "604800");
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(capturedR2Configurations).toHaveLength(5);
    expect(capturedR2Configurations.map(({ accessKeyId, secretAccessKey }) => ({
      accessKeyId,
      secretAccessKey,
    }))).toEqual(expect.arrayContaining([
      { accessKeyId: "web-access", secretAccessKey: "web-secret" },
      { accessKeyId: "account-access", secretAccessKey: "account-secret" },
      { accessKeyId: "media-access", secretAccessKey: "media-secret" },
      { accessKeyId: "photobook-access", secretAccessKey: "photobook-secret" },
      { accessKeyId: "fulfilment-access", secretAccessKey: "fulfilment-secret" },
    ]));
    expect(new Set(capturedR2Configurations).size).toBe(5);
    expect(capturedR2Configurations.every((configuration) => (
      configuration.accountId === "synthetic-account"
      && configuration.bucketName === "buildy-test-private"
    ))).toBe(true);
  });
});

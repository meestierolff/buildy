// @vitest-environment node

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureServerComposition,
  resetServerCompositionForTests,
} from "../../server/composition";
import { resolveDefaultAccountWorker } from "../../server/account/runtime";
import { handleDefaultAuthRequest } from "../../server/auth";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { closeBuildyDatabaseForTests } from "../../server/db/client";
import { handleDefaultModerationRequest } from "../../server/moderation/runtime";
import { handleDefaultProjectRequest } from "../../server/projects/runtime";

const { capturedBlobConfigurations } = vi.hoisted(() => ({
  capturedBlobConfigurations: [] as Array<{
    token: string;
    sdk: Record<string, unknown>;
  }>,
}));

vi.mock("../../server/storage/vercelBlobObjectStorage", () => ({
  VERCEL_BLOB_STORAGE_NAMESPACE: "vercel-blob-private",
  VercelBlobObjectStorage: class VercelBlobObjectStorage {
    constructor(configuration: (typeof capturedBlobConfigurations)[number]) {
      capturedBlobConfigurations.push(configuration);
    }
  },
}));

function stubBaseEnvironment(): void {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("APP_ORIGIN", "https://app.buildy.test");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  vi.stubEnv("PII_ENCRYPTION_KEYS", "");
  vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "");
  vi.stubEnv("PII_BLIND_INDEX_KEY", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
}

function stubAuthEnvironment(): void {
  vi.stubEnv("DATABASE_URL", "postgresql://buildy:buildy@127.0.0.1:5432/buildy");
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
  vi.stubEnv("PII_ENCRYPTION_KEYS", JSON.stringify({ 1: randomBytes(32).toString("base64") }));
  vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "1");
  vi.stubEnv("PII_BLIND_INDEX_KEY", randomBytes(32).toString("base64"));
}

describe("server composition", () => {
  beforeEach(() => {
    stubBaseEnvironment();
    capturedBlobConfigurations.length = 0;
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

  it("composes auth and verbouwingen exactly once from validated server-only keys", () => {
    stubAuthEnvironment();
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(ensureServerComposition()).toBe("ready");
    expect(capturedBlobConfigurations).toHaveLength(0);
  });

  it("composes only anonymous support while authenticated runtimes remain dormant", async () => {
    stubAuthEnvironment();
    vi.stubEnv("PRODUCT_PROFILE", "public_demo");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", `vercel_blob_rw_${"b".repeat(48)}`);
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(ensureServerComposition()).toBe("ready");
    expect(capturedBlobConfigurations).toHaveLength(0);

    const requestId = "00000000-0000-4000-8000-000000000000";
    const support = await handleDefaultModerationRequest(
      new Request("https://app.buildy.test/api/support"),
      requestId,
    );
    const auth = await handleDefaultAuthRequest(
      new Request("https://app.buildy.test/api/auth/session"),
      requestId,
    );
    const projects = await handleDefaultProjectRequest(
      new Request("https://app.buildy.test/api/projects"),
      requestId,
    );

    expect(support.status).toBe(404);
    expect(auth.status).toBe(503);
    expect(projects.status).toBe(503);
  });

  it("remembers malformed key configuration as failed without retrying initialization", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://buildy:buildy@127.0.0.1:5432/buildy");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.stubEnv("PII_ENCRYPTION_KEYS", "not-json");
    vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "1");
    vi.stubEnv("PII_BLIND_INDEX_KEY", randomBytes(32).toString("base64"));
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("failed");
    expect(ensureServerComposition()).toBe("failed");
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain("not-json");
  });

  it("does not compose Blob-backed domains without the private store token", () => {
    stubAuthEnvironment();
    vi.stubEnv("DATABASE_MEDIA_WORKER_URL", "postgresql://media:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("CRON_SECRET", "c".repeat(32));
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(capturedBlobConfigurations).toHaveLength(0);
  });

  it("shares one private Vercel Blob adapter across web, workers and guarded order admin", () => {
    stubAuthEnvironment();
    vi.stubEnv("DATABASE_ACCOUNT_WORKER_URL", "postgresql://account:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("DATABASE_MEDIA_WORKER_URL", "postgresql://media:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("DATABASE_PHOTOBOOK_WORKER_URL", "postgresql://photobook:secret@127.0.0.1:5432/buildy");
    vi.stubEnv("ACCOUNT_RETENTION_POLICY_VERSION", "approved-v1");
    vi.stubEnv("ACCOUNT_RETENTION_POLICY_APPROVED_AT", "2026-08-04T12:00:00.000Z");
    vi.stubEnv("CRON_SECRET", "c".repeat(32));
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", `vercel_blob_rw_${"b".repeat(48)}`);
    resetRuntimeConfigForTests();

    expect(ensureServerComposition()).toBe("ready");
    expect(ensureServerComposition()).toBe("ready");
    expect(capturedBlobConfigurations).toHaveLength(1);
    expect(resolveDefaultAccountWorker().orphanCleanup).toBeDefined();
    expect(capturedBlobConfigurations[0]?.token).toMatch(/^vercel_blob_rw_/);
    expect(Object.keys(capturedBlobConfigurations[0]?.sdk ?? {}).sort()).toEqual([
      "copy",
      "del",
      "get",
      "handleUpload",
      "head",
      "list",
      "put",
    ]);
  });
});

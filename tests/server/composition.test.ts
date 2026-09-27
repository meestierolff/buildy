// @vitest-environment node

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureServerComposition,
  resetServerCompositionForTests,
} from "../../server/composition";
import { resolveDefaultAccountWorker } from "../../server/account/runtime";
import { handleDefaultAuthRequest } from "../../server/auth";
import { getCapabilities, resetRuntimeConfigForTests } from "../../server/config/runtime";
import { closeBuildyDatabaseForTests } from "../../server/db/client";
import * as databaseClient from "../../server/db/client";
import { handleDefaultModerationRequest } from "../../server/moderation/runtime";
import { PostgresPhotobookRepository } from "../../server/photobooks/repository";
import * as photobookRuntime from "../../server/photobooks/runtime";
import { PhotobookProofWorker } from "../../server/photobooks/worker";
import { handleDefaultProjectRequest } from "../../server/projects/runtime";
import { photobookPreferencesSchema } from "../../shared/contracts/photobooks";

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
  vi.stubEnv("CHECKOUT_MODE", "off");
  vi.stubEnv("DATABASE_PHOTOBOOK_WORKER_URL", "");
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
    vi.restoreAllMocks();
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

  it.each([true, false])(
    "keeps checkout off while PDF rendering follows its dedicated worker configuration (%s)",
    async (workerConfigured) => {
      stubAuthEnvironment();
      vi.stubEnv("PRODUCT_PROFILE", "feedback_beta");
      vi.stubEnv("BLOB_READ_WRITE_TOKEN", "synthetic-private-blob-token");
      const workerUrl = "postgresql://photobook:synthetic@127.0.0.1:5432/buildy_test";
      vi.stubEnv("DATABASE_PHOTOBOOK_WORKER_URL", workerConfigured ? workerUrl : "");
      resetRuntimeConfigForTests();

      const actorId = "10000000-0000-4000-8000-000000000001";
      const projectId = "20000000-0000-4000-8000-000000000001";
      const draftId = "30000000-0000-4000-8000-000000000001";
      vi.spyOn(PostgresPhotobookRepository.prototype, "loadSource").mockResolvedValue({
        projectId, ownerId: actorId, projectRevision: 1,
        projectTitle: "Ons huis", projectSubtitle: null,
        draftId, draftVersion: 1, exclusions: [], updates: [],
        settings: {
          coverMediaAssetId: null, selectedFormat: "a4-landscape-hardcover-v1",
          title: null, subtitle: null, includeBudget: false,
          preferences: photobookPreferencesSchema.parse({}), version: 1,
        },
      });
      vi.spyOn(PostgresPhotobookRepository.prototype, "saveDraft")
        .mockResolvedValue({ draftId, version: 1 });
      vi.spyOn(PostgresPhotobookRepository.prototype, "latestProof").mockResolvedValue(null);
      const request = vi.spyOn(PostgresPhotobookRepository.prototype, "requestProof")
        .mockImplementation(async ({ revisionId }) => ({ revisionId, status: "rendering", replayed: false }));
      const processRevision = vi.spyOn(PhotobookProofWorker.prototype, "processRevision")
        .mockImplementation(async (revisionId) => ({
          status: "rendered", revisionId, pageCount: 24, pdfSha256: "a".repeat(64),
        }));
      const workerDatabase = vi.spyOn(databaseClient, "getBuildyWorkerDatabase");
      const configure = vi.spyOn(photobookRuntime, "configureDefaultPhotobookRuntime");

      expect(ensureServerComposition()).toBe("ready");
      expect(getCapabilities().payments).toBe("disabled");
      const service = configure.mock.calls[0]![0].service;
      const editor = await service.editor(actorId, projectId);
      const proof = service.requestProof(actorId, projectId, {
        idempotencyKey: "60000000-0000-4000-8000-000000000001",
        expectedDraftVersion: editor.version,
        expectedDocumentSha256: editor.document.checksumSha256,
      });

      if (workerConfigured) {
        await expect(proof).resolves.toMatchObject({ status: "ready" });
        expect(request).toHaveBeenCalledOnce();
        expect(processRevision).toHaveBeenCalledWith(request.mock.calls[0]![0].revisionId);
        expect(workerDatabase).toHaveBeenCalledWith(workerUrl, "photobook");
      } else {
        await expect(proof).rejects.toMatchObject({ reason: "PROOF_UNAVAILABLE" });
        expect(request).not.toHaveBeenCalled();
        expect(processRevision).not.toHaveBeenCalled();
        expect(workerDatabase).not.toHaveBeenCalledWith(workerUrl, "photobook");
      }
    },
  );

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

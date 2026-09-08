// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthResponseSchema, readinessResponseSchema } from "../../shared/contracts/api";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { resetServerCompositionForTests } from "../../server/composition";
import * as composition from "../../server/composition";
import { handleApiRequest, registerExternalRoute, registerRoute } from "../../server/http/router";
import { jsonSuccess } from "../../server/http/responses";

const { coreDatabaseExecute, photobookDatabaseExecute, workerDatabase } = vi.hoisted(() => ({
  coreDatabaseExecute: vi.fn(),
  photobookDatabaseExecute: vi.fn(),
  workerDatabase: vi.fn(),
}));

vi.mock("../../server/db/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../server/db/client")>(),
  getBuildyDatabase: () => ({ execute: coreDatabaseExecute }),
  getBuildyWorkerDatabase: workerDatabase,
}));

describe("API router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", "https://test.buildy.example");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();
  });

  it("returns a typed, secret-free liveness response", async () => {
    const response = await handleApiRequest(new Request("https://test.buildy.example/api/health"));
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(healthResponseSchema.parse(body).data).toMatchObject({
      status: "ok",
      environment: "test",
      capabilities: { database: "unconfigured", authentication: "unconfigured" },
    });
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });

  it("exposes the full immutable deployment SHA for exact launch binding", async () => {
    const releaseSha = "0123456789abcdef0123456789abcdef01234567";
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", releaseSha);
    resetRuntimeConfigForTests();

    const response = await handleApiRequest(new Request("https://test.buildy.example/api/health"));

    await expect(response.json()).resolves.toMatchObject({ data: { release: releaseSha } });
  });

  it("reports the provider-independent public demo ready without database or Google auth", async () => {
    vi.stubEnv("PRODUCT_PROFILE", "public_demo");
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();

    const response = await handleApiRequest(
      new Request("https://test.buildy.example/api/readiness"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ready: true,
        checks: {
          configuration: "pass",
          database: "not_checked",
          accountWorker: "not_checked",
          mediaWorker: "not_checked",
          paymentWorker: "not_checked",
          photobookWorker: "not_checked",
        },
      },
    });
  });

  it("exposes only anonymous support from the composed moderation surface in public_demo", async () => {
    vi.stubEnv("PRODUCT_PROFILE", "public_demo");
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();

    for (const path of ["/api/moderation/reports", "/api/feedback"]) {
      const response = await handleApiRequest(new Request(`https://test.buildy.example${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://test.buildy.example",
        },
        body: "{}",
      }));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "AUTH_UNAVAILABLE",
          message: "Deze functie is niet beschikbaar in de openbare demo.",
        },
      });
    }

    const support = await handleApiRequest(new Request("https://test.buildy.example/api/support", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://test.buildy.example",
      },
      body: "{}",
    }));
    await expect(support.json()).resolves.toMatchObject({
      error: { code: "AUTH_UNAVAILABLE" },
    });
  });

  it("keeps scheduled account maintenance deliberately dormant in public_demo", async () => {
    vi.stubEnv("PRODUCT_PROFILE", "public_demo");
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();

    const response = await handleApiRequest(new Request(
      "https://test.buildy.example/api/internal/cron/account-lifecycle",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Accountonderhoud is niet actief in de openbare demo.",
      },
    });
  });

  it("keeps feedback_beta readiness closed without its authenticated runtime", async () => {
    vi.stubEnv("PRODUCT_PROFILE", "feedback_beta");
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();

    const response = await handleApiRequest(
      new Request("https://test.buildy.example/api/readiness"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ready: false,
        checks: { configuration: "fail", database: "not_checked" },
      },
    });
  });

  it.each(["off", "test", "live"] as const)(
    "checks a failing configured proof worker only when checkout is active (%s)",
    async (checkoutMode) => {
      const proofDatabaseUrl = "postgresql://proof:synthetic@127.0.0.1:5432/buildy_test";
      const environment = {
        PRODUCT_PROFILE: "feedback_beta",
        BETA_MODE: "false",
        CHECKOUT_MODE: checkoutMode,
        DATABASE_URL: "postgresql://web:synthetic@127.0.0.1:5432/buildy_test",
        DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:synthetic@127.0.0.1:5432/buildy_test",
        DATABASE_MEDIA_WORKER_URL: "postgresql://media:synthetic@127.0.0.1:5432/buildy_test",
        DATABASE_PHOTOBOOK_WORKER_URL: proofDatabaseUrl,
        PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
        PII_ENCRYPTION_CURRENT_VERSION: "1",
        PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
        BLOB_READ_WRITE_TOKEN: "synthetic-blob-token",
        ACCOUNT_RETENTION_POLICY_VERSION: "synthetic-test-policy",
        ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-01-01T00:00:00Z",
        CRON_SECRET: "synthetic-cron-secret-for-test-only",
      };
      for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
      resetRuntimeConfigForTests();
      vi.spyOn(composition, "getServerCompositionStatus").mockReturnValue("ready");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      coreDatabaseExecute.mockResolvedValue({ rows: [{ ready: true, isolated: true }] });
      photobookDatabaseExecute.mockRejectedValue(new Error("Synthetic proof database unavailable"));
      workerDatabase.mockImplementation((_url: string, role: string) => ({
        execute: role === "photobook" ? photobookDatabaseExecute : coreDatabaseExecute,
      }));

      const response = await handleApiRequest(new Request("https://test.buildy.example/api/readiness"));
      const body = readinessResponseSchema.parse(await response.json());
      const proofActive = checkoutMode !== "off";

      expect.soft(response.status).toBe(proofActive ? 503 : 200);
      expect.soft(body.data).toEqual({
        ready: !proofActive,
        checks: {
          configuration: "pass",
          database: "pass",
          accountWorker: "pass",
          mediaWorker: "pass",
          paymentWorker: "not_checked",
          photobookWorker: proofActive ? "fail" : "not_checked",
        },
      });
      expect.soft(photobookDatabaseExecute).toHaveBeenCalledTimes(proofActive ? 1 : 0);
      if (proofActive) expect(workerDatabase).toHaveBeenCalledWith(proofDatabaseUrl, "photobook");
      else expect(workerDatabase).not.toHaveBeenCalledWith(proofDatabaseUrl, "photobook");
    },
  );

  it("returns a stable Dutch not-found error with a request id", async () => {
    const response = await handleApiRequest(new Request("https://test.buildy.example/api/nope"));
    const body = await response.json() as { error: { code: string; requestId: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("keeps readiness closed when present auth key material is malformed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("DATABASE_URL", "postgresql://buildy:buildy@127.0.0.1:5432/buildy");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.stubEnv("PII_ENCRYPTION_KEYS", "not-json");
    vi.stubEnv("PII_ENCRYPTION_CURRENT_VERSION", "1");
    vi.stubEnv("PII_BLIND_INDEX_KEY", Buffer.alloc(32, 1).toString("base64"));
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();

    const response = await handleApiRequest(
      new Request("https://test.buildy.example/api/readiness"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        ready: false,
        checks: { configuration: "fail", database: "not_checked" },
      },
    });
    expect(error).toHaveBeenCalledOnce();
  });

  it("rejects state changes from an untrusted origin", async () => {
    registerRoute("POST", "/api/test/origin", (_request, requestId) => jsonSuccess({ ok: true }, requestId));

    const response = await handleApiRequest(new Request("https://test.buildy.example/api/test/origin", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("lets explicitly registered provider callbacks authenticate without a browser Origin", async () => {
    registerExternalRoute("POST", "/api/test/provider-callback", (_request, requestId) =>
      jsonSuccess({ accepted: true }, requestId, { status: 202 }));

    const response = await handleApiRequest(new Request(
      "https://test.buildy.example/api/test/provider-callback",
      { method: "POST", body: "synthetic-provider-payload" },
    ));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ data: { accepted: true } });
  });

  it("dispatches the checkout pattern but stays closed while commerce is unconfigured", async () => {
    const revisionId = "17ac5c61-5b78-4dd7-b78e-3f7a5c96ecaf";
    const response = await handleApiRequest(new Request(
      `https://test.buildy.example/api/photobooks/proofs/${revisionId}/quote`,
      {
        method: "POST",
        headers: {
          origin: "https://test.buildy.example",
          "content-type": "application/json",
        },
        body: "{}",
      },
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("registers the authenticated customer order collection route", async () => {
    const response = await handleApiRequest(new Request(
      "https://test.buildy.example/api/orders",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
  });

  it("registers guarded bestellingbeheer but keeps it unavailable without server composition", async () => {
    const response = await handleApiRequest(new Request(
      "https://test.buildy.example/api/admin/orders",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_UNAVAILABLE" },
    });
  });

  it.each([
    ["GET", "/api/internal/cron/email"],
    ["GET", "/api/internal/cron/peecho-fulfilment"],
    ["POST", "/api/webhooks/brevo"],
    ["POST", "/api/webhooks/peecho"],
  ])("does not expose the retired %s %s route", async (method, path) => {
    const response = await handleApiRequest(new Request(
      `https://test.buildy.example${path}`,
      { method },
    ));

    expect(response.status).toBe(404);
  });

  it.each([
    ["GET", "/api/social/projects/00000000-0000-4000-8000-000000000101/state"],
    ["PUT", "/api/social/projects/00000000-0000-4000-8000-000000000101/follow"],
    ["DELETE", "/api/social/projects/00000000-0000-4000-8000-000000000101/follow"],
    ["PUT", "/api/social/projects/00000000-0000-4000-8000-000000000101/access"],
    ["DELETE", "/api/social/projects/00000000-0000-4000-8000-000000000101/access"],
    ["GET", "/api/social/projects/00000000-0000-4000-8000-000000000101/access-requests"],
    ["POST", "/api/social/projects/00000000-0000-4000-8000-000000000101/access-requests/00000000-0000-4000-8000-000000000002/accept"],
    ["POST", "/api/social/projects/00000000-0000-4000-8000-000000000101/access-requests/00000000-0000-4000-8000-000000000002/reject"],
    ["DELETE", "/api/social/projects/00000000-0000-4000-8000-000000000101/access-requests/00000000-0000-4000-8000-000000000002"],
  ])("keeps retired project-social endpoint %s %s at router-level 404", async (method, path) => {
    const response = await handleApiRequest(new Request(
      `https://test.buildy.example${path}`,
      { method },
    ));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});

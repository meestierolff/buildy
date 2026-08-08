// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthResponseSchema } from "../../shared/contracts/api";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { resetServerCompositionForTests } from "../../server/composition";
import { handleApiRequest, registerExternalRoute, registerRoute } from "../../server/http/router";
import { jsonSuccess } from "../../server/http/responses";

describe("API router", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", "https://test.buildy.example");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    resetRuntimeConfigForTests();
    resetServerCompositionForTests();
  });

  afterEach(() => {
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
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
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
});

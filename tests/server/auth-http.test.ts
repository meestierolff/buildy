// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "../../shared/contracts/api";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { AuthUnavailableError } from "../../server/auth/errors";
import { createAuthHttpHandler } from "../../server/auth/http";
import { resetDefaultAuthRuntimeForTests } from "../../server/auth/runtime";
import { handleApiRequest } from "../../server/http/router";

const requestId = "0d18815a-ef3f-4bc2-a52f-6a9e70413429";

describe("Better Auth HTTP boundary", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", "https://app.buildy.test");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    resetRuntimeConfigForTests();
    resetDefaultAuthRuntimeForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
    resetDefaultAuthRuntimeForTests();
  });

  it("preserves auth cookies while applying no-store security headers", async () => {
    let forwardedRequestId: string | null = null;
    const handler = createAuthHttpHandler(() => ({
      async resolveAuthUserId() {
        return null;
      },
      async handler(request) {
        forwardedRequestId = request.headers.get("x-request-id");
        return new Response('{"ok":true}', {
          headers: {
            "content-type": "application/json",
            "set-cookie": "buildy.session_token=value; HttpOnly; Secure; SameSite=Lax; Path=/",
          },
        });
      },
    }));

    const response = await handler(
      new Request("https://app.buildy.test/api/auth/get-session"),
      requestId,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(forwardedRequestId).toBe(requestId);
  });

  it("normalizes Better Auth's rate-limit header without consuming its response", async () => {
    const handler = createAuthHttpHandler(() => ({
      async resolveAuthUserId() {
        return null;
      },
      async handler() {
        return new Response('{"message":"Too many requests"}', {
          headers: { "x-retry-after": "47" },
          status: 429,
        });
      },
    }));

    const response = await handler(
      new Request("https://app.buildy.test/api/auth/sign-in/email", { method: "POST" }),
      requestId,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("47");
    await expect(response.json()).resolves.toEqual({ message: "Too many requests" });
  });

  it("maps unavailable initialization to a controlled Dutch 503", async () => {
    const handler = createAuthHttpHandler(() => {
      throw new AuthUnavailableError("configuration_missing");
    });

    const response = await handler(
      new Request("https://app.buildy.test/api/auth/get-session"),
      requestId,
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(apiErrorSchema.parse(body).error).toMatchObject({
      code: "AUTH_UNAVAILABLE",
      requestId,
    });
  });

  it("mounts the prefix exactly and fails closed before auth is composed", async () => {
    const authResponse = await handleApiRequest(
      new Request("https://app.buildy.test/api/auth/get-session"),
    );
    const boundaryResponse = await handleApiRequest(
      new Request("https://app.buildy.test/api/authentic"),
    );

    expect(authResponse.status).toBe(503);
    expect(boundaryResponse.status).toBe(404);
    await expect(authResponse.json()).resolves.toMatchObject({
      error: { code: "AUTH_UNAVAILABLE" },
    });
  });

  it.each([undefined, "https://attacker.test"])(
    "rejects a missing or untrusted mutation origin before invoking auth: %s",
    async (origin) => {
      const headers = new Headers();
      if (origin) headers.set("origin", origin);

      const response = await handleApiRequest(
        new Request("https://app.buildy.test/api/auth/sign-in/email", {
          headers,
          method: "POST",
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "FORBIDDEN" },
      });
    },
  );
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createBetaHttpHandler, type BetaHttpService } from "../../server/beta/http";
import { BetaError } from "../../server/beta/errors";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const INVITE = `BLDY_${"Z".repeat(32)}`;
const TOKEN = "R".repeat(43);

function context(overrides: Partial<BetaHttpService> = {}) {
  const service: BetaHttpService = {
    status: vi.fn().mockReturnValue({
      betaMode: true,
      inviteRequiredForNewAccounts: true,
      label: "Private bèta",
    }),
    reserveInvite: vi.fn().mockResolvedValue({
      cookieToken: TOKEN,
      provider: "email",
      publicResult: {
        reserved: true,
        expiresAt: "2026-08-04T12:10:00.000Z",
        replayed: false,
      },
    }),
    recordClientEvent: vi.fn().mockResolvedValue({ accepted: true, replayed: false }),
    ...overrides,
  };
  const actors = { resolve: vi.fn().mockResolvedValue({ kind: "anonymous" as const }) };
  return {
    actors,
    service,
    handler: createBetaHttpHandler({ actors, secureCookies: true, service }),
  };
}

describe("private beta HTTP boundary", () => {
  it("exposes beta status without creating a tracking cookie", async () => {
    const response = await context().handler(
      new Request("https://buildy.test/api/beta/status"),
      REQUEST_ID,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      data: { betaMode: true, label: "Private bèta" },
    });
  });

  it("sets only an HttpOnly opaque reservation cookie and never echoes code/token", async () => {
    const requestBody = {
      inviteCode: INVITE,
      provider: "email",
      email: "private@example.test",
      idempotencyKey: "beta-reservation:v1:22222222-2222-4222-8222-222222222222",
    };
    const response = await context().handler(new Request(
      "https://buildy.test/api/beta/reservations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    ), REQUEST_ID);
    const body = await response.text();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(201);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/api/auth");
    expect(body).not.toContain(INVITE);
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("private@example.test");
  });

  it("uses one generic invalid-invite response and clears stale authorization", async () => {
    const beta = context({
      reserveInvite: vi.fn().mockRejectedValue(new BetaError("INVITE_INVALID")),
    });
    const response = await beta.handler(new Request(
      "https://buildy.test/api/beta/reservations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: INVITE }),
      },
    ), REQUEST_ID);
    const body = await response.text();
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(body).not.toContain(INVITE);
  });

  it("creates a pseudonymous HttpOnly cookie for an anonymous product event", async () => {
    const beta = context();
    const response = await beta.handler(new Request(
      "https://buildy.test/api/product-events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: "33333333-3333-4333-8333-333333333333",
          eventName: "photobook_opened",
          properties: { schemaVersion: 1 },
        }),
      },
    ), REQUEST_ID);
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("buildy_product_subject=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(beta.service.recordClientEvent).toHaveBeenCalledWith(
      { kind: "anonymous" },
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({ eventName: "photobook_opened" }),
    );
  });
});

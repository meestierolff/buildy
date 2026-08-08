// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";
import { BetaRegistrationGate, betaReservationCookie } from "../../server/beta/authGate";
import { BetaError } from "../../server/beta/errors";
import { BetaService } from "../../server/beta/service";
import type { BetaRepository, BetaReservationRateLimitStorage } from "../../server/beta/types";

const INVITE = `BLDY_${"A".repeat(32)}`;
const IDEMPOTENCY = "beta-reservation:v1:11111111-1111-4111-8111-111111111111";
const TOKEN = "T".repeat(43);
const NOW = new Date("2026-08-04T12:10:00.000Z");

function testContext(overrides: {
  betaMode?: boolean;
  repository?: Partial<BetaRepository>;
  rateLimits?: Partial<BetaReservationRateLimitStorage>;
} = {}) {
  const repository: BetaRepository = {
    completeSignup: vi.fn().mockResolvedValue(undefined),
    recordClientEvent: vi.fn().mockResolvedValue({ accepted: true, replayed: false }),
    reserveInvite: vi.fn().mockResolvedValue({ expiresAt: NOW, replayed: false }),
    ...overrides.repository,
  };
  const rateLimits: BetaReservationRateLimitStorage = {
    consume: vi.fn().mockResolvedValue({ allowed: true, retryAfter: null }),
    ...overrides.rateLimits,
  };
  const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 7).toString("base64"));
  const service = new BetaService(
    overrides.betaMode ?? true,
    repository,
    rateLimits,
    blindIndex,
    () => TOKEN,
  );
  return { blindIndex, rateLimits, repository, service };
}

describe("private beta service", () => {
  it("hashes the invite and email, returns no secret, and reuses the opaque token for replay", async () => {
    const context = testContext();
    const input = {
      inviteCode: INVITE,
      provider: "email" as const,
      email: "Bewoner@Example.test",
      idempotencyKey: IDEMPOTENCY,
    };

    const first = await context.service.reserveInvite(input, {
      networkIdentifier: "203.0.113.8",
      userAgent: "test-browser",
    });
    const second = await context.service.reserveInvite(input, {
      networkIdentifier: "203.0.113.8",
      userAgent: "test-browser",
    });

    expect(first.cookieToken).toBe(TOKEN);
    expect(second.cookieToken).toBe(TOKEN);
    expect(JSON.stringify(first.publicResult)).not.toContain(INVITE);
    expect(JSON.stringify(first.publicResult)).not.toContain(TOKEN);
    expect(context.repository.reserveInvite).toHaveBeenCalledWith(expect.objectContaining({
      codeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      emailHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      reservationTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(JSON.stringify(vi.mocked(context.repository.reserveInvite).mock.calls)).not.toContain(INVITE);
    expect(JSON.stringify(vi.mocked(context.repository.reserveInvite).mock.calls))
      .not.toContain("Bewoner@Example.test");
  });

  it("fails every invalid/expired/exhausted invite through one non-enumerating error", async () => {
    const context = testContext({
      repository: { reserveInvite: vi.fn().mockRejectedValue(new BetaError("INVITE_INVALID")) },
    });
    await expect(context.service.reserveInvite({
      inviteCode: INVITE,
      provider: "google",
      idempotencyKey: IDEMPOTENCY,
    }, { networkIdentifier: "unknown", userAgent: "unknown" })).rejects.toMatchObject({
      apiCode: "BETA_INVITE_INVALID",
      status: 403,
    });
  });

  it("rate limits before touching the invite repository", async () => {
    const context = testContext({
      rateLimits: {
        consume: vi.fn().mockResolvedValue({ allowed: false, retryAfter: 90 }),
      },
    });
    await expect(context.service.reserveInvite({
      inviteCode: INVITE,
      provider: "google",
      idempotencyKey: IDEMPOTENCY,
    }, { networkIdentifier: "unknown", userAgent: "unknown" })).rejects.toMatchObject({
      reason: "RATE_LIMITED",
      retryAfterSeconds: 90,
    });
    expect(context.repository.reserveInvite).not.toHaveBeenCalled();
  });

  it("accepts only the four privacy-minimal browser event shapes", async () => {
    const context = testContext();
    await context.service.recordClientEvent(
      { kind: "anonymous" },
      TOKEN,
      {
        eventId: "22222222-2222-4222-8222-222222222222",
        eventName: "signup_started",
        properties: { schemaVersion: 1, method: "google" },
      },
    );
    expect(context.repository.recordClientEvent).toHaveBeenCalledWith(
      { kind: "anonymous" },
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.objectContaining({ eventName: "signup_started" }),
    );

    await expect(context.service.recordClientEvent(
      { kind: "anonymous" },
      TOKEN,
      {
        eventId: "33333333-3333-4333-8333-333333333333",
        eventName: "error_encountered",
        properties: {
          schemaVersion: 1,
          category: "unknown",
          email: "private@example.test",
        },
      },
    )).rejects.toBeDefined();
  });

  it("does not gate existing-login requests and bypasses new-user gating only when beta mode is off", async () => {
    const enabled = testContext();
    const enabledGate = new BetaRegistrationGate(enabled.service);
    await enabledGate.withRequest(new Request("https://buildy.test/api/auth/sign-in/email"), async () => {
      // Better Auth does not call authorizeNewUser for an existing identity.
    });
    expect(enabled.repository.completeSignup).not.toHaveBeenCalled();

    const disabled = testContext({ betaMode: false });
    const disabledGate = new BetaRegistrationGate(disabled.service);
    await disabledGate.withRequest(new Request("https://buildy.test/api/auth/sign-up/email"), () => (
      disabledGate.authorizeNewUser({} as never, {
        id: "new-auth-user",
        email: "new@example.test",
        name: "Nieuwe tester",
      })
    ));
    expect(disabled.repository.completeSignup).not.toHaveBeenCalled();
  });

  it("binds reservation cookies to provider and rejects new users without one", async () => {
    const context = testContext();
    const gate = new BetaRegistrationGate(context.service);
    const cookie = betaReservationCookie("google", TOKEN, true);
    const request = new Request("https://buildy.test/api/auth/callback/google", {
      headers: { cookie: cookie.split(";", 1)[0] },
    });
    await gate.withRequest(request, () => gate.authorizeNewUser({} as never, {
      id: "google-auth-user",
      email: "google@example.test",
      name: "Google tester",
    }));
    expect(context.repository.completeSignup).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ provider: "google" }),
    );

    await expect(gate.withRequest(
      new Request("https://buildy.test/api/auth/sign-up/email"),
      () => gate.authorizeNewUser({} as never, {
        id: "email-auth-user",
        email: "email@example.test",
        name: "E-mailtester",
      }),
    )).rejects.toBeInstanceOf(APIError);
  });
});

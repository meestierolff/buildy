// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthConfiguration } from "../../server/auth/config";
import {
  createBuildyAuth,
  type CreateBuildyAuthInput,
  type OpenIdClientApi,
} from "../../server/auth/factory";
import type {
  GoogleLoginAttemptInput,
  GoogleOidcRepository,
  GoogleSessionRecord,
  NewGoogleSession,
  VerifiedGoogleIdentity,
} from "../../server/auth/repository";
import type { BuildyDatabase } from "../../server/db/client";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const STATE = "S".repeat(43);
const NONCE = "N".repeat(43);
const VERIFIER = "V".repeat(43);
const SESSION_TOKEN = "T".repeat(43);

const config: AuthConfiguration = {
  appOrigin: "https://app.buildy.test",
  betaMode: false,
  callbackUrl: "https://app.buildy.test/api/auth/callback/google",
  databaseUrl: "postgresql://buildy:buildy@127.0.0.1:5432/buildy",
  google: { clientId: "google-client", clientSecret: "google-secret" },
  secureCookies: true,
  trustedOrigins: ["https://app.buildy.test"],
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(
  identity: VerifiedGoogleIdentity,
  session: NewGoogleSession,
): GoogleSessionRecord {
  return {
    authUserId: "google-auth-user",
    createdAt: session.createdAt,
    email: identity.email,
    expiresAt: session.expiresAt,
    identitySubject: identity.subject,
    image: null,
    name: identity.name,
    sessionId: session.id,
    sessionUpdatedAt: session.createdAt,
    userAgent: session.userAgent,
    userCreatedAt: NOW,
    userUpdatedAt: NOW,
  };
}

function harness() {
  let attempt: GoogleLoginAttemptInput | null = null;
  let consumed = false;
  const completeLogin = vi.fn(async (
    identity: VerifiedGoogleIdentity,
    session: NewGoogleSession,
  ) => record(identity, session));
  const repository: GoogleOidcRepository = {
    createLoginAttempt: vi.fn(async (input) => {
      attempt = input;
      consumed = false;
    }),
    consumeLoginAttempt: vi.fn(async (stateHash) => {
      if (!attempt || consumed || attempt.stateHash !== stateHash) return null;
      consumed = true;
      return {
        id: attempt.id,
        browserBindingHash: attempt.browserBindingHash,
        codeVerifierCiphertext: attempt.codeVerifierCiphertext,
        nonceCiphertext: attempt.nonceCiphertext,
        nextPath: attempt.nextPath,
      };
    }),
    completeLogin,
    findSession: vi.fn(async () => null),
    listSessions: vi.fn(async () => []),
    revokeCurrentSession: vi.fn(async () => false),
    revokeSession: vi.fn(async () => ({ revoked: false, wasCurrent: false })),
  };
  const authorizationCodeGrant = vi.fn(async () => ({
    access_token: "provider-access-token-must-not-persist",
    refresh_token: "provider-refresh-token-must-not-persist",
    claims: () => ({
      sub: "google-subject-123",
      email: "Bewoner@Example.test",
      email_verified: true,
      name: "  Bewoner   Buildy  ",
    }),
  }));
  const discovery = vi.fn(async () => ({ provider: "google" }));
  const buildAuthorizationUrl = vi.fn((_configuration, parameters: Record<string, string>) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
  });
  const oidc = {
    authorizationCodeGrant,
    buildAuthorizationUrl,
    calculatePKCECodeChallenge: vi.fn(async () => "pkce-challenge"),
    discovery,
    randomNonce: vi.fn(() => NONCE),
    randomPKCECodeVerifier: vi.fn(() => VERIFIER),
    randomState: vi.fn(() => STATE),
  } as unknown as OpenIdClientApi;
  const keyring = new DataProtectionKeyring({
    currentVersion: 1,
    keys: { 1: Buffer.alloc(32, 7).toString("base64") },
  });
  const input: CreateBuildyAuthInput = {
    blindIndex: new PrivacyBlindIndex(Buffer.alloc(32, 8).toString("base64")),
    config,
    database: {} as BuildyDatabase,
    identityProvisioner: {
      ensureForSession: async () => undefined,
      provisionForAuthUser: async () => undefined,
    },
    keyring,
    now: () => NOW,
    oidc,
    randomSessionToken: () => SESSION_TOKEN,
    rateLimitStorage: {
      consume: async () => ({ allowed: true, retryAfter: null }),
    },
    repository,
  };
  return {
    authorizationCodeGrant,
    buildAuthorizationUrl,
    completeLogin,
    discovery,
    input,
    keyring,
    repository,
  };
}

function originHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://app.buildy.test",
    "user-agent": "Buildy test browser",
  };
}

describe("Google OIDC auth factory", () => {
  it("fails closed when beta mode has no transactional registration gate", () => {
    const test = harness();
    expect(() => createBuildyAuth({
      ...test.input,
      config: { ...config, betaMode: true },
    })).toThrowError(expect.objectContaining({ reason: "configuration_invalid" }));
  });

  it("creates a bounded PKCE/state/nonce attempt and returns only an authorization URL", async () => {
    const test = harness();
    const auth = createBuildyAuth(test.input);
    const response = await auth.handler(new Request(
      "https://app.buildy.test/api/auth/sign-in/google",
      {
        body: JSON.stringify({ next: "/project/project-1?tab=updates" }),
        headers: originHeaders(),
        method: "POST",
      },
    ));
    const body = await response.json() as { data: { authorizationUrl: string } };

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /^buildy_oidc_attempt=[A-Za-z0-9_-]{43}; Path=\/api\/auth\/callback\/google; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
    );
    const authorizationUrl = new URL(body.data.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("state")).toBe(STATE);
    expect(authorizationUrl.searchParams.get("nonce")).toBe(NONCE);
    expect(test.discovery).toHaveBeenCalledWith(
      new URL("https://accounts.google.com"),
      "google-client",
      "google-secret",
    );
    expect(test.repository.createLoginAttempt).toHaveBeenCalledWith(expect.objectContaining({
      stateHash: hash(STATE),
      nextPath: "/project/project-1?tab=updates",
      expiresAt: new Date("2026-08-04T12:10:00.000Z"),
    }));
    expect(JSON.stringify(vi.mocked(test.repository.createLoginAttempt).mock.calls))
      .not.toContain(VERIFIER);
  });

  it("consumes an attempt once, verifies the ID token, and persists only a session hash", async () => {
    const test = harness();
    const auth = createBuildyAuth(test.input);
    const start = await auth.handler(new Request(
      "https://app.buildy.test/api/auth/sign-in/google",
      {
        body: JSON.stringify({ next: "/projecten" }),
        headers: originHeaders(),
        method: "POST",
      },
    ));
    const binding = /buildy_oidc_attempt=([A-Za-z0-9_-]+)/.exec(
      start.headers.get("set-cookie") ?? "",
    )?.[1];
    expect(binding).toBeTruthy();

    const callback = new Request(
      `https://app.buildy.test/api/auth/callback/google?code=provider-code&state=${STATE}`,
      { headers: { cookie: `buildy_oidc_attempt=${binding}`, "user-agent": "Buildy test browser" } },
    );
    const response = await auth.handler(callback);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.buildy.test/projecten");
    expect(response.headers.get("set-cookie")).toContain(
      `buildy_session=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`,
    );
    expect(test.authorizationCodeGrant).toHaveBeenCalledWith(
      expect.anything(),
      new URL(`${config.callbackUrl}?code=provider-code&state=${STATE}`),
      {
        pkceCodeVerifier: VERIFIER,
        expectedState: STATE,
        expectedNonce: NONCE,
        idTokenExpected: true,
      },
    );
    expect(test.completeLogin).toHaveBeenCalledWith(
      {
        subject: "google-subject-123",
        email: "bewoner@example.test",
        name: "Bewoner Buildy",
      },
      expect.objectContaining({ tokenHash: hash(SESSION_TOKEN) }),
    );
    expect(JSON.stringify(test.completeLogin.mock.calls)).not.toContain("provider-access-token");
    expect(JSON.stringify(test.completeLogin.mock.calls)).not.toContain(SESSION_TOKEN);

    const replay = await auth.handler(callback);
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toContain("error=GOOGLE_CALLBACK_INVALID");
    expect(test.authorizationCodeGrant).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin mutations before creating an attempt", async () => {
    const test = harness();
    const response = await createBuildyAuth(test.input).handler(new Request(
      "https://app.buildy.test/api/auth/sign-in/google",
      {
        body: "{}",
        headers: { ...originHeaders(), origin: "https://attacker.test" },
        method: "POST",
      },
    ));
    expect(response.status).toBe(403);
    expect(test.repository.createLoginAttempt).not.toHaveBeenCalled();
  });
});

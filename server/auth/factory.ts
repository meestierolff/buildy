import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from "openid-client";
import {
  googleAuthStartInputSchema,
  safeAuthNextPath,
  type AuthSessionData,
} from "../../shared/contracts/auth.js";
import type { AccountAuthGateway, AccountAuthSession } from "../account/types.js";
import type { BuildyDatabase } from "../db/client.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import type { AuthConfiguration } from "./config.js";
import { AuthRegistrationRejectedError, AuthUnavailableError } from "./errors.js";
import type { AuthIdentityProvisioner, AuthNewUserAuthorizer } from "./identity.js";
import {
  PostgresGoogleOidcRepository,
  type GoogleOidcRepository,
  type GoogleSessionRecord,
  type VerifiedGoogleIdentity,
} from "./repository.js";

const GOOGLE_ISSUER = new URL("https://accounts.google.com");
const LOGIN_ATTEMPT_MILLISECONDS = 10 * 60 * 1_000;
const SESSION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_COOKIE = "buildy_session";
const LOGIN_ATTEMPT_COOKIE = "buildy_oidc_attempt";
const BETA_RESERVATION_COOKIE = "buildy_beta_reservation";
const OPAQUE_VALUE = /^[A-Za-z0-9_-]{32,512}$/;
const MAX_AUTH_BODY_BYTES = 4 * 1_024;

export type AuthRateLimitStorage = {
  consume(
    key: string,
    rule: { max: number; window: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
};

export interface AuthRegistrationGate extends AuthNewUserAuthorizer {
  withRequest<Result>(request: Request, next: () => Promise<Result>): Promise<Result>;
}

export interface OpenIdClientApi {
  authorizationCodeGrant: typeof authorizationCodeGrant;
  buildAuthorizationUrl: typeof buildAuthorizationUrl;
  calculatePKCECodeChallenge: typeof calculatePKCECodeChallenge;
  discovery: typeof discovery;
  randomNonce: typeof randomNonce;
  randomPKCECodeVerifier: typeof randomPKCECodeVerifier;
  randomState: typeof randomState;
}

const defaultOpenIdClient: OpenIdClientApi = {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
};

export interface AuthEngine {
  handler(request: Request): Promise<Response>;
  resolveAuthUserId(request: Request): Promise<string | null>;
  readonly account: AccountAuthGateway;
}

export interface CreateBuildyAuthInput {
  config: AuthConfiguration;
  database: BuildyDatabase;
  identityProvisioner: AuthIdentityProvisioner;
  keyring: DataProtectionKeyring;
  blindIndex: PrivacyBlindIndex;
  rateLimitStorage: AuthRateLimitStorage;
  registrationGate?: AuthRegistrationGate;
  repository?: GoogleOidcRepository;
  oidc?: OpenIdClientApi;
  now?: () => Date;
  randomSessionToken?: () => string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requestId(request: Request): string {
  const value = request.headers.get("x-request-id");
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : randomUUID();
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16_384) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 1 || segment.slice(0, separator).trim() !== name) continue;
    const value = segment.slice(separator + 1).trim();
    return OPAQUE_VALUE.test(value) ? value : null;
  }
  return null;
}

function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MILLISECONDS / 1_000)}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function loginAttemptCookie(token: string, secure: boolean): string {
  return [
    `${LOGIN_ATTEMPT_COOKIE}=${token}`,
    "Path=/api/auth/callback/google",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(LOGIN_ATTEMPT_MILLISECONDS / 1_000)}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearCookie(name: string, path: string, secure: boolean): string {
  return [
    `${name}=`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function appendCookies(response: Response, cookies: readonly string[]): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function currentTokenHash(request: Request): string | null {
  const token = cookieValue(request, SESSION_COOKIE);
  return token ? sha256(token) : null;
}

function hashMatches(rawValue: string | null, expectedHash: string): boolean {
  if (!rawValue || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(sha256(rawValue), "hex"), Buffer.from(expectedHash, "hex"));
}

function networkIdentifier(request: Request): string {
  const candidate = request.headers.get("x-vercel-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  return candidate && isIP(candidate) ? candidate : "unknown";
}

function userAgent(request: Request): string | null {
  const value = request.headers.get("user-agent")?.trim().slice(0, 1_000);
  return value || null;
}

function trustedMutation(request: Request, origins: readonly string[]): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  return Boolean(origin && origins.includes(origin));
}

async function startInput(request: Request): Promise<ReturnType<typeof googleAuthStartInputSchema.parse>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new TypeError("invalid_auth_body");
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_AUTH_BODY_BYTES) {
    throw new TypeError("invalid_auth_body");
  }
  try {
    return googleAuthStartInputSchema.parse(JSON.parse(body) as unknown);
  } catch (error) {
    throw new TypeError("invalid_auth_body", { cause: error });
  }
}

function authPage(config: AuthConfiguration, code: string, next = "/"): string {
  const location = new URL("/auth", config.appOrigin);
  const safeNext = safeAuthNextPath(next);
  if (safeNext !== "/") location.searchParams.set("next", safeNext);
  location.searchParams.set("error", code);
  return location.toString();
}

function redirect(location: string, cookies: readonly string[] = []): Response {
  const response = new Response(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location,
    },
  });
  return cookies.length ? appendCookies(response, cookies) : response;
}

function callbackUrl(request: Request, configuredCallback: string): URL {
  const incoming = new URL(request.url);
  const result = new URL(configuredCallback);
  incoming.searchParams.forEach((value, key) => result.searchParams.append(key, value));
  return result;
}

function verifiedIdentity(claims: unknown): VerifiedGoogleIdentity {
  if (!claims || typeof claims !== "object") {
    throw new TypeError("missing_id_token_claims");
  }
  const values = claims as Record<string, unknown>;
  const subject = typeof values.sub === "string" ? values.sub : "";
  const email = typeof values.email === "string"
    ? values.email.normalize("NFKC").trim().toLowerCase()
    : "";
  if (
    values.email_verified !== true
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    || Buffer.byteLength(email, "utf8") > 254
  ) throw new GoogleEmailNotVerifiedError();
  if (
    !subject
    || Buffer.byteLength(subject, "utf8") > 255
    || [...subject].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) throw new TypeError("invalid_google_subject");

  const claimedName = typeof values.name === "string"
    ? values.name.normalize("NFKC").replace(/\s+/gu, " ").trim()
    : "";
  return {
    email,
    name: (claimedName || "Nieuwe verbouwer").slice(0, 80),
    subject,
  };
}

class GoogleEmailNotVerifiedError extends Error {
  constructor() {
    super("Google identity has no verified email.");
    this.name = "GoogleEmailNotVerifiedError";
  }
}

function sessionData(record: GoogleSessionRecord | null): AuthSessionData {
  if (!record) return { session: null, user: null };
  return {
    session: {
      id: record.sessionId,
      userId: record.authUserId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.sessionUpdatedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
    },
    user: {
      id: record.authUserId,
      name: record.name,
      email: record.email,
      emailVerified: true,
      image: record.image,
      createdAt: record.userCreatedAt.toISOString(),
      updatedAt: record.userUpdatedAt.toISOString(),
    },
  };
}

function accountSession(record: GoogleSessionRecord, currentId: string): AccountAuthSession {
  return {
    id: record.sessionId,
    authUserId: record.authUserId,
    isCurrent: record.sessionId === currentId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.sessionUpdatedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    ipAddress: null,
    userAgent: record.userAgent,
  };
}

export function createBuildyAuth(input: CreateBuildyAuthInput): AuthEngine {
  if (input.config.betaMode !== false && !input.registrationGate) {
    throw new AuthUnavailableError("configuration_invalid");
  }
  const oidc = input.oidc ?? defaultOpenIdClient;
  const now = input.now ?? (() => new Date());
  const createSessionToken = input.randomSessionToken
    ?? (() => randomBytes(32).toString("base64url"));
  const repository = input.repository ?? new PostgresGoogleOidcRepository(
    input.database,
    input.identityProvisioner,
    input.registrationGate,
  );
  let configuration: Promise<Configuration> | undefined;
  const resolveConfiguration = (): Promise<Configuration> => {
    if (configuration) return configuration;
    const pending = oidc.discovery(
      GOOGLE_ISSUER,
      input.config.google.clientId,
      input.config.google.clientSecret,
    ).catch((error: unknown) => {
      if (configuration === pending) configuration = undefined;
      throw error;
    });
    configuration = pending;
    return pending;
  };

  const authoritativeSession = async (request: Request): Promise<GoogleSessionRecord | null> => {
    const tokenHash = currentTokenHash(request);
    return tokenHash ? repository.findSession(tokenHash, now()) : null;
  };

  const account: AccountAuthGateway = {
    async currentSession(request) {
      const current = await authoritativeSession(request);
      return current ? accountSession(current, current.sessionId) : null;
    },
    async listSessions(request) {
      const tokenHash = currentTokenHash(request);
      if (!tokenHash) return [];
      const current = await repository.findSession(tokenHash, now());
      if (!current) return [];
      return (await repository.listSessions(tokenHash, now()))
        .map((session) => accountSession(session, current.sessionId));
    },
    async revokeSession(request, sessionId) {
      const tokenHash = currentTokenHash(request);
      if (!tokenHash) return { revoked: false, wasCurrent: false };
      return repository.revokeSession(tokenHash, sessionId, now());
    },
  };

  const handle = async (request: Request): Promise<Response> => {
    const id = requestId(request);
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";

    if (!trustedMutation(request, input.config.trustedOrigins)) {
      return jsonError(403, "FORBIDDEN", "Deze aanvraag komt niet van een vertrouwde Buildy-origin.", id);
    }

    if (request.method === "GET" && ["/api/auth/session", "/api/auth/get-session"].includes(pathname)) {
      return jsonSuccess(sessionData(await authoritativeSession(request)), id);
    }

    if (request.method === "POST" && pathname === "/api/auth/logout") {
      const tokenHash = currentTokenHash(request);
      if (tokenHash) await repository.revokeCurrentSession(tokenHash, now());
      return appendCookies(
        jsonSuccess({ signedOut: true as const }, id),
        [clearCookie(SESSION_COOKIE, "/", input.config.secureCookies)],
      );
    }

    if (request.method === "POST" && pathname === "/api/auth/sign-in/google") {
      let parsed: Awaited<ReturnType<typeof startInput>>;
      try {
        parsed = await startInput(request);
      } catch {
        return jsonError(400, "BAD_REQUEST", "De login-aanvraag is ongeldig.", id);
      }

      const network = networkIdentifier(request);
      const agent = userAgent(request) ?? "unknown";
      const rateLimit = await input.rateLimitStorage.consume(
        `google-oidc-start:${network}\0${agent}`,
        { max: 10, window: 15 * 60 },
      );
      if (!rateLimit.allowed) {
        const response = jsonError(429, "RATE_LIMITED", "Je hebt dit te vaak geprobeerd. Wacht even.", id);
        const headers = new Headers(response.headers);
        headers.set("retry-after", String(rateLimit.retryAfter ?? 60));
        return new Response(response.body, { headers, status: response.status });
      }

      try {
        const attemptId = randomUUID();
        const browserBinding = randomBytes(32).toString("base64url");
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();
        const codeVerifier = oidc.randomPKCECodeVerifier();
        const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
        const createdAt = now();
        await repository.createLoginAttempt({
          id: attemptId,
          stateHash: sha256(state),
          sourceHash: input.blindIndex.create(
            "google-oidc-attempt-source",
            `${network}\0${agent}`,
          ),
          browserBindingHash: sha256(browserBinding),
          codeVerifierCiphertext: input.keyring.encrypt(
            codeVerifier,
            `google-oidc-attempt:${attemptId}:verifier`,
          ),
          nonceCiphertext: input.keyring.encrypt(
            nonce,
            `google-oidc-attempt:${attemptId}:nonce`,
          ),
          nextPath: parsed.next,
          expiresAt: new Date(createdAt.getTime() + LOGIN_ATTEMPT_MILLISECONDS),
          createdAt,
        });
        const authorizationUrl = oidc.buildAuthorizationUrl(await resolveConfiguration(), {
          redirect_uri: input.config.callbackUrl,
          scope: "openid email profile",
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          nonce,
          prompt: "select_account",
        });
        return appendCookies(
          jsonSuccess({ authorizationUrl: authorizationUrl.toString() }, id),
          [loginAttemptCookie(browserBinding, input.config.secureCookies)],
        );
      } catch {
        return jsonError(503, "AUTH_UNAVAILABLE", "Google-login is tijdelijk niet beschikbaar.", id);
      }
    }

    if (request.method === "GET" && pathname === "/api/auth/callback/google") {
      const state = url.searchParams.get("state");
      if (!state || !OPAQUE_VALUE.test(state)) {
        return redirect(authPage(input.config, "GOOGLE_CALLBACK_INVALID"), [
          clearCookie(LOGIN_ATTEMPT_COOKIE, "/api/auth/callback/google", input.config.secureCookies),
        ]);
      }
      const attempt = await repository.consumeLoginAttempt(sha256(state), now());
      if (!attempt || !hashMatches(cookieValue(request, LOGIN_ATTEMPT_COOKIE), attempt.browserBindingHash)) {
        return redirect(authPage(input.config, "GOOGLE_CALLBACK_INVALID"), [
          clearCookie(LOGIN_ATTEMPT_COOKIE, "/api/auth/callback/google", input.config.secureCookies),
        ]);
      }

      try {
        const codeVerifier = input.keyring.decrypt(
          attempt.codeVerifierCiphertext,
          `google-oidc-attempt:${attempt.id}:verifier`,
        );
        const nonce = input.keyring.decrypt(
          attempt.nonceCiphertext,
          `google-oidc-attempt:${attempt.id}:nonce`,
        );
        const tokenResponse = await oidc.authorizationCodeGrant(
          await resolveConfiguration(),
          callbackUrl(request, input.config.callbackUrl),
          {
            pkceCodeVerifier: codeVerifier,
            expectedState: state,
            expectedNonce: nonce,
            idTokenExpected: true,
          },
        );
        const identity = verifiedIdentity(tokenResponse.claims());
        const sessionToken = createSessionToken();
        if (!OPAQUE_VALUE.test(sessionToken)) throw new TypeError("invalid_session_token");
        const createdAt = now();
        await repository.completeLogin(identity, {
          id: randomUUID(),
          tokenHash: sha256(sessionToken),
          userAgent: userAgent(request),
          createdAt,
          expiresAt: new Date(createdAt.getTime() + SESSION_MILLISECONDS),
        });
        return redirect(new URL(safeAuthNextPath(attempt.nextPath), input.config.appOrigin).toString(), [
          sessionCookie(sessionToken, input.config.secureCookies),
          clearCookie(LOGIN_ATTEMPT_COOKIE, "/api/auth/callback/google", input.config.secureCookies),
          clearCookie(BETA_RESERVATION_COOKIE, "/api/auth", input.config.secureCookies),
        ]);
      } catch (error) {
        const code = error instanceof AuthRegistrationRejectedError
          ? error.code
          : error instanceof GoogleEmailNotVerifiedError
            ? "GOOGLE_EMAIL_NOT_VERIFIED"
            : "GOOGLE_LOGIN_FAILED";
        return redirect(authPage(input.config, code, attempt.nextPath), [
          clearCookie(LOGIN_ATTEMPT_COOKIE, "/api/auth/callback/google", input.config.secureCookies),
          clearCookie(BETA_RESERVATION_COOKIE, "/api/auth", input.config.secureCookies),
        ]);
      }
    }

    return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", id);
  };

  return {
    account,
    handler: input.registrationGate
      ? (request) => input.registrationGate!.withRequest(request, () => handle(request))
      : handle,
    async resolveAuthUserId(request) {
      return (await authoritativeSession(request))?.authUserId ?? null;
    },
  };
}

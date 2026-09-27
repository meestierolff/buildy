import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { usernameSignInInputSchema, usernameSignUpInputSchema, type AuthSessionData } from "../../shared/contracts/auth.js";
import type { AccountAuthGateway, AccountAuthSession } from "../account/types.js";
import type { BuildyDatabase } from "../db/client.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import type { AuthConfiguration } from "./config.js";
import type { AuthIdentityProvisioner, AuthNewUserAuthorizer } from "./identity.js";
import { PostgresPasswordAuthRepository, UsernameUnavailableError, type PasswordAuthRepository, type PasswordSessionRecord } from "./passwordRepository.js";
import { hashPassword, isWeakPassword, verifyPassword } from "./password.js";

const SESSION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_COOKIE = "buildy_session";
const OPAQUE_VALUE = /^[A-Za-z0-9_-]{32,512}$/;
const MAX_AUTH_BODY_BYTES = 4 * 1_024;

export type AuthRateLimitStorage = {
  consume(key: string, rule: { max: number; window: number }): Promise<{ allowed: boolean; retryAfter: number | null }>;
};
export interface AuthRegistrationGate extends AuthNewUserAuthorizer {
  withRequest<Result>(request: Request, next: () => Promise<Result>): Promise<Result>;
}
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
  repository?: PasswordAuthRepository;
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

function sessionData(record: PasswordSessionRecord | null): AuthSessionData {
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
      emailVerified: record.emailVerified,
      username: record.username,
      image: record.image,
      createdAt: record.userCreatedAt.toISOString(),
      updatedAt: record.userUpdatedAt.toISOString(),
    },
  };
}

function accountSession(record: PasswordSessionRecord, currentId: string): AccountAuthSession {
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

async function authInput(request: Request, signup: boolean) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !request.body) throw new TypeError("invalid_auth_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_BODY_BYTES) {
        await reader.cancel();
        throw new TypeError("invalid_auth_body");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const schema = signup ? usernameSignUpInputSchema : usernameSignInInputSchema;
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
}

export function createBuildyAuth(input: CreateBuildyAuthInput): AuthEngine {
  const now = input.now ?? (() => new Date());
  const createSessionToken = input.randomSessionToken ?? (() => randomBytes(32).toString("base64url"));
  const repository = input.repository ?? new PostgresPasswordAuthRepository(input.database, input.identityProvisioner);
  const authoritativeSession = async (request: Request): Promise<PasswordSessionRecord | null> => {
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
      return (await repository.listSessions(tokenHash, now())).map((session) => accountSession(session, current.sessionId));
    },
    async revokeSession(request, sessionId) {
      const tokenHash = currentTokenHash(request);
      return tokenHash ? repository.revokeSession(tokenHash, sessionId, now()) : { revoked: false, wasCurrent: false };
    },
  };
  const handle = async (request: Request): Promise<Response> => {
    const id = requestId(request);
    const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    if (!trustedMutation(request, input.config.trustedOrigins)) {
      return jsonError(403, "FORBIDDEN", "Deze aanvraag komt niet van een vertrouwde Buildy-origin.", id);
    }
    if (request.method === "GET" && ["/api/auth/session", "/api/auth/get-session"].includes(pathname)) {
      return jsonSuccess(sessionData(await authoritativeSession(request)), id);
    }
    if (request.method === "POST" && pathname === "/api/auth/logout") {
      const tokenHash = currentTokenHash(request);
      if (tokenHash) await repository.revokeCurrentSession(tokenHash, now());
      return appendCookies(jsonSuccess({ signedOut: true as const }, id), [clearCookie(SESSION_COOKIE, "/", input.config.secureCookies)]);
    }
    if (request.method !== "POST" || !["/api/auth/sign-in", "/api/auth/sign-up"].includes(pathname)) {
      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", id);
    }
    const signup = pathname === "/api/auth/sign-up";
    let parsed: Awaited<ReturnType<typeof authInput>>;
    try {
      parsed = await authInput(request, signup);
    } catch {
      return jsonError(400, "BAD_REQUEST", "Controleer je gebruikersnaam en wachtwoord.", id);
    }
    // Email-bound invitations cannot silently authorize a username-only account.
    if (signup && input.config.betaMode !== false) {
      return jsonError(503, "AUTH_UNAVAILABLE", "Account maken is tijdelijk niet beschikbaar.", id);
    }
    const subjects = [
      { name: signup ? "password-sign-up-network" : "password-sign-in-network", value: networkIdentifier(request), max: signup ? 5 : 30 },
      { name: "password-auth-username", value: parsed.username, max: 10 },
    ];
    for (const subject of subjects) {
      const limit = await input.rateLimitStorage.consume(
        `${subject.name}:${input.blindIndex.create(subject.name, subject.value)}`,
        { max: subject.max, window: 15 * 60 },
      );
      if (!limit.allowed) {
        const response = jsonError(429, "RATE_LIMITED", "Je hebt dit te vaak geprobeerd. Wacht even.", id);
        response.headers.set("retry-after", String(limit.retryAfter ?? 60));
        return response;
      }
    }
    if (signup && isWeakPassword(parsed.password, parsed.username)) {
      return jsonError(400, "WEAK_PASSWORD", "Kies een minder voorspelbaar wachtwoord, bijvoorbeeld een paar eigen woorden.", id);
    }
    try {
      const token = createSessionToken();
      if (!OPAQUE_VALUE.test(token)) throw new TypeError("invalid_session_token");
      const createdAt = now();
      const session = {
        id: randomUUID(), tokenHash: sha256(token), userAgent: userAgent(request), createdAt,
        expiresAt: new Date(createdAt.getTime() + SESSION_MILLISECONDS),
      };
      if (signup) {
        await repository.register({ username: parsed.username, passwordHash: await hashPassword(parsed.password) }, session);
      } else {
        const credentials = await repository.findCredentials(parsed.username);
        const valid = await verifyPassword(parsed.password, credentials?.passwordHash ?? null);
        if (!valid || !credentials) {
          return jsonError(401, "INVALID_CREDENTIALS", "Je gebruikersnaam of wachtwoord klopt niet.", id);
        }
        await repository.createSession(credentials.authUserId, session);
      }
      const previousTokenHash = currentTokenHash(request);
      if (previousTokenHash && previousTokenHash !== session.tokenHash) {
        await repository.revokeCurrentSession(previousTokenHash, createdAt);
      }
      return appendCookies(jsonSuccess({ next: parsed.next }, id), [sessionCookie(token, input.config.secureCookies)]);
    } catch (error) {
      if (error instanceof UsernameUnavailableError) {
        return jsonError(409, "USERNAME_UNAVAILABLE", "Deze gebruikersnaam is al in gebruik. Kies een andere of log in.", id);
      }
      return jsonError(503, "AUTH_UNAVAILABLE", "Inloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.", id);
    }
  };
  return {
    account,
    handler: handle,
    async resolveAuthUserId(request) { return (await authoritativeSession(request))?.authUserId ?? null; },
  };
}

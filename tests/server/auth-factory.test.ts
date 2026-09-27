// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBuildyAuth, type CreateBuildyAuthInput } from "../../server/auth/factory";
import { hashPassword, verifyPassword, isWeakPassword } from "../../server/auth/password";
import { UsernameUnavailableError, type PasswordAuthRepository, type PasswordSessionRecord } from "../../server/auth/passwordRepository";
import type { BuildyDatabase } from "../../server/db/client";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";
import { authSessionResponseSchema, usernameSignUpInputSchema } from "../../shared/contracts/auth";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const TOKEN = "T".repeat(43);
const PASSWORD = "Mijn houten huis wordt mooi!";
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });
const record: PasswordSessionRecord = {
  authUserId: "auth-user", username: "verbouwer", name: "verbouwer", email: null,
  emailVerified: false, image: null, sessionId: "00000000-0000-4000-8000-000000000001",
  createdAt: NOW, expiresAt: new Date(NOW.getTime() + 604800000), sessionUpdatedAt: NOW,
  userAgent: null, userCreatedAt: NOW, userUpdatedAt: NOW,
};
function harness(overrides: Partial<CreateBuildyAuthInput> = {}) {
  const repository: PasswordAuthRepository = {
    register: vi.fn(async () => record),
    findCredentials: vi.fn(async () => ({ authUserId: record.authUserId, passwordHash })),
    createSession: vi.fn(async () => record),
    findSession: vi.fn(async () => record),
    listSessions: vi.fn(async () => [record]),
    revokeCurrentSession: vi.fn(async () => true),
    revokeSession: vi.fn(async () => ({ revoked: true, wasCurrent: true })),
  };
  const rateLimitStorage = { consume: vi.fn(async (_key: string, _rule: { max: number; window: number }) => ({ allowed: true, retryAfter: null as number | null })) };
  const input: CreateBuildyAuthInput = {
    config: { appOrigin: "https://app.buildy.test", betaMode: false,
      databaseUrl: "postgresql://web:secret@localhost/buildy", secureCookies: true,
      trustedOrigins: ["https://app.buildy.test"] },
    database: {} as BuildyDatabase,
    identityProvisioner: { provisionForAuthUser: vi.fn(), ensureForSession: vi.fn() },
    blindIndex: new PrivacyBlindIndex(Buffer.alloc(32, 2).toString("base64")),
    keyring: new DataProtectionKeyring({ currentVersion: 1, keys: { 1: Buffer.alloc(32, 1).toString("base64") } }),
    repository, rateLimitStorage, now: () => NOW, randomSessionToken: () => TOKEN, ...overrides,
  };
  return { engine: createBuildyAuth(input), repository, rateLimitStorage, input };
}
function request(path = "/api/auth/sign-in", body: unknown = { username: "Verbouwer", password: PASSWORD, next: "/verbouwing/nieuw" }, headers = {}) {
  return new Request(`https://app.buildy.test${path}`, { method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "https://app.buildy.test", ...headers } });
}
const tokenHash = createHash("sha256").update(TOKEN).digest("hex");

describe("username and password authentication", () => {
  it("registers a normalized username with a salted hash, private session and safe next", async () => {
    const { engine, repository } = harness();
    const response = await engine.handler(request("/api/auth/sign-up"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { next: "/verbouwing/nieuw" } });
    const [identity, session] = vi.mocked(repository.register).mock.calls[0];
    expect(identity.username).toBe("verbouwer");
    expect(identity.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, identity.passwordHash)).toBe(true);
    expect(session.tokenHash).toBe(tokenHash);
    expect(JSON.stringify(session)).not.toContain(TOKEN);
    expect(response.headers.get("set-cookie")).toContain(`buildy_session=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`);
  });
  it("logs into the same persisted identity and rotates the previous session", async () => {
    const { engine, repository } = harness();
    const response = await engine.handler(request(undefined, undefined, { cookie: `buildy_session=${"P".repeat(43)}` }));
    expect(response.status).toBe(200);
    expect(repository.createSession).toHaveBeenCalledWith("auth-user", expect.objectContaining({ tokenHash }));
    expect(repository.revokeCurrentSession).toHaveBeenCalledTimes(1);
  });
  it("gives the same generic rejection for unknown usernames and wrong passwords", async () => {
    const { engine, repository } = harness();
    const wrong = await engine.handler(request(undefined, { username: "verbouwer", password: "verkeerd" }));
    vi.mocked(repository.findCredentials).mockResolvedValue(null);
    const missing = await engine.handler(request(undefined, { username: "onbekend", password: PASSWORD }));
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    const wrongError = (await wrong.json()).error;
    const missingError = (await missing.json()).error;
    expect({ ...wrongError, requestId: undefined }).toEqual({ ...missingError, requestId: undefined });
    expect(repository.createSession).not.toHaveBeenCalled();
  });
  it("rejects a duplicate username without setting a session", async () => {
    const { engine, repository } = harness();
    vi.mocked(repository.register).mockRejectedValue(new UsernameUnavailableError());
    const response = await engine.handler(request("/api/auth/sign-up"));
    expect(response.status).toBe(409);
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("rate limits before password work and uses blinded subject keys", async () => {
    const { engine, repository, rateLimitStorage } = harness();
    rateLimitStorage.consume.mockResolvedValue({ allowed: false, retryAfter: 42 });
    const response = await engine.handler(request(undefined, undefined, { "x-vercel-forwarded-for": "192.0.2.10" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(repository.findCredentials).not.toHaveBeenCalled();
    expect(JSON.stringify(rateLimitStorage.consume.mock.calls)).not.toMatch(/192\.0\.2\.10|verbouwer/);
  });
  it("cannot reopen an exhausted signin limit by submitting the signup form", async () => {
    const { engine, rateLimitStorage, repository } = harness();
    const counts = new Map<string, number>();
    rateLimitStorage.consume.mockImplementation(async (key, rule) => {
      const count = Math.min((counts.get(key) ?? 31) + 1, rule.max + 1);
      counts.set(key, count);
      return { allowed: count <= rule.max, retryAfter: 60 };
    });
    expect((await engine.handler(request())).status).toBe(429);
    expect((await engine.handler(request("/api/auth/sign-up"))).status).toBe(429);
    expect((await engine.handler(request())).status).toBe(429);
    expect(repository.findCredentials).not.toHaveBeenCalled();
  });
  it("rejects cross-origin sign-in, signup and logout", async () => {
    const { engine, repository } = harness();
    for (const path of ["/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/logout"]) {
      expect((await engine.handler(request(path, undefined, { origin: "https://evil.test" }))).status).toBe(403);
    }
    expect(repository.register).not.toHaveBeenCalled();
    expect(repository.revokeCurrentSession).not.toHaveBeenCalled();
  });
  it("rejects oversized and invalid input before persistence", async () => {
    const { engine, repository } = harness();
    for (const body of [{ username: "xx", password: PASSWORD }, { username: "valid", password: "a".repeat(5000) }, { username: "valid", password: PASSWORD, role: "admin" }]) {
      expect((await engine.handler(request("/api/auth/sign-up", body))).status).toBe(400);
    }
    expect(repository.register).not.toHaveBeenCalled();
  });
  it("rejects predictable passwords and does not bypass email-bound beta invitations", async () => {
    const { engine, input } = harness();
    expect((await engine.handler(request("/api/auth/sign-up", { username: "valid", password: "password123456789" }))).status).toBe(400);
    input.config.betaMode = true;
    expect((await engine.handler(request("/api/auth/sign-up"))).status).toBe(503);
  });
  it("never starts Google OAuth or accepts callbacks", async () => {
    const { engine } = harness();
    expect((await engine.handler(request("/api/auth/sign-in/google"))).status).toBe(404);
    expect((await engine.handler(new Request("https://app.buildy.test/api/auth/callback/google?code=anything"))).status).toBe(404);
  });
  it("closes safely on a database outage", async () => {
    const { engine, repository } = harness();
    vi.mocked(repository.findCredentials).mockRejectedValue(new Error("private database detail"));
    const response = await engine.handler(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("keeps redirects same-origin", async () => {
    const { engine } = harness();
    const response = await engine.handler(request(undefined, { username: "verbouwer", password: PASSWORD, next: "https://evil.test" }));
    expect(await response.json()).toMatchObject({ data: { next: "/" } });
  });
  it("resolves and lists server sessions, then revokes on logout", async () => {
    const { engine, repository } = harness();
    const sessionRequest = new Request("https://app.buildy.test/api/auth/session", { headers: { cookie: `buildy_session=${TOKEN}` } });
    const result = authSessionResponseSchema.parse(await (await engine.handler(sessionRequest)).json());
    expect(result.data.user).toMatchObject({ username: "verbouwer", email: null, emailVerified: false });
    expect(await engine.resolveAuthUserId(sessionRequest)).toBe("auth-user");
    expect(await engine.account.listSessions(sessionRequest)).toHaveLength(1);
    const logout = await engine.handler(request("/api/auth/logout", {}, { cookie: `buildy_session=${TOKEN}` }));
    expect(repository.revokeCurrentSession).toHaveBeenCalledWith(tokenHash, NOW);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await engine.handler(new Request("https://app.buildy.test/api/auth/session"))).status).toBe(200);
  });
});

describe("password storage", () => {
  it("salts each hash and rejects a wrong password or malformed stored hash", async () => {
    const second = await hashPassword(PASSWORD);
    expect(second).not.toBe(passwordHash);
    expect(await verifyPassword(PASSWORD, second)).toBe(true);
    expect(await verifyPassword("wrong", second)).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt$malformed")).toBe(false);
    expect(await verifyPassword(PASSWORD, null)).toBe(false);
  });
  it("allows passphrases, spaces and Unicode without composition rules", () => {
    expect(usernameSignUpInputSchema.parse({ username: " My.House-2 ", password: "🌳".repeat(15) }).username).toBe("my.house-2");
    expect(usernameSignUpInputSchema.safeParse({ username: "house", password: "a".repeat(14) }).success).toBe(false);
    expect(usernameSignUpInputSchema.safeParse({ username: "house", password: "🌳".repeat(129) }).success).toBe(false);
    expect(isWeakPassword(PASSWORD, "verbouwer")).toBe(false);
  });
});

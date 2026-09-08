// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPostgresAuthIdentityProvisioner } from "../../server/auth/identity";
import { createBuildyAuth } from "../../server/auth/factory";
import { PostgresAuthRateLimitStorage } from "../../server/auth/postgresRateLimitStorage";
import { PostgresPasswordAuthRepository, UsernameUnavailableError, type NewPasswordSession } from "../../server/auth/passwordRepository";
import { createBuildyDatabase } from "../../server/db/client";
import { StrictMappedProjectActorResolver } from "../../server/projects/actor";
import { PostgresActiveAppUserLookup } from "../../server/projects/authActor";
import { PostgresProjectRepository } from "../../server/projects/repository";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";

const adminUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webUrl = process.env.DATABASE_SECURITY_WEB_URL?.trim();
const accountWorkerUrl = process.env.DATABASE_SECURITY_ACCOUNT_WORKER_URL?.trim();
const describeWithDatabase = adminUrl && webUrl && accountWorkerUrl ? describe : describe.skip;
const passwordHash = `scrypt$v1$131072$8$1$${"a".repeat(32)}$${"b".repeat(128)}`;

function assertDisposable(raw: string): void {
  const url = new URL(raw);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    || !/(?:test|tmp|ci)/i.test(decodeURIComponent(url.pathname))) {
    throw new Error("Wachtwoordtests vereisen een lokale tijdelijke testdatabase.");
  }
}

function session(createdAt = new Date()): NewPasswordSession {
  return {
    id: randomUUID(),
    tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    userAgent: "Synthetic password integration test",
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60_000),
  };
}

describeWithDatabase("username/password PostgreSQL boundary", () => {
  let admin: Client;
  let worker: Client;
  let resources: ReturnType<typeof createBuildyDatabase>;
  let repository: PostgresPasswordAuthRepository;
  const usernames: string[] = [];
  const username = () => {
    const value = `test-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    usernames.push(value);
    return value;
  };

  beforeAll(async () => {
    for (const url of [adminUrl!, webUrl!, accountWorkerUrl!]) assertDisposable(url);
    admin = new Client({ connectionString: adminUrl });
    worker = new Client({ connectionString: accountWorkerUrl });
    await admin.connect();
    await worker.connect();
    resources = createBuildyDatabase(webUrl!, { applicationName: "password-auth-test" });
    repository = new PostgresPasswordAuthRepository(resources.database, createPostgresAuthIdentityProvisioner());
  });

  afterEach(async () => { await admin?.query("ROLLBACK"); });

  afterAll(async () => {
    if (admin) {
      await admin.query("ROLLBACK");
      const accounts = await admin.query<{ auth_user_id: string; app_user_id: string }>(`
        SELECT credential.auth_user_id, mapping.app_user_id
        FROM public.password_credentials credential
        JOIN public.auth_identity_mappings mapping ON mapping.auth_user_id = credential.auth_user_id
        WHERE credential.username = ANY($1::text[])
      `, [usernames]);
      for (const row of accounts.rows) {
        await admin.query("DELETE FROM public.export_jobs WHERE user_id = $1", [row.app_user_id]);
        await admin.query("DELETE FROM public.deletion_jobs WHERE kind = 'account' AND target_id = $1", [row.app_user_id]);
        await admin.query("UPDATE public.app_users SET status = 'deleted', deleted_at = statement_timestamp() WHERE id = $1", [row.app_user_id]);
        // Match lifecycle erasure: append-only audit records retain the domain
        // tombstone while provider identity, credentials and sessions disappear.
        await admin.query("DELETE FROM public.auth_identity_mappings WHERE auth_user_id = $1", [row.auth_user_id]);
        await admin.query("DELETE FROM public.auth_users WHERE id = $1", [row.auth_user_id]);
      }
      await admin.end();
    }
    await worker?.end();
    await resources?.pool.end();
  });

  it("runs real signup, actor mapping, private project persistence, logout and password login", async () => {
    const origin = "https://password.buildy.test";
    const name = username();
    const password = "Mijn houten huis wordt steeds mooier!";
    const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 7).toString("base64"));
    const engine = createBuildyAuth({
      config: { appOrigin: origin, betaMode: false, databaseUrl: webUrl!, secureCookies: true, trustedOrigins: [origin] },
      database: resources.database,
      identityProvisioner: createPostgresAuthIdentityProvisioner(),
      blindIndex,
      keyring: new DataProtectionKeyring({ currentVersion: 1, keys: { 1: Buffer.alloc(32, 6).toString("base64") } }),
      rateLimitStorage: new PostgresAuthRateLimitStorage(resources.database, blindIndex),
    });
    const request = (path: string, body?: unknown, cookie?: string) => new Request(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const signup = await engine.handler(request("/api/auth/sign-up", { username: name.toUpperCase(), password }));
    expect(signup.status).toBe(200);
    const firstCookie = signup.headers.get("set-cookie")!.split(";", 1)[0];
    expect(signup.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    const sessionRequest = request("/api/auth/session", undefined, firstCookie);
    const authUserId = await engine.resolveAuthUserId(sessionRequest);
    expect(authUserId).toBeTruthy();
    const actors = new StrictMappedProjectActorResolver(engine, new PostgresActiveAppUserLookup(resources.database));
    const actor = await actors.resolve(sessionRequest);
    expect(actor.kind).toBe("authenticated");
    if (actor.kind !== "authenticated") throw new Error("Synthetic actor was not resolved.");
    const projects = new PostgresProjectRepository(resources.database);
    const projectId = randomUUID();
    const commandId = createHash("sha256").update(randomUUID()).digest("hex");
    await projects.createProject({
      projectId, ownerId: actor.appUserId, slug: `password-${projectId}`,
      input: { title: "Ons eerste huis", idempotencyKey: commandId },
      privateDetails: { addressLine1Ciphertext: null, addressLine2Ciphertext: null, postalCodeCiphertext: null,
        cityCiphertext: null, countryCode: null, contractorNotesCiphertext: null, encryptionKeyVersion: 1 },
      idempotencyKey: commandId, requestHash: createHash("sha256").update(projectId).digest("hex"),
    });
    expect(await projects.getOverview({ kind: "anonymous" }, projectId)).toBeNull();
    expect((await projects.getOverview(actor, projectId))?.title).toBe("Ons eerste huis");
    expect((await engine.handler(request("/api/auth/logout", {}, firstCookie))).status).toBe(200);
    expect(await engine.resolveAuthUserId(sessionRequest)).toBeNull();
    const login = await engine.handler(request("/api/auth/sign-in", { username: name, password }));
    expect(login.status).toBe(200);
    const secondCookie = login.headers.get("set-cookie")!.split(";", 1)[0];
    expect(secondCookie === firstCookie).toBe(false);
    const returningRequest = request("/api/auth/session", undefined, secondCookie);
    expect(await engine.resolveAuthUserId(returningRequest)).toBe(authUserId);
    const returningActor = await actors.resolve(returningRequest);
    expect(returningActor).toEqual(actor);
    expect((await projects.getOverview(returningActor, projectId))?.title).toBe("Ons eerste huis");
  });

  it("registers without an email, creates a private profile and authenticates through the restricted web role", async () => {
    const name = username();
    const first = session();
    const result = await repository.register({ username: name, passwordHash }, first);
    expect(result).toMatchObject({ username: name, name, email: null, emailVerified: false, sessionId: first.id });
    expect(await repository.findCredentials(name)).toMatchObject({ authUserId: result.authUserId, passwordHash });
    expect(await repository.findSession(first.tokenHash, new Date())).toMatchObject({ sessionId: first.id });
    expect(await repository.findSession(first.tokenHash, first.expiresAt)).toBeNull();
    const profile = await admin.query<{ is_private: boolean; migration_status: string }>(`
      SELECT profile.is_private, mapping.migration_status FROM public.auth_identity_mappings mapping
      JOIN public.profiles profile ON profile.user_id = mapping.app_user_id WHERE mapping.auth_user_id = $1
    `, [result.authUserId]);
    expect(profile.rows).toEqual([{ is_private: true, migration_status: "linked" }]);
    expect(JSON.stringify(result)).not.toContain(passwordHash);
    expect(JSON.stringify(result)).not.toContain(first.tokenHash);
  });

  it("rolls back the losing concurrent registration and failed profile provisioning", async () => {
    const name = username();
    const registrations = await Promise.allSettled([
      repository.register({ username: name, passwordHash }, session()),
      repository.register({ username: name, passwordHash }, session()),
    ]);
    expect(registrations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = registrations.find((result) => result.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason instanceof UsernameUnavailableError).toBe(true);
    expect((await admin.query("SELECT id FROM public.auth_users WHERE name = $1", [name])).rowCount).toBe(1);

    const brokenName = username();
    const provisioner = createPostgresAuthIdentityProvisioner();
    const broken = new PostgresPasswordAuthRepository(resources.database, {
      ...provisioner,
      async provisionForAuthUser(transaction, user) {
        await provisioner.provisionForAuthUser(transaction, user);
        throw new Error("Synthetic provisioning failure");
      },
    });
    await expect(broken.register({ username: brokenName, passwordHash }, session())).rejects.toThrow("Synthetic provisioning failure");
    expect((await admin.query("SELECT id FROM public.auth_users WHERE name = $1", [brokenName])).rowCount).toBe(0);
    expect((await admin.query("SELECT user_id FROM public.profiles WHERE display_name = $1", [brokenName])).rowCount).toBe(0);
  });

  it("scopes session listing and revocation to the current account", async () => {
    const first = session();
    const owner = await repository.register({ username: username(), passwordHash }, first);
    const second = session();
    await repository.createSession(owner.authUserId, second);
    const foreign = session();
    await repository.register({ username: username(), passwordHash }, foreign);
    expect((await repository.listSessions(first.tokenHash, new Date())).map((row) => row.sessionId).sort())
      .toEqual([first.id, second.id].sort());
    expect(await repository.revokeSession(first.tokenHash, foreign.id, new Date())).toEqual({ revoked: false, wasCurrent: false });
    expect(await repository.revokeSession(first.tokenHash, second.id, new Date())).toEqual({ revoked: true, wasCurrent: false });
    expect(await repository.findSession(second.tokenHash, new Date())).toBeNull();
    expect(await repository.revokeCurrentSession(first.tokenHash, new Date())).toBe(true);
    expect(await repository.listSessions(first.tokenHash, new Date())).toEqual([]);
    expect(await repository.findSession(foreign.tokenHash, new Date())).not.toBeNull();
  });

  it("revokes suspension sessions permanently and serializes login with account restriction", async () => {
    const first = session();
    const name = username();
    const owner = await repository.register({ username: name, passwordHash }, first);
    const appUser = await admin.query<{ app_user_id: string }>(
      "SELECT app_user_id FROM public.auth_identity_mappings WHERE auth_user_id = $1", [owner.authUserId],
    );
    expect(await repository.findCredentials(name)).not.toBeNull();
    await admin.query("BEGIN");
    await admin.query("UPDATE public.app_users SET status = 'suspended' WHERE id = $1", [appUser.rows[0].app_user_id]);
    const staleLogin = repository.createSession(owner.authUserId, session());
    const rejected = expect(staleLogin).rejects.toThrow("niet actief");
    await admin.query("COMMIT");
    await rejected;
    expect(await repository.findCredentials(name)).toBeNull();
    expect(await repository.findSession(first.tokenHash, new Date())).toBeNull();
    await admin.query("UPDATE public.app_users SET status = 'active' WHERE id = $1", [appUser.rows[0].app_user_id]);
    expect(await repository.findCredentials(name)).not.toBeNull();
    expect(await repository.findSession(first.tokenHash, new Date())).toBeNull();
    expect((await repository.createSession(owner.authUserId, session())).authUserId).toBe(owner.authUserId);
  });

  it("invalidates sessions immediately on an account deletion request and cascades credential erasure", async () => {
    const first = session();
    const name = username();
    const owner = await repository.register({ username: name, passwordHash }, first);
    const actor = await admin.query<{ app_user_id: string }>(
      "SELECT app_user_id FROM public.auth_identity_mappings WHERE auth_user_id = $1", [owner.authUserId],
    );
    await admin.query("BEGIN");
    await admin.query("SELECT set_config('app.actor_id', $1, true)", [actor.rows[0].app_user_id]);
    const deletion = await admin.query<{ job_id: string }>("SELECT * FROM public.app_request_account_deletion($1, 'password-test-policy')", [createHash("sha256").update(randomUUID()).digest("hex")]);
    await admin.query("COMMIT");
    expect(await repository.findCredentials(name)).toBeNull();
    expect(await repository.findSession(first.tokenHash, new Date())).toBeNull();
    const revoked = await admin.query<{ revoked: boolean }>("SELECT revoked_at IS NOT NULL AS revoked FROM public.password_sessions WHERE id = $1", [first.id]);
    expect(revoked.rows).toEqual([{ revoked: true }]);
    await admin.query("UPDATE public.app_users SET status = 'deleted', deleted_at = statement_timestamp() WHERE id = $1", [actor.rows[0].app_user_id]);
    await admin.query("DELETE FROM public.auth_identity_mappings WHERE auth_user_id = $1", [owner.authUserId]);
    await admin.query("DELETE FROM public.auth_users WHERE id = $1", [owner.authUserId]);
    expect((await admin.query("SELECT auth_user_id FROM public.password_credentials WHERE auth_user_id = $1", [owner.authUserId])).rowCount).toBe(0);
    expect((await admin.query("SELECT id FROM public.password_sessions WHERE auth_user_id = $1", [owner.authUserId])).rowCount).toBe(0);
    await admin.query("DELETE FROM public.deletion_jobs WHERE id = $1", [deletion.rows[0].job_id]);
  });

  it("denies workers direct credential/session access and excludes password hashes from account export", async () => {
    for (const table of ["password_credentials", "password_sessions"]) {
      await expect(worker.query(`SELECT * FROM public.${table} LIMIT 1`)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(worker.query("SELECT public.app_lock_password_auth_identity('unknown')")).rejects.toMatchObject({ code: "42501" });
    const first = session();
    const owner = await repository.register({ username: username(), passwordHash }, first);
    const actor = await admin.query<{ app_user_id: string }>(
      "SELECT app_user_id FROM public.auth_identity_mappings WHERE auth_user_id = $1", [owner.authUserId],
    );
    await admin.query("BEGIN");
    await admin.query("SELECT set_config('app.actor_id', $1, true)", [actor.rows[0].app_user_id]);
    const requested = await admin.query<{ job_id: string }>(
      "SELECT * FROM public.app_request_account_export($1, false, 'password-test-policy')", [createHash("sha256").update(randomUUID()).digest("hex")],
    );
    await admin.query("COMMIT");
    const workerId = `password-export-${randomUUID()}`;
    const claimed = await worker.query<{ job_id: string }>("SELECT * FROM public.app_account_worker_claim_export($1, 60)", [workerId]);
    expect(claimed.rows[0]?.job_id).toBe(requested.rows[0].job_id);
    const snapshot = await worker.query<{ payload: unknown }>("SELECT * FROM public.app_account_worker_begin_export($1, $2)", [workerId, requested.rows[0].job_id]);
    expect(snapshot.rows[0]?.payload).toBeTruthy();
    const serialized = JSON.stringify(snapshot.rows[0]?.payload);
    expect(serialized).not.toContain(passwordHash);
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain(first.tokenHash);
  });
});

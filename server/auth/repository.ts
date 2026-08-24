import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { BuildyDatabase } from "../db/client.js";
import type {
  AuthIdentityProvisioner,
  AuthIdentityUser,
  AuthNewUserAuthorizer,
} from "./identity.js";

export interface GoogleLoginAttemptInput {
  id: string;
  stateHash: string;
  sourceHash: string;
  browserBindingHash: string;
  codeVerifierCiphertext: string;
  nonceCiphertext: string;
  nextPath: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface GoogleLoginAttempt {
  id: string;
  browserBindingHash: string;
  codeVerifierCiphertext: string;
  nonceCiphertext: string;
  nextPath: string;
}

export interface VerifiedGoogleIdentity {
  email: string;
  name: string;
  subject: string;
}

export interface NewGoogleSession {
  id: string;
  tokenHash: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface GoogleSessionRecord {
  authUserId: string;
  createdAt: Date;
  email: string;
  expiresAt: Date;
  identitySubject: string;
  image: string | null;
  name: string;
  sessionId: string;
  sessionUpdatedAt: Date;
  userAgent: string | null;
  userCreatedAt: Date;
  userUpdatedAt: Date;
}

export interface GoogleOidcRepository {
  createLoginAttempt(input: GoogleLoginAttemptInput): Promise<void>;
  consumeLoginAttempt(stateHash: string, now: Date): Promise<GoogleLoginAttempt | null>;
  completeLogin(
    identity: VerifiedGoogleIdentity,
    session: NewGoogleSession,
  ): Promise<GoogleSessionRecord>;
  findSession(tokenHash: string, now: Date): Promise<GoogleSessionRecord | null>;
  listSessions(tokenHash: string, now: Date): Promise<GoogleSessionRecord[]>;
  revokeCurrentSession(tokenHash: string, now: Date): Promise<boolean>;
  revokeSession(
    currentTokenHash: string,
    sessionId: string,
    now: Date,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }>;
}

interface SessionRow extends Record<string, unknown> {
  auth_user_id: string;
  created_at: Date;
  email: string;
  expires_at: Date;
  identity_subject: string;
  image: string | null;
  name: string;
  session_id: string;
  session_updated_at: Date;
  user_agent: string | null;
  user_created_at: Date;
  user_updated_at: Date;
}

function sessionRecord(row: SessionRow | undefined): GoogleSessionRecord | null {
  if (!row) return null;
  return {
    authUserId: row.auth_user_id,
    createdAt: new Date(row.created_at),
    email: row.email,
    expiresAt: new Date(row.expires_at),
    identitySubject: row.identity_subject,
    image: row.image,
    name: row.name,
    sessionId: row.session_id,
    sessionUpdatedAt: new Date(row.session_updated_at),
    userAgent: row.user_agent,
    userCreatedAt: new Date(row.user_created_at),
    userUpdatedAt: new Date(row.user_updated_at),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PostgresGoogleOidcRepository implements GoogleOidcRepository {
  constructor(
    private readonly database: BuildyDatabase,
    private readonly identityProvisioner: AuthIdentityProvisioner,
    private readonly newUserAuthorizer?: AuthNewUserAuthorizer,
  ) {}

  async createLoginAttempt(input: GoogleLoginAttemptInput): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        delete from public.google_oidc_login_attempts attempt
        where attempt.expires_at <= ${input.createdAt}
           or attempt.consumed_at <= ${new Date(input.createdAt.getTime() - 24 * 60 * 60 * 1_000)}
      `);
      await transaction.execute(sql`
        insert into public.google_oidc_login_attempts (
          id, state_hash, source_hash, browser_binding_hash, code_verifier_ciphertext,
          nonce_ciphertext, next_path, expires_at, created_at
        ) values (
          ${input.id}::uuid, ${input.stateHash}, ${input.sourceHash}, ${input.browserBindingHash},
          ${input.codeVerifierCiphertext}, ${input.nonceCiphertext},
          ${input.nextPath}, ${input.expiresAt}, ${input.createdAt}
        )
      `);
    });
  }

  async consumeLoginAttempt(stateHash: string, now: Date): Promise<GoogleLoginAttempt | null> {
    const result = await this.database.execute<{
      id: string;
      browser_binding_hash: string;
      code_verifier_ciphertext: string;
      nonce_ciphertext: string;
      next_path: string;
    }>(sql`
      update public.google_oidc_login_attempts attempt
      set consumed_at = ${now}
      where attempt.state_hash = ${stateHash}
        and attempt.consumed_at is null
        and attempt.expires_at > ${now}
      returning attempt.id, attempt.browser_binding_hash, attempt.code_verifier_ciphertext,
        attempt.nonce_ciphertext, attempt.next_path
    `);
    const row = result.rows[0];
    return row ? {
      id: row.id,
      browserBindingHash: row.browser_binding_hash,
      codeVerifierCiphertext: row.code_verifier_ciphertext,
      nonceCiphertext: row.nonce_ciphertext,
      nextPath: row.next_path,
    } : null;
  }

  async completeLogin(
    identity: VerifiedGoogleIdentity,
    session: NewGoogleSession,
  ): Promise<GoogleSessionRecord> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended('google-oidc:' || ${identity.subject}, 0)
        )
      `);

      const existing = await transaction.execute<{ auth_user_id: string }>(sql`
        select google_identity.auth_user_id
        from public.google_oidc_identities google_identity
        where google_identity.subject = ${identity.subject}
        limit 1
      `);
      let authUserId = existing.rows[0]?.auth_user_id;

      if (!authUserId) {
        const legacy = await transaction.execute<{ auth_user_id: string }>(sql`
          select account.user_id as auth_user_id
          from public.auth_accounts account
          join public.auth_identity_mappings mapping
            on mapping.auth_user_id = account.user_id
           and mapping.migration_status = 'linked'
          join public.app_users app_user
            on app_user.id = mapping.app_user_id
           and app_user.status = 'active'
           and app_user.deleted_at is null
          where lower(account.provider_id) = 'google'
            and account.account_id = ${identity.subject}
          limit 1
        `);
        authUserId = legacy.rows[0]?.auth_user_id;
      }

      if (!authUserId) {
        authUserId = randomUUID();
        const authUser: AuthIdentityUser = {
          email: identity.email,
          id: authUserId,
          name: identity.name,
        };
        await transaction.execute(sql`
          insert into public.auth_users (
            id, name, email, email_verified, image, created_at, updated_at
          ) values (
            ${authUser.id}, ${authUser.name}, ${authUser.email}, true, null,
            ${session.createdAt}, ${session.createdAt}
          )
        `);
        await this.identityProvisioner.provisionForAuthUser(transaction, authUser);
        await this.newUserAuthorizer?.authorizeNewUser(transaction, authUser);
      }

      await transaction.execute(sql`
        insert into public.google_oidc_identities (
          subject, auth_user_id, created_at, updated_at, last_authenticated_at
        ) values (
          ${identity.subject}, ${authUserId}, ${session.createdAt},
          ${session.createdAt}, ${session.createdAt}
        )
        on conflict (subject) do update
          set last_authenticated_at = excluded.last_authenticated_at,
              updated_at = excluded.updated_at
        where google_oidc_identities.auth_user_id = excluded.auth_user_id
      `);

      await this.identityProvisioner.ensureForSession(transaction, authUserId);
      await transaction.execute(sql`
        delete from public.google_oidc_sessions existing_session
        where existing_session.expires_at <= ${session.createdAt}
           or existing_session.revoked_at <= ${new Date(session.createdAt.getTime() - 24 * 60 * 60 * 1_000)}
      `);
      await transaction.execute(sql`
        insert into public.google_oidc_sessions (
          id, identity_subject, token_hash, user_agent,
          expires_at, created_at, updated_at
        ) values (
          ${session.id}::uuid, ${identity.subject}, ${session.tokenHash},
          ${session.userAgent}, ${session.expiresAt}, ${session.createdAt}, ${session.createdAt}
        )
      `);

      const result = await transaction.execute<SessionRow>(sql`
        select
          auth_user.id as auth_user_id,
          auth_user.email,
          auth_user.name,
          auth_user.image,
          auth_user.created_at as user_created_at,
          auth_user.updated_at as user_updated_at,
          session.id as session_id,
          session.identity_subject,
          session.user_agent,
          session.created_at,
          session.updated_at as session_updated_at,
          session.expires_at
        from public.google_oidc_sessions session
        join public.google_oidc_identities google_identity
          on google_identity.subject = session.identity_subject
        join public.auth_users auth_user
          on auth_user.id = google_identity.auth_user_id
        where session.id = ${session.id}::uuid
        limit 1
      `);
      const record = sessionRecord(result.rows[0]);
      if (!record) throw new Error("Google OIDC-sessie ontbreekt na aanmaak.");
      return record;
    });
  }

  async findSession(tokenHash: string, now: Date): Promise<GoogleSessionRecord | null> {
    const result = await this.database.execute<SessionRow>(sql`
      select
        auth_user.id as auth_user_id,
        auth_user.email,
        auth_user.name,
        auth_user.image,
        auth_user.created_at as user_created_at,
        auth_user.updated_at as user_updated_at,
        session.id as session_id,
        session.identity_subject,
        session.user_agent,
        session.created_at,
        session.updated_at as session_updated_at,
        session.expires_at
      from public.google_oidc_sessions session
      join public.google_oidc_identities google_identity
        on google_identity.subject = session.identity_subject
      join public.auth_users auth_user
        on auth_user.id = google_identity.auth_user_id
      join public.auth_identity_mappings mapping
        on mapping.auth_user_id = auth_user.id
       and mapping.migration_status = 'linked'
      join public.app_users app_user
        on app_user.id = mapping.app_user_id
       and app_user.status = 'active'
       and app_user.deleted_at is null
      where session.token_hash = ${tokenHash}
        and session.revoked_at is null
        and session.expires_at > ${now}
      limit 1
    `);
    return sessionRecord(result.rows[0]);
  }

  async listSessions(tokenHash: string, now: Date): Promise<GoogleSessionRecord[]> {
    const current = await this.findSession(tokenHash, now);
    if (!current) return [];
    const result = await this.database.execute<SessionRow>(sql`
      select
        auth_user.id as auth_user_id,
        auth_user.email,
        auth_user.name,
        auth_user.image,
        auth_user.created_at as user_created_at,
        auth_user.updated_at as user_updated_at,
        session.id as session_id,
        session.identity_subject,
        session.user_agent,
        session.created_at,
        session.updated_at as session_updated_at,
        session.expires_at
      from public.google_oidc_sessions session
      join public.google_oidc_identities google_identity
        on google_identity.subject = session.identity_subject
      join public.auth_users auth_user
        on auth_user.id = google_identity.auth_user_id
      where session.identity_subject = ${current.identitySubject}
        and session.revoked_at is null
        and session.expires_at > ${now}
      order by session.created_at desc, session.id desc
      limit 100
    `);
    return result.rows.flatMap((row) => {
      const record = sessionRecord(row);
      return record ? [record] : [];
    });
  }

  async revokeCurrentSession(tokenHash: string, now: Date): Promise<boolean> {
    const result = await this.database.execute<{ id: string }>(sql`
      update public.google_oidc_sessions session
      set revoked_at = ${now}, updated_at = ${now}
      where session.token_hash = ${tokenHash}
        and session.revoked_at is null
      returning session.id
    `);
    return Boolean(result.rows[0]);
  }

  async revokeSession(
    currentTokenHash: string,
    sessionId: string,
    now: Date,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    if (!UUID.test(sessionId)) return { revoked: false, wasCurrent: false };
    const current = await this.findSession(currentTokenHash, now);
    if (!current) return { revoked: false, wasCurrent: false };
    const result = await this.database.execute<{ id: string }>(sql`
      update public.google_oidc_sessions target
      set revoked_at = ${now}, updated_at = ${now}
      where target.id = ${sessionId}::uuid
        and target.identity_subject = ${current.identitySubject}
        and target.revoked_at is null
      returning target.id
    `);
    return {
      revoked: Boolean(result.rows[0]),
      wasCurrent: current.sessionId === sessionId,
    };
  }
}

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { BuildyDatabase } from "../db/client.js";
import type { AuthIdentityProvisioner, BuildyAuthTransaction } from "./identity.js";

export interface NewPasswordSession {
  id: string;
  tokenHash: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface PasswordSessionRecord {
  authUserId: string;
  createdAt: Date;
  email: string | null;
  emailVerified: boolean;
  expiresAt: Date;
  image: string | null;
  name: string;
  username: string;
  sessionId: string;
  sessionUpdatedAt: Date;
  userAgent: string | null;
  userCreatedAt: Date;
  userUpdatedAt: Date;
}

export interface PasswordAuthRepository {
  register(input: { username: string; passwordHash: string }, session: NewPasswordSession): Promise<PasswordSessionRecord>;
  findCredentials(username: string): Promise<{ authUserId: string; passwordHash: string } | null>;
  createSession(authUserId: string, session: NewPasswordSession): Promise<PasswordSessionRecord>;
  findSession(tokenHash: string, now: Date): Promise<PasswordSessionRecord | null>;
  listSessions(tokenHash: string, now: Date): Promise<PasswordSessionRecord[]>;
  revokeCurrentSession(tokenHash: string, now: Date): Promise<boolean>;
  revokeSession(currentTokenHash: string, sessionId: string, now: Date): Promise<{ revoked: boolean; wasCurrent: boolean }>;
}

export class UsernameUnavailableError extends Error {
  constructor() {
    super("Deze gebruikersnaam is niet beschikbaar.");
    this.name = "UsernameUnavailableError";
  }
}

interface SessionRow extends Record<string, unknown> {
  auth_user_id: string;
  created_at: Date;
  email: string | null;
  email_verified: boolean;
  expires_at: Date;
  image: string | null;
  name: string;
  username: string;
  session_id: string;
  session_updated_at: Date;
  user_agent: string | null;
  user_created_at: Date;
  user_updated_at: Date;
}

function sessionRecord(row: SessionRow): PasswordSessionRecord {
  return {
    authUserId: row.auth_user_id,
    createdAt: new Date(row.created_at),
    email: row.email,
    emailVerified: row.email_verified,
    expiresAt: new Date(row.expires_at),
    image: row.image,
    name: row.name,
    username: row.username,
    sessionId: row.session_id,
    sessionUpdatedAt: new Date(row.session_updated_at),
    userAgent: row.user_agent,
    userCreatedAt: new Date(row.user_created_at),
    userUpdatedAt: new Date(row.user_updated_at),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

const sessionSelection = sql`
  select auth_user.id as auth_user_id, auth_user.email, auth_user.email_verified,
    auth_user.name, auth_user.image, credential.username,
    auth_user.created_at as user_created_at, auth_user.updated_at as user_updated_at,
    session.id as session_id, session.user_agent, session.created_at,
    session.updated_at as session_updated_at, session.expires_at
  from public.password_sessions session
  join public.auth_users auth_user on auth_user.id = session.auth_user_id
  join public.password_credentials credential on credential.auth_user_id = auth_user.id
`;

export class PostgresPasswordAuthRepository implements PasswordAuthRepository {
  constructor(
    private readonly database: BuildyDatabase,
    private readonly identityProvisioner: AuthIdentityProvisioner,
  ) {}

  async register(
    input: { username: string; passwordHash: string },
    session: NewPasswordSession,
  ): Promise<PasswordSessionRecord> {
    if (!USERNAME.test(input.username)) throw new Error("Ongeldige gebruikersnaam.");
    return this.database.transaction(async (transaction) => {
      const authUserId = randomUUID();
      const authUser = { id: authUserId, name: input.username, email: null };
      await transaction.execute(sql`
        insert into public.auth_users (id, name, email, email_verified, created_at, updated_at)
        values (${authUserId}, ${input.username}, null, false, ${session.createdAt}, ${session.createdAt})
      `);
      const credential = await transaction.execute<{ auth_user_id: string }>(sql`
        insert into public.password_credentials (auth_user_id, username, password_hash, created_at, updated_at)
        values (${authUserId}, ${input.username}, ${input.passwordHash}, ${session.createdAt}, ${session.createdAt})
        on conflict (username) do nothing
        returning auth_user_id
      `);
      // Throw inside the transaction so a concurrent username collision cannot
      // leave an orphan auth user, domain account, profile or session.
      if (!credential.rows[0]) throw new UsernameUnavailableError();
      await this.identityProvisioner.provisionForAuthUser(transaction, authUser);
      return this.insertSession(transaction, authUserId, session);
    });
  }

  async findCredentials(username: string): Promise<{ authUserId: string; passwordHash: string } | null> {
    if (!USERNAME.test(username)) return null;
    const result = await this.database.execute<{ auth_user_id: string; password_hash: string }>(sql`
      select credential.auth_user_id, credential.password_hash
      from public.password_credentials credential
      where credential.username = ${username}
        and public.app_resolve_active_user(credential.auth_user_id) is not null
      limit 1
    `);
    const row = result.rows[0];
    return row ? { authUserId: row.auth_user_id, passwordHash: row.password_hash } : null;
  }

  private async insertSession(
    transaction: BuildyAuthTransaction,
    authUserId: string,
    session: NewPasswordSession,
  ): Promise<PasswordSessionRecord> {
    const locked = await transaction.execute<{ app_user_id: string | null }>(sql`
      select public.app_lock_password_auth_identity(${authUserId}) as app_user_id
    `);
    if (!locked.rows[0]?.app_user_id) throw new Error("De accountidentiteit is niet actief.");
    await this.identityProvisioner.ensureForSession(transaction, authUserId);
    await transaction.execute(sql`
      delete from public.password_sessions existing_session
      where existing_session.auth_user_id = ${authUserId}
        and (existing_session.expires_at <= ${session.createdAt}
          or existing_session.revoked_at <= ${new Date(session.createdAt.getTime() - 24 * 60 * 60_000)})
    `);
    await transaction.execute(sql`
      insert into public.password_sessions (id, auth_user_id, token_hash, user_agent, expires_at, created_at, updated_at)
      values (${session.id}::uuid, ${authUserId}, ${session.tokenHash}, ${session.userAgent},
        ${session.expiresAt}, ${session.createdAt}, ${session.createdAt})
    `);
    const result = await transaction.execute<SessionRow>(sql`
      ${sessionSelection} where session.id = ${session.id}::uuid
        and public.app_resolve_active_user(session.auth_user_id) is not null
    `);
    if (!result.rows[0]) throw new Error("De accountsessie ontbreekt na aanmaak.");
    return sessionRecord(result.rows[0]);
  }

  async createSession(authUserId: string, session: NewPasswordSession): Promise<PasswordSessionRecord> {
    return this.database.transaction((transaction) => this.insertSession(transaction, authUserId, session));
  }

  async findSession(tokenHash: string, now: Date): Promise<PasswordSessionRecord | null> {
    const result = await this.database.execute<SessionRow>(sql`
      ${sessionSelection}
      where session.token_hash = ${tokenHash} and session.revoked_at is null and session.expires_at > ${now}
        and public.app_resolve_active_user(session.auth_user_id) is not null
      limit 1
    `);
    return result.rows[0] ? sessionRecord(result.rows[0]) : null;
  }

  async listSessions(tokenHash: string, now: Date): Promise<PasswordSessionRecord[]> {
    const result = await this.database.execute<SessionRow>(sql`
      ${sessionSelection}
      join public.password_sessions current_session on current_session.auth_user_id = session.auth_user_id
      where current_session.token_hash = ${tokenHash} and current_session.revoked_at is null
        and current_session.expires_at > ${now}
        and session.revoked_at is null and session.expires_at > ${now}
        and public.app_resolve_active_user(session.auth_user_id) is not null
      order by session.created_at desc, session.id desc limit 100
    `);
    return result.rows.map(sessionRecord);
  }

  async revokeCurrentSession(tokenHash: string, now: Date): Promise<boolean> {
    const result = await this.database.execute<{ id: string }>(sql`
      update public.password_sessions set revoked_at = ${now}, updated_at = ${now}
      where token_hash = ${tokenHash} and revoked_at is null returning id
    `);
    return Boolean(result.rows[0]);
  }

  async revokeSession(currentTokenHash: string, sessionId: string, now: Date): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    if (!UUID.test(sessionId)) return { revoked: false, wasCurrent: false };
    const result = await this.database.execute<{ id: string; current_id: string }>(sql`
      update public.password_sessions target set revoked_at = ${now}, updated_at = ${now}
      from public.password_sessions current_session
      where target.id = ${sessionId}::uuid and target.auth_user_id = current_session.auth_user_id
        and current_session.token_hash = ${currentTokenHash} and current_session.revoked_at is null
        and current_session.expires_at > ${now} and target.revoked_at is null
        and public.app_resolve_active_user(target.auth_user_id) is not null
      returning target.id, current_session.id as current_id
    `);
    const row = result.rows[0];
    return { revoked: Boolean(row), wasCurrent: Boolean(row && row.id === row.current_id) };
  }
}

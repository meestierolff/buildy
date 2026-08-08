import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sql } from "drizzle-orm";
import type {
  BetterAuthOptions,
  DBAdapter,
  DBTransactionAdapter,
} from "better-auth";
import { authAccounts, authSessions, authUsers, authVerifications } from "../../db/schema/auth.js";
import type { BuildyDatabase } from "../db/client.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";

export type BuildyAuthTransaction = Parameters<
  Parameters<BuildyDatabase["transaction"]>[0]
>[0];

export interface AuthIdentityUser {
  email: string;
  id: string;
  name: string;
}

export class AuthIdentityProvisioningError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("De accountidentiteit kon niet veilig worden gekoppeld.");
    this.name = "AuthIdentityProvisioningError";
    this.code = code;
  }
}

export interface AuthIdentityProvisioner<Transaction = BuildyAuthTransaction> {
  provisionForAuthUser(transaction: Transaction, user: AuthIdentityUser): Promise<void>;
  ensureForSession(transaction: Transaction, authUserId: string): Promise<void>;
}

/** Runs only for a newly inserted auth user, inside the same transaction. */
export interface AuthNewUserAuthorizer<Transaction = BuildyAuthTransaction> {
  authorizeNewUser(transaction: Transaction, user: AuthIdentityUser): Promise<void>;
}

interface IdentityMapping {
  appUserId: string;
  migrationStatus: "pending" | "linked" | "requires_reset" | "failed";
}

interface IdentityProfileInput {
  displayName: string;
  slug: string;
  userId: string;
}

export interface AuthIdentityPersistence<Transaction> {
  createAppUser(transaction: Transaction, appUserId: string): Promise<void>;
  deleteAppUser(transaction: Transaction, appUserId: string): Promise<void>;
  findAuthUser(transaction: Transaction, authUserId: string): Promise<AuthIdentityUser | null>;
  findIdentityMapping(
    transaction: Transaction,
    authUserId: string,
  ): Promise<IdentityMapping | null>;
  getAppUserStatus(transaction: Transaction, appUserId: string): Promise<string | null>;
  markAuthenticated(transaction: Transaction, appUserId: string, now: Date): Promise<boolean>;
  provisionProfile(transaction: Transaction, profile: IdentityProfileInput): Promise<void>;
  tryCreateIdentityMapping(
    transaction: Transaction,
    input: { appUserId: string; authUserId: string; linkedAt: Date },
  ): Promise<boolean>;
}

interface CreateAuthIdentityProvisionerOptions<Transaction> {
  generateId?: () => string;
  now?: () => Date;
  persistence: AuthIdentityPersistence<Transaction>;
}

function profileDisplayName(user: AuthIdentityUser): string {
  const name = user.name.replace(/\s+/gu, " ").trim();
  if (name) return name.slice(0, 80);
  return "Nieuwe verbouwer";
}

function profileSlug(appUserId: string): string {
  return `verbouwer-${appUserId.replaceAll("-", "").toLowerCase()}`;
}

export function createAuthIdentityProvisioner<Transaction>(
  options: CreateAuthIdentityProvisionerOptions<Transaction>,
): AuthIdentityProvisioner<Transaction> {
  const generateId = options.generateId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  async function ensureIdentity(
    transaction: Transaction,
    user: AuthIdentityUser,
    markAsAuthenticated: boolean,
  ): Promise<void> {
    let mapping = await options.persistence.findIdentityMapping(transaction, user.id);

    if (!mapping) {
      const candidateAppUserId = generateId();
      await options.persistence.createAppUser(transaction, candidateAppUserId);

      const linkedAt = now();
      const inserted = await options.persistence.tryCreateIdentityMapping(transaction, {
        appUserId: candidateAppUserId,
        authUserId: user.id,
        linkedAt,
      });

      if (inserted) {
        mapping = { appUserId: candidateAppUserId, migrationStatus: "linked" };
      } else {
        // A concurrent request won the unique auth-user mapping. Remove this
        // transaction's unused domain user before adopting the winning row.
        await options.persistence.deleteAppUser(transaction, candidateAppUserId);
        mapping = await options.persistence.findIdentityMapping(transaction, user.id);
      }
    }

    if (!mapping) throw new AuthIdentityProvisioningError("identity_mapping_missing");
    if (mapping.migrationStatus !== "linked") {
      throw new AuthIdentityProvisioningError("identity_mapping_not_linked");
    }

    const status = await options.persistence.getAppUserStatus(transaction, mapping.appUserId);
    if (!status) throw new AuthIdentityProvisioningError("app_user_missing");
    if (markAsAuthenticated && status !== "active") {
      throw new AuthIdentityProvisioningError("app_user_inactive");
    }

    await options.persistence.provisionProfile(transaction, {
      displayName: profileDisplayName(user),
      slug: profileSlug(mapping.appUserId),
      userId: mapping.appUserId,
    });

    if (markAsAuthenticated) {
      const marked = await options.persistence.markAuthenticated(
        transaction,
        mapping.appUserId,
        now(),
      );
      if (!marked) throw new AuthIdentityProvisioningError("app_user_inactive");
    }
  }

  return {
    async provisionForAuthUser(transaction, user) {
      await ensureIdentity(transaction, user, false);
    },
    async ensureForSession(transaction, authUserId) {
      const user = await options.persistence.findAuthUser(transaction, authUserId);
      if (!user) throw new AuthIdentityProvisioningError("auth_user_missing");
      await ensureIdentity(transaction, user, true);
    },
  };
}

export function createPostgresAuthIdentityProvisioner(
  keyring: DataProtectionKeyring,
  blindIndex: PrivacyBlindIndex,
): AuthIdentityProvisioner {
  const provision = async (
    transaction: BuildyAuthTransaction,
    authUserId: string,
    markAuthenticated: boolean,
  ): Promise<string> => {
    if (!authUserId || Buffer.byteLength(authUserId, "utf8") > 512) {
      throw new AuthIdentityProvisioningError("invalid_auth_user_id");
    }
    const result = await transaction.execute<{ app_user_id: string }>(sql`
      select app_provision_auth_identity(
        ${authUserId},
        ${randomUUID()}::uuid,
        ${markAuthenticated}
      ) as app_user_id
    `);
    const appUserId = result.rows[0]?.app_user_id;
    if (!appUserId) throw new AuthIdentityProvisioningError("app_user_missing");
    return appUserId;
  };

  const registerRecipient = async (
    transaction: BuildyAuthTransaction,
    authUserId: string,
    appUserId: string,
    rawEmail: string,
  ): Promise<void> => {
    const email = rawEmail.normalize("NFKC").trim().toLowerCase();
    if (
      !email
      || Buffer.byteLength(email, "utf8") > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    ) {
      throw new AuthIdentityProvisioningError("invalid_auth_email");
    }
    const recipientCiphertext = keyring.encrypt(email, `email-recipient:${appUserId}:address`);
    const recipientHash = blindIndex.create("email-recipient", email);
    await transaction.execute(sql`
      select app_register_auth_email_recipient(
        ${authUserId},
        ${recipientCiphertext},
        ${recipientHash}
      )
    `);
  };

  return {
    async provisionForAuthUser(transaction, user) {
      const appUserId = await provision(transaction, user.id, false);
      await registerRecipient(transaction, user.id, appUserId, user.email);
    },
    async ensureForSession(transaction, authUserId) {
      if (!authUserId || Buffer.byteLength(authUserId, "utf8") > 512) {
        throw new AuthIdentityProvisioningError("invalid_auth_user_id");
      }
      const authUser = await transaction.execute<{ email: string }>(sql`
        select email from auth_users where id = ${authUserId} limit 1
      `);
      const email = authUser.rows[0]?.email;
      if (!email) throw new AuthIdentityProvisioningError("auth_user_missing");
      const appUserId = await provision(transaction, authUserId, false);
      await registerRecipient(transaction, authUserId, appUserId, email);
      await provision(transaction, authUserId, true);
    },
  };
}

const authSchema = {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
};

interface ProvisionedAdapterOptions<Transaction> {
  authorizer?: AuthNewUserAuthorizer<Transaction>;
  baseAdapter: DBAdapter;
  beginTransaction<R>(
    callback: (transaction: Transaction, baseAdapter: DBAdapter) => Promise<R>,
  ): Promise<R>;
  provisioner: AuthIdentityProvisioner<Transaction>;
  transaction?: Transaction;
}

function authUserFromResult(value: unknown): AuthIdentityUser {
  if (!value || typeof value !== "object") {
    throw new AuthIdentityProvisioningError("invalid_auth_user_result");
  }

  const candidate = value as Partial<AuthIdentityUser>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.email !== "string" ||
    typeof candidate.name !== "string"
  ) {
    throw new AuthIdentityProvisioningError("invalid_auth_user_result");
  }
  return { email: candidate.email, id: candidate.id, name: candidate.name };
}

function sessionUserId(data: Record<string, unknown>): string {
  const userId = data.userId;
  if (typeof userId !== "string" || !userId) {
    throw new AuthIdentityProvisioningError("invalid_session_user");
  }
  return userId;
}

function isUserModel(model: string): boolean {
  return model === "user" || model === "authUsers";
}

function isSessionModel(model: string): boolean {
  return model === "session" || model === "authSessions";
}

/**
 * Decorates Better Auth's adapter at its write boundary. Better Auth database
 * `after` hooks run after commit, so they cannot guarantee that an auth user
 * and its domain identity are created atomically.
 */
export function withAuthIdentityProvisioning<Transaction>(
  options: ProvisionedAdapterOptions<Transaction>,
): DBAdapter {
  const inAtomicTransaction = async <Result>(
    operation: (
      transaction: Transaction,
      baseAdapter: DBAdapter,
      transactionAdapter: DBAdapter,
    ) => Promise<Result>,
  ): Promise<Result> => {
    if (options.transaction !== undefined) {
      return operation(options.transaction, options.baseAdapter, adapter);
    }
    return options.beginTransaction(async (transaction, baseAdapter) => {
      const transactionAdapter = withAuthIdentityProvisioning({
        authorizer: options.authorizer,
        baseAdapter,
        beginTransaction: options.beginTransaction,
        provisioner: options.provisioner,
        transaction,
      });
      return operation(transaction, baseAdapter, transactionAdapter);
    });
  };

  const create = (async (request: Parameters<DBAdapter["create"]>[0]) => {
    if (!isUserModel(request.model) && !isSessionModel(request.model)) {
      return options.baseAdapter.create(request);
    }

    return inAtomicTransaction(async (transaction, baseAdapter) => {
      if (isUserModel(request.model)) {
        const createdUser = await baseAdapter.create(request);
        await options.provisioner.provisionForAuthUser(
          transaction,
          authUserFromResult(createdUser),
        );
        await options.authorizer?.authorizeNewUser(
          transaction,
          authUserFromResult(createdUser),
        );
        return createdUser;
      }

      await options.provisioner.ensureForSession(
        transaction,
        sessionUserId(request.data as Record<string, unknown>),
      );
      return baseAdapter.create(request);
    });
  }) as DBAdapter["create"];

  const adapter: DBAdapter = {
    ...options.baseAdapter,
    create,
    transaction: async <Result>(
      callback: (transaction: DBTransactionAdapter) => Promise<Result>,
    ) =>
      inAtomicTransaction((_, _baseAdapter, transactionAdapter) =>
        callback(transactionAdapter as DBTransactionAdapter),
      ),
  };

  return adapter;
}

export function createProvisionedDrizzleAuthAdapter(
  database: BuildyDatabase,
  provisioner: AuthIdentityProvisioner,
  authorizer?: AuthNewUserAuthorizer,
): (options: BetterAuthOptions) => DBAdapter {
  return (options) => {
    const createBaseAdapter = (connection: BuildyDatabase | BuildyAuthTransaction) =>
      drizzleAdapter(connection, {
        provider: "pg",
        schema: authSchema,
        transaction: false,
      })(options);

    return withAuthIdentityProvisioning({
      authorizer,
      baseAdapter: createBaseAdapter(database),
      beginTransaction: (callback) =>
        database.transaction(async (transaction) =>
          callback(transaction, createBaseAdapter(transaction)),
        ),
      provisioner,
    });
  };
}

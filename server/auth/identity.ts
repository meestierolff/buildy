import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { BuildyDatabase } from "../db/client.js";

export type BuildyAuthTransaction = Parameters<
  Parameters<BuildyDatabase["transaction"]>[0]
>[0];

export interface AuthIdentityUser {
  email: string | null;
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

export function createPostgresAuthIdentityProvisioner(): AuthIdentityProvisioner {
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

  return {
    async provisionForAuthUser(transaction, user) {
      await provision(transaction, user.id, false);
    },
    async ensureForSession(transaction, authUserId) {
      await provision(transaction, authUserId, true);
    },
  };
}

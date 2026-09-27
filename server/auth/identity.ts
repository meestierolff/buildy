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

export interface AuthIdentityProvisioner {
  provisionForAuthUser(transaction: BuildyAuthTransaction, user: AuthIdentityUser): Promise<void>;
  ensureForSession(transaction: BuildyAuthTransaction, authUserId: string): Promise<void>;
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

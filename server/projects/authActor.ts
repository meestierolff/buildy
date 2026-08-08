import { sql } from "drizzle-orm";
import type { AuthEngine } from "../auth/factory.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ActiveAppUserLookup, AuthenticatedSubjectResolver } from "./actor.js";
import { ProjectError } from "./errors.js";

const MAX_AUTH_USER_ID_BYTES = 512;

export class BetterAuthSubjectResolver implements AuthenticatedSubjectResolver {
  constructor(private readonly resolveEngine: () => AuthEngine) {}

  async resolveAuthUserId(request: Request): Promise<string | null> {
    try {
      return await this.resolveEngine().resolveAuthUserId(request);
    } catch (error) {
      throw new ProjectError("ACTOR_MAPPING_UNAVAILABLE", { cause: error });
    }
  }
}

export class PostgresActiveAppUserLookup implements ActiveAppUserLookup {
  constructor(private readonly database: BuildyDatabase) {}

  async findActiveAppUserId(authUserId: string): Promise<string | null> {
    if (
      !authUserId ||
      Buffer.byteLength(authUserId, "utf8") > MAX_AUTH_USER_ID_BYTES
    ) return null;

    const result = await this.database.execute<{ app_user_id: string | null }>(sql`
      select app_resolve_active_user(${authUserId}) as app_user_id
    `);
    return result.rows[0]?.app_user_id ?? null;
  }
}

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { ModerationAdminRole, ModerationAdminSession } from "../../shared/contracts/moderation.js";
import type { BuildyDatabase } from "../db/client.js";
import type { AuthenticatedSubjectResolver } from "../projects/actor.js";
import { ModerationAdminError } from "./adminErrors.js";

const MAX_AUTH_SUBJECT_BYTES = 512;

const moderationActorRowSchema = z.object({
  app_user_id: z.string().uuid(),
  role: z.enum(["moderator", "admin"]),
  grant_expires_at: z.coerce.date().nullable(),
});

export type ModerationAdminActor = {
  appUserId: string;
  role: ModerationAdminRole;
  grantExpiresAt: string | null;
};

export interface ModerationAdminActorLookup {
  findByAuthSubject(authSubject: string): Promise<ModerationAdminActor | null>;
}

export interface ModerationAdminActorResolver {
  resolve(request: Request): Promise<ModerationAdminActor>;
}

export class PostgresModerationAdminActorLookup implements ModerationAdminActorLookup {
  constructor(private readonly database: BuildyDatabase) {}

  async findByAuthSubject(authSubject: string): Promise<ModerationAdminActor | null> {
    if (!authSubject || Buffer.byteLength(authSubject, "utf8") > MAX_AUTH_SUBJECT_BYTES) return null;
    const result = await this.database.execute(sql`
      select * from app_resolve_moderation_actor(${authSubject})
    `);
    if (!result.rows[0]) return null;
    const row = moderationActorRowSchema.parse(result.rows[0]);
    return {
      appUserId: row.app_user_id,
      role: row.role,
      grantExpiresAt: row.grant_expires_at?.toISOString() ?? null,
    };
  }
}

export class StrictModerationAdminActorResolver implements ModerationAdminActorResolver {
  constructor(
    private readonly subjects: AuthenticatedSubjectResolver,
    private readonly actors: ModerationAdminActorLookup,
  ) {}

  async resolve(request: Request): Promise<ModerationAdminActor> {
    let authSubject: string | null;
    try {
      authSubject = await this.subjects.resolveAuthUserId(request);
    } catch (error) {
      throw new ModerationAdminError("AUTH_UNAVAILABLE", { cause: error });
    }
    if (!authSubject) throw new ModerationAdminError("UNAUTHENTICATED");

    try {
      const actor = await this.actors.findByAuthSubject(authSubject);
      if (!actor) throw new ModerationAdminError("FORBIDDEN");
      return actor;
    } catch (error) {
      if (error instanceof ModerationAdminError) throw error;
      throw new ModerationAdminError("AUTH_UNAVAILABLE", { cause: error });
    }
  }
}

export function moderationAdminSession(actor: ModerationAdminActor): ModerationAdminSession {
  return {
    appUserId: actor.appUserId,
    role: actor.role,
    grantExpiresAt: actor.grantExpiresAt,
  };
}

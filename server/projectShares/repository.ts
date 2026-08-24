import { sql } from "drizzle-orm";

import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import { ProjectShareError } from "./errors.js";
import type {
  IssueShareLinkCommand,
  ProjectShareRepository,
  RevokeShareLinkCommand,
  StoredProjectShareLink,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

type LinkRow = {
  id: string;
  project_id: string;
  expires_at: Date | string;
  created_at: Date | string;
  revoked_at: Date | string | null;
  version: number | string;
  replayed?: boolean;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapLink(row: LinkRow): StoredProjectShareLink {
  return {
    id: row.id,
    projectId: row.project_id,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
    version: Number(row.version),
  };
}

function databaseDetails(error: unknown): { code?: string; message?: string } {
  if (!error || typeof error !== "object") return {};
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : undefined;
  if (code) return { code, message };
  return "cause" in error ? databaseDetails(error.cause) : { message };
}

function translate(error: unknown): never {
  if (error instanceof ProjectShareError) throw error;
  const details = databaseDetails(error);
  if (details.message?.includes("project share idempotency conflict") || details.code === "23505") {
    throw new ProjectShareError("IDEMPOTENCY_CONFLICT", { cause: error });
  }
  if (details.message?.includes("project share version conflict") || details.code === "40001") {
    throw new ProjectShareError("VERSION_CONFLICT", { cause: error });
  }
  if (details.message?.includes("project share already exists")) {
    throw new ProjectShareError("LINK_ALREADY_EXISTS", { cause: error });
  }
  if (details.message?.includes("project share link missing")) {
    throw new ProjectShareError("LINK_NOT_FOUND", { cause: error });
  }
  if (details.message?.includes("project is not unlisted")) {
    throw new ProjectShareError("PROJECT_NOT_UNLISTED", { cause: error });
  }
  if (details.code === "42501" || details.message?.includes("project share owner unavailable")) {
    throw new ProjectShareError("PROJECT_NOT_FOUND", { cause: error });
  }
  throw error;
}

async function setContext(transaction: DatabaseTransaction, actor: ProjectActor): Promise<void> {
  const actorId = actor.kind === "authenticated" ? actor.appUserId : null;
  await transaction.execute(sql`select
    set_config('app.actor_id', ${actorId ?? ""}, true),
    set_config('app.share_link_id', ${actor.shareLinkId ?? ""}, true)
  `);
}

export class PostgresProjectShareRepository implements ProjectShareRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async getOwnerLink(actorId: string, projectId: string): Promise<StoredProjectShareLink | null> {
    return this.database.transaction(async (transaction) => {
      await setContext(transaction, { kind: "authenticated", appUserId: actorId });
      const projectResult = await transaction.execute<{ visibility: string }>(sql`
        select project.visibility::text
        from projects project
        where project.id = ${projectId}::uuid
          and project.owner_id = ${actorId}::uuid
          and project.lifecycle_status = 'active'
        limit 1
      `);
      if (!projectResult.rows[0]) throw new ProjectShareError("PROJECT_NOT_FOUND");
      if (projectResult.rows[0].visibility !== "unlisted") {
        throw new ProjectShareError("PROJECT_NOT_UNLISTED");
      }
      const result = await transaction.execute<LinkRow>(sql`
        select link.id, link.project_id, link.expires_at, link.created_at, link.revoked_at, link.version
        from project_share_links link
        where link.project_id = ${projectId}::uuid
          and link.owner_id = ${actorId}::uuid
          and link.revoked_at is null
        order by link.created_at desc, link.id desc
        limit 1
      `);
      return result.rows[0] ? mapLink(result.rows[0]) : null;
    });
  }

  async issue(command: IssueShareLinkCommand): Promise<{ link: StoredProjectShareLink; replayed: boolean }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setContext(transaction, { kind: "authenticated", appUserId: command.actorId });
        const result = await transaction.execute<LinkRow>(sql`
          select * from public.app_issue_project_share_link(
            ${command.projectId}::uuid,
            ${command.linkId}::uuid,
            ${command.operation},
            ${command.expiresAt},
            ${command.expectedVersion},
            ${command.tokenHash},
            ${command.idempotencyHash},
            ${command.requestHash},
            ${command.requestId}
          )
        `);
        const row = result.rows[0];
        if (!row) throw new ProjectShareError("PROJECT_NOT_FOUND");
        return { link: mapLink(row), replayed: row.replayed === true };
      });
    } catch (error) {
      translate(error);
    }
  }

  async revoke(command: RevokeShareLinkCommand): Promise<{
    projectId: string;
    linkId: string;
    version: number;
    replayed: boolean;
  }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setContext(transaction, { kind: "authenticated", appUserId: command.actorId });
        const result = await transaction.execute<{
          project_id: string;
          link_id: string;
          version: number | string;
          replayed: boolean;
        }>(sql`
          select * from public.app_revoke_project_share_link(
            ${command.projectId}::uuid,
            ${command.expectedVersion},
            ${command.idempotencyHash},
            ${command.requestHash},
            ${command.requestId}
          )
        `);
        const row = result.rows[0];
        if (!row) throw new ProjectShareError("LINK_NOT_FOUND");
        return {
          projectId: row.project_id,
          linkId: row.link_id,
          version: Number(row.version),
          replayed: row.replayed,
        };
      });
    } catch (error) {
      translate(error);
    }
  }

  async redeem(viewer: ProjectActor, tokenHash: string): Promise<{
    status: "active" | "expired" | "unavailable";
    linkId: string | null;
    projectId: string | null;
    expiresAt: string | null;
  }> {
    return this.database.transaction(async (transaction) => {
      await setContext(transaction, { ...viewer, shareLinkId: undefined });
      const result = await transaction.execute<{
        status: "active" | "expired" | "unavailable";
        link_id: string | null;
        project_id: string | null;
        expires_at: Date | string | null;
      }>(sql`select * from public.app_redeem_project_share_link(${tokenHash})`);
      const row = result.rows[0];
      return row
        ? {
            status: row.status,
            linkId: row.link_id,
            projectId: row.project_id,
            expiresAt: row.expires_at === null ? null : iso(row.expires_at),
          }
        : { status: "unavailable", linkId: null, projectId: null, expiresAt: null };
    });
  }
}

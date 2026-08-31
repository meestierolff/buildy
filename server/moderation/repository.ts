import { sql } from "drizzle-orm";
import { z } from "zod";
import type {
  FeedbackSubmissionReceipt,
  ModerationReportReceipt,
  ModerationTargetType,
} from "../../shared/contracts/moderation.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ProjectActor } from "../projects/actor.js";
import { ModerationError } from "./errors.js";
import type {
  CreateFeedbackSubmissionCommand,
  CreateModerationReportCommand,
  ModerationRepository,
  VisibleModerationTarget,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const moderationReceiptRowSchema = z.object({
  id: z.string().uuid(),
  receipt_code: z.string(),
  status: z.literal("received"),
  submitted_at: z.coerce.date(),
  replayed: z.boolean(),
});

const feedbackReceiptRowSchema = moderationReceiptRowSchema.extend({
  kind: z.enum(["feedback", "support", "third_party_request", "appeal"]),
});

function actorId(actor: ProjectActor): string | null {
  return actor.kind === "authenticated" ? actor.appUserId : null;
}

async function setActor(transaction: DatabaseTransaction, actor: ProjectActor): Promise<void> {
  await transaction.execute(sql`select
    set_config('app.actor_id', ${actorId(actor) ?? ""}, true),
    set_config('app.share_link_id', ${actor.shareLinkId ?? ""}, true)
  `);
}

function mapModerationReceipt(row: unknown): ModerationReportReceipt {
  const parsed = moderationReceiptRowSchema.parse(row);
  return {
    id: parsed.id,
    receiptCode: parsed.receipt_code,
    status: parsed.status,
    submittedAt: parsed.submitted_at.toISOString(),
    replayed: parsed.replayed,
  };
}

function mapFeedbackReceipt(row: unknown): FeedbackSubmissionReceipt {
  const parsed = feedbackReceiptRowSchema.parse(row);
  return {
    id: parsed.id,
    receiptCode: parsed.receipt_code,
    kind: parsed.kind,
    status: parsed.status,
    submittedAt: parsed.submitted_at.toISOString(),
    replayed: parsed.replayed,
  };
}

function databaseDetails(error: unknown): { code?: string; message?: string } {
  if (!error || typeof error !== "object") return {};
  const direct = {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    message: "message" in error && typeof error.message === "string" ? error.message : undefined,
  };
  if (direct.code) return direct;
  return "cause" in error ? databaseDetails(error.cause) : direct;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof ModerationError) throw error;
  const details = databaseDetails(error);
  if (details.code === "23505" || details.message?.includes("idempotency")) {
    throw new ModerationError("IDEMPOTENCY_CONFLICT", undefined, { cause: error });
  }
  if (details.code === "42501") {
    throw new ModerationError("CONTENT_NOT_FOUND", undefined, { cause: error });
  }
  if (["22023", "23503", "23514", "55000"].includes(details.code ?? "")) {
    throw new ModerationError("INVALID_STATE", undefined, { cause: error });
  }
  throw error;
}

type TargetRow = Record<string, unknown> & {
  id: string;
  owner_id: string;
  project_id: string | null;
};

function targetResult(
  targetType: ModerationTargetType,
  row: TargetRow | undefined,
  omittedKeys: readonly string[],
): VisibleModerationTarget | null {
  if (!row) return null;
  const snapshot = Object.fromEntries(
    Object.entries(row).filter(([key]) => !omittedKeys.includes(key)),
  );
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    targetType,
    snapshot,
  };
}

export class PostgresModerationRepository implements ModerationRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async findModerationReportReplay(input: {
    actor: ProjectActor;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ModerationReportReceipt | null> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, input.actor);
        const result = await transaction.execute(sql`
          select * from app_replay_moderation_report(
            ${input.idempotencyKey},
            ${input.requestHash}
          )
        `);
        return result.rows[0] ? mapModerationReceipt(result.rows[0]) : null;
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async findFeedbackSubmissionReplay(input: {
    actor: ProjectActor;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<FeedbackSubmissionReceipt | null> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, input.actor);
        const result = await transaction.execute(sql`
          select * from app_replay_feedback_submission(
            ${input.idempotencyKey},
            ${input.requestHash}
          )
        `);
        return result.rows[0] ? mapFeedbackReceipt(result.rows[0]) : null;
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async findVisibleTarget(
    actor: ProjectActor,
    targetType: ModerationTargetType,
    targetId: string,
  ): Promise<VisibleModerationTarget | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actor);
      let result;
      switch (targetType) {
        case "profile":
          result = await transaction.execute<TargetRow>(sql`
            select
              profile.user_id as id,
              profile.user_id as owner_id,
              null::uuid as project_id,
              profile.display_name,
              profile.slug,
              profile.bio,
              profile.location,
              profile.is_private
            from profiles profile
            where profile.user_id = ${targetId}::uuid
              and app_can_view_profile(profile.user_id)
            limit 1
          `);
          break;
        case "project":
          result = await transaction.execute<TargetRow>(sql`
            select
              project.id,
              project.owner_id,
              project.id as project_id,
              project.title,
              project.description,
              project.project_type,
              project.visibility::text,
              project.lifecycle_status::text
            from projects project
            where project.id = ${targetId}::uuid
              and project.lifecycle_status = 'active'
              and app_can_view_project(project.id)
            limit 1
          `);
          break;
        case "update":
          result = await transaction.execute<TargetRow>(sql`
            select
              item.id,
              item.project_owner_id as owner_id,
              item.project_id,
              item.title,
              item.room,
              item.description,
              item.update_date::text,
              item.status::text
            from updates item
            where item.id = ${targetId}::uuid
              and app_can_view_update(item.id, item.project_id)
            limit 1
          `);
          break;
        case "media":
          result = await transaction.execute<TargetRow>(sql`
            select
              asset.id,
              asset.owner_id,
              asset.project_id,
              asset.detected_content_type,
              asset.sha256,
              attachment.caption,
              attachment.update_id
            from media_assets asset
            left join update_media attachment on attachment.media_asset_id = asset.id
            where asset.id = ${targetId}::uuid
              and asset.project_id is not null
              and asset.status = 'ready'
              and asset.deleted_at is null
              and app_can_view_project(asset.project_id)
            limit 1
          `);
          break;
        case "comment":
          result = await transaction.execute<TargetRow>(sql`
            select
              comment.id,
              comment.author_id as owner_id,
              comment.project_id,
              comment.update_id,
              comment.body,
              comment.status::text,
              comment.created_at
            from comments comment
            where comment.id = ${targetId}::uuid
              and comment.status <> 'deleted'
            limit 1
          `);
          break;
      }
      return targetResult(
        targetType,
        result.rows[0] as TargetRow | undefined,
        ["id", "owner_id", "project_id"],
      );
    });
  }

  async createModerationReport(
    command: CreateModerationReportCommand,
  ): Promise<ModerationReportReceipt> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor);
        const result = await transaction.execute(sql`
          select * from app_submit_moderation_report(
            ${command.id}::uuid,
            ${command.idempotencyKey},
            ${command.requestHash},
            ${command.targetType},
            ${command.targetId}::uuid,
            ${command.reason},
            ${command.detailsCiphertext},
            ${command.contactCiphertext},
            ${command.contactHash},
            ${command.sourceFingerprintHash},
            ${command.targetSnapshotCiphertext},
            ${command.policyVersion},
            ${command.route},
            ${command.receiptCode},
            ${command.ipHash},
            ${command.userAgentHash}
          )
        `);
        if (!result.rows[0]) throw new ModerationError("INVALID_STATE");
        return mapModerationReceipt(result.rows[0]);
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async createFeedbackSubmission(
    command: CreateFeedbackSubmissionCommand,
  ): Promise<FeedbackSubmissionReceipt> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor);
        const result = await transaction.execute(sql`
          select * from app_submit_feedback_submission(
            ${command.id}::uuid,
            ${command.idempotencyKey},
            ${command.requestHash},
            ${command.kind},
            ${command.category},
            ${command.messageCiphertext},
            ${command.contactCiphertext},
            ${command.contactHash},
            ${command.sourceFingerprintHash},
            ${command.route},
            ${command.userAgentFamily},
            ${command.privacyNoticeVersion},
            ${command.receiptCode},
            ${command.ipHash},
            ${command.userAgentHash}
          )
        `);
        if (!result.rows[0]) throw new ModerationError("INVALID_STATE");
        return mapFeedbackReceipt(result.rows[0]);
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

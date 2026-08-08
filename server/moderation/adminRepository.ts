import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  moderationAdminActionKindSchema,
  moderationAdminRoleSchema,
  moderationReasonSchema,
  moderationReportStatusSchema,
  moderationTargetTypeSchema,
  moderationUrgencySchema,
  type ModerationAdminActionResult,
  type ModerationAdminQueueItem,
} from "../../shared/contracts/moderation.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ModerationAdminActor } from "./adminActor.js";
import { ModerationAdminError } from "./adminErrors.js";
import type {
  EncryptedModerationAdminAction,
  EncryptedModerationAdminReportDetail,
  ModerationAdminActionCommand,
  ModerationAdminQueueCommand,
  ModerationAdminRepository,
} from "./adminTypes.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const queueRowSchema = z.object({
  id: z.string().uuid(),
  receipt_code: z.string(),
  target_type: moderationTargetTypeSchema,
  target_id: z.string().uuid(),
  reason: moderationReasonSchema,
  urgency: moderationUrgencySchema,
  status: moderationReportStatusSchema,
  version: z.coerce.number().int().positive(),
  target_hidden: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const detailRowSchema = queueRowSchema.extend({
  details_ciphertext: z.string().nullable(),
  legacy_details: z.string().nullable(),
  target_snapshot_ciphertext: z.string(),
});

const actionRowSchema = z.object({
  id: z.string().uuid(),
  kind: moderationAdminActionKindSchema,
  actor_id: z.string().uuid(),
  actor_role: moderationAdminRoleSchema,
  reason_ciphertext: z.string(),
  reverses_action_id: z.string().uuid().nullable(),
  reversed_by_action_id: z.string().uuid().nullable(),
  report_version: z.coerce.number().int().positive(),
  created_at: z.coerce.date(),
});

const actionResultRowSchema = z.object({
  action_id: z.string().uuid(),
  report_id: z.string().uuid(),
  report_status: moderationReportStatusSchema,
  report_version: z.coerce.number().int().positive(),
  replayed: z.boolean(),
});

async function setActor(transaction: DatabaseTransaction, actor: ModerationAdminActor): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actor.appUserId}, true)`);
}

function queueItem(rowValue: unknown): ModerationAdminQueueItem {
  const row = queueRowSchema.parse(rowValue);
  return {
    id: row.id,
    receiptCode: row.receipt_code,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    urgency: row.urgency,
    status: row.status,
    version: row.version,
    targetHidden: row.target_hidden,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function encryptedAction(rowValue: unknown): EncryptedModerationAdminAction {
  const row = actionRowSchema.parse(rowValue);
  return {
    id: row.id,
    kind: row.kind,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    reasonCiphertext: row.reason_ciphertext,
    reversesActionId: row.reverses_action_id,
    reversedByActionId: row.reversed_by_action_id,
    reportVersion: row.report_version,
    createdAt: row.created_at.toISOString(),
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
  if (error instanceof ModerationAdminError) throw error;
  const details = databaseDetails(error);
  if (details.code === "42501") throw new ModerationAdminError("FORBIDDEN", { cause: error });
  if (details.code === "P0002") throw new ModerationAdminError("REPORT_NOT_FOUND", { cause: error });
  if (details.code === "40001" || details.message?.includes("moderation version conflict")) {
    throw new ModerationAdminError("VERSION_CONFLICT", { cause: error });
  }
  if (details.code === "23505" || details.message?.includes("moderation action idempotency")) {
    throw new ModerationAdminError("IDEMPOTENCY_CONFLICT", { cause: error });
  }
  if (["22023", "23503", "23514", "55000"].includes(details.code ?? "")) {
    throw new ModerationAdminError("INVALID_ACTION", { cause: error });
  }
  throw error;
}

export class PostgresModerationAdminRepository implements ModerationAdminRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async listQueue(command: ModerationAdminQueueCommand): Promise<{
    items: ModerationAdminQueueItem[];
    hasMore: boolean;
  }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor);
        const result = await transaction.execute(sql`
          select * from app_admin_list_moderation_reports(
            ${command.query.status},
            ${command.query.urgency ?? null},
            ${command.query.targetType ?? null},
            ${command.cursor?.timestamp ?? null}::timestamptz,
            ${command.cursor?.id ?? null}::uuid,
            ${command.query.limit + 1}
          )
        `);
        const rows = result.rows.map(queueItem);
        return {
          items: rows.slice(0, command.query.limit),
          hasMore: rows.length > command.query.limit,
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async loadReport(
    actor: ModerationAdminActor,
    reportId: string,
  ): Promise<EncryptedModerationAdminReportDetail | null> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, actor);
        const reportResult = await transaction.execute(sql`
          select * from app_admin_load_moderation_report(${reportId}::uuid)
        `);
        if (!reportResult.rows[0]) return null;
        const actionsResult = await transaction.execute(sql`
          select * from app_admin_list_moderation_actions(${reportId}::uuid)
        `);
        const row = detailRowSchema.parse(reportResult.rows[0]);
        return {
          ...queueItem(row),
          detailsCiphertext: row.details_ciphertext,
          legacyDetails: row.legacy_details,
          targetSnapshotCiphertext: row.target_snapshot_ciphertext,
          actions: actionsResult.rows.map(encryptedAction),
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async applyAction(command: ModerationAdminActionCommand): Promise<ModerationAdminActionResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor);
        const result = await transaction.execute(sql`
          select * from app_admin_apply_moderation_action(
            ${command.reportId}::uuid,
            ${command.actionId}::uuid,
            ${command.kind},
            ${command.reasonCiphertext},
            ${command.idempotencyKey},
            ${command.requestHash},
            ${command.expectedReportVersion},
            ${command.reverseActionId}::uuid,
            ${command.requestId}
          )
        `);
        const row = actionResultRowSchema.parse(result.rows[0]);
        return {
          actionId: row.action_id,
          reportId: row.report_id,
          reportStatus: row.report_status,
          reportVersion: row.report_version,
          replayed: row.replayed,
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

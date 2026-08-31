import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  feedbackAdminKindSchema,
  feedbackAdminStatusSchema,
  type FeedbackAdminQueueItem,
  type FeedbackAdminStatusResult,
} from "../../shared/contracts/feedbackAdmin.js";
import { moderationAdminRoleSchema } from "../../shared/contracts/moderation.js";
import type { BuildyDatabase } from "../db/client.js";
import type { ModerationAdminActor } from "../moderation/adminActor.js";
import { ModerationAdminError } from "../moderation/adminErrors.js";
import { FeedbackAdminError } from "./errors.js";
import type {
  EncryptedFeedbackAdminDetail,
  FeedbackAdminQueueCommand,
  FeedbackAdminRepository,
  FeedbackAdminStatusCommand,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const queueRowSchema = z.object({
  id: z.string().uuid(),
  receipt_code: z.string().regex(/^HELP-[A-Z0-9]{8}$/),
  kind: feedbackAdminKindSchema,
  category: z.string().trim().min(1).max(80),
  status: feedbackAdminStatusSchema,
  version: z.coerce.number().int().positive(),
  has_contact: z.boolean(),
  authenticated: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const detailRowSchema = queueRowSchema.extend({
  message_ciphertext: z.string().nullable(),
  legacy_message: z.string().nullable(),
  contact_ciphertext: z.string().nullable(),
  resolved_at: z.coerce.date().nullable(),
});

const reviewRowSchema = z.object({
  id: z.string().uuid(),
  actor_id: z.string().uuid(),
  actor_role: moderationAdminRoleSchema,
  from_status: feedbackAdminStatusSchema,
  to_status: feedbackAdminStatusSchema,
  submission_version: z.coerce.number().int().positive(),
  created_at: z.coerce.date(),
});

const statusResultRowSchema = z.object({
  review_id: z.string().uuid(),
  submission_id: z.string().uuid(),
  status: feedbackAdminStatusSchema,
  version: z.coerce.number().int().positive(),
  replayed: z.boolean(),
});

async function setActor(transaction: DatabaseTransaction, actor: ModerationAdminActor): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actor.appUserId}, true)`);
}

function queueItem(rowValue: unknown): FeedbackAdminQueueItem {
  const row = queueRowSchema.parse(rowValue);
  return {
    id: row.id,
    receiptCode: row.receipt_code,
    kind: row.kind,
    category: row.category,
    status: row.status,
    version: row.version,
    hasContact: row.has_contact,
    authenticated: row.authenticated,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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
  if (error instanceof FeedbackAdminError) throw error;
  const details = databaseDetails(error);
  if (details.code === "P0002") throw new FeedbackAdminError("SUBMISSION_NOT_FOUND", { cause: error });
  if (details.code === "42501") throw new ModerationAdminError("FORBIDDEN", { cause: error });
  if (details.code === "40001" || details.message?.includes("feedback version conflict")) {
    throw new FeedbackAdminError("VERSION_CONFLICT", { cause: error });
  }
  if (details.code === "23505" || details.message?.includes("feedback review idempotency")) {
    throw new FeedbackAdminError("IDEMPOTENCY_CONFLICT", { cause: error });
  }
  if (["22023", "23503", "23514", "55000"].includes(details.code ?? "")) {
    throw new FeedbackAdminError("INVALID_TRANSITION", { cause: error });
  }
  throw error;
}

export class PostgresFeedbackAdminRepository implements FeedbackAdminRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async listQueue(command: FeedbackAdminQueueCommand): Promise<{
    items: FeedbackAdminQueueItem[];
    hasMore: boolean;
  }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor);
        const result = await transaction.execute(sql`
          select * from app_admin_list_feedback_submissions(
            ${command.query.status},
            ${command.query.kind ?? null},
            ${command.cursor?.timestamp ?? null}::timestamptz,
            ${command.cursor?.id ?? null}::uuid,
            ${command.query.limit + 1}
          )
        `);
        const rows = result.rows.map(queueItem);
        return { items: rows.slice(0, command.query.limit), hasMore: rows.length > command.query.limit };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async loadSubmission(
    actor: ModerationAdminActor,
    submissionId: string,
  ): Promise<EncryptedFeedbackAdminDetail | null> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, actor);
        const detailResult = await transaction.execute(sql`
          select * from app_admin_load_feedback_submission(${submissionId}::uuid)
        `);
        if (!detailResult.rows[0]) return null;
        const reviewResult = await transaction.execute(sql`
          select * from app_admin_list_feedback_reviews(${submissionId}::uuid)
        `);
        const row = detailRowSchema.parse(detailResult.rows[0]);
        return {
          ...queueItem(row),
          messageCiphertext: row.message_ciphertext,
          legacyMessage: row.legacy_message,
          contactCiphertext: row.contact_ciphertext,
          resolvedAt: row.resolved_at?.toISOString() ?? null,
          reviews: reviewResult.rows.map((value) => {
            const review = reviewRowSchema.parse(value);
            return {
              id: review.id,
              actorId: review.actor_id,
              actorRole: review.actor_role,
              fromStatus: review.from_status,
              toStatus: review.to_status,
              submissionVersion: review.submission_version,
              createdAt: review.created_at.toISOString(),
            };
          }),
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async updateStatus(command: FeedbackAdminStatusCommand): Promise<FeedbackAdminStatusResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor);
        const result = await transaction.execute(sql`
          select * from app_admin_update_feedback_status(
            ${command.submissionId}::uuid,
            ${command.reviewId}::uuid,
            ${command.status},
            ${command.expectedVersion},
            ${command.idempotencyKey},
            ${command.requestHash},
            ${command.requestId}
          )
        `);
        const row = statusResultRowSchema.parse(result.rows[0]);
        return {
          reviewId: row.review_id,
          submissionId: row.submission_id,
          status: row.status,
          version: row.version,
          replayed: row.replayed,
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

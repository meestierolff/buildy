import {
  feedbackAdminQueueQuerySchema,
  feedbackAdminStatusInputSchema,
  type FeedbackAdminDetail,
  type FeedbackAdminQueuePage,
  type FeedbackAdminSession,
  type FeedbackAdminStatusResult,
} from "../../shared/contracts/feedbackAdmin.js";
import { canonicalJson } from "../security/canonicalJson.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import type { ModerationAdminActor } from "../moderation/adminActor.js";
import { ModerationAdminError } from "../moderation/adminErrors.js";
import { decodeFeedbackAdminCursor, encodeFeedbackAdminCursor } from "./cursor.js";
import { FeedbackAdminError } from "./errors.js";
import type { FeedbackAdminRepository } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function submissionId(value: string): string {
  if (!UUID.test(value)) throw new FeedbackAdminError("SUBMISSION_NOT_FOUND");
  return value.toLowerCase();
}

function assertAdmin(actor: ModerationAdminActor): void {
  if (actor.role !== "admin") throw new ModerationAdminError("FORBIDDEN");
}

export class FeedbackAdminService {
  constructor(
    private readonly repository: FeedbackAdminRepository,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
  ) {}

  session(actor: ModerationAdminActor): FeedbackAdminSession {
    assertAdmin(actor);
    return {
      appUserId: actor.appUserId,
      role: "admin",
      grantExpiresAt: actor.grantExpiresAt,
    };
  }

  async queue(actor: ModerationAdminActor, rawQuery: unknown): Promise<FeedbackAdminQueuePage> {
    assertAdmin(actor);
    const query = feedbackAdminQueueQuerySchema.parse(rawQuery);
    let cursor = null;
    if (query.cursor) {
      try {
        cursor = decodeFeedbackAdminCursor(query.cursor, query);
      } catch (error) {
        throw new FeedbackAdminError("INVALID_CURSOR", { cause: error });
      }
    }
    const page = await this.repository.listQueue({ actor, query, cursor });
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor: page.hasMore && last
        ? encodeFeedbackAdminCursor({
            kind: "feedback-admin-queue",
            version: 1,
            status: query.status,
            submissionKind: query.kind ?? null,
            timestamp: last.createdAt,
            id: last.id,
          })
        : null,
    };
  }

  async detail(actor: ModerationAdminActor, rawSubmissionId: string): Promise<FeedbackAdminDetail> {
    assertAdmin(actor);
    const selectedSubmissionId = submissionId(rawSubmissionId);
    const submission = await this.repository.loadSubmission(actor, selectedSubmissionId);
    if (!submission) throw new FeedbackAdminError("SUBMISSION_NOT_FOUND");
    const message = submission.messageCiphertext
      ? this.keyring.decrypt(
          submission.messageCiphertext,
          `feedback-submission:${submission.id}:message`,
        )
      : submission.legacyMessage;
    if (!message) throw new FeedbackAdminError("SUBMISSION_NOT_FOUND");
    const contactEmail = submission.contactCiphertext
      ? this.keyring.decrypt(
          submission.contactCiphertext,
          `feedback-submission:${submission.id}:contact`,
        )
      : null;
    return {
      id: submission.id,
      receiptCode: submission.receiptCode,
      kind: submission.kind,
      category: submission.category,
      status: submission.status,
      version: submission.version,
      hasContact: submission.hasContact,
      authenticated: submission.authenticated,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      resolvedAt: submission.resolvedAt,
      reviews: submission.reviews,
      message,
      contactEmail,
    };
  }

  async updateStatus(
    actor: ModerationAdminActor,
    rawSubmissionId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<FeedbackAdminStatusResult> {
    assertAdmin(actor);
    const selectedSubmissionId = submissionId(rawSubmissionId);
    const input = feedbackAdminStatusInputSchema.parse(rawInput);
    const idempotencyHash = this.blindIndex.create(
      "feedback-admin-idempotency",
      `${actor.appUserId}\0${input.idempotencyKey}`,
    );
    const requestHash = this.blindIndex.create("feedback-admin-request", canonicalJson({
      submissionId: selectedSubmissionId,
      expectedVersion: input.expectedVersion,
      status: input.status,
    }));
    return this.repository.updateStatus({
      actor,
      reviewId: crypto.randomUUID(),
      submissionId: selectedSubmissionId,
      status: input.status,
      expectedVersion: input.expectedVersion,
      idempotencyKey: `feedback-admin-command:v1:${idempotencyHash}`,
      requestHash,
      requestId,
    });
  }
}

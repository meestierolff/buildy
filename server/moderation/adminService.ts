import {
  moderationAdminActionInputSchema,
  moderationAdminQueueQuerySchema,
  type ModerationAdminActionResult,
  type ModerationAdminQueuePage,
  type ModerationAdminReportDetail,
  type ModerationAdminSession,
} from "../../shared/contracts/moderation.js";
import { canonicalJson } from "../security/canonicalJson.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import type { ModerationAdminActor } from "./adminActor.js";
import { moderationAdminSession } from "./adminActor.js";
import {
  decodeModerationAdminCursor,
  encodeModerationAdminCursor,
} from "./adminCursor.js";
import { ModerationAdminError } from "./adminErrors.js";
import type { ModerationAdminRepository } from "./adminTypes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reportId(value: string): string {
  if (!UUID.test(value)) throw new ModerationAdminError("REPORT_NOT_FOUND");
  return value.toLowerCase();
}

function targetSnapshot(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ModerationAdminError("INVALID_ACTION", { cause: error });
  }
}

export class ModerationAdminService {
  constructor(
    private readonly repository: ModerationAdminRepository,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
  ) {}

  session(actor: ModerationAdminActor): ModerationAdminSession {
    return moderationAdminSession(actor);
  }

  async queue(actor: ModerationAdminActor, rawQuery: unknown): Promise<ModerationAdminQueuePage> {
    const query = moderationAdminQueueQuerySchema.parse(rawQuery);
    let cursor = null;
    if (query.cursor) {
      try {
        cursor = decodeModerationAdminCursor(query.cursor, query);
      } catch (error) {
        throw new ModerationAdminError("INVALID_CURSOR", { cause: error });
      }
    }
    const page = await this.repository.listQueue({ actor, query, cursor });
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor: page.hasMore && last
        ? encodeModerationAdminCursor({
            kind: "moderation-admin-queue",
            version: 1,
            status: query.status,
            urgency: query.urgency ?? null,
            targetType: query.targetType ?? null,
            timestamp: last.createdAt,
            id: last.id,
          })
        : null,
    };
  }

  async report(
    actor: ModerationAdminActor,
    rawReportId: string,
  ): Promise<ModerationAdminReportDetail> {
    const selectedReportId = reportId(rawReportId);
    const report = await this.repository.loadReport(actor, selectedReportId);
    if (!report) throw new ModerationAdminError("REPORT_NOT_FOUND");

    const details = report.detailsCiphertext
      ? this.keyring.decrypt(report.detailsCiphertext, `moderation-report:${report.id}:details`)
      : report.legacyDetails;
    const snapshot = this.keyring.decrypt(
      report.targetSnapshotCiphertext,
      `moderation-report:${report.id}:target-snapshot`,
    );
    return {
      id: report.id,
      receiptCode: report.receiptCode,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      urgency: report.urgency,
      status: report.status,
      version: report.version,
      targetHidden: report.targetHidden,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      details,
      targetSnapshot: targetSnapshot(snapshot),
      actions: report.actions.map((action) => ({
        id: action.id,
        kind: action.kind,
        actorId: action.actorId,
        actorRole: action.actorRole,
        reason: this.keyring.decrypt(
          action.reasonCiphertext,
          `moderation-action:${action.id}:reason`,
        ),
        reversesActionId: action.reversesActionId,
        reversedByActionId: action.reversedByActionId,
        reportVersion: action.reportVersion,
        createdAt: action.createdAt,
      })),
    };
  }

  async action(
    actor: ModerationAdminActor,
    rawReportId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<ModerationAdminActionResult> {
    const selectedReportId = reportId(rawReportId);
    const input = moderationAdminActionInputSchema.parse(rawInput);
    if ((input.kind === "suspend" || input.kind === "block") && actor.role !== "admin") {
      throw new ModerationAdminError("FORBIDDEN");
    }

    const actionId = crypto.randomUUID();
    const idempotencyHash = this.blindIndex.create(
      "moderation-admin-idempotency",
      `${actor.appUserId}\0${input.idempotencyKey}`,
    );
    const idempotencyKey = `moderation-admin-command:v1:${idempotencyHash}`;
    const requestHash = this.blindIndex.create("moderation-admin-request", canonicalJson({
      reportId: selectedReportId,
      expectedReportVersion: input.expectedReportVersion,
      kind: input.kind,
      reason: input.reason,
      reverseActionId: input.reverseActionId ?? null,
    }));
    const reasonCiphertext = this.keyring.encrypt(
      input.reason,
      `moderation-action:${actionId}:reason`,
    );
    return this.repository.applyAction({
      actor,
      actionId,
      reportId: selectedReportId,
      kind: input.kind,
      reasonCiphertext,
      idempotencyKey,
      requestHash,
      expectedReportVersion: input.expectedReportVersion,
      reverseActionId: input.reverseActionId ?? null,
      requestId,
    });
  }
}

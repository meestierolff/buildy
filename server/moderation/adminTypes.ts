import type {
  ModerationAdminActionInput,
  ModerationAdminActionResult,
  ModerationAdminQueueItem,
  ModerationAdminQueuePage,
  ModerationAdminQueueQuery,
  ModerationAdminReportDetail,
  ModerationAdminSession,
} from "../../shared/contracts/moderation.js";
import type { ModerationAdminActor } from "./adminActor.js";
import type { ModerationAdminCursor } from "./adminCursor.js";

export type ModerationAdminQueueCommand = {
  actor: ModerationAdminActor;
  cursor: ModerationAdminCursor | null;
  query: ModerationAdminQueueQuery;
};

export type ModerationAdminActionCommand = {
  actor: ModerationAdminActor;
  actionId: string;
  reportId: string;
  kind: ModerationAdminActionInput["kind"];
  reasonCiphertext: string;
  idempotencyKey: string;
  requestHash: string;
  expectedReportVersion: number;
  reverseActionId: string | null;
  requestId: string;
};

export type EncryptedModerationAdminAction = Omit<
  ModerationAdminReportDetail["actions"][number],
  "reason"
> & { reasonCiphertext: string };

export type EncryptedModerationAdminReportDetail = Omit<
  ModerationAdminReportDetail,
  "actions" | "details" | "targetSnapshot"
> & {
  actions: EncryptedModerationAdminAction[];
  detailsCiphertext: string | null;
  legacyDetails: string | null;
  targetSnapshotCiphertext: string;
};

export interface ModerationAdminRepository {
  listQueue(command: ModerationAdminQueueCommand): Promise<{
    items: ModerationAdminQueueItem[];
    hasMore: boolean;
  }>;
  loadReport(
    actor: ModerationAdminActor,
    reportId: string,
  ): Promise<EncryptedModerationAdminReportDetail | null>;
  applyAction(command: ModerationAdminActionCommand): Promise<ModerationAdminActionResult>;
}

export interface ModerationAdminServiceContract {
  session(actor: ModerationAdminActor): ModerationAdminSession;
  queue(actor: ModerationAdminActor, rawQuery: unknown): Promise<ModerationAdminQueuePage>;
  report(actor: ModerationAdminActor, reportId: string): Promise<ModerationAdminReportDetail>;
  action(
    actor: ModerationAdminActor,
    reportId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<ModerationAdminActionResult>;
}

import type {
  FeedbackAdminDetail,
  FeedbackAdminQueueItem,
  FeedbackAdminQueuePage,
  FeedbackAdminQueueQuery,
  FeedbackAdminSession,
  FeedbackAdminStatusInput,
  FeedbackAdminStatusResult,
} from "../../shared/contracts/feedbackAdmin.js";
import type { ModerationAdminActor } from "../moderation/adminActor.js";
import type { FeedbackAdminCursor } from "./cursor.js";

export type FeedbackAdminQueueCommand = {
  actor: ModerationAdminActor;
  cursor: FeedbackAdminCursor | null;
  query: FeedbackAdminQueueQuery;
};

export type FeedbackAdminStatusCommand = {
  actor: ModerationAdminActor;
  reviewId: string;
  submissionId: string;
  status: FeedbackAdminStatusInput["status"];
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
};

export type EncryptedFeedbackAdminDetail = Omit<
  FeedbackAdminDetail,
  "message" | "contactEmail"
> & {
  messageCiphertext: string | null;
  legacyMessage: string | null;
  contactCiphertext: string | null;
};

export interface FeedbackAdminRepository {
  listQueue(command: FeedbackAdminQueueCommand): Promise<{
    items: FeedbackAdminQueueItem[];
    hasMore: boolean;
  }>;
  loadSubmission(
    actor: ModerationAdminActor,
    submissionId: string,
  ): Promise<EncryptedFeedbackAdminDetail | null>;
  updateStatus(command: FeedbackAdminStatusCommand): Promise<FeedbackAdminStatusResult>;
}

export interface FeedbackAdminServiceContract {
  session(actor: ModerationAdminActor): FeedbackAdminSession;
  queue(actor: ModerationAdminActor, rawQuery: unknown): Promise<FeedbackAdminQueuePage>;
  detail(actor: ModerationAdminActor, submissionId: string): Promise<FeedbackAdminDetail>;
  updateStatus(
    actor: ModerationAdminActor,
    submissionId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<FeedbackAdminStatusResult>;
}

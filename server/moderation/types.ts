import type {
  FeedbackSubmissionReceipt,
  ModerationReason,
  ModerationReportReceipt,
  ModerationTargetType,
  SupportKind,
} from "../../shared/contracts/moderation.js";
import type { ProjectActor } from "../projects/actor.js";

export interface SubmissionRateLimitStorage {
  consume(
    key: string,
    rule: { max: number; window: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

export interface SubmissionRequestContext {
  networkIdentifier: string;
  rawUserAgent: string;
  userAgentFamily: "chrome" | "edge" | "firefox" | "safari" | "other" | "unknown";
}

export interface VisibleModerationTarget {
  id: string;
  ownerId: string;
  projectId: string | null;
  snapshot: Record<string, unknown>;
  targetType: ModerationTargetType;
}

export interface CreateModerationReportCommand {
  actor: ProjectActor;
  contactCiphertext: string | null;
  contactHash: string | null;
  detailsCiphertext: string | null;
  id: string;
  idempotencyKey: string;
  policyVersion: string;
  reason: ModerationReason;
  receiptCode: string;
  requestHash: string;
  route: string | null;
  sourceFingerprintHash: string;
  targetId: string;
  targetSnapshotCiphertext: string;
  targetType: ModerationTargetType;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface CreateFeedbackSubmissionCommand {
  actor: ProjectActor;
  category: string;
  contactCiphertext: string | null;
  contactHash: string | null;
  id: string;
  idempotencyKey: string;
  kind: "feedback" | SupportKind;
  messageCiphertext: string;
  privacyNoticeVersion: string;
  receiptCode: string;
  requestHash: string;
  route: string | null;
  sourceFingerprintHash: string;
  userAgentFamily: SubmissionRequestContext["userAgentFamily"];
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface ModerationRepository {
  findModerationReportReplay(input: {
    actor: ProjectActor;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ModerationReportReceipt | null>;
  findFeedbackSubmissionReplay(input: {
    actor: ProjectActor;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<FeedbackSubmissionReceipt | null>;
  findVisibleTarget(
    actor: ProjectActor,
    targetType: ModerationTargetType,
    targetId: string,
  ): Promise<VisibleModerationTarget | null>;
  createModerationReport(command: CreateModerationReportCommand): Promise<ModerationReportReceipt>;
  createFeedbackSubmission(
    command: CreateFeedbackSubmissionCommand,
  ): Promise<FeedbackSubmissionReceipt>;
}


import {
  createFeedbackInputSchema,
  createModerationReportInputSchema,
  createSupportInputSchema,
  type FeedbackSubmissionReceipt,
  type ModerationReportReceipt,
} from "../../shared/contracts/moderation.js";
import type { ProjectActor } from "../projects/actor.js";
import { canonicalJson } from "../security/canonicalJson.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import { ModerationError } from "./errors.js";
import { scopedSubmissionIdempotencyKey, submissionRequestHash } from "./idempotency.js";
import type {
  ModerationRepository,
  SubmissionRateLimitStorage,
  SubmissionRequestContext,
} from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedActor(actor: ProjectActor): ProjectActor {
  if (actor.kind === "anonymous") return actor;
  if (!UUID.test(actor.appUserId)) throw new ModerationError("ACTOR_MAPPING_UNAVAILABLE");
  return { kind: "authenticated", appUserId: actor.appUserId.toLowerCase() };
}

function receiptCode(prefix: "MELD" | "HELP", id: string): string {
  const value = BigInt(`0x${id.replaceAll("-", "")}`) % (36n ** 8n);
  return `${prefix}-${value.toString(36).padStart(8, "0").toUpperCase()}`;
}

function actorScope(actor: ProjectActor, sourceFingerprintHash: string): string {
  return actor.kind === "authenticated"
    ? `actor:${actor.appUserId}`
    : `anonymous:${sourceFingerprintHash}`;
}

type SubmissionFingerprints = {
  ipHash: string | null;
  sourceFingerprintHash: string;
  userAgentHash: string | null;
};

function fingerprints(
  context: SubmissionRequestContext,
  blindIndex: PrivacyBlindIndex,
): SubmissionFingerprints {
  const networkIdentifier = context.networkIdentifier.trim().slice(0, 128) || "unknown";
  const userAgent = context.rawUserAgent.trim().slice(0, 512);
  return {
    ipHash: networkIdentifier === "unknown"
      ? null
      : blindIndex.create("community-ip", networkIdentifier),
    userAgentHash: userAgent ? blindIndex.create("community-user-agent", userAgent) : null,
    sourceFingerprintHash: blindIndex.create(
      "community-source",
      `${networkIdentifier}\0${userAgent || "unknown"}`,
    ),
  };
}

async function enforceRateLimits(
  storage: SubmissionRateLimitStorage,
  keys: Array<{ key: string; max: number; window: number }>,
): Promise<void> {
  for (const rule of keys) {
    const decision = await storage.consume(rule.key, { max: rule.max, window: rule.window });
    if (!decision.allowed) {
      throw new ModerationError("RATE_LIMITED", decision.retryAfter ?? undefined);
    }
  }
}

export class ModerationService {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly rateLimits: SubmissionRateLimitStorage,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submitReport(
    actorValue: ProjectActor,
    rawInput: unknown,
    requestContext: SubmissionRequestContext,
  ): Promise<ModerationReportReceipt> {
    const actor = normalizedActor(actorValue);
    const input = createModerationReportInputSchema.parse(rawInput);
    const requestFingerprints = fingerprints(requestContext, this.blindIndex);
    const contactHash = input.contactEmail
      ? this.blindIndex.create("email-recipient", input.contactEmail)
      : null;
    const operation = "moderation.report" as const;
    const scope = actorScope(actor, requestFingerprints.sourceFingerprintHash);
    const idempotencyKey = scopedSubmissionIdempotencyKey(operation, scope, input.idempotencyKey);
    const requestHash = submissionRequestHash(operation, {
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details ?? null,
      contactHash,
      route: input.route ?? null,
      policyVersion: input.policyVersion,
    }, this.blindIndex);

    const replay = await this.repository.findModerationReportReplay({
      actor,
      idempotencyKey,
      requestHash,
    });
    if (replay) return replay;

    const limiterScope = actor.kind === "authenticated"
      ? `user:${actor.appUserId}`
      : `source:${requestFingerprints.sourceFingerprintHash}`;
    await enforceRateLimits(this.rateLimits, [
      {
        key: `community:moderation:${limiterScope}:hour`,
        max: actor.kind === "authenticated" ? 10 : 3,
        window: 60 * 60,
      },
      {
        key: `community:moderation:${limiterScope}:day`,
        max: actor.kind === "authenticated" ? 30 : 8,
        window: 24 * 60 * 60,
      },
    ]);

    const target = await this.repository.findVisibleTarget(
      actor,
      input.targetType,
      input.targetId.toLowerCase(),
    );
    if (!target) throw new ModerationError("CONTENT_NOT_FOUND");

    const id = crypto.randomUUID();
    const capturedAt = this.now().toISOString();
    const targetSnapshotCiphertext = this.keyring.encrypt(canonicalJson({
      schemaVersion: 1,
      capturedAt,
      targetType: target.targetType,
      targetId: target.id,
      projectId: target.projectId,
      ownerId: target.ownerId,
      content: target.snapshot,
    }), `moderation-report:${id}:target-snapshot`);
    const detailsCiphertext = input.details
      ? this.keyring.encrypt(input.details, `moderation-report:${id}:details`)
      : null;
    const contactCiphertext = input.contactEmail
      ? this.keyring.encrypt(input.contactEmail, `moderation-report:${id}:contact`)
      : null;

    return this.repository.createModerationReport({
      actor,
      id,
      idempotencyKey,
      requestHash,
      targetType: input.targetType,
      targetId: input.targetId.toLowerCase(),
      reason: input.reason,
      detailsCiphertext,
      contactCiphertext,
      contactHash,
      sourceFingerprintHash: requestFingerprints.sourceFingerprintHash,
      targetSnapshotCiphertext,
      policyVersion: input.policyVersion,
      route: input.route ?? null,
      receiptCode: receiptCode("MELD", id),
      ipHash: requestFingerprints.ipHash,
      userAgentHash: requestFingerprints.userAgentHash,
    });
  }

  async submitFeedback(
    actorValue: ProjectActor,
    rawInput: unknown,
    requestContext: SubmissionRequestContext,
  ): Promise<FeedbackSubmissionReceipt> {
    const actor = normalizedActor(actorValue);
    if (actor.kind !== "authenticated") throw new ModerationError("ACTOR_REQUIRED");
    const input = createFeedbackInputSchema.parse(rawInput);
    return this.submitFeedbackCommand({
      actor,
      category: input.category,
      clientIdempotencyKey: input.idempotencyKey,
      contactEmail: null,
      kind: "feedback",
      message: input.message,
      operation: "feedback.submit",
      privacyNoticeVersion: input.privacyNoticeVersion,
      requestContext,
      route: input.route ?? null,
    });
  }

  async submitSupport(
    actorValue: ProjectActor,
    rawInput: unknown,
    requestContext: SubmissionRequestContext,
  ): Promise<FeedbackSubmissionReceipt> {
    const actor = normalizedActor(actorValue);
    const input = createSupportInputSchema.parse(rawInput);
    return this.submitFeedbackCommand({
      actor,
      category: input.category,
      clientIdempotencyKey: input.idempotencyKey,
      contactEmail: input.contactEmail,
      kind: input.kind,
      message: input.message,
      operation: "support.submit",
      privacyNoticeVersion: input.privacyNoticeVersion,
      requestContext,
      route: input.route ?? null,
    });
  }

  private async submitFeedbackCommand(input: {
    actor: ProjectActor;
    category: string;
    clientIdempotencyKey: string;
    contactEmail: string | null;
    kind: "feedback" | "support" | "third_party_request" | "appeal";
    message: string;
    operation: "feedback.submit" | "support.submit";
    privacyNoticeVersion: string;
    requestContext: SubmissionRequestContext;
    route: string | null;
  }): Promise<FeedbackSubmissionReceipt> {
    const requestFingerprints = fingerprints(input.requestContext, this.blindIndex);
    const contactHash = input.contactEmail
      ? this.blindIndex.create("email-recipient", input.contactEmail)
      : null;
    const scope = actorScope(input.actor, requestFingerprints.sourceFingerprintHash);
    const idempotencyKey = scopedSubmissionIdempotencyKey(
      input.operation,
      scope,
      input.clientIdempotencyKey,
    );
    const requestHash = submissionRequestHash(input.operation, {
      kind: input.kind,
      category: input.category,
      message: input.message,
      contactHash,
      route: input.route,
      privacyNoticeVersion: input.privacyNoticeVersion,
    }, this.blindIndex);
    const replay = await this.repository.findFeedbackSubmissionReplay({
      actor: input.actor,
      idempotencyKey,
      requestHash,
    });
    if (replay) return replay;

    const limiterScope = input.actor.kind === "authenticated"
      ? `user:${input.actor.appUserId}`
      : `source:${requestFingerprints.sourceFingerprintHash}`;
    await enforceRateLimits(this.rateLimits, [
      {
        key: `community:${input.kind}:${limiterScope}:hour`,
        max: input.kind === "feedback" ? 10 : 3,
        window: 60 * 60,
      },
      {
        key: `community:${input.kind}:${limiterScope}:day`,
        max: input.kind === "feedback" ? 30 : 10,
        window: 24 * 60 * 60,
      },
    ]);

    const id = crypto.randomUUID();
    return this.repository.createFeedbackSubmission({
      actor: input.actor,
      id,
      kind: input.kind,
      category: input.category,
      messageCiphertext: this.keyring.encrypt(
        input.message,
        `feedback-submission:${id}:message`,
      ),
      contactCiphertext: input.contactEmail
        ? this.keyring.encrypt(input.contactEmail, `feedback-submission:${id}:contact`)
        : null,
      contactHash,
      idempotencyKey,
      requestHash,
      sourceFingerprintHash: requestFingerprints.sourceFingerprintHash,
      route: input.route,
      userAgentFamily: input.requestContext.userAgentFamily,
      privacyNoticeVersion: input.privacyNoticeVersion,
      receiptCode: receiptCode("HELP", id),
      ipHash: requestFingerprints.ipHash,
      userAgentHash: requestFingerprints.userAgentHash,
    });
  }
}

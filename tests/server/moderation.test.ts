// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_POLICY_VERSION,
  SUPPORT_PRIVACY_NOTICE_VERSION,
  type FeedbackSubmissionReceipt,
  type ModerationReportReceipt,
} from "../../shared/contracts/moderation";
import { ModerationService } from "../../server/moderation/service";
import type {
  CreateFeedbackSubmissionCommand,
  CreateModerationReportCommand,
  ModerationRepository,
  SubmissionRateLimitStorage,
} from "../../server/moderation/types";
import {
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../../server/security/dataProtection";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-04T12:00:00.000Z");
const CLIENT_KEY = "community-client-key-0001";

function reportReceipt(command: CreateModerationReportCommand): ModerationReportReceipt {
  return {
    id: command.id,
    receiptCode: command.receiptCode,
    status: "received",
    submittedAt: NOW.toISOString(),
    replayed: false,
    emailConfirmationQueued: Boolean(command.contactCiphertext),
  };
}

function feedbackReceipt(command: CreateFeedbackSubmissionCommand): FeedbackSubmissionReceipt {
  return {
    id: command.id,
    receiptCode: command.receiptCode,
    kind: command.kind,
    status: "received",
    submittedAt: NOW.toISOString(),
    replayed: false,
    emailConfirmationQueued: command.kind !== "feedback",
  };
}

function repository(overrides: Partial<ModerationRepository> = {}): ModerationRepository {
  return {
    findModerationReportReplay: vi.fn().mockResolvedValue(null),
    findFeedbackSubmissionReplay: vi.fn().mockResolvedValue(null),
    findVisibleTarget: vi.fn().mockResolvedValue({
      id: TARGET_ID,
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      targetType: "update",
      snapshot: { title: "Zolder geïsoleerd", status: "published" },
    }),
    createModerationReport: vi.fn(async (command) => reportReceipt(command)),
    createFeedbackSubmission: vi.fn(async (command) => feedbackReceipt(command)),
    ...overrides,
  };
}

function dependencies(options: {
  repository?: ModerationRepository;
  rateLimits?: SubmissionRateLimitStorage;
} = {}) {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const blindIndexKey = Buffer.alloc(32, 9).toString("base64");
  const keyring = new DataProtectionKeyring({
    currentVersion: 1,
    keys: { 1: encryptionKey },
  });
  const blindIndex = new PrivacyBlindIndex(blindIndexKey);
  const rates = options.rateLimits ?? {
    consume: vi.fn().mockResolvedValue({ allowed: true, retryAfter: null }),
  };
  const repo = options.repository ?? repository();
  return {
    blindIndex,
    keyring,
    rates,
    repo,
    service: new ModerationService(repo, rates, keyring, blindIndex, () => NOW),
  };
}

const requestContext = {
  networkIdentifier: "203.0.113.42",
  rawUserAgent: "Mozilla/5.0 Chrome/127.0",
  userAgentFamily: "chrome" as const,
};

describe("ModerationService reports", () => {
  it("encrypts report PII and target evidence with field-bound AAD", async () => {
    let captured: CreateModerationReportCommand | undefined;
    const repo = repository({
      createModerationReport: vi.fn(async (command) => {
        captured = command;
        return reportReceipt(command);
      }),
    });
    const context = dependencies({ repository: repo });

    const result = await context.service.submitReport(
      { kind: "authenticated", appUserId: ACTOR_ID },
      {
        idempotencyKey: CLIENT_KEY,
        targetType: "update",
        targetId: TARGET_ID,
        reason: "privacy",
        details: "Er staat een herkenbaar kind op de foto.",
        contactEmail: "melder@example.test",
        route: `/project/${PROJECT_ID}`,
        policyVersion: CONTENT_POLICY_VERSION,
        website: "",
      },
      requestContext,
    );

    expect(result).toMatchObject({ status: "received", emailConfirmationQueued: true });
    expect(captured).toBeDefined();
    const command = captured!;
    expect(command.idempotencyKey).toMatch(/^community-command:v1:moderation[.]report:[0-9a-f]{64}$/);
    expect(command.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(command.sourceFingerprintHash).toMatch(/^[0-9a-f]{64}$/);
    expect(command.contactHash).toBe(
      context.blindIndex.create("email-recipient", "melder@example.test"),
    );
    expect(command.contactCiphertext).not.toContain("melder@example.test");
    expect(context.keyring.decrypt(
      command.contactCiphertext!,
      `moderation-report:${command.id}:contact`,
    )).toBe("melder@example.test");
    expect(context.keyring.decrypt(
      command.detailsCiphertext!,
      `moderation-report:${command.id}:details`,
    )).toBe("Er staat een herkenbaar kind op de foto.");
    const targetSnapshot = JSON.parse(context.keyring.decrypt(
      command.targetSnapshotCiphertext,
      `moderation-report:${command.id}:target-snapshot`,
    )) as Record<string, unknown>;
    expect(targetSnapshot).toMatchObject({
      schemaVersion: 1,
      targetType: "update",
      targetId: TARGET_ID,
      projectId: PROJECT_ID,
      content: { title: "Zolder geïsoleerd", status: "published" },
    });
    expect(JSON.stringify(command)).not.toContain("herkenbaar kind");
  });

  it("does not enumerate a target that is not visible to an anonymous reporter", async () => {
    const repo = repository({ findVisibleTarget: vi.fn().mockResolvedValue(null) });
    const context = dependencies({ repository: repo });

    await expect(context.service.submitReport(
      { kind: "anonymous" },
      {
        idempotencyKey: CLIENT_KEY,
        targetType: "profile",
        targetId: TARGET_ID,
        reason: "spam",
        policyVersion: CONTENT_POLICY_VERSION,
      },
      requestContext,
    )).rejects.toMatchObject({ reason: "CONTENT_NOT_FOUND", status: 404 });
    expect(repo.createModerationReport).not.toHaveBeenCalled();
  });

  it("returns an exact replay before consuming rate limits or loading content", async () => {
    const replay: ModerationReportReceipt = {
      id: TARGET_ID,
      receiptCode: "MELD-22222222",
      status: "received",
      submittedAt: NOW.toISOString(),
      replayed: true,
      emailConfirmationQueued: false,
    };
    const repo = repository({ findModerationReportReplay: vi.fn().mockResolvedValue(replay) });
    const consume = vi.fn().mockResolvedValue({ allowed: true, retryAfter: null });
    const context = dependencies({ repository: repo, rateLimits: { consume } });

    await expect(context.service.submitReport(
      { kind: "anonymous" },
      {
        idempotencyKey: CLIENT_KEY,
        targetType: "profile",
        targetId: TARGET_ID,
        reason: "spam",
        policyVersion: CONTENT_POLICY_VERSION,
      },
      requestContext,
    )).resolves.toEqual(replay);
    expect(consume).not.toHaveBeenCalled();
    expect(repo.findVisibleTarget).not.toHaveBeenCalled();
  });

  it("stops before persistence when the source rate limit is exhausted", async () => {
    const repo = repository();
    const context = dependencies({
      repository: repo,
      rateLimits: {
        consume: vi.fn().mockResolvedValue({ allowed: false, retryAfter: 900 }),
      },
    });

    await expect(context.service.submitReport(
      { kind: "anonymous" },
      {
        idempotencyKey: CLIENT_KEY,
        targetType: "profile",
        targetId: TARGET_ID,
        reason: "spam",
        policyVersion: CONTENT_POLICY_VERSION,
      },
      requestContext,
    )).rejects.toMatchObject({ reason: "RATE_LIMITED", retryAfterSeconds: 900 });
    expect(repo.findVisibleTarget).not.toHaveBeenCalled();
  });
});

describe("ModerationService feedback and support", () => {
  it("requires an authenticated actor for product feedback", async () => {
    const context = dependencies();

    await expect(context.service.submitFeedback(
      { kind: "anonymous" },
      {
        idempotencyKey: CLIENT_KEY,
        category: "idea",
        message: "Een slimme fotoselectie zou helpen.",
        privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      },
      requestContext,
    )).rejects.toMatchObject({ reason: "ACTOR_REQUIRED", status: 401 });
    expect(context.repo.createFeedbackSubmission).not.toHaveBeenCalled();
  });

  it("accepts anonymous support while encrypting both message and reply address", async () => {
    let captured: CreateFeedbackSubmissionCommand | undefined;
    const repo = repository({
      createFeedbackSubmission: vi.fn(async (command) => {
        captured = command;
        return feedbackReceipt(command);
      }),
    });
    const context = dependencies({ repository: repo });

    const result = await context.service.submitSupport(
      { kind: "anonymous" },
      {
        idempotencyKey: CLIENT_KEY,
        kind: "third_party_request",
        category: "privacy",
        message: "Ik sta herkenbaar op een foto en wil verwijdering aanvragen.",
        contactEmail: "betrokkene@example.test",
        route: "/support",
        privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      },
      requestContext,
    );

    expect(result).toMatchObject({ kind: "third_party_request", emailConfirmationQueued: true });
    expect(captured).toBeDefined();
    const command = captured!;
    expect(context.keyring.decrypt(
      command.messageCiphertext,
      `feedback-submission:${command.id}:message`,
    )).toBe("Ik sta herkenbaar op een foto en wil verwijdering aanvragen.");
    expect(context.keyring.decrypt(
      command.contactCiphertext!,
      `feedback-submission:${command.id}:contact`,
    )).toBe("betrokkene@example.test");
    expect(command.contactHash).toBe(
      context.blindIndex.create("email-recipient", "betrokkene@example.test"),
    );
    expect(JSON.stringify(command)).not.toContain("verwijdering aanvragen");
  });
});

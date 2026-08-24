// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  FeedbackAdminDetail,
  FeedbackAdminQueuePage,
  FeedbackAdminSession,
  FeedbackAdminStatusResult,
} from "../../shared/contracts/feedbackAdmin";
import { createFeedbackAdminHttpHandler } from "../../server/feedbackAdmin/http";
import { FeedbackAdminService } from "../../server/feedbackAdmin/service";
import type {
  FeedbackAdminRepository,
  FeedbackAdminServiceContract,
  FeedbackAdminStatusCommand,
} from "../../server/feedbackAdmin/types";
import type { ModerationAdminActor } from "../../server/moderation/adminActor";
import {
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../../server/security/dataProtection";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const MODERATOR_ID = "22222222-2222-4222-8222-222222222222";
const SUBMISSION_ID = "33333333-3333-4333-8333-333333333333";
const REVIEW_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

const admin: ModerationAdminActor = {
  appUserId: ADMIN_ID,
  role: "admin",
  grantExpiresAt: null,
};
const moderator: ModerationAdminActor = {
  appUserId: MODERATOR_ID,
  role: "moderator",
  grantExpiresAt: null,
};

function cryptoDependencies() {
  return {
    keyring: new DataProtectionKeyring({
      currentVersion: 1,
      keys: { 1: Buffer.alloc(32, 7).toString("base64") },
    }),
    blindIndex: new PrivacyBlindIndex(Buffer.alloc(32, 9).toString("base64")),
  };
}

function repository(overrides: Partial<FeedbackAdminRepository> = {}): FeedbackAdminRepository {
  return {
    listQueue: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    loadSubmission: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue({
      reviewId: REVIEW_ID,
      submissionId: SUBMISSION_ID,
      status: "triaged",
      version: 2,
      replayed: false,
    }),
    ...overrides,
  };
}

describe("FeedbackAdminService", () => {
  it("denies moderators before repository access or decryption", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const repo = repository();
    const service = new FeedbackAdminService(repo, keyring, blindIndex);
    await expect(service.queue(moderator, { status: "new", limit: 25 }))
      .rejects.toMatchObject({ reason: "FORBIDDEN", status: 403 });
    await expect(service.detail(moderator, SUBMISSION_ID))
      .rejects.toMatchObject({ reason: "FORBIDDEN", status: 403 });
    expect(repo.listQueue).not.toHaveBeenCalled();
    expect(repo.loadSubmission).not.toHaveBeenCalled();
  });

  it("binds opaque cursors to exact non-PII filters", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const item = {
      id: SUBMISSION_ID,
      receiptCode: "HELP-33333333",
      kind: "support" as const,
      category: "privacy",
      status: "new" as const,
      version: 1,
      hasContact: true,
      authenticated: false,
      createdAt: "2026-08-23T12:00:00.000Z",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };
    const repo = repository({
      listQueue: vi.fn()
        .mockResolvedValueOnce({ items: [item], hasMore: true })
        .mockResolvedValueOnce({ items: [], hasMore: false }),
    });
    const service = new FeedbackAdminService(repo, keyring, blindIndex);
    const first = await service.queue(admin, { status: "new", kind: "support", limit: "1" });
    expect(first.nextCursor).toBeTruthy();
    expect(Buffer.from(first.nextCursor!, "base64url").toString("utf8")).not.toContain("privacy");
    await expect(service.queue(admin, {
      status: "new",
      kind: "feedback",
      cursor: first.nextCursor,
      limit: "1",
    })).rejects.toMatchObject({ reason: "INVALID_CURSOR" });
  });

  it("decrypts message and contact only on the explicit detail path", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const messageCiphertext = keyring.encrypt(
      "Mijn adres en vraag staan alleen hier.",
      `feedback-submission:${SUBMISSION_ID}:message`,
    );
    const contactCiphertext = keyring.encrypt(
      "founder-contact@example.test",
      `feedback-submission:${SUBMISSION_ID}:contact`,
    );
    const repo = repository({
      loadSubmission: vi.fn().mockResolvedValue({
        id: SUBMISSION_ID,
        receiptCode: "HELP-33333333",
        kind: "support",
        category: "privacy",
        status: "new",
        version: 1,
        hasContact: true,
        authenticated: false,
        createdAt: "2026-08-23T12:00:00.000Z",
        updatedAt: "2026-08-23T12:00:00.000Z",
        resolvedAt: null,
        reviews: [],
        messageCiphertext,
        legacyMessage: null,
        contactCiphertext,
      }),
    });
    const service = new FeedbackAdminService(repo, keyring, blindIndex);

    await expect(service.detail(admin, SUBMISSION_ID)).resolves.toMatchObject({
      message: "Mijn adres en vraag staan alleen hier.",
      contactEmail: "founder-contact@example.test",
    });
    expect(JSON.stringify(await service.queue(admin, { status: "new", limit: 25 })))
      .not.toContain("founder-contact@example.test");
  });

  it("uses actor-scoped blind indexes and excludes PII from persisted command metadata", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    let command: FeedbackAdminStatusCommand | undefined;
    const repo = repository({
      updateStatus: vi.fn(async (input): Promise<FeedbackAdminStatusResult> => {
        command = input;
        return {
          reviewId: input.reviewId,
          submissionId: input.submissionId,
          status: input.status,
          version: input.expectedVersion + 1,
          replayed: false,
        };
      }),
    });
    const service = new FeedbackAdminService(repo, keyring, blindIndex);
    await service.updateStatus(admin, SUBMISSION_ID, {
      idempotencyKey: "feedback-client-command-0001",
      expectedVersion: 1,
      status: "triaged",
    }, REQUEST_ID);

    expect(command?.idempotencyKey).toMatch(/^feedback-admin-command:v1:[0-9a-f]{64}$/);
    expect(command?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(command)).not.toMatch(/message|contact|email|address/i);
  });
});

describe("feedback admin HTTP boundary", () => {
  function handler(actor: ModerationAdminActor = admin) {
    const actors = { resolve: vi.fn().mockResolvedValue(actor) };
    const session: FeedbackAdminSession = {
      appUserId: actor.appUserId,
      role: "admin",
      grantExpiresAt: actor.grantExpiresAt,
    };
    const service: FeedbackAdminServiceContract = {
      session: vi.fn().mockReturnValue(session),
      queue: vi.fn().mockResolvedValue({ items: [], nextCursor: null } satisfies FeedbackAdminQueuePage),
      detail: vi.fn().mockResolvedValue({} as FeedbackAdminDetail),
      updateStatus: vi.fn().mockResolvedValue({
        reviewId: REVIEW_ID,
        submissionId: SUBMISSION_ID,
        status: "triaged",
        version: 2,
        replayed: false,
      }),
    };
    return { actors, service, handle: createFeedbackAdminHttpHandler({ actors, service }) };
  }

  it("denies moderators before queue or detail PII can be loaded", async () => {
    const context = handler(moderator);
    await expect(context.handle(new Request(
      `https://test.buildy.example/api/admin/feedback/${SUBMISSION_ID}`,
    ), REQUEST_ID)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(context.service.detail).not.toHaveBeenCalled();
    expect(context.service.queue).not.toHaveBeenCalled();
  });

  it("ignores forged role headers and uses the resolved admin actor", async () => {
    const context = handler(admin);
    const response = await context.handle(new Request(
      "https://test.buildy.example/api/admin/feedback/session",
      { headers: { "x-buildy-role": "moderator" } },
    ), REQUEST_ID);
    expect(response.status).toBe(200);
    expect(context.actors.resolve).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ data: { role: "admin" } });
  });

  it("rejects unknown, duplicate and PII-bearing queue parameters", async () => {
    const context = handler();
    for (const query of [
      "status=new&status=closed",
      "email=private%40example.test",
      "message=private",
    ]) {
      await expect(context.handle(new Request(
        `https://test.buildy.example/api/admin/feedback?${query}`,
      ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    }
    expect(context.service.queue).not.toHaveBeenCalled();
  });

  it("uses replay-aware status codes without echoing submitted values", async () => {
    const context = handler();
    vi.mocked(context.service.updateStatus).mockResolvedValue({
      reviewId: REVIEW_ID,
      submissionId: SUBMISSION_ID,
      status: "triaged",
      version: 2,
      replayed: true,
    });
    const response = await context.handle(new Request(
      `https://test.buildy.example/api/admin/feedback/${SUBMISSION_ID}/status`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privateMessage: "niet loggen" }),
      },
    ), REQUEST_ID);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("niet loggen");
  });
});

// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  ModerationAdminActionResult,
  ModerationAdminQueuePage,
  ModerationAdminReportDetail,
  ModerationAdminSession,
} from "../../shared/contracts/moderation";
import {
  StrictModerationAdminActorResolver,
  type ModerationAdminActor,
  type ModerationAdminActorLookup,
} from "../../server/moderation/adminActor";
import { createModerationAdminHttpHandler } from "../../server/moderation/adminHttp";
import { ModerationAdminService } from "../../server/moderation/adminService";
import type {
  ModerationAdminActionCommand,
  ModerationAdminRepository,
  ModerationAdminServiceContract,
} from "../../server/moderation/adminTypes";
import type { AuthenticatedSubjectResolver } from "../../server/projects/actor";
import {
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../../server/security/dataProtection";

const MODERATOR_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

const moderator: ModerationAdminActor = {
  appUserId: MODERATOR_ID,
  role: "moderator",
  grantExpiresAt: "2026-09-01T00:00:00.000Z",
};

function cryptoDependencies() {
  const keyring = new DataProtectionKeyring({
    currentVersion: 1,
    keys: { 1: Buffer.alloc(32, 3).toString("base64") },
  });
  const blindIndex = new PrivacyBlindIndex(Buffer.alloc(32, 5).toString("base64"));
  return { keyring, blindIndex };
}

function repository(overrides: Partial<ModerationAdminRepository> = {}): ModerationAdminRepository {
  return {
    listQueue: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    loadReport: vi.fn().mockResolvedValue(null),
    applyAction: vi.fn().mockResolvedValue({
      actionId: ACTION_ID,
      reportId: REPORT_ID,
      reportStatus: "resolved",
      reportVersion: 2,
      replayed: false,
    }),
    ...overrides,
  };
}

describe("moderation admin actor boundary", () => {
  it("rejects anonymous sessions and ordinary or expired role lookups", async () => {
    const anonymousSubjects: AuthenticatedSubjectResolver = {
      resolveAuthUserId: vi.fn().mockResolvedValue(null),
    };
    const lookup: ModerationAdminActorLookup = { findByAuthSubject: vi.fn() };
    await expect(new StrictModerationAdminActorResolver(anonymousSubjects, lookup).resolve(
      new Request("https://test.buildy.example/api/moderation/admin/session"),
    )).rejects.toMatchObject({ reason: "UNAUTHENTICATED", status: 401 });
    expect(lookup.findByAuthSubject).not.toHaveBeenCalled();

    const authenticatedSubjects: AuthenticatedSubjectResolver = {
      resolveAuthUserId: vi.fn().mockResolvedValue("auth-subject"),
    };
    const inactiveLookup: ModerationAdminActorLookup = {
      findByAuthSubject: vi.fn().mockResolvedValue(null),
    };
    await expect(new StrictModerationAdminActorResolver(authenticatedSubjects, inactiveLookup).resolve(
      new Request("https://test.buildy.example/api/moderation/admin/session"),
    )).rejects.toMatchObject({ reason: "FORBIDDEN", status: 403 });
  });

  it("returns only the authoritative role supplied by the auth-subject lookup", async () => {
    const subjects: AuthenticatedSubjectResolver = {
      resolveAuthUserId: vi.fn().mockResolvedValue("auth-subject"),
    };
    const lookup: ModerationAdminActorLookup = {
      findByAuthSubject: vi.fn().mockResolvedValue(moderator),
    };
    await expect(new StrictModerationAdminActorResolver(subjects, lookup).resolve(
      new Request("https://test.buildy.example/api/moderation/admin/session", {
        headers: { "x-buildy-role": "admin" },
      }),
    )).resolves.toEqual(moderator);
  });
});

describe("ModerationAdminService", () => {
  it("binds cursors to their exact filters", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const item = {
      id: REPORT_ID,
      receiptCode: "MELD-33333333",
      targetType: "profile" as const,
      targetId: TARGET_ID,
      reason: "privacy" as const,
      urgency: "high" as const,
      status: "open" as const,
      version: 1,
      targetHidden: false,
      createdAt: "2026-08-04T12:00:00.000Z",
      updatedAt: "2026-08-04T12:00:00.000Z",
    };
    const repo = repository({
      listQueue: vi.fn()
        .mockResolvedValueOnce({ items: [item], hasMore: true })
        .mockResolvedValueOnce({ items: [], hasMore: false }),
    });
    const service = new ModerationAdminService(repo, keyring, blindIndex);
    const first = await service.queue(moderator, { status: "open", limit: "1" });
    expect(first.nextCursor).toBeTruthy();
    await expect(service.queue(moderator, {
      status: "resolved",
      cursor: first.nextCursor,
      limit: "1",
    })).rejects.toMatchObject({ reason: "INVALID_CURSOR" });
  });

  it("decrypts report fields only in the explicit detail service", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const detailsCiphertext = keyring.encrypt("Gevoelige toelichting", `moderation-report:${REPORT_ID}:details`);
    const snapshotCiphertext = keyring.encrypt(
      JSON.stringify({ schemaVersion: 1, content: { title: "Privé-inhoud" } }),
      `moderation-report:${REPORT_ID}:target-snapshot`,
    );
    const reasonCiphertext = keyring.encrypt("Inhoud is in strijd met het beleid.", `moderation-action:${ACTION_ID}:reason`);
    const repo = repository({
      loadReport: vi.fn().mockResolvedValue({
        id: REPORT_ID,
        receiptCode: "MELD-33333333",
        targetType: "profile",
        targetId: TARGET_ID,
        reason: "privacy",
        urgency: "high",
        status: "resolved",
        version: 2,
        targetHidden: true,
        createdAt: "2026-08-04T12:00:00.000Z",
        updatedAt: "2026-08-04T12:05:00.000Z",
        detailsCiphertext,
        legacyDetails: null,
        targetSnapshotCiphertext: snapshotCiphertext,
        actions: [{
          id: ACTION_ID,
          kind: "hide",
          actorId: MODERATOR_ID,
          actorRole: "moderator",
          reasonCiphertext,
          reversesActionId: null,
          reversedByActionId: null,
          reportVersion: 2,
          createdAt: "2026-08-04T12:05:00.000Z",
        }],
      }),
    });
    const service = new ModerationAdminService(repo, keyring, blindIndex);

    await expect(service.report(moderator, REPORT_ID)).resolves.toMatchObject({
      details: "Gevoelige toelichting",
      targetSnapshot: { content: { title: "Privé-inhoud" } },
      actions: [{ reason: "Inhoud is in strijd met het beleid." }],
    });
  });

  it("returns a generic 404 for an unknown report ID and does not decrypt anything", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const repo = repository({ loadReport: vi.fn().mockResolvedValue(null) });
    const service = new ModerationAdminService(repo, keyring, blindIndex);

    await expect(service.report(moderator, REPORT_ID)).rejects.toMatchObject({
      reason: "REPORT_NOT_FOUND",
      status: 404,
    });
  });

  it("rejects forged role fields and admin-only account actions for moderators", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const repo = repository();
    const service = new ModerationAdminService(repo, keyring, blindIndex);
    const base = {
      idempotencyKey: "moderation-client-key-0001",
      expectedReportVersion: 1,
      reason: "Herhaalde ernstige overtreding.",
    };

    await expect(service.action(moderator, REPORT_ID, {
      ...base,
      kind: "resolve",
      actorRole: "admin",
    }, REQUEST_ID)).rejects.toBeDefined();
    await expect(service.action(moderator, REPORT_ID, {
      ...base,
      kind: "suspend",
    }, REQUEST_ID)).rejects.toMatchObject({ reason: "FORBIDDEN" });
    expect(repo.applyAction).not.toHaveBeenCalled();
  });

  it("encrypts reasons and scopes replay keys to the authoritative actor", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    let command: ModerationAdminActionCommand | undefined;
    const repo = repository({
      applyAction: vi.fn(async (input): Promise<ModerationAdminActionResult> => {
        command = input;
        return {
          actionId: input.actionId,
          reportId: input.reportId,
          reportStatus: "resolved",
          reportVersion: 2,
          replayed: false,
        };
      }),
    });
    const service = new ModerationAdminService(repo, keyring, blindIndex);
    await service.action(moderator, REPORT_ID, {
      idempotencyKey: "moderation-client-key-0002",
      expectedReportVersion: 1,
      kind: "resolve",
      reason: "Melding zorgvuldig beoordeeld.",
    }, REQUEST_ID);

    expect(command?.idempotencyKey).toMatch(/^moderation-admin-command:v1:[0-9a-f]{64}$/);
    expect(command?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(command?.reasonCiphertext).not.toContain("zorgvuldig");
    expect(keyring.decrypt(
      command!.reasonCiphertext,
      `moderation-action:${command!.actionId}:reason`,
    )).toBe("Melding zorgvuldig beoordeeld.");
  });
});

describe("moderation admin HTTP boundary", () => {
  function handler(options: {
    actor?: ModerationAdminActor;
    actorError?: Error;
    service?: Partial<ModerationAdminServiceContract>;
  } = {}) {
    const actors = {
      resolve: options.actorError
        ? vi.fn().mockRejectedValue(options.actorError)
        : vi.fn().mockResolvedValue(options.actor ?? moderator),
    };
    const session: ModerationAdminSession = {
      appUserId: moderator.appUserId,
      role: moderator.role,
      grantExpiresAt: moderator.grantExpiresAt,
    };
    const service: ModerationAdminServiceContract = {
      session: vi.fn().mockReturnValue(session),
      queue: vi.fn().mockResolvedValue({ items: [], nextCursor: null } satisfies ModerationAdminQueuePage),
      report: vi.fn().mockResolvedValue({} as ModerationAdminReportDetail),
      action: vi.fn().mockResolvedValue({
        actionId: ACTION_ID,
        reportId: REPORT_ID,
        reportStatus: "resolved",
        reportVersion: 2,
        replayed: false,
      } satisfies ModerationAdminActionResult),
      ...options.service,
    };
    return { actors, service, handle: createModerationAdminHttpHandler({ actors, service }) };
  }

  it("does not accept role headers and resolves every route server-side", async () => {
    const context = handler();
    const response = await context.handle(new Request(
      "https://test.buildy.example/api/moderation/admin/session",
      { headers: { "x-buildy-role": "admin" } },
    ), REQUEST_ID);

    expect(response.status).toBe(200);
    expect(context.actors.resolve).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ data: { role: "moderator" } });
  });

  it("rejects duplicate/unknown queue parameters and oversized writes", async () => {
    const context = handler();
    await expect(context.handle(new Request(
      "https://test.buildy.example/api/moderation/admin/reports?status=open&status=resolved",
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(context.handle(new Request(
      "https://test.buildy.example/api/moderation/admin/reports?contact=secret",
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(context.handle(new Request(
      `https://test.buildy.example/api/moderation/admin/reports/${REPORT_ID}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "x".repeat(17 * 1024) }),
      },
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("uses 200 for action replay and never echoes the request body in errors", async () => {
    const context = handler({
      service: {
        action: vi.fn().mockResolvedValue({
          actionId: ACTION_ID,
          reportId: REPORT_ID,
          reportStatus: "resolved",
          reportVersion: 2,
          replayed: true,
        }),
      },
    });
    const response = await context.handle(new Request(
      `https://test.buildy.example/api/moderation/admin/reports/${REPORT_ID}/actions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "gevoelige motivering" }),
      },
    ), REQUEST_ID);

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("gevoelige motivering");
  });
});

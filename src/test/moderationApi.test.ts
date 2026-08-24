// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_POLICY_VERSION,
  SUPPORT_PRIVACY_NOTICE_VERSION,
} from "../../shared/contracts/moderation";
import {
  applyModerationAdminAction,
  getModerationAdminQueue,
  getModerationAdminReport,
  getModerationAdminSession,
  submitFeedback,
  submitModerationReport,
  submitSupport,
} from "@/lib/moderationApi";
import { ApiClientError } from "@/lib/apiClient";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SUBMISSION_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_KEY = "community-browser-key-0001";

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

describe("moderation API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits a typed moderation report to the dedicated same-origin endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      id: SUBMISSION_ID,
      receiptCode: "MELD-22222222",
      status: "received",
      submittedAt: "2026-08-04T12:00:00.000Z",
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitModerationReport({
      idempotencyKey: CLIENT_KEY,
      targetType: "media",
      targetId: TARGET_ID,
      reason: "privacy",
      details: "Een herkenbaar persoon heeft geen toestemming gegeven.",
      contactEmail: "melder@example.test",
      route: "/project/33333333-3333-4333-8333-333333333333",
      policyVersion: CONTENT_POLICY_VERSION,
      website: "",
    })).resolves.toMatchObject({ receiptCode: "MELD-22222222" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/moderation/reports",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ targetType: "media", targetId: TARGET_ID, policyVersion: CONTENT_POLICY_VERSION });
    expect(body).not.toHaveProperty("reporterId");
    expect(body).not.toHaveProperty("status");
  });

  it("keeps authenticated feedback and contact-required support on separate contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({
        id: SUBMISSION_ID,
        receiptCode: "HELP-22222222",
        kind: "feedback",
        status: "received",
        submittedAt: "2026-08-04T12:00:00.000Z",
        replayed: false,
      }))
      .mockResolvedValueOnce(success({
        id: SUBMISSION_ID,
        receiptCode: "HELP-22222222",
        kind: "third_party_request",
        status: "received",
        submittedAt: "2026-08-04T12:00:00.000Z",
        replayed: false,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await submitFeedback({
      idempotencyKey: CLIENT_KEY,
      category: "usability",
      message: "De fotoselectie kan duidelijker.",
      route: "/feedback",
      privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      website: "",
    });
    await submitSupport({
      idempotencyKey: CLIENT_KEY,
      kind: "third_party_request",
      category: "privacy",
      message: "Ik sta herkenbaar op een foto en wil verwijdering aanvragen.",
      contactEmail: "betrokkene@example.test",
      route: "/support",
      privacyNoticeVersion: SUPPORT_PRIVACY_NOTICE_VERSION,
      website: "",
    });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/feedback", "/api/support"]);
    const feedbackBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    const supportBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(feedbackBody).not.toHaveProperty("contactEmail");
    expect(supportBody).toMatchObject({ kind: "third_party_request", contactEmail: "betrokkene@example.test" });
  });

  it("fails closed on malformed receipt codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success({
      id: SUBMISSION_ID,
      receiptCode: "raw-email@example.test",
      status: "received",
      submittedAt: "2026-08-04T12:00:00.000Z",
      replayed: false,
    })));

    await expect(submitModerationReport({
      idempotencyKey: CLIENT_KEY,
      targetType: "profile",
      targetId: TARGET_ID,
      reason: "spam",
      policyVersion: CONTENT_POLICY_VERSION,
    })).rejects.toBeInstanceOf(ApiClientError);
  });

  it("loads only the typed PII-free admin queue and explicit report detail routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({
        appUserId: TARGET_ID,
        role: "moderator",
        grantExpiresAt: null,
      }))
      .mockResolvedValueOnce(success({
        items: [{
          id: SUBMISSION_ID,
          receiptCode: "MELD-22222222",
          targetType: "profile",
          targetId: TARGET_ID,
          reason: "privacy",
          urgency: "high",
          status: "open",
          version: 1,
          targetHidden: false,
          createdAt: "2026-08-04T12:00:00.000Z",
          updatedAt: "2026-08-04T12:00:00.000Z",
        }],
        nextCursor: null,
      }))
      .mockResolvedValueOnce(success({
        id: SUBMISSION_ID,
        receiptCode: "MELD-22222222",
        targetType: "profile",
        targetId: TARGET_ID,
        reason: "privacy",
        urgency: "high",
        status: "open",
        version: 1,
        targetHidden: false,
        createdAt: "2026-08-04T12:00:00.000Z",
        updatedAt: "2026-08-04T12:00:00.000Z",
        details: "Alleen op detail",
        targetSnapshot: { schemaVersion: 1 },
        actions: [],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await getModerationAdminSession();
    const queue = await getModerationAdminQueue({
      status: "open",
      urgency: "high",
      targetType: "profile",
      limit: 25,
    });
    expect(queue.items[0]).not.toHaveProperty("details");
    await expect(getModerationAdminReport(SUBMISSION_ID)).resolves.toMatchObject({
      details: "Alleen op detail",
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/moderation/admin/session",
      "/api/moderation/admin/reports?status=open&limit=25&urgency=high&targetType=profile",
      `/api/moderation/admin/reports/${SUBMISSION_ID}`,
    ]);
  });

  it("posts optimistic idempotent admin actions without a client-controlled actor or role", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      actionId: TARGET_ID,
      reportId: SUBMISSION_ID,
      reportStatus: "resolved",
      reportVersion: 2,
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await applyModerationAdminAction(SUBMISSION_ID, {
      idempotencyKey: CLIENT_KEY,
      expectedReportVersion: 1,
      kind: "resolve",
      reason: "Melding beoordeeld.",
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toEqual({
      idempotencyKey: CLIENT_KEY,
      expectedReportVersion: 1,
      kind: "resolve",
      reason: "Melding beoordeeld.",
    });
    expect(body).not.toHaveProperty("actorId");
    expect(body).not.toHaveProperty("role");
  });
});

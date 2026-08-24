// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFeedbackAdminDetail,
  getFeedbackAdminQueue,
  getFeedbackAdminSession,
  updateFeedbackAdminStatus,
} from "@/lib/feedbackAdminApi";
import { ApiClientError } from "@/lib/apiClient";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const SUBMISSION_ID = "33333333-3333-4333-8333-333333333333";
const REVIEW_ID = "44444444-4444-4444-8444-444444444444";

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

function queueItem() {
  return {
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
  };
}

describe("feedback admin API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses typed same-origin session, metadata queue and explicit detail routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({ appUserId: ADMIN_ID, role: "admin", grantExpiresAt: null }))
      .mockResolvedValueOnce(success({ items: [queueItem()], nextCursor: null }))
      .mockResolvedValueOnce(success({
        ...queueItem(),
        message: "Alleen op detail zichtbaar.",
        contactEmail: "contact@example.test",
        resolvedAt: null,
        reviews: [],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await getFeedbackAdminSession();
    const queue = await getFeedbackAdminQueue({
      status: "new",
      kind: "support",
      limit: 25,
    });
    expect(queue.items[0]).not.toHaveProperty("message");
    await expect(getFeedbackAdminDetail(SUBMISSION_ID)).resolves.toMatchObject({
      message: "Alleen op detail zichtbaar.",
      contactEmail: "contact@example.test",
    });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/admin/feedback/session",
      "/api/admin/feedback?status=new&limit=25&kind=support",
      `/api/admin/feedback/${SUBMISSION_ID}`,
    ]);
  });

  it("fails closed when a queue response unexpectedly contains PII", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(success({
      items: [{ ...queueItem(), message: "mag niet in de wachtrij" }],
      nextCursor: null,
    })));
    await expect(getFeedbackAdminQueue({ status: "new", limit: 25 }))
      .rejects.toBeInstanceOf(ApiClientError);
  });

  it("posts only optimistic status command fields and no actor or PII", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      reviewId: REVIEW_ID,
      submissionId: SUBMISSION_ID,
      status: "triaged",
      version: 2,
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    await updateFeedbackAdminStatus(SUBMISSION_ID, {
      idempotencyKey: "feedback-browser-command-0001",
      expectedVersion: 1,
      status: "triaged",
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toEqual({
      idempotencyKey: "feedback-browser-command-0001",
      expectedVersion: 1,
      status: "triaged",
    });
    expect(JSON.stringify(body)).not.toMatch(/actor|message|contact|email/i);
  });
});

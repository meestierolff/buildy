// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createModerationHttpHandler } from "../../server/moderation/http";
import { ModerationError } from "../../server/moderation/errors";
import type { ModerationHttpService } from "../../server/moderation/http";
import type { ProjectActorResolver } from "../../server/projects/actor";
import { ProjectError } from "../../server/projects/errors";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";

const reportReceipt = {
  id: REPORT_ID,
  receiptCode: "MELD-22222222",
  status: "received" as const,
  submittedAt: "2026-08-04T12:00:00.000Z",
  replayed: false,
  emailConfirmationQueued: false,
};

function dependencies(serviceOverrides: Partial<ModerationHttpService> = {}) {
  const actors: ProjectActorResolver = {
    resolve: vi.fn().mockResolvedValue({ kind: "anonymous" }),
  };
  const service: ModerationHttpService = {
    submitReport: vi.fn().mockResolvedValue(reportReceipt),
    submitFeedback: vi.fn().mockResolvedValue({
      ...reportReceipt,
      receiptCode: "HELP-22222222",
      kind: "feedback",
    }),
    submitSupport: vi.fn().mockResolvedValue({
      ...reportReceipt,
      receiptCode: "HELP-22222222",
      kind: "support",
      emailConfirmationQueued: true,
    }),
    ...serviceOverrides,
  };
  return { actors, service, handler: createModerationHttpHandler({ actors, service }) };
}

describe("moderation, feedback and support HTTP boundary", () => {
  it("returns 201 for a first report and trusts only Vercel's normalized client-IP header", async () => {
    const context = dependencies();
    const response = await context.handler(new Request(
      "https://test.buildy.example/api/moderation/reports",
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "user-agent": "Mozilla/5.0 Edg/127.0",
          "x-forwarded-for": "198.51.100.99",
          "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
        },
        body: JSON.stringify({ example: true }),
      },
    ), REQUEST_ID);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { receiptCode: "MELD-22222222", replayed: false },
      meta: { requestId: REQUEST_ID },
    });
    expect(context.service.submitReport).toHaveBeenCalledWith(
      { kind: "anonymous" },
      { example: true },
      {
        networkIdentifier: "203.0.113.10",
        rawUserAgent: "Mozilla/5.0 Edg/127.0",
        userAgentFamily: "edge",
      },
    );
  });

  it("returns 200 for an idempotent replay", async () => {
    const context = dependencies({
      submitReport: vi.fn().mockResolvedValue({ ...reportReceipt, replayed: true }),
    });
    const response = await context.handler(new Request(
      "https://test.buildy.example/api/moderation/reports",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ), REQUEST_ID);

    expect(response.status).toBe(200);
  });

  it("rejects query strings, non-JSON input and oversized bodies", async () => {
    const context = dependencies();

    await expect(context.handler(new Request(
      "https://test.buildy.example/api/support?receipt=secret",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(context.handler(new Request(
      "https://test.buildy.example/api/support",
      { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" },
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    await expect(context.handler(new Request(
      "https://test.buildy.example/api/support",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "x".repeat(33 * 1024) }),
      },
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("emits Retry-After without echoing submission data", async () => {
    const context = dependencies({
      submitSupport: vi.fn().mockRejectedValue(new ModerationError("RATE_LIMITED", 600)),
    });
    const response = await context.handler(new Request(
      "https://test.buildy.example/api/support",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactEmail: "private@example.test" }),
      },
    ), REQUEST_ID);
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(body).not.toContain("private@example.test");
  });

  it("keeps the contact-required support and appeal route available after session revocation", async () => {
    const context = dependencies();
    vi.mocked(context.actors.resolve).mockRejectedValueOnce(
      new ProjectError("ACTOR_MAPPING_UNAVAILABLE"),
    );
    const response = await context.handler(new Request(
      "https://test.buildy.example/api/support",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "appeal" }),
      },
    ), REQUEST_ID);

    expect(response.status).toBe(201);
    expect(context.service.submitSupport).toHaveBeenCalledWith(
      { kind: "anonymous" },
      { kind: "appeal" },
      expect.any(Object),
    );
  });

  it("does not expose an invented moderator or admin route", async () => {
    const context = dependencies();
    const response = await context.handler(new Request(
      "https://test.buildy.example/api/moderation/actions",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    ), REQUEST_ID);

    expect(response.status).toBe(404);
    expect(context.service.submitReport).not.toHaveBeenCalled();
  });
});

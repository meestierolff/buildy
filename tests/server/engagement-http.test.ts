// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANONYMOUS_PROJECT_ACTOR } from "../../server/projects/actor";
import {
  createEngagementHttpHandler,
  type EngagementHttpService,
} from "../../server/engagement/http";
import type { ProjectActorResolver } from "../../server/projects/actor";
import { EngagementError } from "../../server/engagement/errors";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const FORGED_ID = "00000000-0000-4000-8000-000000000002";
const PROJECT_ID = "00000000-0000-4000-8000-000000000101";
const UPDATE_ID = "00000000-0000-4000-8000-000000000201";
const COMMENT_ID = "00000000-0000-4000-8000-000000000301";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000401";
const REACTION_ID = "00000000-0000-4000-8000-000000000501";
const REQUEST_ID = "00000000-0000-4000-8000-000000000901";

function serviceMocks(): EngagementHttpService {
  return {
    comments: vi.fn().mockResolvedValue({
      projectId: PROJECT_ID,
      updateId: UPDATE_ID,
      items: [],
      nextCursor: null,
    }),
    createComment: vi.fn().mockResolvedValue({ commentId: COMMENT_ID, replayed: false }),
    deleteComment: vi.fn().mockResolvedValue({ commentId: COMMENT_ID, replayed: false }),
    reactions: vi.fn().mockResolvedValue({
      projectId: PROJECT_ID,
      updateId: UPDATE_ID,
      target: "update",
      commentId: null,
      items: [],
    }),
    addReaction: vi.fn().mockResolvedValue({
      reactionId: REACTION_ID,
      state: "active",
      replayed: false,
    }),
    removeReaction: vi.fn().mockResolvedValue({
      reactionId: null,
      state: "removed",
      replayed: true,
    }),
    notifications: vi.fn().mockResolvedValue({ items: [], nextCursor: null, unreadCount: 0 }),
    markAllNotificationsRead: vi.fn().mockResolvedValue({
      updatedCount: 2,
      unreadCount: 0,
    }),
    updateNotification: vi.fn().mockResolvedValue({
      notificationId: NOTIFICATION_ID,
      status: "read",
      replayed: false,
    }),
  };
}

function actorResolver(actorId: string | null): ProjectActorResolver {
  return {
    resolve: vi.fn().mockResolvedValue(
      actorId
        ? { kind: "authenticated", appUserId: actorId }
        : ANONYMOUS_PROJECT_ACTOR,
    ),
  };
}

describe("engagement HTTP handler", () => {
  let actors: ProjectActorResolver;
  let service: EngagementHttpService;

  beforeEach(() => {
    actors = actorResolver(ACTOR_ID);
    service = serviceMocks();
  });

  it("allows anonymous reads without inventing an actor", async () => {
    actors = actorResolver(null);
    const handler = createEngagementHttpHandler({ actors, service });

    const comments = await handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments?limit=10`,
      ),
      REQUEST_ID,
    );
    const reactions = await handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/reactions`,
      ),
      REQUEST_ID,
    );

    expect(comments.status).toBe(200);
    expect(reactions.status).toBe(200);
    expect(service.comments).toHaveBeenCalledWith(
      ANONYMOUS_PROJECT_ACTOR,
      PROJECT_ID,
      UPDATE_ID,
      { limit: "10" },
    );
    expect(service.reactions).toHaveBeenCalledWith(
      ANONYMOUS_PROJECT_ACTOR,
      PROJECT_ID,
      UPDATE_ID,
      {},
    );
  });

  it("rejects anonymous writes before disclosing content existence", async () => {
    actors = actorResolver(null);
    const handler = createEngagementHttpHandler({ actors, service });

    await expect(handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: "Test" }),
        },
      ),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(handler(
      new Request("https://app.buildy.test/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "read_all" }),
      }),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(service.createComment).not.toHaveBeenCalled();
    expect(service.markAllNotificationsRead).not.toHaveBeenCalled();
  });

  it("uses only the server-resolved actor for comment and reaction writes", async () => {
    const handler = createEngagementHttpHandler({ actors, service });
    const forgedBody = {
      actorId: FORGED_ID,
      recipientId: FORGED_ID,
      target: "update",
      emoji: "👍",
    };

    await handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/reactions`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", "x-user-id": FORGED_ID },
          body: JSON.stringify(forgedBody),
        },
      ),
      REQUEST_ID,
    );

    expect(service.addReaction).toHaveBeenCalledWith(
      ACTOR_ID,
      PROJECT_ID,
      UPDATE_ID,
      forgedBody,
    );
  });

  it("routes author/owner comment deletion with path-owned identifiers", async () => {
    const handler = createEngagementHttpHandler({ actors, service });
    const input = { idempotencyKey: "comment-delete-key-0001", expectedVersion: 2 };

    const response = await handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments/${COMMENT_ID}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      ),
      REQUEST_ID,
    );

    expect(response.status).toBe(200);
    expect(service.deleteComment).toHaveBeenCalledWith(
      ACTOR_ID,
      PROJECT_ID,
      UPDATE_ID,
      COMMENT_ID,
      input,
    );
  });

  it("never accepts a recipient selector for notification list or mutation", async () => {
    const handler = createEngagementHttpHandler({ actors, service });

    await handler(
      new Request(
        `https://app.buildy.test/api/notifications?status=unread&limit=5`,
        { headers: { "x-recipient-id": FORGED_ID },
      }),
      REQUEST_ID,
    );
    await handler(
      new Request("https://app.buildy.test/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-recipient-id": FORGED_ID },
        body: JSON.stringify({ action: "read_all" }),
      }),
      REQUEST_ID,
    );
    await handler(
      new Request(`https://app.buildy.test/api/notifications/${NOTIFICATION_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-recipient-id": FORGED_ID },
        body: JSON.stringify({ action: "read" }),
      }),
      REQUEST_ID,
    );

    expect(service.notifications).toHaveBeenCalledWith(ACTOR_ID, {
      status: "unread",
      limit: "5",
    });
    expect(service.markAllNotificationsRead).toHaveBeenCalledWith(
      ACTOR_ID,
      { action: "read_all" },
    );
    expect(service.updateNotification).toHaveBeenCalledWith(
      ACTOR_ID,
      NOTIFICATION_ID,
      { action: "read" },
    );
  });

  it("uses 201 for a new comment and 200 for its idempotent replay", async () => {
    vi.mocked(service.createComment)
      .mockResolvedValueOnce({ commentId: COMMENT_ID, replayed: false })
      .mockResolvedValueOnce({ commentId: COMMENT_ID, replayed: true });
    const handler = createEngagementHttpHandler({ actors, service });
    const request = () => new Request(
      `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "comment-create-key-0001",
          body: "Mooi!",
        }),
      },
    );

    expect((await handler(request(), REQUEST_ID)).status).toBe(201);
    expect((await handler(request(), REQUEST_ID)).status).toBe(200);
  });

  it("maps inaccessible content identically and rejects malformed paths locally", async () => {
    vi.mocked(service.comments).mockRejectedValue(new EngagementError("CONTENT_NOT_FOUND"));
    const handler = createEngagementHttpHandler({ actors, service });

    await expect(handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments`,
      ),
      REQUEST_ID,
    )).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Deze update of reactie bestaat niet of is niet toegankelijk.",
      status: 404,
    });

    await expect(handler(
      new Request("https://app.buildy.test/api/projects/not-a-uuid/updates/nope/comments"),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects duplicate queries and malformed or oversized JSON before the service", async () => {
    const handler = createEngagementHttpHandler({ actors, service });
    await expect(handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments?limit=5&limit=10`,
      ),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    await expect(handler(
      new Request(`https://app.buildy.test/api/notifications/${NOTIFICATION_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    await expect(handler(
      new Request(
        `https://app.buildy.test/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/reactions`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-length": String(33 * 1024),
          },
          body: "{}",
        },
      ),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });

  it("returns a local JSON 404 for unsupported methods and routes", async () => {
    const handler = createEngagementHttpHandler({ actors, service });
    const response = await handler(
      new Request("https://app.buildy.test/api/notifications", { method: "POST" }),
      REQUEST_ID,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId: REQUEST_ID },
    });
  });
});

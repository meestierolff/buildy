// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createCommentInputSchema,
  engagementCommentSchema,
  engagementNotificationSchema,
  reactionTargetInputSchema,
  type EngagementComment,
  type EngagementNotification,
} from "../../shared/contracts/engagement";
import { ANONYMOUS_PROJECT_ACTOR, type ProjectActor } from "../../server/projects/actor";
import {
  decodeCommentCursor,
  decodeNotificationCursor,
  encodeEngagementCursor,
} from "../../server/engagement/cursor";
import { EngagementError } from "../../server/engagement/errors";
import {
  buildEngagementNotificationOutboxRecord,
  canActorDeleteComment,
  canViewerAccessUpdate,
  ENGAGEMENT_NOTIFICATION_OUTBOX_PAYLOAD,
  type UpdateAccessFacts,
} from "../../server/engagement/repository";
import { EngagementService } from "../../server/engagement/service";
import type {
  CreateCommentCommand,
  DeleteCommentCommand,
  EngagementRepository,
  NotificationListStatus,
  ReactionCommand,
} from "../../server/engagement/types";
import type { CommentCursor, NotificationCursor } from "../../server/engagement/cursor";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_ID = "00000000-0000-4000-8000-000000000003";
const PROJECT_ID = "00000000-0000-4000-8000-000000000101";
const UPDATE_ID = "00000000-0000-4000-8000-000000000201";
const OTHER_UPDATE_ID = "00000000-0000-4000-8000-000000000202";
const COMMENT_ID = "00000000-0000-4000-8000-000000000301";
const SECOND_COMMENT_ID = "00000000-0000-4000-8000-000000000302";
const THIRD_COMMENT_ID = "00000000-0000-4000-8000-000000000303";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000401";
const BLIND_INDEX = new PrivacyBlindIndex(Buffer.alloc(32, 15).toString("base64"));
const SECOND_NOTIFICATION_ID = "00000000-0000-4000-8000-000000000402";
const THIRD_NOTIFICATION_ID = "00000000-0000-4000-8000-000000000403";
const REACTION_ID = "00000000-0000-4000-8000-000000000501";

const ACTOR: ProjectActor = { kind: "authenticated", appUserId: ACTOR_ID };
const NOW = new Date("2026-08-04T12:00:00.000Z");

function comment(
  id: string,
  createdAt: string,
  overrides: Partial<EngagementComment> = {},
): EngagementComment {
  return {
    id,
    projectId: PROJECT_ID,
    updateId: UPDATE_ID,
    parentCommentId: null,
    author: {
      id: OWNER_ID,
      displayName: "Ada Bouwer",
      slug: "ada-bouwer",
      avatar: null,
    },
    body: "Mooi resultaat.",
    mentionCount: 0,
    version: 1,
    canDelete: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function notification(
  id: string,
  createdAt: string,
  overrides: Partial<EngagementNotification> = {},
): EngagementNotification {
  return {
    id,
    type: "comment.created",
    status: "unread",
    actor: {
      id: OWNER_ID,
      displayName: "Ada Bouwer",
      slug: "ada-bouwer",
      avatar: null,
    },
    projectId: PROJECT_ID,
    updateId: UPDATE_ID,
    commentId: COMMENT_ID,
    orderId: null,
    readAt: null,
    createdAt,
    ...overrides,
  };
}

class TestEngagementRepository implements EngagementRepository {
  commentsResult: EngagementComment[] | null = [];
  notificationResult: EngagementNotification[] = [];
  notificationUnreadCount = 0;
  commentCalls: Array<{
    viewer: ProjectActor;
    cursor: CommentCursor | undefined;
    limit: number;
  }> = [];
  notificationCalls: Array<{
    recipientId: string;
    cursor: NotificationCursor | undefined;
    limit: number;
    status: NotificationListStatus;
  }> = [];
  createCommands: CreateCommentCommand[] = [];
  deleteCommands: DeleteCommentCommand[] = [];
  reactionCommands: ReactionCommand[] = [];
  notificationUpdates: Array<{
    recipientId: string;
    notificationId: string;
    action: "read" | "archive";
  }> = [];
  notificationMarkAllCalls: Array<{ recipientId: string; now: Date }> = [];
  private readonly idempotency = new Map<string, { hash: string; id: string }>();

  async listComments(
    viewer: ProjectActor,
    _projectId: string,
    _updateId: string,
    cursor: CommentCursor | undefined,
    limit: number,
  ) {
    this.commentCalls.push({ viewer, cursor, limit });
    return this.commentsResult;
  }

  async createComment(command: CreateCommentCommand) {
    this.createCommands.push(command);
    const existing = this.idempotency.get(command.idempotencyKey);
    if (existing) {
      if (existing.hash !== command.requestHash) {
        throw new EngagementError("IDEMPOTENCY_CONFLICT");
      }
      return { commentId: existing.id, replayed: true };
    }
    this.idempotency.set(command.idempotencyKey, {
      hash: command.requestHash,
      id: command.commentId,
    });
    return { commentId: command.commentId, replayed: false };
  }

  async deleteComment(command: DeleteCommentCommand) {
    this.deleteCommands.push(command);
    return { commentId: command.commentId, replayed: false };
  }

  async reactionSummary(
    _viewer: ProjectActor,
    projectId: string,
    updateId: string,
    commentId: string | null,
  ) {
    return {
      projectId,
      updateId,
      target: commentId ? "comment" as const : "update" as const,
      commentId,
      items: [{ emoji: "👍" as const, count: 2, viewerReacted: true }],
    };
  }

  async addReaction(command: ReactionCommand) {
    this.reactionCommands.push(command);
    return { reactionId: REACTION_ID, state: "active" as const, replayed: false };
  }

  async removeReaction(command: ReactionCommand) {
    this.reactionCommands.push(command);
    return { reactionId: null, state: "removed" as const, replayed: true };
  }

  async listNotifications(
    recipientId: string,
    cursor: NotificationCursor | undefined,
    limit: number,
    status: NotificationListStatus,
  ) {
    this.notificationCalls.push({ recipientId, cursor, limit, status });
    return {
      items: this.notificationResult,
      unreadCount: this.notificationUnreadCount,
    };
  }

  async updateNotification(
    recipientId: string,
    notificationId: string,
    action: "read" | "archive",
  ) {
    this.notificationUpdates.push({ recipientId, notificationId, action });
    return {
      notificationId,
      status: action === "read" ? "read" as const : "archived" as const,
      replayed: false,
    };
  }

  async markAllNotificationsRead(recipientId: string, now: Date) {
    this.notificationMarkAllCalls.push({ recipientId, now });
    const updatedCount = this.notificationUnreadCount;
    this.notificationUnreadCount = 0;
    return { updatedCount, unreadCount: 0 };
  }
}

function serviceWith(repository = new TestEngagementRepository()) {
  let nextId = 0;
  const ids = [COMMENT_ID, SECOND_COMMENT_ID, THIRD_COMMENT_ID];
  return {
    repository,
    service: new EngagementService(
      repository,
      BLIND_INDEX,
      () => NOW,
      () => ids[nextId++] ?? THIRD_COMMENT_ID,
    ),
  };
}

describe("engagement access policy", () => {
  const visiblePublic: UpdateAccessFacts = {
    profileFollower: false,
    blocked: false,
    lifecycleStatus: "active",
    ownerId: OWNER_ID,
    updateStatus: "published",
    visibility: "public",
  };

  it.each([
    ["anonymous published public", ANONYMOUS_PROJECT_ACTOR, visiblePublic, true],
    ["anonymous draft", ANONYMOUS_PROJECT_ACTOR, { ...visiblePublic, updateStatus: "draft" }, false],
    ["anonymous unlisted UUID only", ANONYMOUS_PROJECT_ACTOR, { ...visiblePublic, visibility: "unlisted" }, false],
    ["anonymous unlisted grant", { kind: "anonymous", shareLinkId: UPDATE_ID }, { ...visiblePublic, visibility: "unlisted" }, true],
    ["anonymous followers-only", ANONYMOUS_PROJECT_ACTOR, { ...visiblePublic, visibility: "followers", profileFollower: true }, false],
    ["authenticated public", ACTOR, visiblePublic, true],
    ["authenticated unlisted UUID only", ACTOR, { ...visiblePublic, visibility: "unlisted" }, false],
    ["authenticated unlisted grant", { ...ACTOR, shareLinkId: UPDATE_ID }, { ...visiblePublic, visibility: "unlisted" }, true],
    ["active profile follower", ACTOR, { ...visiblePublic, visibility: "followers", profileFollower: true }, true],
    ["non-follower", ACTOR, { ...visiblePublic, visibility: "followers" }, false],
    ["private despite following", ACTOR, { ...visiblePublic, visibility: "private", profileFollower: true }, false],
    ["owner draft", { kind: "authenticated", appUserId: OWNER_ID }, { ...visiblePublic, updateStatus: "draft" }, true],
    ["blocked public", ACTOR, { ...visiblePublic, blocked: true }, false],
    ["deleted update", ACTOR, { ...visiblePublic, updateStatus: "deleted" }, false],
    ["inactive project", ACTOR, { ...visiblePublic, lifecycleStatus: "deletion_pending" }, false],
  ] as const)("handles %s", (_label, viewer, facts, expected) => {
    expect(canViewerAccessUpdate(viewer, facts)).toBe(expected);
  });

  it("allows only the comment author or project owner to delete", () => {
    expect(canActorDeleteComment(ACTOR_ID, ACTOR_ID, OWNER_ID)).toBe(true);
    expect(canActorDeleteComment(OWNER_ID, ACTOR_ID, OWNER_ID)).toBe(true);
    expect(canActorDeleteComment(OTHER_ID, ACTOR_ID, OWNER_ID)).toBe(false);
  });
});

describe("engagement contracts and service", () => {
  it("trims bounded comment text and rejects duplicate mentions and unknown fields", () => {
    expect(createCommentInputSchema.parse({
      idempotencyKey: "comment-create-key-0001",
      body: "  Netjes!  ",
    }).body).toBe("Netjes!");
    expect(() => createCommentInputSchema.parse({
      idempotencyKey: "comment-create-key-0001",
      body: "Netjes!",
      mentionUserIds: [OTHER_ID, OTHER_ID.toUpperCase()],
    })).toThrow();
    expect(() => createCommentInputSchema.parse({
      idempotencyKey: "comment-create-key-0001",
      body: "Netjes!",
      recipientId: OTHER_ID,
    })).toThrow();
    expect(() => reactionTargetInputSchema.parse({ target: "comment", emoji: "👍" }))
      .toThrow();
  });

  it("paginates comments with a cursor scoped to one update", async () => {
    const { repository, service } = serviceWith();
    repository.commentsResult = [
      comment(COMMENT_ID, "2026-08-04T10:00:00.000Z"),
      comment(SECOND_COMMENT_ID, "2026-08-04T10:01:00.000Z"),
      comment(THIRD_COMMENT_ID, "2026-08-04T10:02:00.000Z"),
    ];
    const page = await service.comments(ACTOR, PROJECT_ID, UPDATE_ID, { limit: "2" });

    expect(page.items.map((item) => item.id)).toEqual([COMMENT_ID, SECOND_COMMENT_ID]);
    expect(repository.commentCalls[0]).toMatchObject({ viewer: ACTOR, limit: 3 });
    expect(decodeCommentCursor(page.nextCursor ?? undefined, UPDATE_ID)).toMatchObject({
      id: SECOND_COMMENT_ID,
      updateId: UPDATE_ID,
    });
    expect(() => decodeCommentCursor(page.nextCursor ?? undefined, OTHER_UPDATE_ID))
      .toThrowError(EngagementError);
  });

  it("conceals an inaccessible update with the same not-found error", async () => {
    const { repository, service } = serviceWith();
    repository.commentsResult = null;
    await expect(service.comments(ANONYMOUS_PROJECT_ACTOR, PROJECT_ID, UPDATE_ID, {}))
      .rejects.toMatchObject({ reason: "CONTENT_NOT_FOUND", status: 404 });
  });

  it("scopes create idempotency to actor/update and detects a changed retry", async () => {
    const { repository, service } = serviceWith();
    const input = {
      idempotencyKey: "comment-create-key-0001",
      body: "Eerste reactie",
      mentionUserIds: [OTHER_ID],
    };
    const first = await service.createComment(ACTOR_ID, PROJECT_ID, UPDATE_ID, input);
    const replay = await service.createComment(ACTOR_ID, PROJECT_ID, UPDATE_ID, input);

    expect(first).toEqual({ commentId: COMMENT_ID, replayed: false });
    expect(replay).toEqual({ commentId: COMMENT_ID, replayed: true });
    expect(repository.createCommands[0]).toMatchObject({
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      updateId: UPDATE_ID,
      now: NOW,
      input: { body: "Eerste reactie", mentionUserIds: [OTHER_ID] },
    });
    expect(repository.createCommands[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repository.createCommands[0]?.idempotencyKey).toMatch(
      /^engagement-command:v1:comment\.create:[0-9a-f]{64}$/,
    );
    await expect(service.createComment(ACTOR_ID, PROJECT_ID, UPDATE_ID, {
      ...input,
      body: "Gewijzigde retry",
    })).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });
  });

  it("passes no client identity or target shape outside the discriminated reaction", async () => {
    const { repository, service } = serviceWith();
    await service.addReaction(ACTOR_ID, PROJECT_ID, UPDATE_ID, {
      target: "comment",
      commentId: COMMENT_ID.toUpperCase(),
      emoji: "❤️",
    });
    expect(repository.reactionCommands[0]).toMatchObject({
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      updateId: UPDATE_ID,
      input: { target: "comment", commentId: COMMENT_ID, emoji: "❤️" },
    });
    await expect(service.addReaction(ACTOR_ID, PROJECT_ID, UPDATE_ID, {
      target: "update",
      commentId: COMMENT_ID,
      emoji: "❤️",
      actorId: OTHER_ID,
    })).rejects.toThrow();
  });

  it("binds notification cursors to their status filter and trusted recipient", async () => {
    const { repository, service } = serviceWith();
    repository.notificationUnreadCount = 7;
    repository.notificationResult = [
      notification(NOTIFICATION_ID, "2026-08-04T12:03:00.000Z"),
      notification(SECOND_NOTIFICATION_ID, "2026-08-04T12:02:00.000Z"),
      notification(THIRD_NOTIFICATION_ID, "2026-08-04T12:01:00.000Z"),
    ];
    const page = await service.notifications(ACTOR_ID, { limit: 2, status: "unread" });

    expect(page.items).toHaveLength(2);
    expect(page.unreadCount).toBe(7);
    expect(repository.notificationCalls[0]).toMatchObject({
      recipientId: ACTOR_ID,
      limit: 3,
      status: "unread",
    });
    expect(decodeNotificationCursor(page.nextCursor ?? undefined, "unread"))
      .toMatchObject({ id: SECOND_NOTIFICATION_ID, status: "unread" });
    expect(() => decodeNotificationCursor(page.nextCursor ?? undefined, "read"))
      .toThrowError(EngagementError);
  });

  it("updates only the trusted recipient notification and validates its action", async () => {
    const { repository, service } = serviceWith();
    await expect(service.updateNotification(ACTOR_ID, NOTIFICATION_ID, {
      action: "archive",
      recipientId: OTHER_ID,
    })).rejects.toThrow();

    await expect(service.updateNotification(ACTOR_ID, NOTIFICATION_ID, {
      action: "archive",
    })).resolves.toEqual({
      notificationId: NOTIFICATION_ID,
      status: "archived",
      replayed: false,
    });
    expect(repository.notificationUpdates).toEqual([{
      recipientId: ACTOR_ID,
      notificationId: NOTIFICATION_ID,
      action: "archive",
    }]);
  });

  it("marks every canonical unread notification through the trusted recipient boundary", async () => {
    const { repository, service } = serviceWith();
    repository.notificationUnreadCount = 23;

    await expect(service.markAllNotificationsRead(ACTOR_ID, {
      action: "read_all",
      recipientId: OTHER_ID,
    })).rejects.toThrow();
    await expect(service.markAllNotificationsRead(ACTOR_ID, {
      action: "read_all",
    })).resolves.toEqual({ updatedCount: 23, unreadCount: 0 });
    expect(repository.notificationMarkAllCalls).toEqual([{
      recipientId: ACTOR_ID,
      now: NOW,
    }]);
  });

  it("keeps raw payloads and private project fields outside public DTOs and outbox", () => {
    const commentKeys = Object.keys(engagementCommentSchema.shape).join(" ");
    const notificationKeys = Object.keys(engagementNotificationSchema.shape).join(" ");
    expect(notificationKeys).toContain("orderId");
    expect(`${commentKeys} ${notificationKeys}`).not.toMatch(
      /payload|address|postal|budget|contractor|signedUrl|objectKey|mentionUserIds/i,
    );

    const record = buildEngagementNotificationOutboxRecord(NOTIFICATION_ID);
    expect(record).toEqual({
      aggregateId: NOTIFICATION_ID,
      aggregateType: "notification",
      eventType: "engagement.notification.created.v1",
      idempotencyKey: `engagement-notification:${NOTIFICATION_ID}`,
      payload: { schemaVersion: 1 },
    });
    expect(Object.keys(ENGAGEMENT_NOTIFICATION_OUTBOX_PAYLOAD)).toEqual(["schemaVersion"]);
  });

  it("rejects cursor kind tampering", () => {
    const cursor = encodeEngagementCursor({
      version: 1,
      kind: "notifications",
      status: "all",
      timestamp: NOW.toISOString(),
      id: NOTIFICATION_ID,
    });
    expect(() => decodeCommentCursor(cursor, UPDATE_ID)).toThrowError(EngagementError);
  });
});

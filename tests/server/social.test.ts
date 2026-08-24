// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  SocialMutationResult,
  SocialProfile,
} from "../../shared/contracts/social";
import { socialProfileSchema } from "../../shared/contracts/social";
import { SocialError } from "../../server/social/errors";
import {
  buildSocialNotificationOutboxRecord,
  SOCIAL_NOTIFICATION_OUTBOX_PAYLOAD,
} from "../../server/social/repository";
import { SocialService } from "../../server/social/service";
import type {
  ProfileListRecord,
  ProfileSearch,
  ConnectionListRecord,
  ConnectionListSearch,
  SocialRepository,
  SocialViewerId,
} from "../../server/social/types";

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  publicUser: "00000000-0000-4000-8000-000000000002",
  privateUser: "00000000-0000-4000-8000-000000000003",
  unrelated: "00000000-0000-4000-8000-000000000004",
  notification: "00000000-0000-4000-8000-000000000201",
} as const;

type FollowStatus = "active" | "pending" | "rejected" | "revoked";
type LegacyAccessStatus = "accepted" | "pending" | "revoked";

interface ProfileSeed {
  createdAt: string;
  displayName: string;
  isPrivate: boolean;
}

function pair(left: string, right: string): string {
  return [left, right].sort().join(":");
}

function directed(left: string, right: string): string {
  return `${left}:${right}`;
}

class MemorySocialRepository implements SocialRepository {
  readonly blocks = new Set<string>();
  readonly follows = new Map<string, FollowStatus>();
  readonly legacyAccesses = new Map<string, LegacyAccessStatus>();
  readonly legacyProjectFollowers = new Map<string, "active" | "revoked">();
  readonly notifications: string[] = [];
  readonly profiles = new Map<string, ProfileSeed>();
  connectionRows: ConnectionListRecord[] = [];
  lastConnectionSearch: ConnectionListSearch | undefined;

  constructor() {
    this.profiles.set(ids.owner, {
      createdAt: "2026-08-04T12:00:00.000Z",
      displayName: "Eigenaar",
      isPrivate: false,
    });
    this.profiles.set(ids.publicUser, {
      createdAt: "2026-08-03T12:00:00.000Z",
      displayName: "Open bouwer",
      isPrivate: false,
    });
    this.profiles.set(ids.privateUser, {
      createdAt: "2026-08-02T12:00:00.000Z",
      displayName: "Privé bouwer",
      isPrivate: true,
    });
    this.profiles.set(ids.unrelated, {
      createdAt: "2026-08-01T12:00:00.000Z",
      displayName: "Andere bouwer",
      isPrivate: false,
    });
  }

  private blocked(left: string | null, right: string): boolean {
    return Boolean(left && this.blocks.has(pair(left, right)));
  }

  private visible(viewerId: SocialViewerId, profileId: string): boolean {
    const profile = this.profiles.get(profileId);
    if (!profile || this.blocked(viewerId, profileId)) return false;
    return (
      !profile.isPrivate ||
      viewerId === profileId ||
      this.follows.get(directed(String(viewerId), profileId)) === "active"
    );
  }

  private mappedProfile(viewerId: SocialViewerId, profileId: string): ProfileListRecord | null {
    const seed = this.profiles.get(profileId);
    if (!seed || !this.visible(viewerId, profileId)) return null;
    const viewerFollow = viewerId
      ? this.follows.get(directed(viewerId, profileId))
      : undefined;
    const followerCount = [...this.follows].filter(
      ([key, status]) => key.endsWith(`:${profileId}`) && status === "active",
    ).length;
    const followingCount = [...this.follows].filter(
      ([key, status]) => key.startsWith(`${profileId}:`) && status === "active",
    ).length;
    return {
      avatar: null,
      bio: `Bio van ${seed.displayName}`,
      cursorTimestamp: seed.createdAt,
      displayName: seed.displayName,
      followerCount,
      followingCount,
      followsViewer: Boolean(
        viewerId && this.follows.get(directed(profileId, viewerId)) === "active",
      ),
      id: profileId,
      isPrivate: seed.isPrivate,
      isPro: false,
      location: null,
      slug: `profiel-${profileId.slice(-3)}`,
      viewerAccess:
        viewerId === profileId ? "owner" : seed.isPrivate ? "follower" : "public",
      viewerFollowStatus:
        viewerId === profileId
          ? "self"
          : viewerFollow === "active"
            ? "following"
            : viewerFollow === "pending"
              ? "pending"
              : "none",
    };
  }

  private requireProfile(profileId: string): ProfileSeed {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new SocialError("TARGET_NOT_FOUND");
    return profile;
  }

  private assertNotBlocked(left: string, right: string): void {
    if (this.blocked(left, right)) throw new SocialError("TARGET_NOT_FOUND");
  }

  private revokeLegacyProjectRelationships(followerId: string, ownerId: string): void {
    const key = directed(followerId, ownerId);
    if (this.legacyAccesses.has(key)) this.legacyAccesses.set(key, "revoked");
    if (this.legacyProjectFollowers.has(key)) {
      this.legacyProjectFollowers.set(key, "revoked");
    }
  }

  async findProfile(
    viewerId: SocialViewerId,
    profileId: string,
  ): Promise<SocialProfile | null> {
    const profile = this.mappedProfile(viewerId, profileId);
    if (!profile) return null;
    const { cursorTimestamp: _cursorTimestamp, ...result } = profile;
    return result;
  }

  async listConnections(
    _actorId: string,
    search: ConnectionListSearch,
  ): Promise<ConnectionListRecord[]> {
    this.lastConnectionSearch = search;
    return this.connectionRows.slice(0, search.limit);
  }

  async searchProfiles(
    viewerId: SocialViewerId,
    search: ProfileSearch,
  ): Promise<ProfileListRecord[]> {
    return [...this.profiles.keys()]
      .map((profileId): ProfileListRecord | null => {
        const visible = this.mappedProfile(viewerId, profileId);
        if (visible) return visible;
        const seed = this.profiles.get(profileId);
        if (!viewerId || !search.normalizedQuery || !seed || this.blocked(viewerId, profileId)) {
          return null;
        }
        return {
          avatar: null,
          bio: null,
          cursorTimestamp: seed.createdAt,
          displayName: seed.displayName,
          followerCount: 0,
          followingCount: 0,
          followsViewer: false,
          id: profileId,
          isPrivate: seed.isPrivate,
          isPro: false,
          location: null,
          slug: `profiel-${profileId.slice(-3)}`,
          viewerAccess: "requestable",
          viewerFollowStatus:
            this.follows.get(directed(viewerId, profileId)) === "pending" ? "pending" : "none",
        };
      })
      .filter((profile): profile is ProfileListRecord => Boolean(profile))
      .filter((profile) =>
        search.normalizedQuery
          ? profile.displayName.toLowerCase().includes(search.normalizedQuery) ||
            profile.slug.includes(search.normalizedQuery)
          : true,
      )
      .filter((profile) =>
        search.cursor
          ? profile.cursorTimestamp < search.cursor.timestamp ||
            (profile.cursorTimestamp === search.cursor.timestamp &&
              profile.id < search.cursor.id)
          : true,
      )
      .sort((left, right) =>
        right.cursorTimestamp.localeCompare(left.cursorTimestamp) ||
        right.id.localeCompare(left.id),
      )
      .slice(0, search.limit);
  }

  async followProfile(actorId: string, profileId: string): Promise<SocialMutationResult> {
    const target = this.requireProfile(profileId);
    this.assertNotBlocked(actorId, profileId);
    const key = directed(actorId, profileId);
    const current = this.follows.get(key);
    if (current === "active") return { replayed: true, state: "following" };
    const desired = target.isPrivate ? "pending" : "active";
    if (current === desired) {
      return { replayed: true, state: desired === "pending" ? "pending" : "following" };
    }
    this.follows.set(key, desired);
    this.notifications.push(desired === "pending" ? "profile.follow.requested" : "profile.followed");
    return { replayed: false, state: desired === "pending" ? "pending" : "following" };
  }

  async removeProfileFollow(actorId: string, profileId: string): Promise<SocialMutationResult> {
    const key = directed(actorId, profileId);
    const current = this.follows.get(key);
    this.revokeLegacyProjectRelationships(actorId, profileId);
    if (!current || current === "rejected" || current === "revoked") {
      return { replayed: true, state: "none" };
    }
    this.follows.set(key, "revoked");
    return { replayed: false, state: current === "pending" ? "cancelled" : "none" };
  }

  async acceptProfileFollow(actorId: string, requesterId: string): Promise<SocialMutationResult> {
    return this.decideFollow(actorId, requesterId, "active");
  }

  async rejectProfileFollow(actorId: string, requesterId: string): Promise<SocialMutationResult> {
    return this.decideFollow(actorId, requesterId, "rejected");
  }

  private async decideFollow(
    actorId: string,
    requesterId: string,
    decision: "active" | "rejected",
  ): Promise<SocialMutationResult> {
    this.assertNotBlocked(actorId, requesterId);
    const key = directed(requesterId, actorId);
    const current = this.follows.get(key);
    if (current === decision) {
      if (decision === "rejected") {
        this.revokeLegacyProjectRelationships(requesterId, actorId);
      }
      return { replayed: true, state: decision === "active" ? "following" : "rejected" };
    }
    if (current !== "pending") throw new SocialError("TARGET_NOT_FOUND");
    this.follows.set(key, decision);
    if (decision === "rejected") {
      this.revokeLegacyProjectRelationships(requesterId, actorId);
    }
    this.notifications.push(
      decision === "active" ? "profile.follow.accepted" : "profile.follow.rejected",
    );
    return { replayed: false, state: decision === "active" ? "following" : "rejected" };
  }

  async revokeProfileFollower(actorId: string, followerId: string): Promise<SocialMutationResult> {
    const key = directed(followerId, actorId);
    const current = this.follows.get(key);
    if (current === "revoked") {
      this.revokeLegacyProjectRelationships(followerId, actorId);
      return { replayed: true, state: "revoked" };
    }
    if (current !== "active") throw new SocialError("TARGET_NOT_FOUND");
    this.follows.set(key, "revoked");
    this.revokeLegacyProjectRelationships(followerId, actorId);
    return { replayed: false, state: "revoked" };
  }

  async blockProfile(actorId: string, profileId: string): Promise<SocialMutationResult> {
    this.requireProfile(profileId);
    const replayed = this.blocks.has(pair(actorId, profileId));
    this.blocks.add(pair(actorId, profileId));
    this.follows.set(directed(actorId, profileId), "revoked");
    this.follows.set(directed(profileId, actorId), "revoked");
    this.revokeLegacyProjectRelationships(actorId, profileId);
    this.revokeLegacyProjectRelationships(profileId, actorId);
    return { replayed, state: "blocked" };
  }

  async unblockProfile(actorId: string, profileId: string): Promise<SocialMutationResult> {
    const key = pair(actorId, profileId);
    const replayed = !this.blocks.has(key);
    this.blocks.delete(key);
    return { replayed, state: "unblocked" };
  }

}

function serviceWith(repository = new MemorySocialRepository()) {
  return {
    repository,
    service: new SocialService(repository, () => new Date("2026-08-04T12:00:00.000Z")),
  };
}

describe("social privacy service", () => {
  it("shows public profiles anonymously but hides private, unrelated and blocked profiles identically", async () => {
    const { repository, service } = serviceWith();

    await expect(service.profile(null, ids.publicUser)).resolves.toMatchObject({
      id: ids.publicUser,
      viewerAccess: "public",
    });
    await expect(service.profile(null, ids.privateUser)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
      status: 404,
    });
    await expect(service.profile(ids.unrelated, ids.privateUser)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
      status: 404,
    });

    repository.follows.set(directed(ids.unrelated, ids.privateUser), "pending");
    await expect(service.profile(ids.unrelated, ids.privateUser)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
      status: 404,
    });
    repository.follows.set(directed(ids.unrelated, ids.privateUser), "active");
    await expect(service.profile(ids.unrelated, ids.privateUser)).resolves.toMatchObject({
      viewerAccess: "follower",
      viewerFollowStatus: "following",
    });
    await expect(service.profile(ids.privateUser, ids.privateUser)).resolves.toMatchObject({
      viewerAccess: "owner",
    });

    await service.blockProfile(ids.privateUser, ids.unrelated);
    await expect(service.profile(ids.unrelated, ids.privateUser)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
      status: 404,
    });
  });

  it("lets authenticated users find a private identity without exposing private details", async () => {
    const { repository, service } = serviceWith();

    const anonymous = await service.search(null, { q: "privé", limit: "10" });
    expect(anonymous.items).toEqual([]);

    const result = await service.search(ids.unrelated, { q: "privé", limit: "10" });
    expect(result.items).toEqual([
      expect.objectContaining({
        avatar: null,
        bio: null,
        followerCount: 0,
        followingCount: 0,
        id: ids.privateUser,
        location: null,
        viewerAccess: "requestable",
        viewerFollowStatus: "none",
      }),
    ]);

    repository.blocks.add(pair(ids.unrelated, ids.privateUser));
    await expect(service.search(ids.unrelated, { q: "privé", limit: "10" }))
      .resolves.toMatchObject({ items: [] });
  });

  it("makes public follows and private requests idempotent under concurrent replay", async () => {
    const { repository, service } = serviceWith();

    const publicResults = await Promise.all([
      service.followProfile(ids.unrelated, ids.publicUser),
      service.followProfile(ids.unrelated, ids.publicUser),
    ]);
    expect(publicResults).toContainEqual({ replayed: false, state: "following" });
    expect(publicResults).toContainEqual({ replayed: true, state: "following" });
    expect(repository.notifications.filter((type) => type === "profile.followed")).toHaveLength(1);

    const request = await service.followProfile(ids.unrelated, ids.privateUser);
    expect(request).toEqual({ replayed: false, state: "pending" });
    await expect(service.profile(ids.unrelated, ids.privateUser)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
    expect(await service.acceptProfileFollow(ids.privateUser, ids.unrelated)).toEqual({
      replayed: false,
      state: "following",
    });
    expect(await service.acceptProfileFollow(ids.privateUser, ids.unrelated)).toEqual({
      replayed: true,
      state: "following",
    });
    await expect(service.profile(ids.unrelated, ids.privateUser)).resolves.toMatchObject({
      id: ids.privateUser,
    });
  });

  it("supports reject, cancel and owner revoke without accepting stale transitions", async () => {
    const { service } = serviceWith();

    await service.followProfile(ids.unrelated, ids.privateUser);
    expect(await service.removeProfileFollow(ids.unrelated, ids.privateUser)).toEqual({
      replayed: false,
      state: "cancelled",
    });
    await expect(
      service.acceptProfileFollow(ids.privateUser, ids.unrelated),
    ).rejects.toMatchObject({ reason: "TARGET_NOT_FOUND" });

    await service.followProfile(ids.unrelated, ids.privateUser);
    expect(await service.rejectProfileFollow(ids.privateUser, ids.unrelated)).toEqual({
      replayed: false,
      state: "rejected",
    });
    await service.followProfile(ids.unrelated, ids.privateUser);
    await service.acceptProfileFollow(ids.privateUser, ids.unrelated);
    expect(await service.revokeProfileFollower(ids.privateUser, ids.unrelated)).toEqual({
      replayed: false,
      state: "revoked",
    });
  });

  it("revokes historical project rows when a profile-follow privacy boundary closes", async () => {
    const { repository, service } = serviceWith();
    const legacyKey = directed(ids.unrelated, ids.owner);

    repository.legacyAccesses.set(legacyKey, "accepted");
    repository.legacyProjectFollowers.set(legacyKey, "active");
    expect(await service.removeProfileFollow(ids.unrelated, ids.owner)).toEqual({
      replayed: true,
      state: "none",
    });
    expect(repository.legacyAccesses.get(legacyKey)).toBe("revoked");
    expect(repository.legacyProjectFollowers.get(legacyKey)).toBe("revoked");

    repository.follows.set(legacyKey, "pending");
    repository.legacyAccesses.set(legacyKey, "pending");
    repository.legacyProjectFollowers.set(legacyKey, "active");
    await service.rejectProfileFollow(ids.owner, ids.unrelated);
    expect(repository.legacyAccesses.get(legacyKey)).toBe("revoked");
    expect(repository.legacyProjectFollowers.get(legacyKey)).toBe("revoked");

    repository.follows.set(legacyKey, "active");
    repository.legacyAccesses.set(legacyKey, "accepted");
    repository.legacyProjectFollowers.set(legacyKey, "active");
    await service.revokeProfileFollower(ids.owner, ids.unrelated);
    expect(repository.legacyAccesses.get(legacyKey)).toBe("revoked");
    expect(repository.legacyProjectFollowers.get(legacyKey)).toBe("revoked");
  });

  it("enforces blocks in both directions and never restores prior rights on unblock", async () => {
    const { repository, service } = serviceWith();
    repository.follows.set(directed(ids.owner, ids.unrelated), "active");
    repository.follows.set(directed(ids.unrelated, ids.owner), "active");
    repository.legacyAccesses.set(directed(ids.owner, ids.unrelated), "pending");
    repository.legacyAccesses.set(directed(ids.unrelated, ids.owner), "accepted");
    repository.legacyProjectFollowers.set(directed(ids.owner, ids.unrelated), "active");
    repository.legacyProjectFollowers.set(directed(ids.unrelated, ids.owner), "active");

    expect(await service.blockProfile(ids.owner, ids.unrelated)).toEqual({
      replayed: false,
      state: "blocked",
    });
    expect(await service.blockProfile(ids.owner, ids.unrelated)).toEqual({
      replayed: true,
      state: "blocked",
    });
    await expect(service.profile(ids.owner, ids.unrelated)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
    await expect(service.profile(ids.unrelated, ids.owner)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
    expect(repository.follows.get(directed(ids.owner, ids.unrelated))).toBe("revoked");
    expect(repository.follows.get(directed(ids.unrelated, ids.owner))).toBe("revoked");
    expect([...repository.legacyAccesses.values()]).toEqual(["revoked", "revoked"]);
    expect([...repository.legacyProjectFollowers.values()]).toEqual([
      "revoked",
      "revoked",
    ]);

    await service.unblockProfile(ids.owner, ids.unrelated);
    expect(repository.follows.get(directed(ids.unrelated, ids.owner))).toBe("revoked");
    expect([...repository.legacyAccesses.values()]).toEqual(["revoked", "revoked"]);
  });

  it("forbids self-actions and binds profile cursors to the normalized search", async () => {
    const { service } = serviceWith();
    await expect(service.followProfile(ids.owner, ids.owner)).rejects.toMatchObject({
      reason: "SELF_ACTION",
    });

    const first = await service.search(null, { limit: "2" });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(
      service.search(null, { cursor: first.nextCursor, limit: "2", q: "anders" }),
    ).rejects.toMatchObject({ reason: "INVALID_CURSOR" });
  });

  it("paginates canonical connection views and binds cursors to one view", async () => {
    const { repository, service } = serviceWith();
    repository.connectionRows = [ids.publicUser, ids.privateUser, ids.unrelated].map(
      (id, index): ConnectionListRecord => ({
        avatar: null,
        cursorTimestamp: `2026-08-0${4 - index}T12:00:00.000Z`,
        displayName: `Bouwer ${index + 1}`,
        followsViewer: false,
        id,
        isPrivate: index === 1,
        relationshipAt: `2026-08-0${4 - index}T12:00:00.000Z`,
        slug: `bouwer-${index + 1}`,
        totalCount: 3,
        viewerFollowStatus: "following",
      }),
    );

    const first = await service.connections(ids.owner, {
      limit: "2",
      view: "following",
    });
    expect(first).toMatchObject({
      items: [{ id: ids.publicUser }, { id: ids.privateUser }],
      total: 3,
      view: "following",
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(repository.lastConnectionSearch).toMatchObject({
      limit: 3,
      view: "following",
    });

    await expect(service.connections(ids.owner, {
      cursor: first.nextCursor,
      view: "blocked",
    })).rejects.toMatchObject({ reason: "INVALID_CURSOR" });
  });

  it("puts no identity or profile data in the social notification outbox payload", () => {
    const record = buildSocialNotificationOutboxRecord(ids.notification);
    expect(record).toEqual({
      aggregateId: ids.notification,
      aggregateType: "notification",
      eventType: "social.notification.created.v1",
      idempotencyKey: `social-notification:${ids.notification}`,
      payload: { schemaVersion: 1 },
    });
    expect(Object.keys(SOCIAL_NOTIFICATION_OUTBOX_PAYLOAD)).toEqual(["schemaVersion"]);
    expect(JSON.stringify(record.payload)).not.toMatch(/email|name|profile|actor|recipient/i);
  });

  it("keeps financial and private project fields outside every profile DTO", () => {
    const serializedShape = Object.keys(socialProfileSchema.shape).join(" ");
    expect(serializedShape).not.toMatch(
      /budget|address|postal|contractor|privateNotes|private_details/i,
    );
  });
});

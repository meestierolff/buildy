// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  ProjectAccessList,
  ProjectSocialState,
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
  SocialRepository,
  SocialViewerId,
} from "../../server/social/types";

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  publicUser: "00000000-0000-4000-8000-000000000002",
  privateUser: "00000000-0000-4000-8000-000000000003",
  unrelated: "00000000-0000-4000-8000-000000000004",
  project: "00000000-0000-4000-8000-000000000101",
  notification: "00000000-0000-4000-8000-000000000201",
} as const;

type FollowStatus = "active" | "pending" | "rejected" | "revoked";
type AccessStatus = "accepted" | "cancelled" | "pending" | "rejected" | "revoked";

interface ProfileSeed {
  createdAt: string;
  displayName: string;
  isPrivate: boolean;
}

interface ProjectSeed {
  ownerId: string;
  visibility: "private" | "public";
}

function pair(left: string, right: string): string {
  return [left, right].sort().join(":");
}

function directed(left: string, right: string): string {
  return `${left}:${right}`;
}

function projectKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

class MemorySocialRepository implements SocialRepository {
  readonly accesses = new Map<string, AccessStatus>();
  readonly blocks = new Set<string>();
  readonly follows = new Map<string, FollowStatus>();
  readonly notifications: string[] = [];
  readonly profiles = new Map<string, ProfileSeed>();
  readonly projectFollowers = new Map<string, "active" | "revoked">();
  readonly projects = new Map<string, ProjectSeed>();

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
    this.projects.set(ids.project, { ownerId: ids.owner, visibility: "private" });
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

  private requireProject(actorId: string, projectId: string): ProjectSeed {
    const project = this.projects.get(projectId);
    if (!project || project.ownerId === actorId) {
      throw new SocialError(project?.ownerId === actorId ? "SELF_ACTION" : "TARGET_NOT_FOUND");
    }
    this.assertNotBlocked(actorId, project.ownerId);
    return project;
  }

  private canViewProject(actorId: string, projectId: string, project: ProjectSeed): boolean {
    return (
      project.visibility === "public" ||
      this.accesses.get(projectKey(projectId, actorId)) === "accepted"
    );
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

  async getProjectState(actorId: string, projectId: string): Promise<ProjectSocialState | null> {
    const project = this.projects.get(projectId);
    if (!project || this.blocked(actorId, project.ownerId)) return null;
    if (project.ownerId === actorId) {
      return { projectId, viewerRole: "owner", followStatus: "none", accessStatus: "owner" };
    }
    const access = this.accesses.get(projectKey(projectId, actorId));
    return {
      projectId,
      viewerRole: "viewer",
      followStatus: this.projectFollowers.get(projectKey(projectId, actorId)) === "active"
        ? "following"
        : "none",
      accessStatus: project.visibility === "public"
        ? "not_required"
        : access === "pending" || access === "accepted" ? access : "none",
    };
  }

  async listProjectAccess(actorId: string, projectId: string): Promise<ProjectAccessList | null> {
    const project = this.projects.get(projectId);
    if (!project || project.ownerId !== actorId) return null;
    const items = [...this.accesses.entries()].flatMap(([key, status]) => {
      const [candidateProjectId, requesterId] = key.split(":");
      if (candidateProjectId !== projectId || (status !== "pending" && status !== "accepted")) return [];
      return [{
        requesterId,
        displayName: this.profiles.get(requesterId)?.displayName ?? "Buildy-gebruiker",
        avatar: null,
        status,
        requestedAt: "2026-08-04T10:00:00.000Z",
        updatedAt: "2026-08-04T10:00:00.000Z",
      }];
    });
    return { projectId, items };
  }

  async searchProfiles(
    viewerId: SocialViewerId,
    search: ProfileSearch,
  ): Promise<ProfileListRecord[]> {
    return [...this.profiles.keys()]
      .map((profileId) => this.mappedProfile(viewerId, profileId))
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
      return { replayed: true, state: decision === "active" ? "following" : "rejected" };
    }
    if (current !== "pending") throw new SocialError("TARGET_NOT_FOUND");
    this.follows.set(key, decision);
    this.notifications.push(
      decision === "active" ? "profile.follow.accepted" : "profile.follow.rejected",
    );
    return { replayed: false, state: decision === "active" ? "following" : "rejected" };
  }

  async revokeProfileFollower(actorId: string, followerId: string): Promise<SocialMutationResult> {
    const key = directed(followerId, actorId);
    const current = this.follows.get(key);
    if (current === "revoked") return { replayed: true, state: "revoked" };
    if (current !== "active") throw new SocialError("TARGET_NOT_FOUND");
    this.follows.set(key, "revoked");
    return { replayed: false, state: "revoked" };
  }

  async blockProfile(actorId: string, profileId: string): Promise<SocialMutationResult> {
    this.requireProfile(profileId);
    const replayed = this.blocks.has(pair(actorId, profileId));
    this.blocks.add(pair(actorId, profileId));
    this.follows.set(directed(actorId, profileId), "revoked");
    this.follows.set(directed(profileId, actorId), "revoked");
    for (const [projectId, project] of this.projects) {
      if (project.ownerId === actorId) {
        this.accesses.set(projectKey(projectId, profileId), "revoked");
        this.projectFollowers.set(projectKey(projectId, profileId), "revoked");
      }
      if (project.ownerId === profileId) {
        this.accesses.set(projectKey(projectId, actorId), "revoked");
        this.projectFollowers.set(projectKey(projectId, actorId), "revoked");
      }
    }
    return { replayed, state: "blocked" };
  }

  async unblockProfile(actorId: string, profileId: string): Promise<SocialMutationResult> {
    const key = pair(actorId, profileId);
    const replayed = !this.blocks.has(key);
    this.blocks.delete(key);
    return { replayed, state: "unblocked" };
  }

  async followProject(actorId: string, projectId: string): Promise<SocialMutationResult> {
    const project = this.requireProject(actorId, projectId);
    if (!this.canViewProject(actorId, projectId, project)) {
      throw new SocialError("TARGET_NOT_FOUND");
    }
    const key = projectKey(projectId, actorId);
    if (this.projectFollowers.get(key) === "active") {
      return { replayed: true, state: "following" };
    }
    this.projectFollowers.set(key, "active");
    this.notifications.push("project.followed");
    return { replayed: false, state: "following" };
  }

  async unfollowProject(actorId: string, projectId: string): Promise<SocialMutationResult> {
    this.requireProject(actorId, projectId);
    const key = projectKey(projectId, actorId);
    if (this.projectFollowers.get(key) !== "active") {
      return { replayed: true, state: "none" };
    }
    this.projectFollowers.set(key, "revoked");
    return { replayed: false, state: "none" };
  }

  async requestProjectAccess(actorId: string, projectId: string): Promise<SocialMutationResult> {
    const project = this.requireProject(actorId, projectId);
    if (project.visibility !== "private") throw new SocialError("TARGET_NOT_FOUND");
    const key = projectKey(projectId, actorId);
    const current = this.accesses.get(key);
    if (current === "pending" || current === "accepted") {
      return { replayed: true, state: current };
    }
    this.accesses.set(key, "pending");
    this.notifications.push("project.access.requested");
    return { replayed: false, state: "pending" };
  }

  async cancelProjectAccess(actorId: string, projectId: string): Promise<SocialMutationResult> {
    this.requireProject(actorId, projectId);
    const key = projectKey(projectId, actorId);
    const current = this.accesses.get(key);
    if (!current || current === "cancelled" || current === "rejected" || current === "revoked") {
      return { replayed: true, state: "cancelled" };
    }
    this.accesses.set(key, "cancelled");
    this.projectFollowers.set(key, "revoked");
    return { replayed: false, state: "cancelled" };
  }

  async acceptProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
  ): Promise<SocialMutationResult> {
    return this.decideAccess(actorId, projectId, requesterId, "accepted");
  }

  async rejectProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
  ): Promise<SocialMutationResult> {
    return this.decideAccess(actorId, projectId, requesterId, "rejected");
  }

  private async decideAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
    decision: "accepted" | "rejected",
  ): Promise<SocialMutationResult> {
    const project = this.projects.get(projectId);
    if (!project || project.ownerId !== actorId || project.visibility !== "private") {
      throw new SocialError("TARGET_NOT_FOUND");
    }
    this.assertNotBlocked(actorId, requesterId);
    const key = projectKey(projectId, requesterId);
    const current = this.accesses.get(key);
    if (current === decision) return { replayed: true, state: decision };
    if (current !== "pending") throw new SocialError("TARGET_NOT_FOUND");
    this.accesses.set(key, decision);
    this.notifications.push(`project.access.${decision}`);
    return { replayed: false, state: decision };
  }

  async revokeProjectAccess(
    actorId: string,
    projectId: string,
    requesterId: string,
  ): Promise<SocialMutationResult> {
    const project = this.projects.get(projectId);
    if (!project || project.ownerId !== actorId) throw new SocialError("TARGET_NOT_FOUND");
    const key = projectKey(projectId, requesterId);
    const current = this.accesses.get(key);
    if (current === "revoked") return { replayed: true, state: "revoked" };
    if (current !== "accepted") throw new SocialError("TARGET_NOT_FOUND");
    this.accesses.set(key, "revoked");
    this.projectFollowers.set(key, "revoked");
    return { replayed: false, state: "revoked" };
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

  it("keeps project followers separate and gates them on accepted private access", async () => {
    const { repository, service } = serviceWith();

    await expect(service.followProject(ids.unrelated, ids.project)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
    expect(await service.requestProjectAccess(ids.unrelated, ids.project)).toEqual({
      replayed: false,
      state: "pending",
    });
    await expect(service.followProject(ids.unrelated, ids.project)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
    expect(
      await service.acceptProjectAccess(ids.owner, ids.project, ids.unrelated),
    ).toEqual({ replayed: false, state: "accepted" });
    expect(await service.followProject(ids.unrelated, ids.project)).toEqual({
      replayed: false,
      state: "following",
    });
    expect(await service.followProject(ids.unrelated, ids.project)).toEqual({
      replayed: true,
      state: "following",
    });
    expect(repository.projectFollowers.get(projectKey(ids.project, ids.unrelated))).toBe(
      "active",
    );

    expect(
      await service.revokeProjectAccess(ids.owner, ids.project, ids.unrelated),
    ).toEqual({ replayed: false, state: "revoked" });
    expect(repository.projectFollowers.get(projectKey(ids.project, ids.unrelated))).toBe(
      "revoked",
    );
    await expect(service.followProject(ids.unrelated, ids.project)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
  });

  it("exposes only the actor's project relationship state and owner-scoped access list", async () => {
    const { repository, service } = serviceWith();

    await expect(service.projectState(ids.unrelated, ids.project)).resolves.toMatchObject({
      accessStatus: "none",
      followStatus: "none",
      viewerRole: "viewer",
    });
    await service.requestProjectAccess(ids.unrelated, ids.project);
    await expect(service.projectState(ids.unrelated, ids.project)).resolves.toMatchObject({
      accessStatus: "pending",
    });
    await expect(service.projectAccess(ids.owner, ids.project)).resolves.toMatchObject({
      projectId: ids.project,
      items: [{ requesterId: ids.unrelated, status: "pending" }],
    });
    await expect(service.projectAccess(ids.publicUser, ids.project)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
      status: 404,
    });

    repository.blocks.add(pair(ids.owner, ids.unrelated));
    await expect(service.projectState(ids.unrelated, ids.project)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
      status: 404,
    });
  });

  it("supports private-project request cancellation and owner rejection as distinct states", async () => {
    const { service } = serviceWith();

    await service.requestProjectAccess(ids.unrelated, ids.project);
    expect(await service.cancelProjectAccess(ids.unrelated, ids.project)).toEqual({
      replayed: false,
      state: "cancelled",
    });
    expect(await service.cancelProjectAccess(ids.unrelated, ids.project)).toEqual({
      replayed: true,
      state: "cancelled",
    });

    await service.requestProjectAccess(ids.unrelated, ids.project);
    expect(
      await service.rejectProjectAccess(ids.owner, ids.project, ids.unrelated),
    ).toEqual({ replayed: false, state: "rejected" });
    expect(
      await service.rejectProjectAccess(ids.owner, ids.project, ids.unrelated),
    ).toEqual({ replayed: true, state: "rejected" });
  });

  it("enforces blocks in both directions and never restores prior rights on unblock", async () => {
    const { repository, service } = serviceWith();
    repository.projects.set(ids.project, { ownerId: ids.owner, visibility: "private" });
    repository.follows.set(directed(ids.owner, ids.unrelated), "active");
    repository.follows.set(directed(ids.unrelated, ids.owner), "active");
    repository.accesses.set(projectKey(ids.project, ids.unrelated), "accepted");
    repository.projectFollowers.set(projectKey(ids.project, ids.unrelated), "active");

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
    await expect(service.requestProjectAccess(ids.unrelated, ids.project)).rejects.toMatchObject({
      reason: "TARGET_NOT_FOUND",
    });
    expect(repository.follows.get(directed(ids.owner, ids.unrelated))).toBe("revoked");
    expect(repository.follows.get(directed(ids.unrelated, ids.owner))).toBe("revoked");
    expect(repository.accesses.get(projectKey(ids.project, ids.unrelated))).toBe("revoked");
    expect(repository.projectFollowers.get(projectKey(ids.project, ids.unrelated))).toBe(
      "revoked",
    );

    await service.unblockProfile(ids.owner, ids.unrelated);
    expect(repository.follows.get(directed(ids.unrelated, ids.owner))).toBe("revoked");
    expect(repository.accesses.get(projectKey(ids.project, ids.unrelated))).toBe("revoked");
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

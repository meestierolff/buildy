// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type {
  FollowingActivity,
  ProjectCard,
  ProjectOverview,
  ProjectUpdate,
} from "../../shared/contracts/projects";
import type { BuildyDatabase } from "../../server/db/client";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";
import {
  ANONYMOUS_PROJECT_ACTOR,
  StrictMappedProjectActorResolver,
  type ProjectActor,
} from "../../server/projects/actor";
import { decodeProjectCursor, encodeProjectCursor } from "../../server/projects/cursor";
import { ProjectError } from "../../server/projects/errors";
import {
  projectRequestHash,
  scopedProjectIdempotencyKey,
} from "../../server/projects/idempotency";
import { canActorViewProject, PostgresProjectRepository } from "../../server/projects/repository";
import { ProjectService } from "../../server/projects/service";
import {
  STANDARD_PROJECT_PHASES,
  type CreateProjectCommand,
  type CreateProjectPhaseCommand,
  type CreateUpdateCommand,
  type DeleteProjectCommand,
  type DeleteUpdateCommand,
  type EditUpdateCommand,
  type MutationReference,
  type ProjectPrivateDetailsProtector,
  type ProjectDeletionMutation,
  type ProjectRepository,
  type UpdateProjectCommand,
} from "../../server/projects/types";
import type { DashboardCursor, DiscoveryCursor, TimelineCursor } from "../../server/projects/cursor";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const UPDATE_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_UPDATE_ID = "55555555-5555-4555-8555-555555555555";
const BLIND_INDEX = new PrivacyBlindIndex(Buffer.alloc(32, 11).toString("base64"));
const OTHER_BLIND_INDEX = new PrivacyBlindIndex(Buffer.alloc(32, 12).toString("base64"));

function card(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: PROJECT_ID,
    slug: "keuken-project-3333333333",
    title: "Nieuwe keuken",
    description: "Van casco naar warm hout.",
    projectType: "Keuken",
    visibility: "private",
    progressPercentage: 15,
    version: 1,
    updatedAt: "2026-08-04T10:00:00.000Z",
    publishedAt: null,
    updateCount: 0,
    lastUpdateAt: null,
    owner: { id: ACTOR_ID, displayName: "Ada", slug: "ada" },
    cover: null,
    ...overrides,
  };
}

function overview(overrides: Partial<ProjectOverview> = {}): ProjectOverview {
  return {
    ...card(),
    startDate: "2026-08-01",
    expectedEndDate: "2026-12-01",
    contentRevision: 1,
    followerCount: 0,
    viewerAccess: "owner",
    canEdit: true,
    phases: STANDARD_PROJECT_PHASES.map((name, sortOrder) => ({
      id: `00000000-0000-4000-8000-${String(sortOrder + 1).padStart(12, "0")}`,
      name,
      sortOrder,
      isCustom: false,
    })),
    ...overrides,
  };
}

function update(overrides: Partial<ProjectUpdate> = {}): ProjectUpdate {
  return {
    id: UPDATE_ID,
    projectId: PROJECT_ID,
    phase: null,
    title: "Leidingen verlegd",
    room: "Keuken",
    description: "Water en elektra liggen op hun plek.",
    updateDate: "2026-08-04",
    status: "draft",
    isMilestone: false,
    sortOrder: 0,
    contentRevision: 1,
    version: 1,
    publishedAt: null,
    updatedAt: "2026-08-04T10:00:00.000Z",
    media: [],
    ...overrides,
  };
}

class FakeProjectRepository implements ProjectRepository {
  readonly createProjectCommands: CreateProjectCommand[] = [];
  readonly createUpdateCommands: CreateUpdateCommand[] = [];
  readonly editUpdateCommands: EditUpdateCommand[] = [];
  readonly deleteUpdateCommands: DeleteUpdateCommand[] = [];
  readonly deleteProjectCommands: DeleteProjectCommand[] = [];
  readonly createProjectPhaseCommands: CreateProjectPhaseCommand[] = [];
  readonly dashboardCalls: Array<{ actorId: string; cursor: DashboardCursor | undefined; limit: number }> = [];
  readonly idempotency = new Map<string, { id: string; requestHash: string }>();
  readonly projects = new Map<string, ProjectOverview>([[PROJECT_ID, overview()]]);
  readonly updates = new Map<string, ProjectUpdate>([[UPDATE_ID, update()]]);
  dashboardRows: ProjectCard[] = [];
  discoveryRows: ProjectCard[] = [];
  followingProjectRows: ProjectCard[] = [];
  followingActivityRows: FollowingActivity[] = [];
  timelineRows: ProjectUpdate[] | null = [];
  updateProjectError?: ProjectError;
  projectDeletionStatus: ProjectDeletionMutation["status"] = "deletion_pending";

  async createProject(command: CreateProjectCommand): Promise<MutationReference> {
    this.createProjectCommands.push(command);
    const replay = this.idempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new ProjectError("IDEMPOTENCY_CONFLICT");
      return { id: replay.id, replayed: true };
    }
    this.idempotency.set(command.idempotencyKey, { id: command.projectId, requestHash: command.requestHash });
    this.projects.set(command.projectId, overview({
      id: command.projectId,
      slug: command.slug,
      title: command.input.title,
      description: command.input.description ?? null,
      projectType: command.input.projectType ?? null,
      visibility: "private",
      owner: { id: command.ownerId, displayName: "Ada", slug: "ada" },
    }));
    return { id: command.projectId, replayed: false };
  }

  async updateProject(_command: UpdateProjectCommand): Promise<void> {
    if (this.updateProjectError) throw this.updateProjectError;
  }

  async requestProjectDeletion(command: DeleteProjectCommand): Promise<ProjectDeletionMutation> {
    this.deleteProjectCommands.push(command);
    return {
      jobId: "66666666-6666-4666-8666-666666666666",
      projectId: command.projectId,
      status: this.projectDeletionStatus,
      activeOrderCount: this.projectDeletionStatus === "blocked_active_order" ? 1 : 0,
      replayed: this.deleteProjectCommands.length > 1,
    };
  }

  async listDashboard(
    actorId: string,
    cursor: DashboardCursor | undefined,
    limit: number,
  ): Promise<ProjectCard[]> {
    this.dashboardCalls.push({ actorId, cursor, limit });
    return this.dashboardRows.slice(0, limit);
  }

  async listDiscovery(
    _viewer: ProjectActor,
    _cursor: DiscoveryCursor | undefined,
    limit: number,
  ): Promise<ProjectCard[]> {
    return this.discoveryRows.slice(0, limit);
  }

  async listFollowingProjects(_actorId: string, limit: number): Promise<ProjectCard[]> {
    return this.followingProjectRows.slice(0, limit);
  }

  async listFollowingActivity(_actorId: string, limit: number): Promise<FollowingActivity[]> {
    return this.followingActivityRows.slice(0, limit);
  }

  async getOverview(_viewer: ProjectActor, projectId: string): Promise<ProjectOverview | null> {
    return this.projects.get(projectId) ?? null;
  }

  async listTimeline(
    _viewer: ProjectActor,
    _projectId: string,
    _cursor: TimelineCursor | undefined,
    limit: number,
  ): Promise<ProjectUpdate[] | null> {
    return this.timelineRows?.slice(0, limit) ?? null;
  }

  async getUpdate(_viewer: ProjectActor, _projectId: string, updateId: string): Promise<ProjectUpdate | null> {
    return this.updates.get(updateId) ?? null;
  }

  async createUpdate(command: CreateUpdateCommand): Promise<MutationReference> {
    this.createUpdateCommands.push(command);
    const replay = this.idempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new ProjectError("IDEMPOTENCY_CONFLICT");
      return { id: replay.id, replayed: true };
    }
    this.idempotency.set(command.idempotencyKey, { id: command.updateId, requestHash: command.requestHash });
    this.updates.set(command.updateId, update({
      id: command.updateId,
      projectId: command.projectId,
      title: command.input.title ?? null,
      description: command.input.description ?? null,
      room: command.input.room ?? null,
      updateDate: command.input.updateDate,
      status: command.input.publish ? "published" : "draft",
      publishedAt: command.input.publish ? command.now.toISOString() : null,
    }));
    return { id: command.updateId, replayed: false };
  }

  async editUpdate(command: EditUpdateCommand): Promise<MutationReference> {
    this.editUpdateCommands.push(command);
    return { id: command.updateId, replayed: false };
  }

  async deleteUpdate(command: DeleteUpdateCommand): Promise<MutationReference> {
    this.deleteUpdateCommands.push(command);
    const replay = this.idempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new ProjectError("IDEMPOTENCY_CONFLICT");
      return { id: replay.id, replayed: true };
    }
    this.idempotency.set(command.idempotencyKey, {
      id: command.updateId,
      requestHash: command.requestHash,
    });
    this.updates.delete(command.updateId);
    const project = this.projects.get(command.projectId);
    if (project) {
      this.projects.set(command.projectId, {
        ...project,
        version: project.version + 1,
        contentRevision: project.contentRevision + 1,
      });
    }
    return { id: command.updateId, replayed: false };
  }

  async createProjectPhase(command: CreateProjectPhaseCommand): Promise<MutationReference> {
    this.createProjectPhaseCommands.push(command);
    const replay = this.idempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new ProjectError("IDEMPOTENCY_CONFLICT");
      return { id: replay.id, replayed: true };
    }
    this.idempotency.set(command.idempotencyKey, {
      id: command.phaseId,
      requestHash: command.requestHash,
    });
    const project = this.projects.get(command.projectId);
    if (project) {
      this.projects.set(command.projectId, {
        ...project,
        version: project.version + 1,
        contentRevision: project.contentRevision + 1,
        phases: [
          ...project.phases,
          {
            id: command.phaseId,
            name: command.input.name,
            sortOrder: project.phases.length,
            isCustom: true,
          },
        ],
      });
    }
    return { id: command.phaseId, replayed: false };
  }
}

class RecordingProtector implements ProjectPrivateDetailsProtector {
  readonly currentKeyVersion = 7;
  readonly calls: Array<{ plaintext: string; context: string }> = [];

  protect(plaintext: string, context: string): string {
    this.calls.push({ plaintext, context });
    return `ciphertext:${context}:${plaintext.length}`;
  }
}

describe("project repository security rules", () => {
  it("resolves only a trusted session subject through the stable identity mapping", async () => {
    const subjects = { resolveAuthUserId: vi.fn(async () => "google-oidc-user") };
    const appUsers = { findActiveAppUserId: vi.fn(async () => ACTOR_ID) };
    const resolver = new StrictMappedProjectActorResolver(subjects, appUsers);

    await expect(resolver.resolve(new Request("https://buildy.test/api/projects", {
      headers: { "x-user-id": OTHER_ID },
    }))).resolves.toEqual({ kind: "authenticated", appUserId: ACTOR_ID });
    expect(appUsers.findActiveAppUserId).toHaveBeenCalledWith("google-oidc-user");
  });

  it("represents a missing session explicitly as an anonymous actor", async () => {
    const appUsers = { findActiveAppUserId: vi.fn(async () => ACTOR_ID) };
    const resolver = new StrictMappedProjectActorResolver(
      { resolveAuthUserId: async () => null },
      appUsers,
    );

    await expect(resolver.resolve(new Request("https://buildy.test/api/discovery")))
      .resolves.toBe(ANONYMOUS_PROJECT_ACTOR);
    expect(appUsers.findActiveAppUserId).not.toHaveBeenCalled();
  });

  it("fails closed when a session subject has no active app-user mapping", async () => {
    const resolver = new StrictMappedProjectActorResolver(
      { resolveAuthUserId: async () => "google-oidc-user" },
      { findActiveAppUserId: async () => null },
    );

    await expect(resolver.resolve(new Request("https://buildy.test/api/projects"))).rejects.toThrowError(
      expect.objectContaining({ reason: "ACTOR_MAPPING_UNAVAILABLE" }),
    );
  });

  it.each([
    ["owner", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: ACTOR_ID, visibility: "private", profileFollower: false, blocked: false }, true],
    ["public", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: OTHER_ID, visibility: "public", profileFollower: false, blocked: false }, true],
    ["unlisted without grant", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: OTHER_ID, visibility: "unlisted", profileFollower: false, blocked: false }, false],
    ["unlisted with grant", { kind: "authenticated", appUserId: ACTOR_ID, shareLinkId: PROJECT_ID }, { ownerId: OTHER_ID, visibility: "unlisted", profileFollower: false, blocked: false }, true],
    ["active profile follower", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: OTHER_ID, visibility: "followers", profileFollower: true, blocked: false }, true],
    ["non-follower", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: OTHER_ID, visibility: "followers", profileFollower: false, blocked: false }, false],
    ["private despite following", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: OTHER_ID, visibility: "private", profileFollower: true, blocked: false }, false],
    ["blocked", { kind: "authenticated", appUserId: ACTOR_ID }, { ownerId: OTHER_ID, visibility: "public", profileFollower: true, blocked: true }, false],
    ["anonymous public", ANONYMOUS_PROJECT_ACTOR, { ownerId: OTHER_ID, visibility: "public", profileFollower: false, blocked: false }, true],
    ["anonymous UUID only", ANONYMOUS_PROJECT_ACTOR, { ownerId: OTHER_ID, visibility: "unlisted", profileFollower: false, blocked: false }, false],
    ["anonymous signed grant", { kind: "anonymous", shareLinkId: PROJECT_ID }, { ownerId: OTHER_ID, visibility: "unlisted", profileFollower: false, blocked: false }, true],
    ["anonymous followers-only", ANONYMOUS_PROJECT_ACTOR, { ownerId: OTHER_ID, visibility: "followers", profileFollower: true, blocked: false }, false],
  ] as const)("enforces %s visibility", (_label, viewer, facts, expected) => {
    expect(canActorViewProject(viewer, { ...facts, lifecycleStatus: "active" })).toBe(expected);
  });

  it("binds cursors to one readmodel and rejects tampering", () => {
    const cursor = encodeProjectCursor({
      version: 1,
      kind: "dashboard",
      timestamp: "2026-08-04T10:00:00.000Z",
      id: PROJECT_ID,
    });
    expect(decodeProjectCursor(cursor, "dashboard")?.id).toBe(PROJECT_ID);
    expect(() => decodeProjectCursor(cursor, "discovery")).toThrowError(
      expect.objectContaining({ reason: "INVALID_CURSOR" }),
    );
    expect(() => decodeProjectCursor("not-base64-json", "dashboard")).toThrowError(
      expect.objectContaining({ reason: "INVALID_CURSOR" }),
    );
  });

  it("creates deterministic, actor-scoped command hashes without storing the client key", () => {
    expect(projectRequestHash("edit", { b: 2, a: 1 }, BLIND_INDEX)).toBe(
      projectRequestHash("edit", { a: 1, b: 2 }, BLIND_INDEX),
    );
    expect(projectRequestHash("edit", { a: 1, b: 2 }, BLIND_INDEX)).not.toBe(
      projectRequestHash("edit", { a: 1, b: 2 }, OTHER_BLIND_INDEX),
    );
    const first = scopedProjectIdempotencyKey("edit", ACTOR_ID, UPDATE_ID, "client-key-123456");
    const otherActor = scopedProjectIdempotencyKey("edit", OTHER_ID, UPDATE_ID, "client-key-123456");
    expect(first).not.toBe(otherActor);
    expect(first).not.toContain("client-key-123456");
  });

  it("builds a dashboard readmodel in one data query without exposing storage coordinates", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: PROJECT_ID,
          slug: "keuken-3333333333",
          title: "Nieuwe keuken",
          description: null,
          project_type: "Keuken",
          visibility: "private",
          progress_percentage: 10,
          version: 2,
          updated_at: new Date("2026-08-04T10:00:00Z"),
          published_at: null,
          owner_id: ACTOR_ID,
          owner_display_name: "Ada",
          owner_slug: "ada",
          update_count: 4,
          last_update_at: new Date("2026-08-03T10:00:00Z"),
          cover_id: UPDATE_ID,
          cover_content_type: "image/webp",
          cover_width: 1_600,
          cover_height: 1_200,
          bucket: "must-not-leak",
          object_key: "private/original.jpg",
        }],
      });
    const database = {
      transaction: async (callback: (transaction: { execute: typeof execute }) => Promise<unknown>) =>
        callback({ execute }),
    } as unknown as BuildyDatabase;
    const repository = new PostgresProjectRepository(database);

    const result = await repository.listDashboard(ACTOR_ID, undefined, 21);

    expect(execute).toHaveBeenCalledTimes(2); // actor context + one set-based readmodel query
    expect(result).toHaveLength(1);
    expect(result[0]?.cover).toEqual({
      id: UPDATE_ID,
      contentType: "image/webp",
      width: 1_600,
      height: 1_200,
      proxyPath: `/api/media/${UPDATE_ID}`,
    });
    expect(JSON.stringify(result)).not.toMatch(/bucket|object_key|original\.jpg/);
  });
});

describe("project service", () => {
  it("builds the authenticated following feed from bounded project and activity reads", async () => {
    const repository = new FakeProjectRepository();
    repository.followingProjectRows = [card({ visibility: "public" })];
    repository.followingActivityRows = [{
      project: { id: PROJECT_ID, title: "Nieuwe keuken" },
      update: update({ status: "published", publishedAt: "2026-08-04T10:00:00.000Z" }),
    }];
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);

    await expect(service.following(ACTOR_ID, {
      projectLimit: "10",
      activityLimit: "5",
    })).resolves.toEqual({
      projects: repository.followingProjectRows,
      activity: repository.followingActivityRows,
    });
    await expect(service.following(ACTOR_ID, { activityLimit: "500" })).rejects.toBeInstanceOf(ZodError);
  });

  it("creates a private project for the injected actor and encrypts every private field", async () => {
    const repository = new FakeProjectRepository();
    const protector = new RecordingProtector();
    const service = new ProjectService(repository, protector, BLIND_INDEX, () => new Date("2026-08-04T10:00:00Z"), () => PROJECT_ID);

    const result = await service.createProject(ACTOR_ID, {
      idempotencyKey: "create-project-key-0001",
      title: "Nieuwe keuken",
      privateDetails: {
        addressLine1: "Keizersgracht 42",
        postalCode: "1015 CS",
        city: "Amsterdam",
        countryCode: "nl",
        contractorNotes: "Bel aannemer na 18:00.",
      },
    });

    const command = repository.createProjectCommands[0];
    expect(command?.ownerId).toBe(ACTOR_ID);
    expect(command?.privateDetails).toMatchObject({
      countryCode: "NL",
      encryptionKeyVersion: 7,
    });
    expect(JSON.stringify(command?.privateDetails)).not.toContain("Keizersgracht 42");
    expect(protector.calls.map((call) => call.context)).toEqual([
      `project:${PROJECT_ID}:private:address_line_1`,
      `project:${PROJECT_ID}:private:postal_code`,
      `project:${PROJECT_ID}:private:city`,
      `project:${PROJECT_ID}:private:contractor_notes`,
    ]);
    expect(result.project.visibility).toBe("private");
    expect(result.project.phases.map((phase) => phase.name)).toEqual(STANDARD_PROJECT_PHASES);
  });

  it("rejects forged ownership before calling the repository", async () => {
    const repository = new FakeProjectRepository();
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX, undefined, () => PROJECT_ID);

    await expect(service.createProject(ACTOR_ID, {
      idempotencyKey: "create-project-key-0001",
      title: "Poging",
      ownerId: OTHER_ID,
    })).rejects.toBeInstanceOf(ZodError);
    expect(repository.createProjectCommands).toHaveLength(0);
  });

  it("paginates the dashboard with one repository read and an opaque continuation", async () => {
    const repository = new FakeProjectRepository();
    repository.dashboardRows = [
      card({ id: PROJECT_ID, updatedAt: "2026-08-04T10:00:00.000Z" }),
      card({ id: UPDATE_ID, updatedAt: "2026-08-03T10:00:00.000Z" }),
      card({ id: SECOND_UPDATE_ID, updatedAt: "2026-08-02T10:00:00.000Z" }),
    ];
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);

    const page = await service.dashboard(ACTOR_ID, { limit: "2" });

    expect(page.items).toHaveLength(2);
    expect(repository.dashboardCalls).toHaveLength(1);
    expect(repository.dashboardCalls[0]?.limit).toBe(3);
    expect(decodeProjectCursor(page.nextCursor ?? undefined, "dashboard")).toMatchObject({
      id: UPDATE_ID,
      timestamp: "2026-08-03T10:00:00.000Z",
    });
  });

  it("returns the same update for a double submit and conflicts on key reuse", async () => {
    const repository = new FakeProjectRepository();
    const ids = [UPDATE_ID, SECOND_UPDATE_ID, "66666666-6666-4666-8666-666666666666"];
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX, () => new Date("2026-08-04T10:00:00Z"), () => ids.shift()!);
    const input = {
      idempotencyKey: "update-submit-key-0001",
      expectedProjectVersion: 1,
      updateDate: "2026-08-04",
      title: "Leidingen",
      publish: true,
    };

    const first = await service.createUpdate(ACTOR_ID, PROJECT_ID, input);
    const second = await service.createUpdate(ACTOR_ID, PROJECT_ID, input);

    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, update: { id: UPDATE_ID } });
    expect(repository.createUpdateCommands[0]?.actorId).toBe(ACTOR_ID);
    expect(repository.createUpdateCommands[0]?.idempotencyKey).toBe(
      repository.createUpdateCommands[1]?.idempotencyKey,
    );
    await expect(service.createUpdate(ACTOR_ID, PROJECT_ID, {
      ...input,
      title: "Andere inhoud",
    })).rejects.toThrowError(expect.objectContaining({ reason: "IDEMPOTENCY_CONFLICT" }));
  });

  it("uses a non-enumerating not-found error for invisible project IDs", async () => {
    const repository = new FakeProjectRepository();
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);

    await expect(service.overview(
      { kind: "authenticated", appUserId: ACTOR_ID },
      OTHER_ID,
    )).rejects.toThrowError(
      expect.objectContaining({ reason: "PROJECT_NOT_FOUND", status: 404 }),
    );
  });

  it("preserves optimistic write conflicts as a stable typed error", async () => {
    const repository = new FakeProjectRepository();
    repository.updateProjectError = new ProjectError("VERSION_CONFLICT");
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);

    await expect(service.updateProject(ACTOR_ID, PROJECT_ID, {
      expectedVersion: 1,
      title: "Nieuwe titel",
    })).rejects.toThrowError(expect.objectContaining({
      reason: "VERSION_CONFLICT",
      apiCode: "CONFLICT",
      status: 409,
    }));
  });

  it("soft-deletes an update with a version-bound, idempotent owner command", async () => {
    const repository = new FakeProjectRepository();
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);
    const input = {
      idempotencyKey: "update-delete:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      expectedVersion: 1,
      confirmation: "delete-update",
    };

    const first = await service.deleteUpdate(ACTOR_ID, PROJECT_ID, UPDATE_ID, input);
    const second = await service.deleteUpdate(ACTOR_ID, PROJECT_ID, UPDATE_ID, input);

    expect(first).toMatchObject({ updateId: UPDATE_ID, deleted: true, replayed: false });
    expect(second).toMatchObject({ updateId: UPDATE_ID, deleted: true, replayed: true });
    expect(repository.deleteUpdateCommands).toHaveLength(2);
    expect(repository.deleteUpdateCommands[0]).toMatchObject({
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      updateId: UPDATE_ID,
      input: { expectedVersion: 1, confirmation: "delete-update" },
    });
    expect(repository.deleteUpdateCommands[0]?.idempotencyKey).toBe(
      repository.deleteUpdateCommands[1]?.idempotencyKey,
    );
  });

  it("starts project erasure with an actor-scoped key and preserves replay identity", async () => {
    const repository = new FakeProjectRepository();
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);
    const input = {
      idempotencyKey: "project-delete:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedVersion: 1,
      confirmation: "VERWIJDER VERBOUWING",
    } as const;

    await expect(service.requestProjectDeletion(ACTOR_ID, PROJECT_ID, input)).resolves.toMatchObject({
      projectId: PROJECT_ID,
      status: "deletion_pending",
      replayed: false,
    });
    await expect(service.requestProjectDeletion(ACTOR_ID, PROJECT_ID, input)).resolves.toMatchObject({
      projectId: PROJECT_ID,
      status: "deletion_pending",
      replayed: true,
    });
    expect(repository.deleteProjectCommands).toHaveLength(2);
    expect(repository.deleteProjectCommands[0]).toMatchObject({
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      retentionPolicyVersion: "project-erasure-v1",
      input: { expectedVersion: 1, confirmation: "VERWIJDER VERBOUWING" },
    });
    expect(repository.deleteProjectCommands[0]?.idempotencyKey)
      .toMatch(/^project-command:v1:project\.delete:[0-9a-f]{64}$/);
    expect(repository.deleteProjectCommands[0]?.idempotencyKey)
      .toBe(repository.deleteProjectCommands[1]?.idempotencyKey);
  });

  it("blocks project erasure while a physical order is active", async () => {
    const repository = new FakeProjectRepository();
    repository.projectDeletionStatus = "blocked_active_order";
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);

    await expect(service.requestProjectDeletion(ACTOR_ID, PROJECT_ID, {
      idempotencyKey: "project-delete:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedVersion: 1,
      confirmation: "VERWIJDER VERBOUWING",
    })).rejects.toThrowError(expect.objectContaining({
      reason: "ACTIVE_ORDER",
      status: 409,
    }));
  });

  it("rejects a project deletion without the exact destructive confirmation", async () => {
    const repository = new FakeProjectRepository();
    const service = new ProjectService(repository, new RecordingProtector(), BLIND_INDEX);

    await expect(service.requestProjectDeletion(ACTOR_ID, PROJECT_ID, {
      idempotencyKey: "project-delete:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expectedVersion: 1,
      confirmation: "verwijder project",
    })).rejects.toBeInstanceOf(ZodError);
    expect(repository.deleteProjectCommands).toHaveLength(0);
  });

  it("creates and replays a custom phase under the project's optimistic version", async () => {
    const repository = new FakeProjectRepository();
    const service = new ProjectService(
      repository,
      new RecordingProtector(),
      BLIND_INDEX,
      () => new Date("2026-08-04T10:00:00Z"),
      () => SECOND_UPDATE_ID,
    );
    const input = {
      idempotencyKey: "project-phase:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      expectedProjectVersion: 1,
      name: "  Maatwerk  ",
    };

    const first = await service.createProjectPhase(ACTOR_ID, PROJECT_ID, input);
    const second = await service.createProjectPhase(ACTOR_ID, PROJECT_ID, input);

    expect(first).toMatchObject({
      replayed: false,
      phase: { id: SECOND_UPDATE_ID, name: "Maatwerk", isCustom: true },
      project: { version: 2 },
    });
    expect(second).toMatchObject({ replayed: true, phase: { id: SECOND_UPDATE_ID } });
    expect(repository.createProjectPhaseCommands[0]).toMatchObject({
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      input: { expectedProjectVersion: 1, name: "Maatwerk" },
    });
  });
});

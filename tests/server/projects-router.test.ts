// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectOverview, ProjectUpdate } from "../../shared/contracts/projects";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { handleApiRequest } from "../../server/http/router";
import {
  ANONYMOUS_PROJECT_ACTOR,
  type ProjectActor,
  type ProjectActorResolver,
} from "../../server/projects/actor";
import { ProjectError } from "../../server/projects/errors";
import type { ProjectHttpService } from "../../server/projects/http";
import {
  configureDefaultProjectRuntime,
  resetDefaultProjectRuntimeForTests,
} from "../../server/projects/runtime";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const UPDATE_ID = "44444444-4444-4444-8444-444444444444";
const PHASE_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ORIGIN = "https://test.buildy.example";

function overview(overrides: Partial<ProjectOverview> = {}): ProjectOverview {
  return {
    id: PROJECT_ID,
    slug: "keuken-3333333333",
    title: "Nieuwe keuken",
    description: null,
    projectType: "Keuken",
    visibility: "private",
    progressPercentage: 0,
    version: 1,
    updatedAt: "2026-08-04T10:00:00.000Z",
    publishedAt: null,
    updateCount: 0,
    lastUpdateAt: null,
    owner: { id: ACTOR_ID, displayName: "Ada", slug: "ada" },
    cover: null,
    startDate: null,
    expectedEndDate: null,
    contentRevision: 1,
    followerCount: 0,
    viewerAccess: "owner",
    canEdit: true,
    phases: [],
    ...overrides,
  };
}

function projectUpdate(): ProjectUpdate {
  return {
    id: UPDATE_ID,
    projectId: PROJECT_ID,
    phase: null,
    title: "Leidingen",
    room: null,
    description: null,
    updateDate: "2026-08-04",
    status: "published",
    isMilestone: false,
    sortOrder: 0,
    contentRevision: 2,
    version: 2,
    publishedAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:00:00.000Z",
    media: [],
  };
}

function actorResolver(appUserId: string | null): ProjectActorResolver {
  return {
    resolve: vi.fn(async () => appUserId
      ? { kind: "authenticated" as const, appUserId }
      : ANONYMOUS_PROJECT_ACTOR),
  };
}

function service(overrides: Partial<ProjectHttpService> = {}): ProjectHttpService {
  return {
    createProject: async () => ({ project: overview(), replayed: false }),
    updateProject: async () => ({ project: overview(), replayed: false }),
    requestProjectDeletion: async () => ({
      jobId: "66666666-6666-4666-8666-666666666666",
      projectId: PROJECT_ID,
      status: "deletion_pending",
      activeOrderCount: 0,
      replayed: false,
    }),
    dashboard: async () => ({ items: [], nextCursor: null }),
    discovery: async () => ({ items: [], nextCursor: null }),
    following: async () => ({ projects: [], activity: [] }),
    overview: async () => overview(),
    timeline: async () => ({ projectId: PROJECT_ID, items: [], nextCursor: null }),
    createUpdate: async () => ({ update: projectUpdate(), replayed: false }),
    editUpdate: async () => ({ update: projectUpdate(), replayed: false }),
    deleteUpdate: async () => ({
      project: overview(),
      updateId: UPDATE_ID,
      deleted: true,
      replayed: false,
    }),
    createProjectPhase: async () => ({
      project: overview(),
      phase: {
        id: PHASE_ID,
        name: "Maatwerk",
        sortOrder: 6,
        isCustom: true,
      },
      replayed: false,
    }),
    ...overrides,
  };
}

describe("project HTTP routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", REQUEST_ORIGIN);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    resetRuntimeConfigForTests();
    resetDefaultProjectRuntimeForTests();
  });

  afterEach(() => {
    resetDefaultProjectRuntimeForTests();
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it("fails closed while the Google OIDC app-user mapping is not composed", async () => {
    const response = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/projects`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_UNAVAILABLE" },
    });
  });

  it("requires a server-resolved app-user actor for the dashboard", async () => {
    configureDefaultProjectRuntime({ actors: actorResolver(null), service: service() });

    const response = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/projects`, {
      headers: { "x-user-id": FORGED_USER_ID },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it.each([
    ["anonymous", null, ANONYMOUS_PROJECT_ACTOR],
    ["authenticated", ACTOR_ID, { kind: "authenticated", appUserId: ACTOR_ID }],
  ] as const)("serves discovery to an %s viewer", async (_label, appUserId, expectedViewer) => {
    const discoverySpy = vi.fn(async (viewer: ProjectActor) => {
      expect(viewer).toEqual(expectedViewer);
      return { items: [], nextCursor: null };
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(appUserId),
      service: service({ discovery: discoverySpy }),
    });

    const response = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/discovery`, {
      headers: { "x-user-id": FORGED_USER_ID },
    }));

    expect(response.status).toBe(200);
    expect(discoverySpy).toHaveBeenCalledOnce();
  });

  it("requires authentication for the following feed and ignores forged identity headers", async () => {
    const followingSpy = vi.fn(async (actorId: string) => {
      expect(actorId).toBe(ACTOR_ID);
      return { projects: [], activity: [] };
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ following: followingSpy }),
    });

    const response = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/following`, {
      headers: { "x-user-id": FORGED_USER_ID },
    }));
    expect(response.status).toBe(200);
    expect(followingSpy).toHaveBeenCalledOnce();

    resetDefaultProjectRuntimeForTests();
    configureDefaultProjectRuntime({ actors: actorResolver(null), service: service() });
    const anonymous = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/following`));
    expect(anonymous.status).toBe(401);
  });

  it("matches project parameters and ignores forged client identity headers", async () => {
    const overviewSpy = vi.fn(async (viewer: ProjectActor, projectId: string) => {
      expect(viewer).toEqual({ kind: "authenticated", appUserId: ACTOR_ID });
      expect(projectId).toBe(PROJECT_ID);
      return overview();
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ overview: overviewSpy }),
    });

    const response = await handleApiRequest(new Request(
      `${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}`,
      { headers: { "x-user-id": FORGED_USER_ID } },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(overviewSpy).toHaveBeenCalledOnce();
    expect(body).toMatchObject({ data: { id: PROJECT_ID, canEdit: true } });
    expect(JSON.stringify(body)).not.toMatch(/address|contractor|ciphertext|objectKey|signedUrl/i);
  });

  it("serves a public overview and published timeline anonymously", async () => {
    const publicOverview = overview({
      visibility: "public",
      publishedAt: "2026-08-04T10:00:00.000Z",
      viewerAccess: "public",
      canEdit: false,
    });
    const overviewSpy = vi.fn(async (viewer: ProjectActor) => {
      expect(viewer).toBe(ANONYMOUS_PROJECT_ACTOR);
      return publicOverview;
    });
    const timelineSpy = vi.fn(async (viewer: ProjectActor) => {
      expect(viewer).toBe(ANONYMOUS_PROJECT_ACTOR);
      return { projectId: PROJECT_ID, items: [projectUpdate()], nextCursor: null };
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(null),
      service: service({ overview: overviewSpy, timeline: timelineSpy }),
    });

    const overviewResponse = await handleApiRequest(
      new Request(`${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}`),
    );
    const timelineResponse = await handleApiRequest(
      new Request(`${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}/updates`),
    );

    expect(overviewResponse.status).toBe(200);
    expect(timelineResponse.status).toBe(200);
    await expect(timelineResponse.json()).resolves.toMatchObject({
      data: { items: [{ id: UPDATE_ID, status: "published" }] },
    });
  });

  it("conceals a private project from an anonymous viewer", async () => {
    const overviewSpy = vi.fn(async (viewer: ProjectActor) => {
      expect(viewer).toBe(ANONYMOUS_PROJECT_ACTOR);
      throw new ProjectError("PROJECT_NOT_FOUND");
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(null),
      service: service({ overview: overviewSpy }),
    });

    const response = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns the same non-enumerating 404 for a blocked authenticated viewer", async () => {
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({
        overview: async () => {
          throw new ProjectError("PROJECT_NOT_FOUND");
        },
      }),
    });

    const response = await handleApiRequest(new Request(`${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Dit project bestaat niet of is niet toegankelijk.",
      },
    });
  });

  it("routes an update publish with path-owned IDs and trusted origin", async () => {
    const editSpy = vi.fn(async (
      actorId: string,
      projectId: string,
      updateId: string,
      input: unknown,
    ) => {
      expect({ actorId, projectId, updateId, input }).toEqual({
        actorId: ACTOR_ID,
        projectId: PROJECT_ID,
        updateId: UPDATE_ID,
        input: {
          idempotencyKey: "publish-update-key-0001",
          expectedVersion: 1,
          publish: true,
        },
      });
      return { update: projectUpdate(), replayed: false };
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ editUpdate: editSpy }),
    });

    const response = await handleApiRequest(new Request(
      `${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: REQUEST_ORIGIN },
        body: JSON.stringify({
          idempotencyKey: "publish-update-key-0001",
          expectedVersion: 1,
          publish: true,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(editSpy).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: { update: { id: UPDATE_ID, status: "published" }, replayed: false },
    });
  });

  it("routes a confirmed update soft-delete with path-owned IDs", async () => {
    const deleteSpy = vi.fn(async (
      actorId: string,
      projectId: string,
      updateId: string,
      input: unknown,
    ) => {
      expect({ actorId, projectId, updateId, input }).toEqual({
        actorId: ACTOR_ID,
        projectId: PROJECT_ID,
        updateId: UPDATE_ID,
        input: {
          idempotencyKey: "update-delete-key-0001",
          expectedVersion: 2,
          confirmation: "delete-update",
        },
      });
      return {
        project: overview({ version: 2 }),
        updateId,
        deleted: true as const,
        replayed: false,
      };
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ deleteUpdate: deleteSpy }),
    });

    const response = await handleApiRequest(new Request(
      `${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json", origin: REQUEST_ORIGIN },
        body: JSON.stringify({
          idempotencyKey: "update-delete-key-0001",
          expectedVersion: 2,
          confirmation: "delete-update",
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: { updateId: UPDATE_ID, deleted: true, replayed: false },
    });
  });

  it("creates a custom phase only for the trusted authenticated actor", async () => {
    const createPhaseSpy = vi.fn(async (actorId: string, projectId: string, input: unknown) => {
      expect({ actorId, projectId, input }).toEqual({
        actorId: ACTOR_ID,
        projectId: PROJECT_ID,
        input: {
          idempotencyKey: "project-phase-key-0001",
          expectedProjectVersion: 1,
          name: "Maatwerk",
        },
      });
      return {
        project: overview({ version: 2 }),
        phase: { id: PHASE_ID, name: "Maatwerk", sortOrder: 6, isCustom: true },
        replayed: false,
      };
    });
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ createProjectPhase: createPhaseSpy }),
    });

    const response = await handleApiRequest(new Request(
      `${REQUEST_ORIGIN}/api/projects/${PROJECT_ID}/phases`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: REQUEST_ORIGIN },
        body: JSON.stringify({
          idempotencyKey: "project-phase-key-0001",
          expectedProjectVersion: 1,
          name: "Maatwerk",
        }),
      },
    ));

    expect(response.status).toBe(201);
    expect(createPhaseSpy).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: { phase: { id: PHASE_ID, isCustom: true }, replayed: false },
    });
  });

  it("uses 201 for a new submit and 200 for its replay", async () => {
    const createSpy = vi.fn()
      .mockResolvedValueOnce({ project: overview(), replayed: false })
      .mockResolvedValueOnce({ project: overview(), replayed: true });
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ createProject: createSpy }),
    });
    const request = () => new Request(`${REQUEST_ORIGIN}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: REQUEST_ORIGIN },
      body: JSON.stringify({
        idempotencyKey: "create-project-key-0001",
        title: "Nieuwe keuken",
      }),
    });

    expect((await handleApiRequest(request())).status).toBe(201);
    expect((await handleApiRequest(request())).status).toBe(200);
  });

  it("rejects duplicate cursor parameters before the repository", async () => {
    const dashboardSpy = vi.fn(async () => ({ items: [], nextCursor: null }));
    configureDefaultProjectRuntime({
      actors: actorResolver(ACTOR_ID),
      service: service({ dashboard: dashboardSpy }),
    });

    const response = await handleApiRequest(new Request(
      `${REQUEST_ORIGIN}/api/projects?cursor=one&cursor=two`,
    ));

    expect(response.status).toBe(400);
    expect(dashboardSpy).not.toHaveBeenCalled();
  });
});

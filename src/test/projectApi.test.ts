// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectPhase,
  createProjectUpdate,
  createProjectWithVisibility,
  deleteProject,
  deleteProjectUpdate,
  editProjectUpdate,
  getFollowingFeed,
  getProjectDashboard,
  getProjectDiscovery,
  getProjectOverview,
  getProjectTimeline,
} from "@/lib/projectApi";
import type { ProjectVisibility } from "../../shared/contracts/projects";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const UPDATE_ID = "44444444-4444-4444-8444-444444444444";
const CREATE_KEY = "project-create:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function overview(visibility: ProjectVisibility = "private", version = 3) {
  return {
    id: PROJECT_ID,
    slug: "ons-huis",
    title: "Ons huis",
    description: null,
    projectType: null,
    visibility,
    progressPercentage: 0,
    version,
    updatedAt: "2026-08-04T12:00:00.000Z",
    publishedAt: visibility === "private" ? null : "2026-08-04T12:00:00.000Z",
    updateCount: 0,
    lastUpdateAt: null,
    owner: { id: OWNER_ID, displayName: "Eigenaar", slug: "eigenaar" },
    cover: null,
    startDate: null,
    expectedEndDate: null,
    contentRevision: 1,
    followerCount: 0,
    viewerAccess: "owner" as const,
    canEdit: true,
    phases: [],
  };
}

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

function mutation(project = overview()) {
  return success({ project, replayed: false });
}

function projectUpdate() {
  return {
    id: UPDATE_ID,
    projectId: PROJECT_ID,
    phase: null,
    title: "De muur is open",
    room: null,
    description: null,
    updateDate: "2026-08-04",
    status: "published",
    isMilestone: false,
    sortOrder: 0,
    contentRevision: 1,
    version: 1,
    publishedAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
    media: [],
  };
}

describe("project API write flow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a private-default project with one cookie-authenticated POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mutation());
    vi.stubGlobal("fetch", fetchMock);
    const input = { idempotencyKey: CREATE_KEY, title: "Ons huis" };

    const result = await createProjectWithVisibility({ input, visibility: "private" });

    expect(result.project.id).toBe(PROJECT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/projects");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(String(request.body))).toEqual(input);
  });

  it.each(["followers", "unlisted", "public"] as const)("continues %s visibility with the server version and no visibility in create", async (visibility) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mutation(overview("private", 3)))
      .mockResolvedValueOnce(mutation(overview(visibility, 4)));
    vi.stubGlobal("fetch", fetchMock);
    const input = { idempotencyKey: CREATE_KEY, title: "Ons huis" };

    const result = await createProjectWithVisibility({ input, visibility });

    expect(result.project.visibility).toBe(visibility);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects",
      `/api/projects/${PROJECT_ID}`,
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(input);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      expectedVersion: 3,
      visibility,
    });
  });

  it("reconciles an uncertain visibility response by reading the canonical project", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mutation(overview("private", 3)))
      .mockResolvedValueOnce(Response.json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Onzeker",
          requestId: REQUEST_ID,
        },
      }, { status: 503 }))
      .mockResolvedValueOnce(success(overview("public", 4)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createProjectWithVisibility({
      input: { idempotencyKey: CREATE_KEY, title: "Ons huis" },
      visibility: "public",
    });

    expect(result.project.visibility).toBe("public");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/projects/${PROJECT_ID}`);
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe("GET");
  });

  it("rejects non-UUID route values before a request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getProjectOverview("../../another-user")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses canonical nested routes and exact typed bodies for create and edit update", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => success({
      update: projectUpdate(),
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const createInput = {
      idempotencyKey: "update-create:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      expectedProjectVersion: 3,
      updateDate: "2026-08-04",
      title: "De muur is open",
      isMilestone: false,
      media: [],
      publish: true,
    };
    const editInput = {
      idempotencyKey: "update-edit:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      expectedVersion: 1,
      title: "De draagmuur is open",
    };

    await createProjectUpdate(PROJECT_ID, createInput);
    await editProjectUpdate(PROJECT_ID, UPDATE_ID, editInput);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${PROJECT_ID}/updates`,
      `/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}`,
    ]);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(createInput);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual(editInput);
  });

  it("uses typed same-origin routes for confirmed delete and custom phase creation", async () => {
    const phase = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Maatwerk",
      sortOrder: 6,
      isCustom: true,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({
        project: overview(),
        updateId: UPDATE_ID,
        deleted: true,
        replayed: false,
      }))
      .mockResolvedValueOnce(success({
        project: { ...overview("private", 4), phases: [phase] },
        phase,
        replayed: false,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const deleteInput = {
      idempotencyKey: "update-delete:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      expectedVersion: 1,
      confirmation: "delete-update" as const,
    };
    const phaseInput = {
      idempotencyKey: "project-phase:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      expectedProjectVersion: 3,
      name: "Maatwerk",
    };

    await deleteProjectUpdate(PROJECT_ID, UPDATE_ID, deleteInput);
    await createProjectPhase(PROJECT_ID, phaseInput);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}`,
      `/api/projects/${PROJECT_ID}/phases`,
    ]);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(deleteInput);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual(phaseInput);
  });

  it("requests project erasure with the exact typed destructive body", async () => {
    const jobId = "66666666-6666-4666-8666-666666666666";
    const fetchMock = vi.fn().mockResolvedValue(success({
      deletion: {
        id: jobId,
        projectId: PROJECT_ID,
        status: "deletion_pending",
        activeOrderCount: 0,
      },
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      idempotencyKey: "project-delete:ffffffff-ffff-4fff-8fff-ffffffffffff",
      expectedVersion: 3,
      confirmation: "VERWIJDER VERBOUWING" as const,
    };

    await expect(deleteProject(PROJECT_ID, input)).resolves.toMatchObject({
      deletion: { id: jobId, projectId: PROJECT_ID, status: "deletion_pending" },
      replayed: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}`,
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        body: JSON.stringify(input),
      }),
    );
  });

  it("reads a cursor-paginated timeline with private media proxy descriptors", async () => {
    const cursor = "opaque:timeline:cursor";
    const update = projectUpdate();
    const mediaId = "55555555-5555-4555-8555-555555555555";
    const fetchMock = vi.fn().mockResolvedValue(success({
      projectId: PROJECT_ID,
      items: [{
        ...update,
        media: [{
          id: mediaId,
          contentType: "image/jpeg",
          width: 1600,
          height: 1200,
          proxyPath: `/api/media/${mediaId}`,
          role: "gallery",
          sortOrder: 0,
          caption: null,
        }],
      }],
      nextCursor: null,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();

    const result = await getProjectTimeline(
      PROJECT_ID,
      { cursor, limit: 50 },
      abort.signal,
    );

    expect(result.items[0]?.media[0]?.proxyPath).toBe(`/api/media/${mediaId}`);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/updates?limit=50&cursor=${encodeURIComponent(cursor)}`,
      expect.objectContaining({
        credentials: "include",
        method: "GET",
        signal: abort.signal,
      }),
    );
  });

  it("reads dashboard, discovery and following through bounded typed endpoints", async () => {
    const card = {
      ...overview("public"),
      startDate: undefined,
      expectedEndDate: undefined,
      contentRevision: undefined,
      followerCount: undefined,
      viewerAccess: undefined,
      canEdit: undefined,
      phases: undefined,
    };
    const normalizedCard = Object.fromEntries(
      Object.entries(card).filter(([, value]) => value !== undefined),
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({ items: [normalizedCard], nextCursor: null }))
      .mockResolvedValueOnce(success({ items: [normalizedCard], nextCursor: null }))
      .mockResolvedValueOnce(success({ projects: [normalizedCard], activity: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectDashboard({ limit: 50 });
    await getProjectDiscovery({ limit: 50 });
    await getFollowingFeed({ projectLimit: 20, activityLimit: 10 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/projects?limit=50",
      "/api/discovery?limit=50",
      "/api/following?projectLimit=20&activityLimit=10",
    ]);
  });
});

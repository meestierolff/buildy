// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSocialHttpHandler,
  type SocialActorResolver,
  type SocialHttpService,
} from "../../server/social/http";
import { SocialError } from "../../server/social/errors";

const actorId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000101";
const requestId = "00000000-0000-4000-8000-000000000901";

function serviceMocks(): SocialHttpService {
  return {
    acceptProfileFollow: vi.fn().mockResolvedValue({ replayed: false, state: "following" }),
    acceptProjectAccess: vi.fn().mockResolvedValue({ replayed: false, state: "accepted" }),
    blockProfile: vi.fn().mockResolvedValue({ replayed: false, state: "blocked" }),
    cancelProjectAccess: vi.fn().mockResolvedValue({ replayed: false, state: "cancelled" }),
    followProfile: vi.fn().mockResolvedValue({ replayed: false, state: "following" }),
    followProject: vi.fn().mockResolvedValue({ replayed: false, state: "following" }),
    projectState: vi.fn().mockResolvedValue({
      projectId,
      viewerRole: "viewer",
      followStatus: "none",
      accessStatus: "none",
    }),
    projectAccess: vi.fn().mockResolvedValue({ projectId, items: [] }),
    profile: vi.fn().mockResolvedValue({
      avatar: null,
      bio: null,
      displayName: "Testbouwer",
      followerCount: 0,
      followingCount: 0,
      followsViewer: false,
      id: targetId,
      isPrivate: false,
      isPro: false,
      location: null,
      slug: "testbouwer",
      viewerAccess: "public",
      viewerFollowStatus: "none",
    }),
    rejectProfileFollow: vi.fn().mockResolvedValue({ replayed: false, state: "rejected" }),
    rejectProjectAccess: vi.fn().mockResolvedValue({ replayed: false, state: "rejected" }),
    removeProfileFollow: vi.fn().mockResolvedValue({ replayed: false, state: "none" }),
    requestProjectAccess: vi.fn().mockResolvedValue({ replayed: false, state: "pending" }),
    revokeProfileFollower: vi.fn().mockResolvedValue({ replayed: false, state: "revoked" }),
    revokeProjectAccess: vi.fn().mockResolvedValue({ replayed: false, state: "revoked" }),
    search: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    unblockProfile: vi.fn().mockResolvedValue({ replayed: false, state: "unblocked" }),
    unfollowProject: vi.fn().mockResolvedValue({ replayed: false, state: "none" }),
  };
}

describe("social HTTP handler", () => {
  let actors: SocialActorResolver;
  let service: SocialHttpService;

  beforeEach(() => {
    actors = { resolveAppUserId: vi.fn().mockResolvedValue(actorId) };
    service = serviceMocks();
  });

  it("allows anonymous profile search and passes only server-resolved viewer state", async () => {
    vi.mocked(actors.resolveAppUserId).mockResolvedValue(null);
    const handler = createSocialHttpHandler({ actors, service });

    const response = await handler(
      new Request("https://app.buildy.test/api/social/profiles?q=bouw&limit=10"),
      requestId,
    );

    expect(response.status).toBe(200);
    expect(service.search).toHaveBeenCalledWith(null, { limit: "10", q: "bouw" });
  });

  it("ignores spoofed actor, owner and status fields in mutation bodies", async () => {
    const handler = createSocialHttpHandler({ actors, service });
    const response = await handler(
      new Request(`https://app.buildy.test/api/social/profiles/${targetId}/follow`, {
        body: JSON.stringify({
          actorId: targetId,
          ownerId: targetId,
          status: "active",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      requestId,
    );

    expect(response.status).toBe(200);
    expect(service.followProfile).toHaveBeenCalledWith(actorId, targetId);
    expect(service.followProfile).toHaveBeenCalledTimes(1);
  });

  it("rejects anonymous mutations before disclosing whether a target exists", async () => {
    vi.mocked(actors.resolveAppUserId).mockResolvedValue(null);
    const handler = createSocialHttpHandler({ actors, service });

    await expect(
      handler(
        new Request(`https://app.buildy.test/api/social/profiles/${targetId}/follow`, {
          method: "PUT",
        }),
        requestId,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(service.followProfile).not.toHaveBeenCalled();
  });

  it("routes project access decisions with the server actor as owner", async () => {
    const handler = createSocialHttpHandler({ actors, service });
    const response = await handler(
      new Request(
        `https://app.buildy.test/api/social/projects/${projectId}/access-requests/${targetId}/accept`,
        { method: "POST" },
      ),
      requestId,
    );

    expect(response.status).toBe(200);
    expect(service.acceptProjectAccess).toHaveBeenCalledWith(actorId, projectId, targetId);
  });

  it("serves project state and owner access requests only with a server-resolved actor", async () => {
    const handler = createSocialHttpHandler({ actors, service });
    const stateResponse = await handler(
      new Request(`https://app.buildy.test/api/social/projects/${projectId}/state`),
      requestId,
    );
    const accessResponse = await handler(
      new Request(`https://app.buildy.test/api/social/projects/${projectId}/access-requests`),
      requestId,
    );

    expect(stateResponse.status).toBe(200);
    expect(accessResponse.status).toBe(200);
    expect(service.projectState).toHaveBeenCalledWith(actorId, projectId);
    expect(service.projectAccess).toHaveBeenCalledWith(actorId, projectId);

    vi.mocked(actors.resolveAppUserId).mockResolvedValue(null);
    await expect(handler(
      new Request(`https://app.buildy.test/api/social/projects/${projectId}/state`),
      requestId,
    )).rejects.toMatchObject({ status: 401 });
  });

  it("maps inaccessible and unknown profiles to the same non-enumerating HTTP error", async () => {
    vi.mocked(service.profile).mockRejectedValue(new SocialError("TARGET_NOT_FOUND"));
    const handler = createSocialHttpHandler({ actors, service });

    await expect(
      handler(
        new Request(`https://app.buildy.test/api/social/profiles/${targetId}`),
        requestId,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Dit profiel of project bestaat niet of is niet toegankelijk.",
      status: 404,
    });
  });

  it("rejects duplicate query parameters and returns a local 404 for unknown routes", async () => {
    const handler = createSocialHttpHandler({ actors, service });
    await expect(
      handler(
        new Request("https://app.buildy.test/api/social/profiles?limit=10&limit=20"),
        requestId,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });

    const response = await handler(
      new Request("https://app.buildy.test/api/social/onbekend"),
      requestId,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", requestId },
    });
  });
});

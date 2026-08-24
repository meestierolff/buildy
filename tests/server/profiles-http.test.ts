// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnProfile, PublicProfile } from "../../shared/contracts/profiles";
import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { handleApiRequest } from "../../server/http/router";
import { ProfileError } from "../../server/profiles/errors";
import {
  createProfileHttpHandler,
  type ProfileHttpService,
} from "../../server/profiles/http";
import {
  configureDefaultProfileRuntime,
  handleDefaultProfileRequest,
  resetDefaultProfileRuntimeForTests,
} from "../../server/profiles/runtime";
import type { ProjectActorResolver } from "../../server/projects/actor";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "90000000-0000-4000-8000-000000000009";

const own: OwnProfile = {
  id: ACTOR_ID,
  displayName: "Ada",
  slug: "ada",
  bio: null,
  location: null,
  isPrivate: true,
  isPro: false,
  avatar: null,
  onboardedAt: null,
  version: 2,
  updatedAt: "2026-08-04T12:00:00.000Z",
};

const visible: PublicProfile = {
  id: OTHER_ID,
  displayName: "Noor",
  slug: "noor",
  bio: null,
  location: "Delft",
  isPrivate: false,
  isPro: false,
  avatar: null,
  viewerAccess: "public",
};

function serviceMocks(): ProfileHttpService {
  return {
    ownProfile: vi.fn().mockResolvedValue(own),
    publicProfile: vi.fn().mockResolvedValue(visible),
    updateOwnProfile: vi.fn().mockResolvedValue({ id: ACTOR_ID, version: 3, replayed: false }),
  };
}

describe("profile HTTP handler", () => {
  let actors: ProjectActorResolver;
  let service: ProfileHttpService;

  beforeEach(() => {
    actors = {
      resolve: vi.fn().mockResolvedValue({ kind: "authenticated", appUserId: ACTOR_ID }),
    };
    service = serviceMocks();
  });

  it("staat openbare profielreads toe met uitsluitend de vertrouwde viewer", async () => {
    vi.mocked(actors.resolve).mockResolvedValue({ kind: "anonymous" });
    const handler = createProfileHttpHandler({ actors, service });

    const response = await handler(
      new Request("https://app.buildy.test/api/profiles/Noor"),
      REQUEST_ID,
    );

    expect(response.status).toBe(200);
    expect(service.publicProfile).toHaveBeenCalledWith({ kind: "anonymous" }, "Noor");
    await expect(response.json()).resolves.toMatchObject({
      data: { id: OTHER_ID, slug: "noor" },
      meta: { requestId: REQUEST_ID },
    });
  });

  it("weigert anonymous eigen-profielreads vóór enige profieldisclosure", async () => {
    vi.mocked(actors.resolve).mockResolvedValue({ kind: "anonymous" });
    const handler = createProfileHttpHandler({ actors, service });

    await expect(handler(
      new Request("https://app.buildy.test/api/account/profile"),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(service.ownProfile).not.toHaveBeenCalled();
  });

  it("neemt de update-identiteit nooit over uit de body", async () => {
    const handler = createProfileHttpHandler({ actors, service });
    const input = {
      idempotencyKey: "profile-http-key-0001",
      expectedVersion: 2,
      displayName: "Ada Nieuw",
      userId: OTHER_ID,
    };

    const response = await handler(new Request("https://app.buildy.test/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }), REQUEST_ID);

    expect(response.status).toBe(200);
    expect(service.updateOwnProfile).toHaveBeenCalledWith(ACTOR_ID, input);
    expect(service.updateOwnProfile).not.toHaveBeenCalledWith(OTHER_ID, expect.anything());
  });

  it.each([
    ["VERSION_CONFLICT", "CONFLICT", 409],
    ["SLUG_CONFLICT", "CONFLICT", 409],
    ["PROFILE_NOT_FOUND", "NOT_FOUND", 404],
  ] as const)("vertaalt %s naar een stabiele HTTP-fout", async (reason, code, status) => {
    vi.mocked(service.updateOwnProfile).mockRejectedValue(new ProfileError(reason));
    const handler = createProfileHttpHandler({ actors, service });

    await expect(handler(new Request("https://app.buildy.test/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "profile-http-key-0002",
        expectedVersion: 2,
        displayName: "Ada Nieuw",
      }),
    }), REQUEST_ID)).rejects.toMatchObject({ code, status });
  });

  it("weigert querysmuggling, ongeldige JSON en onbekende routes lokaal", async () => {
    const handler = createProfileHttpHandler({ actors, service });

    await expect(handler(
      new Request(`https://app.buildy.test/api/account/profile?userId=${OTHER_ID}`),
      REQUEST_ID,
    )).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    await expect(handler(new Request("https://app.buildy.test/api/account/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{",
    }), REQUEST_ID)).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
    const missing = await handler(
      new Request("https://app.buildy.test/api/account/sessions"),
      REQUEST_ID,
    );
    expect(missing.status).toBe(404);
  });
});

describe("profile runtime", () => {
  beforeEach(() => resetDefaultProfileRuntimeForTests());

  it("faalt gesloten zolang de actorresolver niet is samengesteld", async () => {
    const response = await handleDefaultProfileRequest(
      new Request("https://app.buildy.test/api/account/profile"),
      REQUEST_ID,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_UNAVAILABLE", requestId: REQUEST_ID },
    });
  });
});

describe("profile routes in the central API router", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", "https://app.buildy.test");
    vi.stubEnv("DATABASE_URL", "");
    resetRuntimeConfigForTests();
    resetDefaultProfileRuntimeForTests();
  });

  afterEach(() => {
    resetDefaultProfileRuntimeForTests();
    resetRuntimeConfigForTests();
    vi.unstubAllEnvs();
  });

  it("registreert eigen reads/writes en openbare slugreads zonder prefixfallback", async () => {
    const actors: ProjectActorResolver = {
      resolve: vi.fn().mockResolvedValue({ kind: "authenticated", appUserId: ACTOR_ID }),
    };
    const service = serviceMocks();
    configureDefaultProfileRuntime({ actors, service });

    const ownResponse = await handleApiRequest(
      new Request("https://app.buildy.test/api/account/profile"),
    );
    const publicResponse = await handleApiRequest(
      new Request("https://app.buildy.test/api/profiles/noor"),
    );
    const mutationResponse = await handleApiRequest(
      new Request("https://app.buildy.test/api/account/profile", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://app.buildy.test",
        },
        body: JSON.stringify({
          idempotencyKey: "profile-router-key-0001",
          expectedVersion: 2,
          displayName: "Ada Nieuw",
        }),
      }),
    );

    expect(ownResponse.status).toBe(200);
    expect(publicResponse.status).toBe(200);
    expect(mutationResponse.status).toBe(200);
    expect(service.ownProfile).toHaveBeenCalledWith(ACTOR_ID);
    expect(service.publicProfile).toHaveBeenCalledWith(
      { kind: "authenticated", appUserId: ACTOR_ID },
      "noor",
    );
    expect(service.updateOwnProfile).toHaveBeenCalledWith(
      ACTOR_ID,
      expect.objectContaining({ expectedVersion: 2 }),
    );
  });
});

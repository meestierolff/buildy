// @vitest-environment node

import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";
import type {
  OwnProfile,
  ProfileMutationResult,
  PublicProfile,
} from "../../shared/contracts/profiles";
import { ProfileError } from "../../server/profiles/errors";
import {
  profileRequestHash,
  scopedProfileIdempotencyKey,
} from "../../server/profiles/idempotency";
import { buildProfileOutboxRecord } from "../../server/profiles/repository";
import { ProfileService } from "../../server/profiles/service";
import type { ProfileRepository } from "../../server/profiles/types";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "20000000-0000-4000-8000-000000000002";
const AVATAR_ID = "30000000-0000-4000-8000-000000000003";
const CLIENT_KEY = "profile-settings-key-0001";

const ownProfile: OwnProfile = {
  id: ACTOR_ID,
  displayName: "Ada Bouwer",
  slug: "ada-bouwer",
  bio: "Een jaren-dertigwoning in ere herstellen.",
  location: "Utrecht",
  isPrivate: true,
  isPro: false,
  avatar: {
    id: AVATAR_ID,
    contentType: "image/webp",
    width: 640,
    height: 640,
    proxyPath: `/api/media/${AVATAR_ID}`,
  },
  onboardedAt: null,
  version: 4,
  updatedAt: "2026-08-04T12:00:00.000Z",
};

const publicProfile: PublicProfile = {
  id: ACTOR_ID,
  displayName: ownProfile.displayName,
  slug: ownProfile.slug,
  bio: ownProfile.bio,
  location: ownProfile.location,
  isPrivate: false,
  isPro: false,
  avatar: ownProfile.avatar,
  viewerAccess: "public",
};

const mutation: ProfileMutationResult = {
  id: ACTOR_ID,
  version: 5,
  replayed: false,
};

function repository(overrides: Partial<ProfileRepository> = {}): ProfileRepository {
  return {
    findOwnProfile: async () => ownProfile,
    findPublicProfile: async () => publicProfile,
    updateOwnProfile: async () => mutation,
    ...overrides,
  };
}

describe("ProfileService reads", () => {
  it("leest het eigen profiel uitsluitend op basis van de vertrouwde actor", async () => {
    const findOwnProfile = vi.fn(async () => ownProfile);
    const service = new ProfileService(repository({ findOwnProfile }));

    await expect(service.ownProfile(ACTOR_ID.toUpperCase())).resolves.toEqual(ownProfile);
    expect(findOwnProfile).toHaveBeenCalledWith(ACTOR_ID);
  });

  it("normaliseert een publieke slug en behoudt anonymous viewer state", async () => {
    const findPublicProfile = vi.fn(async () => publicProfile);
    const service = new ProfileService(repository({ findPublicProfile }));

    await expect(service.publicProfile({ kind: "anonymous" }, " Ada-Bouwer "))
      .resolves.toEqual(publicProfile);
    expect(findPublicProfile).toHaveBeenCalledWith({ kind: "anonymous" }, "ada-bouwer");
  });

  it.each([
    "privé zonder follow",
    "wederzijds geblokkeerd",
    "geschorst of verwijderd",
    "onbekende slug",
  ])("gebruikt één niet-enumererende 404 voor %s", async () => {
    const service = new ProfileService(repository({ findPublicProfile: async () => null }));

    await expect(service.publicProfile({ kind: "anonymous" }, "onzichtbaar"))
      .rejects.toMatchObject({ reason: "PROFILE_NOT_FOUND", status: 404 });
  });

  it("faalt gesloten bij een ongeldige actor mapping", async () => {
    const service = new ProfileService(repository());

    await expect(service.ownProfile("provider-user-id"))
      .rejects.toMatchObject({ reason: "ACTOR_MAPPING_UNAVAILABLE", status: 503 });
  });
});

describe("ProfileService writes", () => {
  it("weigert IDOR-velden voordat het repository wordt aangeroepen", async () => {
    const updateOwnProfile = vi.fn(async (
      _command: Parameters<ProfileRepository["updateOwnProfile"]>[0],
    ) => mutation);
    const service = new ProfileService(repository({ updateOwnProfile }));

    await expect(service.updateOwnProfile(ACTOR_ID, {
      idempotencyKey: CLIENT_KEY,
      expectedVersion: 4,
      displayName: "Aanvaller",
      userId: OTHER_ID,
      isPro: true,
    })).rejects.toBeInstanceOf(ZodError);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("normaliseert profielvelden en maakt actor-scoped commandmetadata", async () => {
    const updateOwnProfile = vi.fn(async (
      _command: Parameters<ProfileRepository["updateOwnProfile"]>[0],
    ) => mutation);
    const service = new ProfileService(repository({ updateOwnProfile }));

    await service.updateOwnProfile(ACTOR_ID, {
      idempotencyKey: CLIENT_KEY,
      expectedVersion: 4,
      displayName: "  Ada Renovatie  ",
      slug: " Ada-Renovatie ",
      bio: "  Nieuwe bio.  ",
      location: null,
      isPrivate: false,
      avatarAssetId: AVATAR_ID,
    });

    const command = updateOwnProfile.mock.calls[0]?.[0];
    if (!command) throw new Error("Profielcommand ontbreekt in de test.");
    expect(command).toMatchObject({
      actorId: ACTOR_ID,
      input: {
        expectedVersion: 4,
        displayName: "Ada Renovatie",
        slug: "ada-renovatie",
        bio: "Nieuwe bio.",
        location: null,
        isPrivate: false,
        avatarAssetId: AVATAR_ID,
      },
    });
    expect(command.idempotencyKey).toMatch(/^profile-command:v1:profile\.update:[0-9a-f]{64}$/);
    expect(command.idempotencyKey).not.toContain(CLIENT_KEY);
    expect(command.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepteert alleen een eenrichtings-completion-intentie en nooit een clienttijdstip", async () => {
    const updateOwnProfile = vi.fn(async (
      _command: Parameters<ProfileRepository["updateOwnProfile"]>[0],
    ) => mutation);
    const service = new ProfileService(repository({ updateOwnProfile }));

    await service.updateOwnProfile(ACTOR_ID, {
      idempotencyKey: CLIENT_KEY,
      expectedVersion: 4,
      onboardingCompleted: true,
    });
    expect(updateOwnProfile.mock.calls[0]?.[0].input).toMatchObject({
      expectedVersion: 4,
      onboardingCompleted: true,
    });

    await expect(service.updateOwnProfile(ACTOR_ID, {
      idempotencyKey: "profile-settings-key-0002",
      expectedVersion: 4,
      onboardingCompleted: false,
    })).rejects.toBeInstanceOf(ZodError);
    await expect(service.updateOwnProfile(ACTOR_ID, {
      idempotencyKey: "profile-settings-key-0003",
      expectedVersion: 4,
      onboardedAt: "2026-08-04T12:00:00.000Z",
    })).rejects.toBeInstanceOf(ZodError);
    expect(updateOwnProfile).toHaveBeenCalledOnce();
  });

  it.each([
    ["VERSION_CONFLICT", "VERSION_CONFLICT"],
    ["SLUG_CONFLICT", "SLUG_CONFLICT"],
    ["AVATAR_UNAVAILABLE", "AVATAR_UNAVAILABLE"],
  ] as const)("behoudt het getypeerde repositoryconflict %s", async (reason, expected) => {
    const service = new ProfileService(repository({
      updateOwnProfile: async () => { throw new ProfileError(reason); },
    }));

    await expect(service.updateOwnProfile(ACTOR_ID, {
      idempotencyKey: CLIENT_KEY,
      expectedVersion: 4,
      displayName: "Nieuwe naam",
    })).rejects.toMatchObject({ reason: expected, status: reason === "AVATAR_UNAVAILABLE" ? 404 : 409 });
  });

  it("maakt deterministische actor-scoped idempotency zonder profiel-PII in de outbox", () => {
    const payload = { expectedVersion: 4, displayName: "Ada", isPrivate: false };
    const key = scopedProfileIdempotencyKey("profile.update", ACTOR_ID, CLIENT_KEY);
    const otherActorKey = scopedProfileIdempotencyKey("profile.update", OTHER_ID, CLIENT_KEY);
    const requestHash = profileRequestHash("profile.update", payload);
    const record = buildProfileOutboxRecord({
      actorId: ACTOR_ID,
      idempotencyKey: key,
      requestHash,
    }, 5);

    expect(key).not.toBe(otherActorKey);
    expect(record.payload).toEqual({ schemaVersion: 1, requestHash, profileVersion: 5 });
    expect(JSON.stringify(record.payload)).not.toMatch(/ada|display|slug|bio|location|avatar/i);
  });
});

import {
  profileSlugSchema,
  updateOwnProfileInputSchema,
  type OwnProfile,
  type ProfileMutationResult,
  type PublicProfile,
  type UpdateOwnProfileInput,
} from "../../shared/contracts/profiles.js";
import type { ProjectActor } from "../projects/actor.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";
import { ProfileError } from "./errors.js";
import { profileRequestHash, scopedProfileIdempotencyKey } from "./idempotency.js";
import type { ProfileRepository } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actorId(value: string): string {
  if (!UUID.test(value)) throw new ProfileError("ACTOR_MAPPING_UNAVAILABLE");
  return value.toLowerCase();
}

function normalizedViewer(viewer: ProjectActor): ProjectActor {
  return viewer.kind === "anonymous"
    ? viewer
    : { kind: "authenticated", appUserId: actorId(viewer.appUserId) };
}

function publicSlug(value: string): string {
  const parsed = profileSlugSchema.safeParse(value);
  if (!parsed.success) throw new ProfileError("PROFILE_NOT_FOUND");
  return parsed.data;
}

function withoutCommandFields(input: UpdateOwnProfileInput): Omit<
  UpdateOwnProfileInput,
  "idempotencyKey" | "expectedVersion"
> & { expectedVersion: number } {
  const { idempotencyKey: _idempotencyKey, ...payload } = input;
  return payload;
}

export class ProfileService {
  constructor(
    private readonly repository: ProfileRepository,
    private readonly blindIndex: PrivacyBlindIndex,
  ) {}

  async ownProfile(actorIdValue: string): Promise<OwnProfile> {
    const profile = await this.repository.findOwnProfile(actorId(actorIdValue));
    if (!profile) throw new ProfileError("PROFILE_NOT_FOUND");
    return profile;
  }

  async publicProfile(viewer: ProjectActor, slugValue: string): Promise<PublicProfile> {
    const profile = await this.repository.findPublicProfile(
      normalizedViewer(viewer),
      publicSlug(slugValue),
    );
    if (!profile) throw new ProfileError("PROFILE_NOT_FOUND");
    return profile;
  }

  async updateOwnProfile(
    actorIdValue: string,
    rawInput: unknown,
  ): Promise<ProfileMutationResult> {
    const actor = actorId(actorIdValue);
    const input = updateOwnProfileInputSchema.parse(rawInput);
    const operation = "profile.update" as const;
    const payload = withoutCommandFields(input);
    return this.repository.updateOwnProfile({
      actorId: actor,
      input,
      idempotencyKey: scopedProfileIdempotencyKey(operation, actor, input.idempotencyKey),
      requestHash: profileRequestHash(operation, payload, this.blindIndex),
    });
  }
}

import {
  ownProfileResponseSchema,
  profileMutationResponseSchema,
  profileSlugSchema,
  publicProfileResponseSchema,
  updateOwnProfileInputSchema,
  type OwnProfile,
  type ProfileMutationResult,
  type PublicProfile,
  type UpdateOwnProfileInput,
} from "../../shared/contracts/profiles";
import { apiRequest } from "./apiClient";

const OWN_PROFILE_PATH = "/api/account/profile" as const;

function publicProfilePath(slugValue: string): `/api/profiles/${string}` {
  const slug = profileSlugSchema.parse(slugValue);
  return `/api/profiles/${encodeURIComponent(slug)}`;
}

export async function getOwnProfile(signal?: AbortSignal): Promise<OwnProfile> {
  return (await apiRequest(
    OWN_PROFILE_PATH,
    ownProfileResponseSchema,
    { signal },
  )).data;
}

export async function getPublicProfile(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicProfile> {
  return (await apiRequest(
    publicProfilePath(slug),
    publicProfileResponseSchema,
    { signal },
  )).data;
}

export async function updateOwnProfile(
  inputValue: UpdateOwnProfileInput,
): Promise<ProfileMutationResult> {
  const input = updateOwnProfileInputSchema.parse(inputValue);
  return (await apiRequest(
    OWN_PROFILE_PATH,
    profileMutationResponseSchema,
    { method: "PATCH", body: input },
  )).data;
}

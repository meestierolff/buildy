import { z } from "zod";
import {
  projectAccessListResponseSchema,
  projectSocialStateResponseSchema,
  profileSearchQuerySchema,
  socialMutationResponseSchema,
  socialProfilePageResponseSchema,
  socialProfileResponseSchema,
  type SocialMutationResult,
  type ProjectAccessList,
  type ProjectSocialState,
  type SocialProfile,
  type SocialProfilePage,
} from "../../shared/contracts/social";
import { apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();

export type SocialProfileSearch = {
  cursor?: string;
  limit?: number;
  q?: string;
};

function encodedId(value: string): string {
  return encodeURIComponent(uuidSchema.parse(value));
}

function socialPath(suffix: string): `/api/social/${string}` {
  return `/api/social/${suffix}`;
}

function profilePath(profileId: string, suffix = ""): `/api/social/${string}` {
  return socialPath(`profiles/${encodedId(profileId)}${suffix}`);
}

function projectPath(projectId: string, suffix: string): `/api/social/${string}` {
  return socialPath(`projects/${encodedId(projectId)}${suffix}`);
}

async function socialMutation(
  path: `/api/social/${string}`,
  method: "POST" | "PUT" | "DELETE",
): Promise<SocialMutationResult> {
  return (await apiRequest(path, socialMutationResponseSchema, { method })).data;
}

export async function getSocialProfile(
  profileId: string,
  signal?: AbortSignal,
): Promise<SocialProfile> {
  return (await apiRequest(
    profilePath(profileId),
    socialProfileResponseSchema,
    { signal },
  )).data;
}

export async function searchSocialProfiles(
  input: SocialProfileSearch = {},
  signal?: AbortSignal,
): Promise<SocialProfilePage> {
  const parsed = profileSearchQuerySchema.parse({
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.q?.trim() ? { q: input.q.trim() } : {}),
  });
  const query = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) query.set("cursor", parsed.cursor);
  if (parsed.q) query.set("q", parsed.q);
  return (await apiRequest(
    `/api/social/profiles?${query.toString()}`,
    socialProfilePageResponseSchema,
    { signal },
  )).data;
}

export function followSocialProfile(profileId: string): Promise<SocialMutationResult> {
  return socialMutation(profilePath(profileId, "/follow"), "PUT");
}

export function removeSocialProfileFollow(profileId: string): Promise<SocialMutationResult> {
  return socialMutation(profilePath(profileId, "/follow"), "DELETE");
}

export function blockSocialProfile(profileId: string): Promise<SocialMutationResult> {
  return socialMutation(profilePath(profileId, "/block"), "PUT");
}

export function unblockSocialProfile(profileId: string): Promise<SocialMutationResult> {
  return socialMutation(profilePath(profileId, "/block"), "DELETE");
}

export function acceptSocialFollowRequest(requesterId: string): Promise<SocialMutationResult> {
  return socialMutation(
    socialPath(`follow-requests/${encodedId(requesterId)}/accept`),
    "POST",
  );
}

export function rejectSocialFollowRequest(requesterId: string): Promise<SocialMutationResult> {
  return socialMutation(
    socialPath(`follow-requests/${encodedId(requesterId)}/reject`),
    "POST",
  );
}

export function removeSocialFollower(followerId: string): Promise<SocialMutationResult> {
  return socialMutation(socialPath(`followers/${encodedId(followerId)}`), "DELETE");
}

export function followSocialProject(projectId: string): Promise<SocialMutationResult> {
  return socialMutation(projectPath(projectId, "/follow"), "PUT");
}

export async function getSocialProjectState(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectSocialState> {
  return (await apiRequest(
    projectPath(projectId, "/state"),
    projectSocialStateResponseSchema,
    { signal },
  )).data;
}

export async function getSocialProjectAccess(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectAccessList> {
  return (await apiRequest(
    projectPath(projectId, "/access-requests"),
    projectAccessListResponseSchema,
    { signal },
  )).data;
}

export function unfollowSocialProject(projectId: string): Promise<SocialMutationResult> {
  return socialMutation(projectPath(projectId, "/follow"), "DELETE");
}

export function requestSocialProjectAccess(projectId: string): Promise<SocialMutationResult> {
  return socialMutation(projectPath(projectId, "/access"), "PUT");
}

export function cancelSocialProjectAccess(projectId: string): Promise<SocialMutationResult> {
  return socialMutation(projectPath(projectId, "/access"), "DELETE");
}

export function acceptSocialProjectAccess(
  projectId: string,
  requesterId: string,
): Promise<SocialMutationResult> {
  return socialMutation(
    projectPath(projectId, `/access-requests/${encodedId(requesterId)}/accept`),
    "POST",
  );
}

export function rejectSocialProjectAccess(
  projectId: string,
  requesterId: string,
): Promise<SocialMutationResult> {
  return socialMutation(
    projectPath(projectId, `/access-requests/${encodedId(requesterId)}/reject`),
    "POST",
  );
}

export function revokeSocialProjectAccess(
  projectId: string,
  requesterId: string,
): Promise<SocialMutationResult> {
  return socialMutation(
    projectPath(projectId, `/access-requests/${encodedId(requesterId)}`),
    "DELETE",
  );
}

export async function resolveVisibleMentionSlugs(
  slugs: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const unique = [...new Set(slugs.map((slug) => slug.toLocaleLowerCase("nl-NL")))];
  const pages = await Promise.all(unique.map((slug) => searchSocialProfiles({ q: slug, limit: 10 }, signal)));
  const resolved = new Map<string, string>();
  pages.forEach((page, index) => {
    const slug = unique[index];
    const profile = page.items.find(
      (item) => item.slug.toLocaleLowerCase("nl-NL") === slug,
    );
    if (profile) resolved.set(slug, profile.id);
  });
  return resolved;
}

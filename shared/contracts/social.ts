import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

const uuidSchema = z.string().uuid();
const opaqueCursorSchema = z.string().min(1).max(2_048);

export const socialRoutes = {
  profiles: "/api/social/profiles",
  profile: "/api/social/profiles/:profileId",
  profileFollow: "/api/social/profiles/:profileId/follow",
  profileBlock: "/api/social/profiles/:profileId/block",
  followRequestAccept: "/api/social/follow-requests/:requesterId/accept",
  followRequestReject: "/api/social/follow-requests/:requesterId/reject",
  follower: "/api/social/followers/:followerId",
  projectFollow: "/api/social/projects/:projectId/follow",
  projectState: "/api/social/projects/:projectId/state",
  projectAccess: "/api/social/projects/:projectId/access",
  projectAccessRequests: "/api/social/projects/:projectId/access-requests",
  projectAccessAccept:
    "/api/social/projects/:projectId/access-requests/:requesterId/accept",
  projectAccessReject:
    "/api/social/projects/:projectId/access-requests/:requesterId/reject",
  projectAccessRevoke:
    "/api/social/projects/:projectId/access-requests/:requesterId",
} as const;

export const profileSearchQuerySchema = z
  .object({
    cursor: opaqueCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    q: z.string().trim().min(2).max(80).optional(),
  })
  .strict();

export const profileAvatarSchema = z.object({
  contentType: z.string().nullable(),
  height: z.number().int().positive().nullable(),
  id: uuidSchema,
  proxyPath: z.string(),
  width: z.number().int().positive().nullable(),
});

export const socialProfileSchema = z.object({
  avatar: profileAvatarSchema.nullable(),
  bio: z.string().nullable(),
  displayName: z.string(),
  followerCount: z.number().int().nonnegative(),
  followingCount: z.number().int().nonnegative(),
  followsViewer: z.boolean(),
  id: uuidSchema,
  isPrivate: z.boolean(),
  isPro: z.boolean(),
  location: z.string().nullable(),
  slug: z.string(),
  viewerAccess: z.enum(["owner", "public", "follower"]),
  viewerFollowStatus: z.enum(["self", "none", "pending", "following"]),
});

export const socialProfilePageSchema = z.object({
  items: z.array(socialProfileSchema),
  nextCursor: opaqueCursorSchema.nullable(),
});

export const socialMutationStateSchema = z.enum([
  "accepted",
  "blocked",
  "cancelled",
  "following",
  "none",
  "pending",
  "rejected",
  "revoked",
  "unblocked",
]);

export const socialMutationResultSchema = z.object({
  replayed: z.boolean(),
  state: socialMutationStateSchema,
});

export const socialProfileResponseSchema = apiSuccessSchema(socialProfileSchema);
export const socialProfilePageResponseSchema = apiSuccessSchema(socialProfilePageSchema);
export const socialMutationResponseSchema = apiSuccessSchema(socialMutationResultSchema);

export const projectSocialStateSchema = z.object({
  projectId: uuidSchema,
  viewerRole: z.enum(["owner", "viewer"]),
  followStatus: z.enum(["following", "none"]),
  accessStatus: z.enum(["owner", "not_required", "none", "pending", "accepted"]),
});

export const projectAccessEntrySchema = z.object({
  requesterId: uuidSchema,
  displayName: z.string(),
  avatar: profileAvatarSchema.nullable(),
  status: z.enum(["pending", "accepted"]),
  requestedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const projectAccessListSchema = z.object({
  projectId: uuidSchema,
  items: z.array(projectAccessEntrySchema),
});

export const projectSocialStateResponseSchema = apiSuccessSchema(projectSocialStateSchema);
export const projectAccessListResponseSchema = apiSuccessSchema(projectAccessListSchema);

export type ProfileSearchQuery = z.infer<typeof profileSearchQuerySchema>;
export type SocialMutationResult = z.infer<typeof socialMutationResultSchema>;
export type SocialMutationState = z.infer<typeof socialMutationStateSchema>;
export type SocialProfile = z.infer<typeof socialProfileSchema>;
export type SocialProfilePage = z.infer<typeof socialProfilePageSchema>;
export type ProjectSocialState = z.infer<typeof projectSocialStateSchema>;
export type ProjectAccessEntry = z.infer<typeof projectAccessEntrySchema>;
export type ProjectAccessList = z.infer<typeof projectAccessListSchema>;

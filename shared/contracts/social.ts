import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

const uuidSchema = z.string().uuid();
const opaqueCursorSchema = z.string().min(1).max(2_048);

export const socialRoutes = {
  connections: "/api/social/connections",
  profiles: "/api/social/profiles",
  profile: "/api/social/profiles/:profileId",
  profileFollow: "/api/social/profiles/:profileId/follow",
  profileBlock: "/api/social/profiles/:profileId/block",
  followRequestAccept: "/api/social/follow-requests/:requesterId/accept",
  followRequestReject: "/api/social/follow-requests/:requesterId/reject",
  follower: "/api/social/followers/:followerId",
} as const;

export const socialConnectionViewSchema = z.enum([
  "following",
  "followers",
  "incoming",
  "outgoing",
  "blocked",
]);

export const socialConnectionQuerySchema = z
  .object({
    cursor: opaqueCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    view: socialConnectionViewSchema.default("following"),
  })
  .strict();

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
  viewerAccess: z.enum(["owner", "public", "follower", "requestable"]),
  viewerFollowStatus: z.enum(["self", "none", "pending", "following"]),
});

export const socialProfilePageSchema = z.object({
  items: z.array(socialProfileSchema),
  nextCursor: opaqueCursorSchema.nullable(),
});

export const socialConnectionSchema = z.object({
  avatar: profileAvatarSchema.nullable(),
  displayName: z.string(),
  followsViewer: z.boolean(),
  id: uuidSchema,
  isPrivate: z.boolean(),
  relationshipAt: z.string().datetime(),
  slug: z.string(),
  viewerFollowStatus: z.enum(["none", "pending", "following"]),
});

export const socialConnectionPageSchema = z.object({
  items: z.array(socialConnectionSchema),
  nextCursor: opaqueCursorSchema.nullable(),
  total: z.number().int().nonnegative(),
  view: socialConnectionViewSchema,
});

export const socialMutationStateSchema = z.enum([
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
export const socialConnectionPageResponseSchema = apiSuccessSchema(socialConnectionPageSchema);
export const socialMutationResponseSchema = apiSuccessSchema(socialMutationResultSchema);

export type ProfileSearchQuery = z.infer<typeof profileSearchQuerySchema>;
export type SocialConnection = z.infer<typeof socialConnectionSchema>;
export type SocialConnectionPage = z.infer<typeof socialConnectionPageSchema>;
export type SocialConnectionQuery = z.infer<typeof socialConnectionQuerySchema>;
export type SocialConnectionView = z.infer<typeof socialConnectionViewSchema>;
export type SocialMutationResult = z.infer<typeof socialMutationResultSchema>;
export type SocialMutationState = z.infer<typeof socialMutationStateSchema>;
export type SocialProfile = z.infer<typeof socialProfileSchema>;
export type SocialProfilePage = z.infer<typeof socialProfilePageSchema>;

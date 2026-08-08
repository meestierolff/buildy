import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

const uuidSchema = z.string().uuid();
const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Idempotency-key bevat ongeldige tekens.");

export const profileRoutes = {
  own: "/api/account/profile",
  public: "/api/profiles/:slug",
} as const;

export const profileSlugSchema = z.string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Een profielslug mag alleen kleine letters, cijfers en verbindingsstreepjes bevatten.",
  );

export const profileAvatarSchema = z.object({
  id: uuidSchema,
  contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/i),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  proxyPath: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
});

const profileFieldsSchema = z.object({
  id: uuidSchema,
  displayName: z.string().min(1).max(80),
  slug: profileSlugSchema,
  bio: z.string().max(500).nullable(),
  location: z.string().max(120).nullable(),
  isPrivate: z.boolean(),
  isPro: z.boolean(),
  avatar: profileAvatarSchema.nullable(),
});

export const ownProfileSchema = profileFieldsSchema.extend({
  onboardedAt: z.string().datetime().nullable(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export const publicProfileSchema = profileFieldsSchema.extend({
  viewerAccess: z.enum(["owner", "public", "follower"]),
});

export const updateOwnProfileInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(80).optional(),
  slug: profileSlugSchema.optional(),
  bio: z.string().trim().min(1).max(500).nullable().optional(),
  location: z.string().trim().min(1).max(120).nullable().optional(),
  isPrivate: z.boolean().optional(),
  avatarAssetId: uuidSchema.nullable().optional(),
  onboardingCompleted: z.literal(true).optional(),
}).strict().refine(
  (input) => Object.keys(input).some(
    (key) => !["idempotencyKey", "expectedVersion"].includes(key),
  ),
  { message: "Geef minimaal één profielwijziging op." },
);

export const profileMutationResultSchema = z.object({
  id: uuidSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});

export const ownProfileResponseSchema = apiSuccessSchema(ownProfileSchema);
export const publicProfileResponseSchema = apiSuccessSchema(publicProfileSchema);
export const profileMutationResponseSchema = apiSuccessSchema(profileMutationResultSchema);

export type ProfileAvatar = z.infer<typeof profileAvatarSchema>;
export type OwnProfile = z.infer<typeof ownProfileSchema>;
export type PublicProfile = z.infer<typeof publicProfileSchema>;
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileInputSchema>;
export type ProfileMutationResult = z.infer<typeof profileMutationResultSchema>;

import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const mediaRoutes = {
  uploadIntents: "/api/media/upload-intents",
  blobUpload: "/api/media/:assetId/blob-upload",
  blobUploadCompleted: "/api/media/blob-upload-completed",
  completeUpload: "/api/media/:assetId/complete",
  display: "/api/media/:assetId",
  originalGrant: "/api/media/:assetId/original-grant",
  original: "/api/media/:assetId/original",
} as const;

export const mediaUploadPurposeSchema = z.enum([
  "project_media",
  "project_cover",
  "floorplan",
]);

export const projectImageContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

export const sha256Base64Schema = z.string().regex(
  /^[A-Za-z0-9+/]{43}=$/,
  "Checksum moet een base64-gecodeerde SHA-256 zijn.",
);

const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Idempotency-key bevat ongeldige tekens.");

export const createMediaUploadIntentInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  projectId: z.string().uuid(),
  purpose: mediaUploadPurposeSchema,
  contentType: projectImageContentTypeSchema,
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  checksumSha256Base64: sha256Base64Schema,
}).strict();

export const completeMediaUploadInputSchema = z.object({}).strict();

export const mediaAssetStateSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  purpose: mediaUploadPurposeSchema,
  status: z.enum(["pending_upload", "uploaded", "processing", "ready", "failed"]),
});

export const mediaUploadGrantSchema = z.object({
  provider: z.literal("vercel_blob"),
  method: z.literal("POST"),
  pathname: z.string().regex(
    /^temporary\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
  handleUploadPath: z.string().regex(
    /^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/blob-upload$/,
  ),
  exactSizeBytes: z.number().int().positive(),
});

export const mediaUploadIntentSchema = z.object({
  asset: mediaAssetStateSchema,
  upload: mediaUploadGrantSchema.nullable(),
  replayed: z.boolean(),
});

export const mediaUploadCompletionSchema = z.object({
  asset: mediaAssetStateSchema,
  replayed: z.boolean(),
});

export const mediaDisplaySizeSchema = z.enum(["small", "medium", "large"]);
export const mediaPrivacyVersionSchema = z.string().regex(/^[1-9][0-9]*\.[1-9][0-9]*$/);
export const mediaDisplayQuerySchema = z.object({
  size: mediaDisplaySizeSchema.default("medium"),
  v: mediaPrivacyVersionSchema.optional(),
}).strict();

export const originalMediaPurposeSchema = z.enum(["photobook", "export"]);
export const originalMediaGrantInputSchema = z.object({
  purpose: originalMediaPurposeSchema,
}).strict();

export const originalMediaGrantSchema = z.object({
  path: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}\/original$/i),
  purpose: originalMediaPurposeSchema,
  expiresAt: z.string().datetime(),
  requiredHeaders: z.object({
    "x-buildy-media-purpose-grant": z.string().min(32).max(512),
  }),
});

export const mediaUploadIntentResponseSchema = apiSuccessSchema(mediaUploadIntentSchema);
export const mediaUploadCompletionResponseSchema = apiSuccessSchema(mediaUploadCompletionSchema);
export const originalMediaGrantResponseSchema = apiSuccessSchema(originalMediaGrantSchema);

export type MediaUploadPurpose = z.infer<typeof mediaUploadPurposeSchema>;
export type ProjectImageContentType = z.infer<typeof projectImageContentTypeSchema>;
export type CreateMediaUploadIntentInput = z.infer<typeof createMediaUploadIntentInputSchema>;
export type MediaAssetState = z.infer<typeof mediaAssetStateSchema>;
export type MediaUploadIntent = z.infer<typeof mediaUploadIntentSchema>;
export type MediaUploadCompletion = z.infer<typeof mediaUploadCompletionSchema>;
export type MediaDisplaySize = z.infer<typeof mediaDisplaySizeSchema>;
export type MediaDisplayQuery = z.infer<typeof mediaDisplayQuerySchema>;
export type OriginalMediaPurpose = z.infer<typeof originalMediaPurposeSchema>;
export type OriginalMediaGrant = z.infer<typeof originalMediaGrantSchema>;

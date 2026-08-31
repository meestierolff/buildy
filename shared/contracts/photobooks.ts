import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const LAUNCH_PHOTOBOOK_FORMAT = "a4-landscape-hardcover-v1" as const;
export const LAUNCH_PHOTOBOOK_MIN_PAGES = 24;

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const millimetresSchema = z.number().finite().nonnegative().max(1_000);
const normalizedSchema = z.number().finite().min(0).max(1);

export const photobookFormatSchema = z.literal(LAUNCH_PHOTOBOOK_FORMAT);

export const photobookLayoutSchema = z.enum(["auto", "one", "two", "three", "grid"]);

export const photobookPrintSpecSchema = z.object({
  widthMm: z.literal(297),
  heightMm: z.literal(210),
  safeMarginMm: z.literal(12),
  bleedMm: z.literal(0),
  targetDpi: z.literal(300),
  colorSpace: z.literal("RGB"),
}).strict();

export const photobookCropSchema = z.object({
  fit: z.enum(["cover", "contain"]),
  focusX: normalizedSchema,
  focusY: normalizedSchema,
  zoom: z.number().finite().min(1).max(4),
}).strict().refine((crop) => crop.fit === "cover" || crop.zoom === 1, {
  message: "Contain-weergave ondersteunt geen zoom omdat er dan geen crop meer gegarandeerd is.",
  path: ["zoom"],
});

export const photobookPreferencesSchema = z.object({
  coverCrop: photobookCropSchema.nullable().default(null),
  cropByAsset: z.record(uuidSchema, photobookCropSchema).default({}),
  photoOrderByUpdate: z.record(uuidSchema, z.array(uuidSchema).max(100)).default({}),
  layoutByPage: z.record(z.string().min(1).max(180), photobookLayoutSchema).default({}),
}).strict();

export const photobookSettingsSchema = z.object({
  coverMediaAssetId: uuidSchema.nullable(),
  selectedFormat: photobookFormatSchema,
  title: z.string().trim().min(1).max(160).nullable(),
  subtitle: z.string().trim().max(240).nullable(),
  includeBudget: z.boolean(),
  preferences: photobookPreferencesSchema,
  version: z.number().int().positive(),
}).strict();

export const updatePhotobookSettingsInputSchema = photobookSettingsSchema
  .omit({ selectedFormat: true })
  .extend({
    selectedFormat: photobookFormatSchema.default(LAUNCH_PHOTOBOOK_FORMAT),
  })
  .strict();

export const photobookExclusionSchema = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("update"), updateId: uuidSchema }).strict(),
  z.object({ targetType: z.literal("media"), mediaAssetId: uuidSchema }).strict(),
  z.object({ targetType: z.literal("chapter"), chapterKey: z.string().trim().min(1).max(180) }).strict(),
]);

export const replacePhotobookExclusionsInputSchema = z.object({
  exclusions: z.array(photobookExclusionSchema).max(5_000),
}).strict();

export const requestPhotobookProofInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedDraftVersion: z.number().int().positive(),
  expectedDocumentSha256: sha256Schema,
}).strict();

export const approvePhotobookProofInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  documentSha256: sha256Schema,
  pdfSha256: sha256Schema,
  proofViewed: z.literal(true),
}).strict();

const blockFrameSchema = z.object({
  xMm: millimetresSchema,
  yMm: millimetresSchema,
  widthMm: millimetresSchema.positive(),
  heightMm: millimetresSchema.positive(),
}).strict();

export const photobookTextBlockSchema = z.object({
  id: z.string().min(1).max(180),
  type: z.literal("text"),
  frame: blockFrameSchema,
  font: z.enum(["inter", "instrument-serif"]),
  weight: z.enum(["regular", "semibold"]),
  style: z.enum(["normal", "italic"]),
  fontSizePt: z.number().finite().min(6).max(72),
  lineHeightPt: z.number().finite().min(7).max(90),
  align: z.enum(["left", "center", "right"]),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  text: z.string().max(20_000),
  lines: z.array(z.string().max(1_000)).max(250),
}).strict();

export const photobookPhotoBlockSchema = z.object({
  id: z.string().min(1).max(180),
  type: z.literal("photo"),
  frame: blockFrameSchema,
  assetId: uuidSchema,
  crop: photobookCropSchema,
  effectiveDpi: z.number().finite().nonnegative(),
  altText: z.string().max(500),
}).strict();

export const photobookBlockSchema = z.discriminatedUnion("type", [
  photobookTextBlockSchema,
  photobookPhotoBlockSchema,
]);

export const photobookPageSchema = z.object({
  id: z.string().min(1).max(180),
  number: z.number().int().positive(),
  kind: z.enum(["cover", "chapter", "update_text", "photos", "blank"]),
  chapterId: z.string().min(1).max(180).nullable(),
  updateId: uuidSchema.nullable(),
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  overlay: z.object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    opacity: z.number().finite().min(0).max(1),
  }).strict().nullable(),
  blocks: z.array(photobookBlockSchema).max(20),
}).strict();

export const photobookChapterSchema = z.object({
  id: z.string().min(1).max(180),
  key: z.string().min(1).max(180),
  title: z.string().min(1).max(160),
  updateIds: z.array(uuidSchema).max(1_000),
  firstPageNumber: z.number().int().positive(),
}).strict();

export const photobookSourceAssetSchema = z.object({
  id: uuidSchema,
  sha256: sha256Schema,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  widthPixels: z.number().int().positive(),
  heightPixels: z.number().int().positive(),
}).strict();

export const photobookWarningSchema = z.object({
  code: z.enum([
    "LOW_EFFECTIVE_DPI",
    "EXTREME_CROP",
    "MISSING_ASSET",
    "INVALID_IMAGE_METADATA",
    "PAGE_LIMIT_EXCEEDED",
    "TEXT_OVERFLOW",
  ]),
  severity: z.enum(["warning", "blocking"]),
  pageNumber: z.number().int().positive().nullable(),
  assetId: uuidSchema.nullable(),
  updateId: uuidSchema.nullable(),
  message: z.string().min(1).max(500),
}).strict();

export const photobookCoverSchema = z.object({
  title: z.string().min(1).max(160),
  subtitle: z.string().max(240),
  mediaAssetId: uuidSchema.nullable(),
  crop: photobookCropSchema.nullable(),
}).strict();

export const photobookDocumentSchema = z.object({
  version: z.literal(1),
  projectId: uuidSchema,
  projectRevision: z.number().int().positive(),
  selectedFormat: photobookFormatSchema,
  locale: z.literal("nl-NL"),
  print: photobookPrintSpecSchema,
  cover: photobookCoverSchema,
  chapters: z.array(photobookChapterSchema).max(250),
  pages: z.array(photobookPageSchema).min(LAUNCH_PHOTOBOOK_MIN_PAGES).max(400),
  sourceAssets: z.array(photobookSourceAssetSchema).max(5_000),
  sourceAssetIds: z.array(uuidSchema).max(5_000),
  pageCount: z.number().int().min(LAUNCH_PHOTOBOOK_MIN_PAGES).max(400),
  warnings: z.array(photobookWarningSchema).max(10_000),
  checksumSha256: sha256Schema,
}).strict().superRefine((document, context) => {
  if (document.pageCount !== document.pages.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "pageCount komt niet overeen met het canonical paginamodel.",
      path: ["pageCount"],
    });
  }
  if (document.pageCount % 2 !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Een printproof moet een even aantal pagina's hebben.",
      path: ["pageCount"],
    });
  }
  document.pages.forEach((page, index) => {
    if (page.number !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Paginanummers moeten aaneengesloten en één-gebaseerd zijn.",
        path: ["pages", index, "number"],
      });
    }
  });
  const assetIds = document.sourceAssets.map((asset) => asset.id);
  if (new Set(assetIds).size !== assetIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bronassets moeten uniek zijn.",
      path: ["sourceAssets"],
    });
  }
  if (
    assetIds.length !== document.sourceAssetIds.length
    || assetIds.some((id, index) => id !== document.sourceAssetIds[index])
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sourceAssetIds moet exact de canonical bronassetvolgorde bevatten.",
      path: ["sourceAssetIds"],
    });
  }
});

export const photobookDraftResponseSchema = apiSuccessSchema(z.object({
  draftId: uuidSchema,
  version: z.number().int().positive(),
  settings: photobookSettingsSchema,
  exclusions: z.array(photobookExclusionSchema),
  document: photobookDocumentSchema,
  proof: z.object({
    revisionId: uuidSchema,
    status: z.enum(["draft", "rendering", "ready", "approved", "locked", "invalidated", "failed"]),
    documentSha256: sha256Schema,
    pdfSha256: sha256Schema.nullable(),
    pageCount: z.number().int().positive().nullable(),
    pdfPath: z.string().regex(/^\/api\/photobooks\/proofs\/[0-9a-f-]{36}\/pdf$/i).nullable(),
    thumbnailPaths: z.array(z.string().regex(/^\/api\/photobooks\/proofs\/[0-9a-f-]{36}\/pages\/[1-9][0-9]*$/i)),
  }).nullable(),
}));

export const photobookProofMutationResponseSchema = apiSuccessSchema(z.object({
  revisionId: uuidSchema,
  status: z.enum(["rendering", "ready", "approved", "locked", "invalidated", "failed"]),
  replayed: z.boolean(),
}));

export type PhotobookCrop = z.infer<typeof photobookCropSchema>;
export type PhotobookLayout = z.infer<typeof photobookLayoutSchema>;
export type PhotobookPreferences = z.infer<typeof photobookPreferencesSchema>;
export type PhotobookSettings = z.infer<typeof photobookSettingsSchema>;
export type PhotobookExclusion = z.infer<typeof photobookExclusionSchema>;
export type PhotobookBlock = z.infer<typeof photobookBlockSchema>;
export type PhotobookPage = z.infer<typeof photobookPageSchema>;
export type PhotobookChapter = z.infer<typeof photobookChapterSchema>;
export type PhotobookSourceAsset = z.infer<typeof photobookSourceAssetSchema>;
export type PhotobookWarning = z.infer<typeof photobookWarningSchema>;
export type PhotobookDocument = z.infer<typeof photobookDocumentSchema>;

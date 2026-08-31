import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const projectRoutes = {
  collection: "/api/projects",
  discovery: "/api/discovery",
  following: "/api/following",
  detail: "/api/projects/:projectId",
  updates: "/api/projects/:projectId/updates",
  updateDetail: "/api/projects/:projectId/updates/:updateId",
  phases: "/api/projects/:projectId/phases",
} as const;

const uuidSchema = z.string().uuid();
const trimmedOptionalText = (maximum: number) => z.string().trim().min(1).max(maximum).optional();
const nullableTrimmedText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();

export const projectVisibilitySchema = z.enum([
  "private",
  "followers",
  "unlisted",
  "public",
]);

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}, "Datum bestaat niet.");

export const opaqueCursorSchema = z.string().min(1).max(512);
export const projectPageQuerySchema = z.object({
  cursor: opaqueCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const followingFeedQuerySchema = z.object({
  projectLimit: z.coerce.number().int().min(1).max(50).default(50),
  activityLimit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const projectPrivateDetailsInputSchema = z.object({
  addressLine1: trimmedOptionalText(200),
  addressLine2: trimmedOptionalText(200),
  postalCode: trimmedOptionalText(32),
  city: trimmedOptionalText(120),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
  contractorNotes: trimmedOptionalText(5_000),
}).strict();

export const createProjectInputSchema = z.object({
  idempotencyKey: z.string()
    .trim()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9:_-]+$/, "Idempotency-key bevat ongeldige tekens."),
  title: z.string().trim().min(1).max(120),
  description: trimmedOptionalText(5_000),
  projectType: trimmedOptionalText(80),
  startDate: isoDateSchema.optional(),
  expectedEndDate: isoDateSchema.optional(),
  privateDetails: projectPrivateDetailsInputSchema.optional(),
}).strict().superRefine((input, context) => {
  if (input.startDate && input.expectedEndDate && input.expectedEndDate < input.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "De verwachte einddatum mag niet vóór de startdatum liggen.",
      path: ["expectedEndDate"],
    });
  }
});

export const updateProjectInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  description: nullableTrimmedText(5_000),
  projectType: nullableTrimmedText(80),
  startDate: isoDateSchema.nullable().optional(),
  expectedEndDate: isoDateSchema.nullable().optional(),
  visibility: projectVisibilitySchema.optional(),
  progressPercentage: z.number().int().min(0).max(100).optional(),
}).strict().refine(
  (input) => Object.keys(input).some((key) => key !== "expectedVersion"),
  { message: "Geef minimaal één projectwijziging op." },
);

export const updateMediaInputSchema = z.object({
  assetId: uuidSchema,
  role: z.enum(["gallery", "before", "after"]).default("gallery"),
  sortOrder: z.number().int().min(0).max(500),
  caption: trimmedOptionalText(500),
}).strict();

function validateUpdateMedia(
  mediaItems: ReadonlyArray<z.infer<typeof updateMediaInputSchema>>,
  context: z.RefinementCtx,
  pathPrefix: Array<string | number> = ["media"],
): void {
  const assetIds = new Set<string>();
  const sortOrders = new Set<number>();
  const singularRoles = new Set<"before" | "after">();
  for (const [index, media] of mediaItems.entries()) {
    if (assetIds.has(media.assetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Media-asset staat dubbel in de update.",
        path: [...pathPrefix, index, "assetId"],
      });
    }
    if (sortOrders.has(media.sortOrder)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mediasortering moet uniek zijn.",
        path: [...pathPrefix, index, "sortOrder"],
      });
    }
    if ((media.role === "before" || media.role === "after") && singularRoles.has(media.role)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Er mag maar één ${media.role === "before" ? "voor" : "na"}-foto zijn.`,
        path: [...pathPrefix, index, "role"],
      });
    }
    assetIds.add(media.assetId);
    sortOrders.add(media.sortOrder);
    if (media.role === "before" || media.role === "after") singularRoles.add(media.role);
  }

  for (let expected = 0; expected < mediaItems.length; expected += 1) {
    if (!sortOrders.has(expected)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mediasortering moet aaneengesloten bij 0 beginnen.",
        path: pathPrefix,
      });
      break;
    }
  }
}

const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Idempotency-key bevat ongeldige tekens.");

export const createUpdateInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedProjectVersion: z.number().int().positive(),
  updateDate: isoDateSchema,
  title: trimmedOptionalText(120),
  room: trimmedOptionalText(80),
  description: trimmedOptionalText(10_000),
  phaseId: uuidSchema.optional(),
  isMilestone: z.boolean().default(false),
  media: z.array(updateMediaInputSchema).max(50).default([]),
  publish: z.boolean().default(false),
}).strict().superRefine((input, context) => {
  validateUpdateMedia(input.media, context);
});

export const editUpdateInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
  updateDate: isoDateSchema.optional(),
  title: nullableTrimmedText(120),
  room: nullableTrimmedText(80),
  description: nullableTrimmedText(10_000),
  phaseId: uuidSchema.nullable().optional(),
  isMilestone: z.boolean().optional(),
  media: z.array(updateMediaInputSchema).max(50).optional(),
  publish: z.literal(true).optional(),
}).strict().refine(
  (input) => Object.keys(input).some((key) => !["idempotencyKey", "expectedVersion"].includes(key)),
  { message: "Geef minimaal één updatewijziging op." },
).superRefine((input, context) => {
  if (!input.media) return;
  validateUpdateMedia(input.media, context);
});

export const deleteUpdateInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
  confirmation: z.literal("delete-update"),
}).strict();

export const deleteProjectInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
  confirmation: z.literal("VERWIJDER VERBOUWING"),
}).strict();

export const projectDeletionStatusSchema = z.enum([
  "requested",
  "blocked_active_order",
  "deletion_pending",
  "database_redaction",
  "storage_cleanup",
  "verification",
  "completed",
  "retry_scheduled",
  "manual_review",
  "dead_letter",
]);

export const createProjectPhaseInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedProjectVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
}).strict();

export const mediaDescriptorSchema = z.object({
  id: uuidSchema,
  contentType: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  proxyPath: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
});

export const updateMediaDescriptorSchema = mediaDescriptorSchema.extend({
  role: z.enum(["gallery", "before", "after"]),
  sortOrder: z.number().int().nonnegative(),
  caption: z.string().nullable(),
});

export const projectOwnerSummarySchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
  slug: z.string(),
});

export const projectCardSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  projectType: z.string().nullable(),
  visibility: projectVisibilitySchema,
  progressPercentage: z.number().int().min(0).max(100),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  updateCount: z.number().int().nonnegative(),
  lastUpdateAt: z.string().datetime().nullable(),
  owner: projectOwnerSummarySchema,
  cover: mediaDescriptorSchema.nullable(),
});

export const projectPhaseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sortOrder: z.number().int().nonnegative(),
  isCustom: z.boolean(),
});

export const projectOverviewSchema = projectCardSchema.extend({
  startDate: isoDateSchema.nullable(),
  expectedEndDate: isoDateSchema.nullable(),
  contentRevision: z.number().int().positive(),
  followerCount: z.number().int().nonnegative(),
  viewerAccess: z.enum(["owner", "follower", "link", "public"]),
  canEdit: z.boolean(),
  phases: z.array(projectPhaseSchema),
});

export const projectUpdateSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  phase: projectPhaseSchema.nullable(),
  title: z.string().nullable(),
  room: z.string().nullable(),
  description: z.string().nullable(),
  updateDate: isoDateSchema,
  status: z.enum(["draft", "published"]),
  isMilestone: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  contentRevision: z.number().int().positive(),
  version: z.number().int().positive(),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  media: z.array(updateMediaDescriptorSchema),
});

export const projectPageSchema = z.object({
  items: z.array(projectCardSchema),
  nextCursor: opaqueCursorSchema.nullable(),
});

export const timelinePageSchema = z.object({
  projectId: uuidSchema,
  items: z.array(projectUpdateSchema),
  nextCursor: opaqueCursorSchema.nullable(),
});

export const followingActivitySchema = z.object({
  project: z.object({
    id: uuidSchema,
    title: z.string(),
  }),
  update: projectUpdateSchema,
});

export const followingFeedSchema = z.object({
  projects: z.array(projectCardSchema),
  activity: z.array(followingActivitySchema),
});

export const dashboardResponseSchema = apiSuccessSchema(projectPageSchema);
export const discoveryResponseSchema = apiSuccessSchema(projectPageSchema);
export const followingFeedResponseSchema = apiSuccessSchema(followingFeedSchema);
export const projectOverviewResponseSchema = apiSuccessSchema(projectOverviewSchema);
export const projectMutationResponseSchema = apiSuccessSchema(z.object({
  project: projectOverviewSchema,
  replayed: z.boolean(),
}));
export const timelineResponseSchema = apiSuccessSchema(timelinePageSchema);
export const updateMutationResponseSchema = apiSuccessSchema(z.object({
  update: projectUpdateSchema,
  replayed: z.boolean(),
}));
export const deleteUpdateMutationResponseSchema = apiSuccessSchema(z.object({
  project: projectOverviewSchema,
  updateId: uuidSchema,
  deleted: z.literal(true),
  replayed: z.boolean(),
}));
export const deleteProjectMutationResponseSchema = apiSuccessSchema(z.object({
  deletion: z.object({
    id: uuidSchema,
    projectId: uuidSchema,
    status: projectDeletionStatusSchema,
    activeOrderCount: z.number().int().nonnegative(),
  }),
  replayed: z.boolean(),
}));
export const projectPhaseMutationResponseSchema = apiSuccessSchema(z.object({
  project: projectOverviewSchema,
  phase: projectPhaseSchema,
  replayed: z.boolean(),
}));

export type ProjectPageQuery = z.infer<typeof projectPageQuerySchema>;
export type FollowingFeedQuery = z.infer<typeof followingFeedQuerySchema>;
export type ProjectPrivateDetailsInput = z.infer<typeof projectPrivateDetailsInputSchema>;
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type CreateUpdateInput = z.infer<typeof createUpdateInputSchema>;
export type EditUpdateInput = z.infer<typeof editUpdateInputSchema>;
export type DeleteUpdateInput = z.infer<typeof deleteUpdateInputSchema>;
export type DeleteProjectInput = z.infer<typeof deleteProjectInputSchema>;
export type ProjectDeletionStatus = z.infer<typeof projectDeletionStatusSchema>;
export type CreateProjectPhaseInput = z.infer<typeof createProjectPhaseInputSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaInputSchema>;
export type ProjectCard = z.infer<typeof projectCardSchema>;
export type ProjectPhase = z.infer<typeof projectPhaseSchema>;
export type ProjectOverview = z.infer<typeof projectOverviewSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type ProjectPage = z.infer<typeof projectPageSchema>;
export type TimelinePage = z.infer<typeof timelinePageSchema>;
export type FollowingActivity = z.infer<typeof followingActivitySchema>;
export type FollowingFeed = z.infer<typeof followingFeedSchema>;

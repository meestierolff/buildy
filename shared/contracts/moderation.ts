import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const CONTENT_POLICY_VERSION = "content-policy-2026-08-04" as const;
export const SUPPORT_PRIVACY_NOTICE_VERSION = "support-privacy-2026-08-04" as const;

export const moderationTargetTypeSchema = z.enum([
  "profile",
  "project",
  "update",
  "media",
  "comment",
]);
export type ModerationTargetType = z.infer<typeof moderationTargetTypeSchema>;

export const moderationReasonSchema = z.enum([
  "privacy",
  "harassment",
  "hate",
  "violence",
  "sexual_content",
  "illegal_content",
  "impersonation",
  "copyright",
  "spam",
  "other",
]);
export type ModerationReason = z.infer<typeof moderationReasonSchema>;

export const MODERATION_REASON_LABELS: Readonly<Record<ModerationReason, string>> = {
  privacy: "Privacy of herkenbare personen",
  harassment: "Intimidatie of pesten",
  hate: "Haatdragende inhoud",
  violence: "Geweld of direct gevaar",
  sexual_content: "Seksuele of ongepaste inhoud",
  illegal_content: "Mogelijk illegale inhoud",
  impersonation: "Voordoen als iemand anders",
  copyright: "Auteursrecht of eigendom",
  spam: "Spam of misleiding",
  other: "Iets anders",
};

const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9:_-]+$/);

const safeRouteSchema = z.string()
  .trim()
  .max(500)
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/)
  .optional();

const optionalEmailSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().toLowerCase().email().max(254).optional(),
);

const optionalDetailsSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().max(5_000).optional(),
);

export const createModerationReportInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  targetType: moderationTargetTypeSchema,
  targetId: z.string().uuid(),
  reason: moderationReasonSchema,
  details: optionalDetailsSchema,
  contactEmail: optionalEmailSchema,
  route: safeRouteSchema,
  policyVersion: z.literal(CONTENT_POLICY_VERSION),
  website: z.literal("").optional(),
}).strict();
export type CreateModerationReportInput = z.infer<typeof createModerationReportInputSchema>;

export const moderationReportReceiptSchema = z.object({
  id: z.string().uuid(),
  receiptCode: z.string().regex(/^MELD-[A-Z0-9]{8}$/),
  status: z.literal("received"),
  submittedAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
  emailConfirmationQueued: z.boolean(),
});
export type ModerationReportReceipt = z.infer<typeof moderationReportReceiptSchema>;
export const moderationReportResponseSchema = apiSuccessSchema(moderationReportReceiptSchema);

export const feedbackCategorySchema = z.enum(["bug", "idea", "usability", "other"]);
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;

export const createFeedbackInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  category: feedbackCategorySchema,
  message: z.string().trim().min(3).max(5_000),
  route: safeRouteSchema,
  privacyNoticeVersion: z.literal(SUPPORT_PRIVACY_NOTICE_VERSION),
  website: z.literal("").optional(),
}).strict();
export type CreateFeedbackInput = z.infer<typeof createFeedbackInputSchema>;

export const supportKindSchema = z.enum(["support", "third_party_request", "appeal"]);
export type SupportKind = z.infer<typeof supportKindSchema>;
export const supportCategorySchema = z.enum([
  "account",
  "privacy",
  "safety",
  "order",
  "technical",
  "content_appeal",
  "other",
]);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

export const createSupportInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  kind: supportKindSchema,
  category: supportCategorySchema,
  message: z.string().trim().min(10).max(5_000),
  contactEmail: z.string().trim().toLowerCase().email().max(254),
  route: safeRouteSchema,
  privacyNoticeVersion: z.literal(SUPPORT_PRIVACY_NOTICE_VERSION),
  website: z.literal("").optional(),
}).strict();
export type CreateSupportInput = z.infer<typeof createSupportInputSchema>;

export const feedbackSubmissionReceiptSchema = z.object({
  id: z.string().uuid(),
  receiptCode: z.string().regex(/^HELP-[A-Z0-9]{8}$/),
  kind: z.enum(["feedback", "support", "third_party_request", "appeal"]),
  status: z.literal("received"),
  submittedAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
  emailConfirmationQueued: z.boolean(),
});
export type FeedbackSubmissionReceipt = z.infer<typeof feedbackSubmissionReceiptSchema>;
export const feedbackSubmissionResponseSchema = apiSuccessSchema(feedbackSubmissionReceiptSchema);

export const moderationAdminRoleSchema = z.enum(["moderator", "admin"]);
export type ModerationAdminRole = z.infer<typeof moderationAdminRoleSchema>;

export const moderationReportStatusSchema = z.enum([
  "open",
  "triaged",
  "investigating",
  "resolved",
  "dismissed",
]);
export type ModerationReportStatus = z.infer<typeof moderationReportStatusSchema>;

export const moderationUrgencySchema = z.enum(["normal", "high", "urgent"]);
export type ModerationUrgency = z.infer<typeof moderationUrgencySchema>;

export const moderationAdminActionKindSchema = z.enum([
  "hide",
  "restore",
  "warn",
  "suspend",
  "block",
  "dismiss",
  "resolve",
]);
export type ModerationAdminActionKind = z.infer<typeof moderationAdminActionKindSchema>;

export const moderationAdminSessionSchema = z.object({
  appUserId: z.string().uuid(),
  role: moderationAdminRoleSchema,
  grantExpiresAt: z.string().datetime({ offset: true }).nullable(),
});
export type ModerationAdminSession = z.infer<typeof moderationAdminSessionSchema>;
export const moderationAdminSessionResponseSchema = apiSuccessSchema(moderationAdminSessionSchema);

export const moderationAdminQueueQuerySchema = z.object({
  status: moderationReportStatusSchema.default("open"),
  urgency: moderationUrgencySchema.optional(),
  targetType: moderationTargetTypeSchema.optional(),
  cursor: z.string().trim().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
export type ModerationAdminQueueQuery = z.infer<typeof moderationAdminQueueQuerySchema>;

export const moderationAdminQueueItemSchema = z.object({
  id: z.string().uuid(),
  receiptCode: z.string().regex(/^MELD-[A-Z0-9]{8}$/),
  targetType: moderationTargetTypeSchema,
  targetId: z.string().uuid(),
  reason: moderationReasonSchema,
  urgency: moderationUrgencySchema,
  status: moderationReportStatusSchema,
  version: z.number().int().positive(),
  targetHidden: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ModerationAdminQueueItem = z.infer<typeof moderationAdminQueueItemSchema>;

export const moderationAdminQueuePageSchema = z.object({
  items: z.array(moderationAdminQueueItemSchema),
  nextCursor: z.string().nullable(),
});
export type ModerationAdminQueuePage = z.infer<typeof moderationAdminQueuePageSchema>;
export const moderationAdminQueueResponseSchema = apiSuccessSchema(moderationAdminQueuePageSchema);

export const moderationAdminActionSchema = z.object({
  id: z.string().uuid(),
  kind: moderationAdminActionKindSchema,
  actorId: z.string().uuid(),
  actorRole: moderationAdminRoleSchema,
  reason: z.string().trim().min(1).max(1_000),
  reversesActionId: z.string().uuid().nullable(),
  reversedByActionId: z.string().uuid().nullable(),
  reportVersion: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
});
export type ModerationAdminAction = z.infer<typeof moderationAdminActionSchema>;

export const moderationAdminReportDetailSchema = moderationAdminQueueItemSchema.extend({
  details: z.string().max(5_000).nullable(),
  targetSnapshot: z.record(z.unknown()),
  actions: z.array(moderationAdminActionSchema),
});
export type ModerationAdminReportDetail = z.infer<typeof moderationAdminReportDetailSchema>;
export const moderationAdminReportDetailResponseSchema = apiSuccessSchema(
  moderationAdminReportDetailSchema,
);

const moderationActionIdempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9:_-]+$/);

export const moderationAdminActionInputSchema = z.object({
  idempotencyKey: moderationActionIdempotencyKeySchema,
  expectedReportVersion: z.number().int().positive(),
  kind: moderationAdminActionKindSchema,
  reason: z.string().trim().min(3).max(1_000),
  reverseActionId: z.string().uuid().optional(),
}).strict().superRefine((input, context) => {
  if (input.kind === "restore" && !input.reverseActionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reverseActionId"],
      message: "Kies de eerdere actie die je wilt terugdraaien.",
    });
  }
  if (input.kind !== "restore" && input.reverseActionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reverseActionId"],
      message: "Alleen herstellen kan naar een eerdere actie verwijzen.",
    });
  }
});
export type ModerationAdminActionInput = z.infer<typeof moderationAdminActionInputSchema>;

export const moderationAdminActionResultSchema = z.object({
  actionId: z.string().uuid(),
  reportId: z.string().uuid(),
  reportStatus: moderationReportStatusSchema,
  reportVersion: z.number().int().positive(),
  replayed: z.boolean(),
});
export type ModerationAdminActionResult = z.infer<typeof moderationAdminActionResultSchema>;
export const moderationAdminActionResponseSchema = apiSuccessSchema(
  moderationAdminActionResultSchema,
);

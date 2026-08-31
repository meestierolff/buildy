import { z } from "zod";
import { apiSuccessSchema } from "./api.js";
import { moderationAdminRoleSchema } from "./moderation.js";

export const feedbackAdminStatusSchema = z.enum([
  "new",
  "triaged",
  "planned",
  "resolved",
  "closed",
]);
export type FeedbackAdminStatus = z.infer<typeof feedbackAdminStatusSchema>;

export const feedbackAdminKindSchema = z.enum([
  "feedback",
  "support",
  "third_party_request",
  "appeal",
]);
export type FeedbackAdminKind = z.infer<typeof feedbackAdminKindSchema>;

export const feedbackAdminSessionSchema = z.object({
  appUserId: z.string().uuid(),
  role: z.literal("admin"),
  grantExpiresAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type FeedbackAdminSession = z.infer<typeof feedbackAdminSessionSchema>;
export const feedbackAdminSessionResponseSchema = apiSuccessSchema(feedbackAdminSessionSchema);

export const feedbackAdminQueueQuerySchema = z.object({
  status: feedbackAdminStatusSchema.default("new"),
  kind: feedbackAdminKindSchema.optional(),
  cursor: z.string().trim().min(1).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();
export type FeedbackAdminQueueQuery = z.infer<typeof feedbackAdminQueueQuerySchema>;

export const feedbackAdminQueueItemSchema = z.object({
  id: z.string().uuid(),
  receiptCode: z.string().regex(/^HELP-[A-Z0-9]{8}$/),
  kind: feedbackAdminKindSchema,
  category: z.string().trim().min(1).max(80),
  status: feedbackAdminStatusSchema,
  version: z.number().int().positive(),
  hasContact: z.boolean(),
  authenticated: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type FeedbackAdminQueueItem = z.infer<typeof feedbackAdminQueueItemSchema>;

export const feedbackAdminQueuePageSchema = z.object({
  items: z.array(feedbackAdminQueueItemSchema),
  nextCursor: z.string().nullable(),
}).strict();
export type FeedbackAdminQueuePage = z.infer<typeof feedbackAdminQueuePageSchema>;
export const feedbackAdminQueueResponseSchema = apiSuccessSchema(feedbackAdminQueuePageSchema);

export const feedbackAdminReviewSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid(),
  actorRole: moderationAdminRoleSchema,
  fromStatus: feedbackAdminStatusSchema,
  toStatus: feedbackAdminStatusSchema,
  submissionVersion: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type FeedbackAdminReview = z.infer<typeof feedbackAdminReviewSchema>;

export const feedbackAdminDetailSchema = feedbackAdminQueueItemSchema.extend({
  message: z.string().trim().min(1).max(5_000),
  contactEmail: z.string().email().max(254).nullable(),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
  reviews: z.array(feedbackAdminReviewSchema),
}).strict();
export type FeedbackAdminDetail = z.infer<typeof feedbackAdminDetailSchema>;
export const feedbackAdminDetailResponseSchema = apiSuccessSchema(feedbackAdminDetailSchema);

const feedbackAdminIdempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(160)
  .regex(/^[A-Za-z0-9:_-]+$/);

export const feedbackAdminStatusInputSchema = z.object({
  idempotencyKey: feedbackAdminIdempotencyKeySchema,
  expectedVersion: z.number().int().positive(),
  status: feedbackAdminStatusSchema,
}).strict();
export type FeedbackAdminStatusInput = z.infer<typeof feedbackAdminStatusInputSchema>;

export const feedbackAdminStatusResultSchema = z.object({
  reviewId: z.string().uuid(),
  submissionId: z.string().uuid(),
  status: feedbackAdminStatusSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
}).strict();
export type FeedbackAdminStatusResult = z.infer<typeof feedbackAdminStatusResultSchema>;
export const feedbackAdminStatusResponseSchema = apiSuccessSchema(feedbackAdminStatusResultSchema);

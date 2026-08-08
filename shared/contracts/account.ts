import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

const idempotencyKeySchema = z.string().trim().min(16).max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const accountSessionSchema = z.object({
  id: z.string().min(1).max(255),
  isCurrent: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  ipAddress: z.string().max(255).nullable(),
  userAgent: z.string().max(1000).nullable(),
});

export const accountSessionsResponseSchema = apiSuccessSchema(
  z.object({ sessions: z.array(accountSessionSchema).max(100) }),
);

export const revokeAccountSessionResponseSchema = apiSuccessSchema(z.object({
  revokedSessionId: z.string().min(1).max(255),
  revokedCurrentSession: z.boolean(),
}));

export const accountExportStatusSchema = z.enum([
  "requested",
  "processing",
  "retry_scheduled",
  "ready",
  "expired",
  "failed",
  "dead_letter",
  "deleted",
]);

export const accountExportSchema = z.object({
  id: z.string().uuid(),
  status: accountExportStatusSchema,
  includeMedia: z.boolean(),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  downloadPath: z.string().startsWith("/api/account/exports/").nullable(),
  failureCode: z.string().max(64).nullable(),
});

export const accountExportsResponseSchema = apiSuccessSchema(
  z.object({ exports: z.array(accountExportSchema).max(20) }),
);

export const createAccountExportInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  includeMedia: z.boolean().default(false),
}).strict();

export const createAccountExportResponseSchema = apiSuccessSchema(z.object({
  export: accountExportSchema,
  replayed: z.boolean(),
}));

export const requestAccountDeletionInputSchema = z.object({
  confirmation: z.literal("VERWIJDEREN"),
  currentPassword: z.string().min(1).max(128).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const accountDeletionStatusSchema = z.enum([
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

export const requestAccountDeletionResponseSchema = apiSuccessSchema(z.object({
  deletion: z.object({
    id: z.string().uuid(),
    status: accountDeletionStatusSchema,
    activeOrderCount: z.number().int().nonnegative(),
  }),
  replayed: z.boolean(),
}));

export type AccountSession = z.infer<typeof accountSessionSchema>;
export type AccountExport = z.infer<typeof accountExportSchema>;
export type AccountExportStatus = z.infer<typeof accountExportStatusSchema>;
export type CreateAccountExportInput = z.infer<typeof createAccountExportInputSchema>;
export type RequestAccountDeletionInput = z.infer<typeof requestAccountDeletionInputSchema>;

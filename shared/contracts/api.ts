import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
  "AUTH_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "BETA_INVITE_REQUIRED",
  "BETA_INVITE_INVALID",
  "INTERNAL_ERROR",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().uuid(),
    fieldErrors: z.record(z.array(z.string())).optional(),
  }),
});

export const capabilityStateSchema = z.enum(["ready", "unconfigured", "disabled"]);

export const serviceCapabilitiesSchema = z.object({
  database: capabilityStateSchema,
  authentication: capabilityStateSchema,
  accountLifecycle: capabilityStateSchema,
  media: capabilityStateSchema,
  photobooks: capabilityStateSchema,
  email: capabilityStateSchema,
  payments: capabilityStateSchema,
  printFulfilment: capabilityStateSchema,
  privateBeta: capabilityStateSchema,
});

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.literal("ok"),
    environment: z.enum(["local", "test", "preview", "staging", "production"]),
    release: z.string(),
    capabilities: serviceCapabilitiesSchema,
  }),
  meta: z.object({
    requestId: z.string().uuid(),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  data: z.object({
    ready: z.boolean(),
    checks: z.object({
      configuration: z.enum(["pass", "fail"]),
      database: z.enum(["pass", "fail", "not_checked"]),
      accountWorker: z.enum(["pass", "fail", "not_checked"]),
      emailWorker: z.enum(["pass", "fail", "not_checked"]),
      fulfilmentWorker: z.enum(["pass", "fail", "not_checked"]),
      mediaWorker: z.enum(["pass", "fail", "not_checked"]),
      paymentWorker: z.enum(["pass", "fail", "not_checked"]),
      photobookWorker: z.enum(["pass", "fail", "not_checked"]),
    }),
  }),
  meta: z.object({
    requestId: z.string().uuid(),
  }),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export function apiSuccessSchema<TSchema extends z.ZodTypeAny>(data: TSchema) {
  return z.object({
    data,
    meta: z.object({ requestId: z.string().uuid() }),
  });
}

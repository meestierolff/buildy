import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const betaProviderSchema = z.enum(["email", "google"]);
export type BetaProvider = z.infer<typeof betaProviderSchema>;

export const betaStatusSchema = z.object({
  betaMode: z.boolean(),
  inviteRequiredForNewAccounts: z.boolean(),
  label: z.literal("Private bèta"),
});
export const betaStatusResponseSchema = apiSuccessSchema(betaStatusSchema);
export type BetaStatus = z.infer<typeof betaStatusSchema>;

export const reserveBetaInviteInputSchema = z.object({
  inviteCode: z.string().trim().regex(/^BLDY_[A-Za-z0-9_-]{32}$/),
  provider: betaProviderSchema,
  email: z.string().trim().email().max(254).optional(),
  idempotencyKey: z.string().regex(/^beta-reservation:v1:[0-9a-f-]{36}$/),
}).strict().superRefine((input, context) => {
  if (input.provider === "email" && !input.email) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "E-mailadres is vereist voor registratie met e-mail.",
      path: ["email"],
    });
  }
});
export type ReserveBetaInviteInput = z.infer<typeof reserveBetaInviteInputSchema>;

export const betaReservationSchema = z.object({
  reserved: z.literal(true),
  expiresAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
});
export const betaReservationResponseSchema = apiSuccessSchema(betaReservationSchema);
export type BetaReservation = z.infer<typeof betaReservationSchema>;

// This is the complete, provider-neutral product event vocabulary. Server-side
// milestones are written by database triggers; only the explicitly smaller
// clientEventSchema surface can be posted by a browser.
export const productEventNames = [
  "signup_started",
  "signup_completed",
  "onboarding_completed",
  "project_created",
  "first_update_created",
  "photo_upload_completed",
  "project_shared",
  "follow_requested",
  "follow_accepted",
  "comment_created",
  "photobook_opened",
  "photobook_draft_generated",
  "proof_generated",
  "proof_approved",
  "checkout_started",
  "checkout_completed",
  "feedback_submitted",
  "error_encountered",
] as const;
export const productEventNameSchema = z.enum(productEventNames);
export type ProductEventName = z.infer<typeof productEventNameSchema>;

const eventIdSchema = z.string().uuid();
const schemaVersion = z.literal(1);

export const clientProductEventInputSchema = z.discriminatedUnion("eventName", [
  z.object({
    eventId: eventIdSchema,
    eventName: z.literal("signup_started"),
    properties: z.object({
      schemaVersion,
      method: betaProviderSchema,
    }).strict(),
  }).strict(),
  z.object({
    eventId: eventIdSchema,
    eventName: z.literal("project_shared"),
    properties: z.object({
      schemaVersion,
      visibility: z.enum(["public", "private"]),
    }).strict(),
  }).strict(),
  z.object({
    eventId: eventIdSchema,
    eventName: z.literal("photobook_opened"),
    properties: z.object({ schemaVersion }).strict(),
  }).strict(),
  z.object({
    eventId: eventIdSchema,
    eventName: z.literal("error_encountered"),
    properties: z.object({
      schemaVersion,
      category: z.enum([
        "network",
        "offline",
        "timeout",
        "authentication",
        "validation",
        "upload",
        "render",
        "checkout",
        "unknown",
      ]),
    }).strict(),
  }).strict(),
]);
export type ClientProductEventInput = z.infer<typeof clientProductEventInputSchema>;

export const productEventReceiptSchema = z.object({
  accepted: z.literal(true),
  replayed: z.boolean(),
});
export const productEventReceiptResponseSchema = apiSuccessSchema(productEventReceiptSchema);
export type ProductEventReceipt = z.infer<typeof productEventReceiptSchema>;

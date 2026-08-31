import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const productProfileNameSchema = z.enum(["feedback_beta", "public_demo"]);
export type ProductProfileName = z.infer<typeof productProfileNameSchema>;

export const checkoutModeSchema = z.enum(["off", "test", "live"]);
export type CheckoutMode = z.infer<typeof checkoutModeSchema>;

export const productProfileCapabilitiesSchema = z.object({
  googleSignIn: z.boolean(),
  emailAuth: z.boolean(),
  renovations: z.boolean(),
  updates: z.boolean(),
  story: z.boolean(),
  media: z.boolean(),
  photobookPreview: z.boolean(),
  sharing: z.boolean(),
  feedback: z.boolean(),
  accountDeletion: z.boolean(),
  checkout: z.boolean(),
}).strict();

export const productProfileSchema = z.object({
  profile: productProfileNameSchema,
  checkoutMode: checkoutModeSchema,
  betaMode: z.boolean(),
  inviteRequiredForNewAccounts: z.boolean(),
  capabilities: productProfileCapabilitiesSchema,
}).strict();

export const productProfileResponseSchema = apiSuccessSchema(productProfileSchema);

export type ProductProfile = z.infer<typeof productProfileSchema>;

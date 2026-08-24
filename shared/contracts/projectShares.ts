import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const projectShareRoutes = {
  redeem: "/api/project-share-links/redeem",
  owner: "/api/projects/:projectId/share-link",
  rotate: "/api/projects/:projectId/share-link/rotate",
} as const;

export const projectShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const shareMutationKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Opdracht-ID bevat ongeldige tekens.");

export const issueProjectShareLinkInputSchema = z.object({
  expiresAt: z.string().datetime(),
  idempotencyKey: shareMutationKeySchema,
}).strict();

export const rotateProjectShareLinkInputSchema = issueProjectShareLinkInputSchema.extend({
  expectedVersion: z.number().int().positive(),
}).strict();

export const revokeProjectShareLinkInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: shareMutationKeySchema,
}).strict();

export const redeemProjectShareLinkInputSchema = z.object({
  token: projectShareTokenSchema,
}).strict();

export const projectShareLinkSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  version: z.number().int().positive(),
  state: z.enum(["active", "expired"]),
});

export const projectShareLinkStateResponseSchema = apiSuccessSchema(z.object({
  projectId: z.string().uuid(),
  link: projectShareLinkSchema.nullable(),
}));

export const projectShareLinkMutationResponseSchema = apiSuccessSchema(z.object({
  link: projectShareLinkSchema,
  shareUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.pathname === "/delen"
      && url.search === ""
      && /^#toegang=[A-Za-z0-9_-]{43}$/.test(url.hash);
  }, "De deellink heeft geen veilig Buildy-formaat."),
  replayed: z.boolean(),
}));

export const projectShareLinkRevokeResponseSchema = apiSuccessSchema(z.object({
  projectId: z.string().uuid(),
  linkId: z.string().uuid(),
  revoked: z.literal(true),
  version: z.number().int().positive(),
  replayed: z.boolean(),
}));

export const projectShareLinkRedeemResponseSchema = apiSuccessSchema(z.object({
  projectId: z.string().uuid(),
  cleanPath: z.string().regex(/^\/project\/[0-9a-f-]{36}$/i),
  expiresAt: z.string().datetime(),
}));

export type IssueProjectShareLinkInput = z.infer<typeof issueProjectShareLinkInputSchema>;
export type RotateProjectShareLinkInput = z.infer<typeof rotateProjectShareLinkInputSchema>;
export type RevokeProjectShareLinkInput = z.infer<typeof revokeProjectShareLinkInputSchema>;
export type RedeemProjectShareLinkInput = z.infer<typeof redeemProjectShareLinkInputSchema>;
export type ProjectShareLink = z.infer<typeof projectShareLinkSchema>;
export type ProjectShareLinkState = z.infer<typeof projectShareLinkStateResponseSchema>["data"];
export type ProjectShareLinkMutation = z.infer<typeof projectShareLinkMutationResponseSchema>["data"];
export type ProjectShareLinkRevocation = z.infer<typeof projectShareLinkRevokeResponseSchema>["data"];
export type ProjectShareLinkRedemption = z.infer<typeof projectShareLinkRedeemResponseSchema>["data"];

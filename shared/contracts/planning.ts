import { z } from "zod";
import { apiSuccessSchema } from "./api.js";

export const planningRoutes = {
  floorplans: "/api/projects/:projectId/floorplans",
  floorplan: "/api/projects/:projectId/floorplans/:floorplanId",
  pins: "/api/projects/:projectId/floorplans/:floorplanId/pins",
  pin: "/api/projects/:projectId/floorplans/:floorplanId/pins/:pinId",
  budget: "/api/projects/:projectId/budget",
  budgetItems: "/api/projects/:projectId/budget/items",
  budgetItem: "/api/projects/:projectId/budget/items/:itemId",
} as const;

const uuidSchema = z.string().uuid();
const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Idempotency-key bevat ongeldige tekens.");
const versionSchema = z.number().int().positive();
const minorAmountSchema = z.number().int().min(0).max(2_147_483_647);
const coordinateSchema = z.number().finite().min(0).max(1).refine(
  (value) => Math.abs(value - Math.round(value * 100_000) / 100_000) < 1e-10,
  "Coördinaten mogen maximaal vijf decimalen bevatten.",
);
const nullableTrimmedText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();

export const planningDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}, "Datum bestaat niet.");

export const createFloorplanInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  mediaAssetId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  floorNumber: z.number().int().min(-20).max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(500),
}).strict();

export const updateFloorplanInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: versionSchema,
  name: z.string().trim().min(1).max(80).optional(),
  floorNumber: z.number().int().min(-20).max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(500).optional(),
}).strict().refine(
  (input) => Object.keys(input).some((key) => !["idempotencyKey", "expectedVersion"].includes(key)),
  { message: "Geef minimaal één plattegrondwijziging op." },
);

export const deletePlanningResourceInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: versionSchema,
}).strict();

export const createFloorplanPinInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  updateId: uuidSchema,
  x: coordinateSchema,
  y: coordinateSchema,
  label: z.string().trim().min(1).max(80).optional(),
}).strict();

export const updateFloorplanPinInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: versionSchema,
  x: coordinateSchema.optional(),
  y: coordinateSchema.optional(),
  label: nullableTrimmedText(80),
}).strict().refine(
  (input) => Object.keys(input).some((key) => !["idempotencyKey", "expectedVersion"].includes(key)),
  { message: "Geef minimaal één pinwijziging op." },
);

export const createProjectBudgetInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  plannedAmountMinor: minorAmountSchema,
}).strict();

export const updateProjectBudgetInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: versionSchema,
  plannedAmountMinor: minorAmountSchema,
}).strict();

export const createBudgetItemInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  updateId: uuidSchema.nullable().optional(),
  kind: z.enum(["planned", "actual"]),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500).optional(),
  amountMinor: minorAmountSchema,
  occurredOn: planningDateSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000),
}).strict();

export const updateBudgetItemInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  expectedVersion: versionSchema,
  updateId: uuidSchema.nullable().optional(),
  kind: z.enum(["planned", "actual"]).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  description: nullableTrimmedText(500),
  amountMinor: minorAmountSchema.optional(),
  occurredOn: planningDateSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict().refine(
  (input) => Object.keys(input).some((key) => !["idempotencyKey", "expectedVersion"].includes(key)),
  { message: "Geef minimaal één budgetwijziging op." },
);

export const floorplanMediaSchema = z.object({
  id: uuidSchema,
  status: z.literal("ready"),
  contentType: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  proxyPath: z.string().regex(/^\/api\/media\/[0-9a-f-]{36}$/i),
});

export const floorplanPinSchema = z.object({
  id: uuidSchema,
  updateId: uuidSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string().nullable(),
  version: versionSchema,
  update: z.object({
    title: z.string().nullable(),
    updateDate: planningDateSchema,
    status: z.enum(["draft", "published"]),
  }),
});

export const floorplanSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  floorNumber: z.number().int().nullable(),
  sortOrder: z.number().int().nonnegative(),
  version: versionSchema,
  media: floorplanMediaSchema,
  pins: z.array(floorplanPinSchema),
});

export const floorplanBoardSchema = z.object({
  projectId: uuidSchema,
  viewerAccess: z.enum(["owner", "follower", "link", "public"]),
  canEdit: z.boolean(),
  floorplans: z.array(floorplanSchema),
});

export const budgetItemSchema = z.object({
  id: uuidSchema,
  updateId: uuidSchema.nullable(),
  kind: z.enum(["planned", "actual"]),
  category: z.string(),
  description: z.string().nullable(),
  amountMinor: minorAmountSchema,
  occurredOn: planningDateSchema.nullable(),
  sortOrder: z.number().int().nonnegative(),
  version: versionSchema,
});

export const projectBudgetSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  plannedAmountMinor: minorAmountSchema,
  version: versionSchema,
  totals: z.object({
    allocatedAmountMinor: z.number().int().nonnegative(),
    actualAmountMinor: z.number().int().nonnegative(),
    remainingAmountMinor: z.number().int(),
  }),
  items: z.array(budgetItemSchema),
});

export const planningMutationResultSchema = z.object({
  resourceType: z.enum(["floorplan", "floorplan_pin", "budget", "budget_item"]),
  id: uuidSchema,
  version: versionSchema.nullable(),
  replayed: z.boolean(),
});

export const floorplanBoardResponseSchema = apiSuccessSchema(floorplanBoardSchema);
export const projectBudgetResponseSchema = apiSuccessSchema(projectBudgetSchema);
export const planningMutationResponseSchema = apiSuccessSchema(planningMutationResultSchema);

export type CreateFloorplanInput = z.infer<typeof createFloorplanInputSchema>;
export type UpdateFloorplanInput = z.infer<typeof updateFloorplanInputSchema>;
export type DeletePlanningResourceInput = z.infer<typeof deletePlanningResourceInputSchema>;
export type CreateFloorplanPinInput = z.infer<typeof createFloorplanPinInputSchema>;
export type UpdateFloorplanPinInput = z.infer<typeof updateFloorplanPinInputSchema>;
export type CreateProjectBudgetInput = z.infer<typeof createProjectBudgetInputSchema>;
export type UpdateProjectBudgetInput = z.infer<typeof updateProjectBudgetInputSchema>;
export type CreateBudgetItemInput = z.infer<typeof createBudgetItemInputSchema>;
export type UpdateBudgetItemInput = z.infer<typeof updateBudgetItemInputSchema>;
export type FloorplanPin = z.infer<typeof floorplanPinSchema>;
export type Floorplan = z.infer<typeof floorplanSchema>;
export type FloorplanBoard = z.infer<typeof floorplanBoardSchema>;
export type BudgetItem = z.infer<typeof budgetItemSchema>;
export type ProjectBudget = z.infer<typeof projectBudgetSchema>;
export type PlanningMutationResult = z.infer<typeof planningMutationResultSchema>;

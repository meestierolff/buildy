import { z } from "zod";
import { apiSuccessSchema } from "./api.js";
import { requestPhotobookProofInputSchema } from "./photobooks.js";

export const bookOrderStatusSchema = z.enum(["requested", "accepted", "printing", "shipped", "cancelled"]);
export const createBookOrderInputSchema = requestPhotobookProofInputSchema.extend({
  quantity: z.number().int().min(1).max(10),
  deliveryDetails: z.string().trim().min(10).max(1500),
}).strict();
export const updateBookOrderInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: bookOrderStatusSchema,
  reply: z.string().trim().max(1500),
}).strict();
export const bookOrderSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  pageCount: z.number().int().positive(),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  quantity: z.number().int().positive(),
  status: bookOrderStatusSchema,
  reply: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const bookOrderListResponseSchema = apiSuccessSchema(z.object({ items: z.array(bookOrderSchema) }));
export const bookOrderResponseSchema = apiSuccessSchema(z.object({ order: bookOrderSchema, replayed: z.boolean() }));
export const adminBookOrderSchema = bookOrderSchema.extend({ deliveryDetails: z.string() });
export const adminBookOrderListResponseSchema = apiSuccessSchema(z.object({
  items: z.array(adminBookOrderSchema),
  nextCursor: z.string().nullable(),
}));
export const bookOrderStatusLabels: Record<z.infer<typeof bookOrderStatusSchema>, string> = {
  requested: "Aangevraagd", accepted: "In behandeling", printing: "Bij de drukker", shipped: "Verzonden", cancelled: "Geannuleerd",
};
export type BookOrder = z.infer<typeof bookOrderSchema>;
export type AdminBookOrder = z.infer<typeof adminBookOrderSchema>;
export type CreateBookOrderInput = z.infer<typeof createBookOrderInputSchema>;
export type UpdateBookOrderInput = z.infer<typeof updateBookOrderInputSchema>;

import { z } from "zod";
import {
  adminOrderQueueQuerySchema,
  type AdminOrderQueueQuery,
} from "../../shared/contracts/orders.js";
import { OrderAdminError } from "./adminErrors.js";

const statusSchema = adminOrderQueueQuerySchema.shape.status;

const cursorSchema = z.object({
  kind: z.literal("manual-order-queue"),
  version: z.literal(1),
  status: statusSchema,
  paidAt: z.string().datetime({ offset: true }),
  orderId: z.string().uuid(),
}).strict();

export type OrderAdminCursor = z.infer<typeof cursorSchema>;

export function encodeOrderAdminCursor(cursor: OrderAdminCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeOrderAdminCursor(
  value: string,
  query: Pick<AdminOrderQueueQuery, "status">,
): OrderAdminCursor {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
    if (parsed.status !== query.status) throw new Error("cursor scope mismatch");
    return parsed;
  } catch (error) {
    throw new OrderAdminError("INVALID_CURSOR", { cause: error });
  }
}

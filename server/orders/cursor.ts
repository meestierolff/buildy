import { z } from "zod";
import { OrderError } from "./errors.js";

const customerOrderCursorSchema = z.object({
  kind: z.literal("customer-orders"),
  version: z.literal(1),
  createdAt: z.string().datetime({ offset: true }),
  orderId: z.string().uuid(),
}).strict();

export type CustomerOrderCursor = z.infer<typeof customerOrderCursorSchema>;

export function encodeCustomerOrderCursor(cursor: CustomerOrderCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCustomerOrderCursor(value: string | undefined): CustomerOrderCursor | undefined {
  if (!value) return undefined;
  try {
    return customerOrderCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
  } catch (error) {
    throw new OrderError("INVALID_CURSOR", { cause: error });
  }
}

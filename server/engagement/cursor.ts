import { z } from "zod";
import { EngagementError } from "./errors.js";

const baseCursorSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
}).strict();

const commentCursorSchema = baseCursorSchema.extend({
  kind: z.literal("comments"),
  updateId: z.string().uuid(),
});

const notificationCursorSchema = baseCursorSchema.extend({
  kind: z.literal("notifications"),
  status: z.enum(["all", "unread", "read"]),
});

export type CommentCursor = z.infer<typeof commentCursorSchema>;
export type NotificationCursor = z.infer<typeof notificationCursorSchema>;
export type EngagementCursor = CommentCursor | NotificationCursor;

export function encodeEngagementCursor(cursor: EngagementCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCommentCursor(
  value: string | undefined,
  updateId: string,
): CommentCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const cursor = commentCursorSchema.parse(decoded);
    if (cursor.updateId !== updateId) throw new Error("cursor_scope_mismatch");
    return cursor;
  } catch {
    throw new EngagementError("INVALID_CURSOR");
  }
}

export function decodeNotificationCursor(
  value: string | undefined,
  status: "all" | "unread" | "read",
): NotificationCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const cursor = notificationCursorSchema.parse(decoded);
    if (cursor.status !== status) throw new Error("cursor_scope_mismatch");
    return cursor;
  } catch {
    throw new EngagementError("INVALID_CURSOR");
  }
}

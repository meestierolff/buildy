import { z } from "zod";
import { SocialError } from "./errors.js";

const profileCursorSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("profiles"),
    query: z.string(),
    timestamp: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

export type ProfileCursor = z.infer<typeof profileCursorSchema>;

export function encodeProfileCursor(cursor: ProfileCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProfileCursor(
  value: string | undefined,
  normalizedQuery: string,
): ProfileCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const cursor = profileCursorSchema.parse(decoded);
    if (cursor.query !== normalizedQuery) throw new SocialError("INVALID_CURSOR");
    return cursor;
  } catch (error) {
    if (error instanceof SocialError) throw error;
    throw new SocialError("INVALID_CURSOR");
  }
}

import { z } from "zod";
import {
  moderationReportStatusSchema,
  moderationTargetTypeSchema,
  moderationUrgencySchema,
  type ModerationAdminQueueQuery,
} from "../../shared/contracts/moderation.js";

const cursorSchema = z.object({
  kind: z.literal("moderation-admin-queue"),
  version: z.literal(1),
  status: moderationReportStatusSchema,
  urgency: moderationUrgencySchema.nullable(),
  targetType: moderationTargetTypeSchema.nullable(),
  timestamp: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

export type ModerationAdminCursor = z.infer<typeof cursorSchema>;

export function encodeModerationAdminCursor(cursor: ModerationAdminCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeModerationAdminCursor(
  value: string,
  query: Pick<ModerationAdminQueueQuery, "status" | "urgency" | "targetType">,
): ModerationAdminCursor {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
    if (
      parsed.status !== query.status
      || parsed.urgency !== (query.urgency ?? null)
      || parsed.targetType !== (query.targetType ?? null)
    ) {
      throw new Error("cursor scope mismatch");
    }
    return parsed;
  } catch (error) {
    throw new Error("INVALID_MODERATION_CURSOR", { cause: error });
  }
}

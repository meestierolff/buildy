import { z } from "zod";
import {
  feedbackAdminKindSchema,
  feedbackAdminStatusSchema,
  type FeedbackAdminQueueQuery,
} from "../../shared/contracts/feedbackAdmin.js";

const cursorSchema = z.object({
  kind: z.literal("feedback-admin-queue"),
  version: z.literal(1),
  status: feedbackAdminStatusSchema,
  submissionKind: feedbackAdminKindSchema.nullable(),
  timestamp: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

export type FeedbackAdminCursor = z.infer<typeof cursorSchema>;

export function encodeFeedbackAdminCursor(cursor: FeedbackAdminCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeFeedbackAdminCursor(
  value: string,
  query: Pick<FeedbackAdminQueueQuery, "status" | "kind">,
): FeedbackAdminCursor {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
    if (
      parsed.status !== query.status
      || parsed.submissionKind !== (query.kind ?? null)
    ) {
      throw new Error("cursor scope mismatch");
    }
    return parsed;
  } catch (error) {
    throw new Error("INVALID_FEEDBACK_ADMIN_CURSOR", { cause: error });
  }
}

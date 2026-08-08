import { createHash } from "node:crypto";
import { canonicalJson } from "../security/canonicalJson.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";

export function scopedSubmissionIdempotencyKey(
  operation: "moderation.report" | "feedback.submit" | "support.submit",
  scope: string,
  clientKey: string,
): string {
  const digest = createHash("sha256")
    .update("buildy-community-submission:v1\0")
    .update(operation)
    .update("\0")
    .update(scope)
    .update("\0")
    .update(clientKey)
    .digest("hex");
  return `community-command:v1:${operation}:${digest}`;
}

export function submissionRequestHash(
  operation: "moderation.report" | "feedback.submit" | "support.submit",
  payload: unknown,
  blindIndex: PrivacyBlindIndex,
): string {
  return blindIndex.create(`community-${operation.replace(".", "-")}`, canonicalJson(payload));
}


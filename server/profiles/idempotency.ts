import { createHash } from "node:crypto";
import { canonicalJson } from "../security/canonicalJson.js";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";

export function profileRequestHash(
  operation: string,
  payload: unknown,
  blindIndex: PrivacyBlindIndex,
): string {
  const canonicalDigest = createHash("sha256")
    .update("buildy-profile-command-payload:v2\0")
    .update(operation)
    .update("\0")
    .update(canonicalJson(payload))
    .digest("hex");
  return blindIndex.create(`profile-command-request-v2:${operation}`, canonicalDigest);
}

export function scopedProfileIdempotencyKey(
  operation: "profile.update",
  actorId: string,
  clientKey: string,
): string {
  const digest = createHash("sha256")
    .update(operation)
    .update("\0")
    .update(actorId)
    .update("\0")
    .update(clientKey)
    .digest("hex");
  return `profile-command:v1:${operation}:${digest}`;
}

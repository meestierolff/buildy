import { createHash } from "node:crypto";
import { canonicalJson } from "../security/canonicalJson.js";

export function profileRequestHash(operation: string, payload: unknown): string {
  return createHash("sha256")
    .update("buildy-profile-command:v1\0")
    .update(operation)
    .update("\0")
    .update(canonicalJson(payload))
    .digest("hex");
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

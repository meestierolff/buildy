import { createHash } from "node:crypto";
import type { PrivacyBlindIndex } from "../security/dataProtection.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function planningRequestHash(
  operation: string,
  payload: unknown,
  blindIndex: PrivacyBlindIndex,
): string {
  const canonicalDigest = createHash("sha256")
    .update("buildy-planning-command-payload:v2\0")
    .update(operation)
    .update("\0")
    .update(JSON.stringify(stableValue(payload)))
    .digest("hex");
  return blindIndex.create(`planning-command-request-v2:${operation}`, canonicalDigest);
}

export function scopedPlanningIdempotencyKey(
  operation: string,
  actorId: string,
  projectId: string,
  clientKey: string,
): string {
  const digest = createHash("sha256")
    .update(operation)
    .update("\0")
    .update(actorId)
    .update("\0")
    .update(projectId)
    .update("\0")
    .update(clientKey)
    .digest("hex");
  return `planning-command:v1:${operation}:${digest}`;
}

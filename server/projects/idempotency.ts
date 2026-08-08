import { createHash } from "node:crypto";

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

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function projectRequestHash(operation: string, payload: unknown): string {
  return createHash("sha256")
    .update("buildy-project-command:v1\0")
    .update(operation)
    .update("\0")
    .update(stableJson(payload))
    .digest("hex");
}

export function scopedProjectIdempotencyKey(
  operation: string,
  actorId: string,
  resourceId: string | undefined,
  clientKey: string,
): string {
  const digest = createHash("sha256")
    .update(operation)
    .update("\0")
    .update(actorId)
    .update("\0")
    .update(resourceId ?? "new")
    .update("\0")
    .update(clientKey)
    .digest("hex");
  return `project-command:v1:${operation}:${digest}`;
}

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

export function mediaRequestHash(value: unknown): string {
  return createHash("sha256")
    .update("buildy-media-upload-intent:v1\0")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function scopedMediaUploadKey(
  actorId: string,
  projectId: string,
  clientKey: string,
): string {
  const digest = createHash("sha256")
    .update("buildy-media-upload-key:v1\0")
    .update(actorId)
    .update("\0")
    .update(projectId)
    .update("\0")
    .update(clientKey)
    .digest("hex");
  return `media-upload:v1:${digest}`;
}

export function deterministicMediaUuid(assetId: string, label: string): string {
  const bytes = createHash("sha256")
    .update("buildy-media-derivative:v1\0")
    .update(assetId)
    .update("\0")
    .update(label)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

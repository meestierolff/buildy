import { z } from "zod";
import { assertObjectKey, type ObjectPurpose } from "../../server/storage/objectStorage";
import { BUILDY_MIGRATION_NAMESPACE } from "./auth";
import { keyedFingerprint, stableUuid } from "./core";

const MAX_SOURCE_KEY_BYTES = 1024;

export type LegacyStoragePurpose = ObjectPurpose;

export interface LegacyObjectLocator {
  bucket: string;
  key: string;
}

export interface LegacyMediaReference extends LegacyObjectLocator {
  field: string;
  ownerId: string;
  projectId: string | null;
  purpose: LegacyStoragePurpose;
  recordId: string;
  table: string;
}

export interface StorageMigrationPlanEntry extends LegacyObjectLocator {
  assetId: string;
  destinationKey: string;
  locatorFingerprint: string;
  purpose: LegacyStoragePurpose;
  references: Array<{
    field: string;
    ownerId: string;
    projectId: string | null;
    recordId: string;
    table: string;
  }>;
}

export interface StorageMigrationPlan {
  schemaVersion: 1;
  entries: StorageMigrationPlanEntry[];
  sourceObjectCount: number;
  referenceCount: number;
}

function assertLegacyBucket(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(normalized)) {
    throw new Error("Legacy bucketnaam is ongeldig.");
  }
  return normalized;
}

export function assertLegacySourceKey(value: string): string {
  const normalized = value.normalize("NFC").replace(/^\/+/, "");
  const bytes = Buffer.byteLength(normalized, "utf8");
  if (
    bytes < 1 ||
    bytes > MAX_SOURCE_KEY_BYTES ||
    normalized.includes("\\") ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    [...normalized].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new Error("Legacy objectpad is ongeldig of bevat padtraversal.");
  }
  return normalized;
}

function decodeObjectKey(encoded: string): string {
  try {
    return assertLegacySourceKey(decodeURIComponent(encoded));
  } catch (error) {
    if (error instanceof URIError) throw new Error("Legacy object-URL bevat ongeldige encoding.");
    throw error;
  }
}

/** Extracts a provider locator while dropping query strings and signed tokens. */
export function parseLegacyObjectLocator(
  value: string,
  fallbackBucket?: string,
): LegacyObjectLocator {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Legacy objectverwijzing is leeg.");

  if (!/^https?:\/\//i.test(trimmed)) {
    if (!fallbackBucket) throw new Error("Bucket ontbreekt bij relatief legacy objectpad.");
    return { bucket: assertLegacyBucket(fallbackBucket), key: assertLegacySourceKey(trimmed) };
  }

  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("Legacy object-URL moet HTTPS gebruiken.");
  const markers = [
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/",
    "/storage/v1/object/sign/",
    "/storage/v1/object/authenticated/",
  ];
  const marker = markers.find((candidate) => url.pathname.includes(candidate));
  if (!marker) throw new Error("Legacy object-URL heeft een onbekende providerroute.");
  const remainder = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
  const separator = remainder.indexOf("/");
  if (separator < 1) throw new Error("Legacy object-URL bevat geen bucket en objectpad.");
  return {
    bucket: assertLegacyBucket(decodeURIComponent(remainder.slice(0, separator))),
    key: decodeObjectKey(remainder.slice(separator + 1)),
  };
}

function destinationKey(purpose: LegacyStoragePurpose, assetId: string): string {
  return assertObjectKey(`${purpose}/${assetId.slice(0, 2)}/${assetId}/source`);
}

export function buildStorageMigrationPlan(
  references: readonly LegacyMediaReference[],
  fingerprintKey: Uint8Array,
): StorageMigrationPlan {
  const grouped = new Map<string, StorageMigrationPlanEntry>();
  for (const rawReference of references) {
    const reference = z.object({
      bucket: z.string(),
      key: z.string(),
      field: z.string().min(1).max(160),
      ownerId: z.string().uuid(),
      projectId: z.string().uuid().nullable(),
      purpose: z.enum(["originals", "display", "avatars", "floorplans", "photobook-pdfs", "exports", "temporary"]),
      recordId: z.string().min(1).max(512),
      table: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    }).strict().parse(rawReference);
    const bucket = assertLegacyBucket(reference.bucket);
    const key = assertLegacySourceKey(reference.key);
    const groupingKey = `${reference.purpose}\0${bucket}\0${key}`;
    let entry = grouped.get(groupingKey);
    if (!entry) {
      const assetId = stableUuid(BUILDY_MIGRATION_NAMESPACE, `asset:${groupingKey}`);
      entry = {
        assetId,
        bucket,
        key,
        destinationKey: destinationKey(reference.purpose, assetId),
        locatorFingerprint: keyedFingerprint(fingerprintKey, "storage.locator", `${bucket}/${key}`),
        purpose: reference.purpose,
        references: [],
      };
      grouped.set(groupingKey, entry);
    }
    entry.references.push({
      field: reference.field,
      ownerId: reference.ownerId,
      projectId: reference.projectId,
      recordId: reference.recordId,
      table: reference.table,
    });
  }

  const entries = [...grouped.values()].sort((left, right) => left.destinationKey.localeCompare(right.destinationKey));
  for (const entry of entries) {
    entry.references.sort((left, right) =>
      `${left.table}:${left.recordId}:${left.field}`.localeCompare(`${right.table}:${right.recordId}:${right.field}`));
  }
  return {
    schemaVersion: 1,
    entries,
    sourceObjectCount: entries.length,
    referenceCount: entries.reduce((total, entry) => total + entry.references.length, 0),
  };
}

export interface StorageCopyCheckpoint {
  assetId: string;
  attempt: number;
  checksumSha256?: string;
  completedAt?: string;
  contentType?: string;
  destinationKey: string;
  errorCode?: string;
  locatorFingerprint: string;
  sizeBytes?: number;
  status: "planned" | "verified" | "failed" | "conflict";
}

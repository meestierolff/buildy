import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { assertObjectKey, type ObjectPurpose } from "../../server/storage/objectStorage";
import { BUILDY_MIGRATION_NAMESPACE } from "./auth";
import { keyedFingerprint, sha256Hex, stableUuid } from "./core";

const MAX_SOURCE_KEY_BYTES = 1024;
const MAX_OBJECT_BYTES = 512 * 1024 * 1024;
const SHA256_HEX = /^[0-9a-f]{64}$/;

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

export interface MigrationObjectMetadata {
  checksumSha256?: string;
  contentType: string;
  etag?: string;
  sizeBytes: number;
}

export interface MigrationObjectStore {
  head(key: string): Promise<MigrationObjectMetadata | null>;
  read(key: string, maximumBytes: number): Promise<Uint8Array>;
  writeIfAbsent(input: {
    bytes: Uint8Array;
    checksumSha256: string;
    contentType: string;
    key: string;
  }): Promise<"created" | "exists">;
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

export interface StorageCopyResult {
  checkpoints: StorageCopyCheckpoint[];
  summary: {
    conflicts: number;
    failed: number;
    planned: number;
    skippedVerified: number;
    verified: number;
  };
}

function sameMetadata(
  metadata: MigrationObjectMetadata,
  checksumSha256: string,
  sizeBytes: number,
): boolean {
  return metadata.sizeBytes === sizeBytes && metadata.checksumSha256 === checksumSha256;
}

export async function copyStoragePlan(input: {
  execute: boolean;
  now?: () => Date;
  onCheckpoint?: (checkpoint: StorageCopyCheckpoint) => Promise<void>;
  plan: StorageMigrationPlan;
  previous?: readonly StorageCopyCheckpoint[];
  sourceByBucket: ReadonlyMap<string, MigrationObjectStore>;
  target: MigrationObjectStore;
}): Promise<StorageCopyResult> {
  const now = input.now ?? (() => new Date());
  const previousByAsset = new Map((input.previous ?? []).map((checkpoint) => [checkpoint.assetId, checkpoint]));
  const checkpoints: StorageCopyCheckpoint[] = [];
  let skippedVerified = 0;

  for (const entry of input.plan.entries) {
    const prior = previousByAsset.get(entry.assetId);
    const base: StorageCopyCheckpoint = {
      assetId: entry.assetId,
      attempt: (prior?.attempt ?? 0) + (input.execute ? 1 : 0),
      destinationKey: entry.destinationKey,
      locatorFingerprint: entry.locatorFingerprint,
      status: "planned",
    };
    if (!input.execute) {
      checkpoints.push(base);
      continue;
    }

    try {
      const source = input.sourceByBucket.get(entry.bucket);
      if (!source) throw new Error("SOURCE_BUCKET_NOT_CONFIGURED");
      const sourceHead = await source.head(entry.key);
      if (!sourceHead) throw new Error("SOURCE_OBJECT_MISSING");
      if (!Number.isSafeInteger(sourceHead.sizeBytes) || sourceHead.sizeBytes < 1 || sourceHead.sizeBytes > MAX_OBJECT_BYTES) {
        throw new Error("SOURCE_OBJECT_SIZE_INVALID");
      }

      const targetHead = await input.target.head(entry.destinationKey);
      if (
        prior?.status === "verified" &&
        prior.checksumSha256 &&
        prior.sizeBytes &&
        targetHead &&
        sameMetadata(targetHead, prior.checksumSha256, prior.sizeBytes)
      ) {
        const checkpoint = { ...prior, attempt: prior.attempt };
        checkpoints.push(checkpoint);
        skippedVerified += 1;
        continue;
      }

      const bytes = await source.read(entry.key, sourceHead.sizeBytes);
      if (bytes.byteLength !== sourceHead.sizeBytes) throw new Error("SOURCE_READ_SIZE_MISMATCH");
      const checksumSha256 = sha256Hex(bytes);
      if (sourceHead.checksumSha256 && sourceHead.checksumSha256 !== checksumSha256) {
        throw new Error("SOURCE_CHECKSUM_MISMATCH");
      }

      if (targetHead) {
        let targetChecksum = targetHead.checksumSha256;
        if (!targetChecksum) targetChecksum = sha256Hex(await input.target.read(entry.destinationKey, targetHead.sizeBytes));
        if (!sameMetadata({ ...targetHead, checksumSha256: targetChecksum }, checksumSha256, bytes.byteLength)) {
          const checkpoint: StorageCopyCheckpoint = {
            ...base,
            checksumSha256,
            errorCode: "DESTINATION_CONFLICT",
            sizeBytes: bytes.byteLength,
            status: "conflict",
          };
          checkpoints.push(checkpoint);
          await input.onCheckpoint?.(checkpoint);
          continue;
        }
      } else {
        await input.target.writeIfAbsent({
          bytes,
          checksumSha256,
          contentType: sourceHead.contentType || "application/octet-stream",
          key: entry.destinationKey,
        });
      }

      const readbackHead = await input.target.head(entry.destinationKey);
      if (!readbackHead || readbackHead.sizeBytes !== bytes.byteLength) throw new Error("DESTINATION_READBACK_MISSING");
      const readbackChecksum = readbackHead.checksumSha256
        ?? sha256Hex(await input.target.read(entry.destinationKey, readbackHead.sizeBytes));
      if (readbackChecksum !== checksumSha256) throw new Error("DESTINATION_READBACK_MISMATCH");

      const checkpoint: StorageCopyCheckpoint = {
        ...base,
        checksumSha256,
        completedAt: now().toISOString(),
        contentType: sourceHead.contentType || "application/octet-stream",
        sizeBytes: bytes.byteLength,
        status: "verified",
      };
      checkpoints.push(checkpoint);
      await input.onCheckpoint?.(checkpoint);
    } catch (error) {
      const candidate = error instanceof Error ? error.message : "UNKNOWN_STORAGE_ERROR";
      const errorCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(candidate) ? candidate : "STORAGE_PROVIDER_ERROR";
      const checkpoint: StorageCopyCheckpoint = { ...base, errorCode, status: "failed" };
      checkpoints.push(checkpoint);
      await input.onCheckpoint?.(checkpoint);
    }
  }

  return {
    checkpoints,
    summary: {
      conflicts: checkpoints.filter((checkpoint) => checkpoint.status === "conflict").length,
      failed: checkpoints.filter((checkpoint) => checkpoint.status === "failed").length,
      planned: checkpoints.filter((checkpoint) => checkpoint.status === "planned").length,
      skippedVerified,
      verified: checkpoints.filter((checkpoint) => checkpoint.status === "verified").length,
    },
  };
}

export interface S3MigrationObjectStoreConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
}

function providerChecksum(metadata: Record<string, string> | undefined, checksumSha256?: string): string | undefined {
  const custom = metadata?.["buildy-migration-sha256"] ?? metadata?.["buildy-sha256"];
  if (custom && SHA256_HEX.test(custom)) return custom;
  if (checksumSha256) {
    const bytes = Buffer.from(checksumSha256, "base64");
    if (bytes.length === 32) return bytes.toString("hex");
  }
  return undefined;
}

async function bodyToBytes(body: { transformToWebStream(): ReadableStream<Uint8Array> }, maximumBytes: number): Promise<Uint8Array> {
  const reader = body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("OBJECT_READ_LIMIT_EXCEEDED");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

/** S3-compatible adapter used only after the CLI's explicit read/write gates. */
export class S3MigrationObjectStore implements MigrationObjectStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3MigrationObjectStoreConfig) {
    if (![config.accessKeyId, config.bucket, config.endpoint, config.region, config.secretAccessKey].every(Boolean)) {
      throw new Error("S3 migratieconfiguratie is onvolledig.");
    }
    this.client = new S3Client({
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: config.region,
    });
  }

  async head(key: string): Promise<MigrationObjectMetadata | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!Number.isSafeInteger(result.ContentLength) || (result.ContentLength ?? 0) < 0) {
        throw new Error("OBJECT_METADATA_INVALID");
      }
      return {
        checksumSha256: providerChecksum(result.Metadata, result.ChecksumSHA256),
        contentType: result.ContentType ?? "application/octet-stream",
        etag: result.ETag?.replaceAll('"', ""),
        sizeBytes: result.ContentLength ?? 0,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async read(key: string, maximumBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_OBJECT_BYTES) {
      throw new Error("OBJECT_READ_LIMIT_INVALID");
    }
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!result.Body) throw new Error("OBJECT_BODY_MISSING");
    return bodyToBytes(result.Body, maximumBytes);
  }

  async writeIfAbsent(input: {
    bytes: Uint8Array;
    checksumSha256: string;
    contentType: string;
    key: string;
  }): Promise<"created" | "exists"> {
    assertObjectKey(input.key);
    if (!SHA256_HEX.test(input.checksumSha256) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_OBJECT_BYTES) {
      throw new Error("OBJECT_WRITE_INVALID");
    }
    try {
      await this.client.send(new PutObjectCommand({
        Body: input.bytes,
        Bucket: this.config.bucket,
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        IfNoneMatch: "*",
        Key: input.key,
        Metadata: { "buildy-migration-sha256": input.checksumSha256 },
      }));
      return "created";
    } catch (error) {
      if (isPreconditionFailed(error)) return "exists";
      throw error;
    }
  }

  async inventory(): Promise<{ objectCount: number; totalBytes: number; listingSha256: string }> {
    const hash = createHash("sha256");
    let cursor: string | undefined;
    let objectCount = 0;
    let totalBytes = 0;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        ContinuationToken: cursor,
        MaxKeys: 1000,
      }));
      const objects = (page.Contents ?? [])
        .filter((entry): entry is typeof entry & { Key: string; Size: number } =>
          typeof entry.Key === "string" && typeof entry.Size === "number")
        .sort((left, right) => left.Key.localeCompare(right.Key));
      for (const object of objects) {
        assertLegacySourceKey(object.Key);
        objectCount += 1;
        totalBytes += object.Size;
        hash.update(object.Key).update("\0").update(String(object.Size)).update("\n");
      }
      cursor = page.NextContinuationToken;
    } while (cursor);
    return { objectCount, totalBytes, listingSha256: hash.digest("hex") };
  }
}

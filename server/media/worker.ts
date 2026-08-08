import { createHash } from "node:crypto";
import {
  ImageProcessingError,
  processProjectImage,
  type ProcessedImageVariant,
  type ProcessedProjectImage,
} from "./imageProcessing.js";
import {
  ObjectStorageError,
  createObjectKey,
  type ObjectPurpose,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/objectStorage.js";
import { MediaError } from "./errors.js";
import { deterministicMediaUuid } from "./idempotency.js";
import type { MediaClock, MediaProcessingJob, MediaRepository } from "./types.js";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const DEFAULT_LEASE_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const ORPHAN_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_CLEANUP_PAGES_PER_PREFIX = 100;

export type MediaWorkerResult =
  | { status: "idle" }
  | { status: "processed"; assetId: string; temporaryCleanupPending: boolean }
  | { status: "retry_scheduled"; assetId: string }
  | { status: "failed"; assetId: string };

export interface MediaWorkerHooks {
  afterObjectWrite?(variant: "original" | "small" | "medium" | "large"): void | Promise<void>;
}

function retryDelay(attemptCount: number): number {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, attemptCount - 1)));
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function processingFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof ImageProcessingError) {
    return { code: `IMAGE_${error.code}`, retryable: false };
  }
  if (error instanceof ObjectStorageError) {
    if (
      error.code === "INVALID_CONTENT_TYPE" ||
      error.code === "INVALID_CHECKSUM" ||
      error.code === "INVALID_SIZE" ||
      error.code === "UPLOAD_MISMATCH"
    ) return { code: `STORAGE_${error.code}`, retryable: false };
    return { code: `STORAGE_${error.code}`, retryable: true };
  }
  if (error instanceof MediaError && error.reason === "WORKER_LEASE_LOST") {
    return { code: "WORKER_LEASE_LOST", retryable: true };
  }
  return { code: "MEDIA_PROCESSING_FAILED", retryable: true };
}

function assertWrittenObject(
  metadata: StoredObjectMetadata,
  key: string,
  variant: ProcessedImageVariant,
): void {
  if (
    metadata.key !== key ||
    metadata.sizeBytes !== variant.sizeBytes ||
    metadata.contentType !== variant.contentType ||
    metadata.checksumSha256Base64 !== variant.sha256Base64
  ) throw new ObjectStorageError("UPLOAD_MISMATCH", "Verwerkt object is niet volledig bevestigd.");
}

export class MediaProcessingWorker {
  constructor(
    private readonly repository: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly workerId: string,
    private readonly clock: MediaClock = () => new Date(),
    private readonly hooks: MediaWorkerHooks = {},
    private readonly leaseSeconds = DEFAULT_LEASE_SECONDS,
  ) {
    if (!/^[A-Za-z0-9:_-]{3,80}$/.test(workerId)) throw new Error("Mediaworker-ID is ongeldig.");
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 15 * 60) {
      throw new Error("Mediaworker-lease is ongeldig.");
    }
  }

  async processNext(): Promise<MediaWorkerResult> {
    const invocationId = createHash("sha256")
      .update(this.workerId)
      .update("\0")
      .update(crypto.randomUUID())
      .digest("hex")
      .slice(0, 24);
    const leaseOwner = `${this.workerId}:${invocationId}`;
    const job = await this.repository.claimProcessingJob(leaseOwner, this.leaseSeconds);
    if (!job) return { status: "idle" };

    try {
      const processed = await this.process(job);
      await this.persist(job, processed);
    } catch (error) {
      const failure = processingFailure(error);
      if (error instanceof MediaError && error.reason === "WORKER_LEASE_LOST") throw error;
      const retryable = failure.retryable && job.attemptCount < MAX_ATTEMPTS;
      await this.repository.failProcessing(
        job,
        failure.code,
        retryable ? { delaySeconds: retryDelay(job.attemptCount) } : null,
      );
      return retryable
        ? { status: "retry_scheduled", assetId: job.assetId }
        : { status: "failed", assetId: job.assetId };
    }

    let temporaryCleanupPending = false;
    try {
      await this.storage.deleteObject(job.temporaryObjectKey);
    } catch {
      temporaryCleanupPending = true;
    }
    return { status: "processed", assetId: job.assetId, temporaryCleanupPending };
  }

  private async process(job: MediaProcessingJob): Promise<ProcessedProjectImage> {
    if (
      !Number.isSafeInteger(job.expectedSizeBytes) ||
      job.expectedSizeBytes < 1 ||
      job.expectedSizeBytes > MAX_SOURCE_BYTES ||
      !/^[0-9a-f]{64}$/.test(job.expectedSha256Hex)
    ) throw new ImageProcessingError("INVALID_SIZE", "Uploadmetadata is ongeldig.");

    const bytes = await this.storage.readObject(job.temporaryObjectKey, job.expectedSizeBytes);
    if (bytes.byteLength !== job.expectedSizeBytes || checksum(bytes) !== job.expectedSha256Hex) {
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Uploadchecksum of grootte wijkt af.");
    }
    return processProjectImage(bytes, job.claimedContentType);
  }

  private async persist(job: MediaProcessingJob, processed: ProcessedProjectImage): Promise<void> {
    const originalObjectKey = createObjectKey("originals", job.assetId);
    const display = [
      ["small", processed.display.small],
      ["medium", processed.display.medium],
      ["large", processed.display.large],
    ] as const;

    const originalMetadata = await this.storage.writeObject({
      key: originalObjectKey,
      contentType: processed.original.contentType,
      bytes: processed.original.bytes,
    });
    assertWrittenObject(originalMetadata, originalObjectKey, processed.original);
    await this.hooks.afterObjectWrite?.("original");

    const derivatives = [];
    for (const [size, variant] of display) {
      const objectKey = createObjectKey("display", job.assetId, `${size}.webp`);
      const metadata = await this.storage.writeObject({
        key: objectKey,
        contentType: variant.contentType,
        bytes: variant.bytes,
      });
      assertWrittenObject(metadata, objectKey, variant);
      await this.hooks.afterObjectWrite?.(size);
      derivatives.push({
        assetId: deterministicMediaUuid(job.assetId, `display-${size}-v1`),
        size,
        objectKey,
        variant,
      });
    }

    await this.repository.finalizeProcessing({
      job,
      originalObjectKey,
      original: processed.original,
      detectedContentType: processed.detectedContentType,
      derivatives,
      now: this.clock(),
    });
  }

  async cleanupOrphans(options: { olderThan?: Date } = {}): Promise<{
    inspected: number;
    deleted: number;
    deleteFailures: number;
  }> {
    const olderThan = options.olderThan ?? new Date(this.clock().getTime() - ORPHAN_RETENTION_MS);
    const prefixes: ObjectPurpose[] = ["temporary", "originals", "display"];
    let inspected = 0;
    let deleted = 0;
    let deleteFailures = 0;

    for (const prefix of prefixes) {
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber < MAX_CLEANUP_PAGES_PER_PREFIX; pageNumber += 1) {
        const page = await this.storage.listObjects(prefix, cursor);
        const candidates = page.objects.filter(
          (object) => object.lastModified && object.lastModified < olderThan,
        );
        inspected += candidates.length;
        const protectedKeys = await this.repository.filterProtectedObjectKeys(
          candidates.map((object) => object.key),
        );
        for (const object of candidates) {
          if (protectedKeys.has(object.key)) continue;
          try {
            await this.storage.deleteObject(object.key);
            deleted += 1;
          } catch {
            deleteFailures += 1;
          }
        }
        cursor = page.cursor;
        if (!cursor) break;
      }
    }
    return { inspected, deleted, deleteFailures };
  }
}

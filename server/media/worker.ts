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
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/objectStorage.js";
import { MediaError } from "./errors.js";
import { deterministicMediaUuid } from "./idempotency.js";
import type {
  MediaCleanupPurpose,
  MediaClock,
  MediaProcessingJob,
  MediaRepository,
} from "./types.js";

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const DEFAULT_LEASE_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const ORPHAN_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_CLEANUP_PAGES_PER_PREFIX = 100;
const MAX_CLEANUP_DELETE_ATTEMPTS = 1_000;
const MAX_CLEANUP_PAGE_OBJECTS = 250;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MediaWorkerResult =
  | { status: "idle" }
  | { status: "processed"; assetId: string; temporaryCleanupPending: boolean }
  | { status: "retry_scheduled"; assetId: string }
  | { status: "failed"; assetId: string };

export interface MediaWorkerHooks {
  afterObjectWrite?(variant: "original" | "small" | "medium" | "large"): void | Promise<void>;
}

export type MediaOrphanCleanupOptions = {
  olderThan?: Date;
  maximumPagesPerPrefix?: number;
  maximumDeleteAttempts?: number;
  shouldContinue?: () => boolean;
};

export type MediaOrphanCleanupFailure = {
  purpose: MediaCleanupPurpose;
  status: "retry_scheduled" | "dead_letter";
  failureCode: string;
};

export type MediaOrphanCleanupResult = {
  inspected: number;
  pages: number;
  deleteAttempts: number;
  deleted: number;
  deleteFailures: number;
  checkpointsClaimed: number;
  checkpointsCompleted: number;
  limitedBy: "none" | "time" | "delete_limit" | "page_limit";
  failures: MediaOrphanCleanupFailure[];
};

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

function cleanupFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof ObjectStorageError) {
    const retryable = error.code === "PROVIDER_ERROR" || error.code === "OBJECT_NOT_FOUND";
    return { code: `STORAGE_${error.code}`.slice(0, 64), retryable };
  }
  if (error instanceof MediaError && error.reason === "WORKER_LEASE_LOST") {
    return { code: "WORKER_LEASE_LOST", retryable: true };
  }
  return { code: "MEDIA_ORPHAN_CLEANUP_FAILED", retryable: true };
}

function boundedCleanupInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new Error(`${label} is ongeldig.`);
  }
  return candidate;
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
    return this.processClaim((leaseOwner) => (
      this.repository.claimProcessingJob(leaseOwner, this.leaseSeconds)
    ));
  }

  async processAsset(assetId: string): Promise<MediaWorkerResult> {
    if (!UUID.test(assetId)) throw new MediaError("MEDIA_NOT_FOUND");
    const normalizedAssetId = assetId.toLowerCase();
    return this.processClaim((leaseOwner) => (
      this.repository.claimProcessingJobForAsset(
        leaseOwner,
        normalizedAssetId,
        this.leaseSeconds,
      )
    ));
  }

  private async processClaim(
    claim: (leaseOwner: string) => Promise<MediaProcessingJob | null>,
  ): Promise<MediaWorkerResult> {
    const invocationId = createHash("sha256")
      .update(this.workerId)
      .update("\0")
      .update(crypto.randomUUID())
      .digest("hex")
      .slice(0, 24);
    const leaseOwner = `${this.workerId}:${invocationId}`;
    const job = await claim(leaseOwner);
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

  async cleanupOrphans(options: MediaOrphanCleanupOptions = {}): Promise<MediaOrphanCleanupResult> {
    const olderThan = options.olderThan ?? new Date(this.clock().getTime() - ORPHAN_RETENTION_MS);
    if (Number.isNaN(olderThan.getTime())) throw new Error("Media-cleanupgrens is ongeldig.");
    const maximumPagesPerPrefix = boundedCleanupInteger(
      options.maximumPagesPerPrefix,
      MAX_CLEANUP_PAGES_PER_PREFIX,
      MAX_CLEANUP_PAGES_PER_PREFIX,
      "Media-cleanuppaginagrens",
    );
    const maximumDeleteAttempts = boundedCleanupInteger(
      options.maximumDeleteAttempts,
      MAX_CLEANUP_DELETE_ATTEMPTS,
      MAX_CLEANUP_DELETE_ATTEMPTS,
      "Media-cleanupverwijdergrens",
    );
    const shouldContinue = options.shouldContinue ?? (() => true);
    const prefixes: MediaCleanupPurpose[] = ["temporary", "originals", "display"];
    let inspected = 0;
    let pages = 0;
    let deleteAttempts = 0;
    let deleted = 0;
    let deleteFailures = 0;
    let checkpointsClaimed = 0;
    let checkpointsCompleted = 0;
    let limitedBy: MediaOrphanCleanupResult["limitedBy"] = "none";
    const failures: MediaOrphanCleanupFailure[] = [];
    const leaseOwner = `${this.workerId}:${createHash("sha256")
      .update("orphan-cleanup\0")
      .update(crypto.randomUUID())
      .digest("hex")
      .slice(0, 20)}`;

    for (const prefix of prefixes) {
      if (!shouldContinue()) {
        limitedBy = "time";
        break;
      }
      const checkpoint = await this.repository.claimOrphanCleanup(
        leaseOwner,
        prefix,
        this.leaseSeconds,
      );
      if (!checkpoint) continue;
      checkpointsClaimed += 1;

      let cursor = checkpoint.cursor;
      let scanComplete = false;
      let prefixPages = 0;
      let checkpointFailed = false;
      try {
        while (prefixPages < maximumPagesPerPrefix) {
          if (!shouldContinue()) {
            limitedBy = "time";
            break;
          }
          if (deleteAttempts >= maximumDeleteAttempts) {
            limitedBy = "delete_limit";
            break;
          }

          const pageCursor = cursor;
          const page = await this.storage.listObjects(prefix, pageCursor);
          if (page.objects.length > MAX_CLEANUP_PAGE_OBJECTS) {
            throw new ObjectStorageError(
              "PROVIDER_ERROR",
              "Private Blob gaf te veel cleanupobjecten in één pagina terug.",
            );
          }
          pages += 1;
          prefixPages += 1;
          const candidates = page.objects.filter(
            (object) => object.lastModified && object.lastModified < olderThan,
          );
          inspected += candidates.length;
          const protectedKeys = await this.repository.filterProtectedObjectKeys(
            candidates.map((object) => object.key),
          );
          let pageComplete = true;
          let pageDeleteFailure: unknown;
          for (const object of candidates) {
            if (protectedKeys.has(object.key)) continue;
            if (!shouldContinue()) {
              limitedBy = "time";
              pageComplete = false;
              break;
            }
            if (deleteAttempts >= maximumDeleteAttempts) {
              limitedBy = "delete_limit";
              pageComplete = false;
              break;
            }
            deleteAttempts += 1;
            try {
              await this.storage.deleteObject(object.key);
              if (await this.storage.headObject(object.key)) {
                throw new ObjectStorageError(
                  "PROVIDER_ERROR",
                  "Privéobject bestaat nog na orphan-cleanup.",
                );
              }
              deleted += 1;
            } catch (error) {
              deleteFailures += 1;
              pageDeleteFailure ??= error;
            }
          }
          if (pageDeleteFailure) throw pageDeleteFailure;
          if (!pageComplete) {
            cursor = pageCursor;
            break;
          }
          if (
            page.cursor !== undefined
            && (
              page.cursor.length < 1
              || page.cursor.length > 2_048
              || page.cursor === pageCursor
            )
          ) {
            throw new ObjectStorageError(
              "PROVIDER_ERROR",
              "Private Blob gaf geen geldige voortgangscursor terug.",
            );
          }
          cursor = page.cursor;
          if (!cursor) {
            scanComplete = true;
            break;
          }
        }

        if (!scanComplete && limitedBy === "none" && prefixPages >= maximumPagesPerPrefix) {
          limitedBy = "page_limit";
        }
        await this.repository.finalizeOrphanCleanup(checkpoint, cursor, scanComplete);
        checkpointsCompleted += 1;
      } catch (error) {
        if (error instanceof MediaError && error.reason === "WORKER_LEASE_LOST") throw error;
        checkpointFailed = true;
        const failure = cleanupFailure(error);
        const retryable = failure.retryable && checkpoint.attemptCount < MAX_ATTEMPTS;
        await this.repository.failOrphanCleanup(
          checkpoint,
          failure.code,
          retryable ? { delaySeconds: retryDelay(checkpoint.attemptCount) } : null,
        );
        failures.push({
          purpose: checkpoint.purpose,
          status: retryable ? "retry_scheduled" : "dead_letter",
          failureCode: failure.code,
        });
      }
      if (checkpointFailed) continue;
      if (limitedBy === "time" || limitedBy === "delete_limit") break;
    }
    return {
      inspected,
      pages,
      deleteAttempts,
      deleted,
      deleteFailures,
      checkpointsClaimed,
      checkpointsCompleted,
      limitedBy,
      failures,
    };
  }
}

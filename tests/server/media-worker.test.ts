// @vitest-environment node

import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { ProjectActor } from "../../server/projects/actor";
import {
  ObjectStorageError,
  type ObjectPurpose,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../../server/storage/objectStorage";
import type {
  CompleteUploadCommand,
  CreateUploadIntentCommand,
  DisplayObject,
  FinalizeMediaProcessingCommand,
  InternalUploadIntent,
  MediaCleanupCheckpoint,
  MediaCleanupPurpose,
  MediaProcessingJob,
  MediaRepository,
  OriginalObject,
  PendingUpload,
} from "../../server/media/types";
import { MediaProcessingWorker } from "../../server/media/worker";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";

class WorkerRepository implements MediaRepository {
  readonly jobs: MediaProcessingJob[] = [];
  readonly finalized: FinalizeMediaProcessingCommand[] = [];
  readonly failures: Array<{
    job: MediaProcessingJob;
    failureCode: string;
    retry: { delaySeconds: number } | null;
  }> = [];
  readonly targetedClaims: string[] = [];
  protectedKeys = new Set<string>();
  readonly cleanupClaims: MediaCleanupCheckpoint[] = [];
  readonly cleanupFinalizations: Array<{
    checkpoint: MediaCleanupCheckpoint;
    nextCursor: string | undefined;
    scanComplete: boolean;
  }> = [];
  readonly cleanupFailures: Array<{
    checkpoint: MediaCleanupCheckpoint;
    failureCode: string;
    retry: { delaySeconds: number } | null;
  }> = [];
  cleanupAttemptCount = 1;

  async createUploadIntent(_command: CreateUploadIntentCommand): Promise<InternalUploadIntent> {
    throw new Error("unused");
  }
  async findUploadForCompletion(): Promise<PendingUpload | null> { return null; }
  async completeUpload(_command: CompleteUploadCommand): Promise<never> { throw new Error("unused"); }
  async rejectUpload(): Promise<void> {}
  async resolveDisplayObject(_viewer: ProjectActor): Promise<DisplayObject | null> { return null; }
  async resolveOwnedOriginal(): Promise<OriginalObject | null> { return null; }
  async claimProcessingJob(workerId: string): Promise<MediaProcessingJob | null> {
    const job = this.jobs.shift();
    return job ? { ...job, workerId } : null;
  }
  async claimProcessingJobForAsset(
    workerId: string,
    assetId: string,
  ): Promise<MediaProcessingJob | null> {
    this.targetedClaims.push(assetId);
    const index = this.jobs.findIndex((candidate) => candidate.assetId === assetId);
    if (index < 0) return null;
    const [claimed] = this.jobs.splice(index, 1);
    return claimed ? { ...claimed, workerId } : null;
  }
  async finalizeProcessing(command: FinalizeMediaProcessingCommand): Promise<void> {
    this.finalized.push(command);
  }
  async failProcessing(
    job: MediaProcessingJob,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    this.failures.push({ job, failureCode, retry });
  }
  async claimOrphanCleanup(
    workerId: string,
    purpose: MediaCleanupPurpose,
  ): Promise<MediaCleanupCheckpoint> {
    const checkpoint = {
      workerId,
      eventId: purpose === "temporary"
        ? "70000000-0000-4000-8000-000000000001"
        : purpose === "originals"
          ? "70000000-0000-4000-8000-000000000002"
          : "70000000-0000-4000-8000-000000000003",
      purpose,
      attemptCount: this.cleanupAttemptCount,
    } satisfies MediaCleanupCheckpoint;
    this.cleanupClaims.push(checkpoint);
    return checkpoint;
  }
  async finalizeOrphanCleanup(
    checkpoint: MediaCleanupCheckpoint,
    nextCursor: string | undefined,
    scanComplete: boolean,
  ): Promise<void> {
    this.cleanupFinalizations.push({ checkpoint, nextCursor, scanComplete });
  }
  async failOrphanCleanup(
    checkpoint: MediaCleanupCheckpoint,
    failureCode: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    this.cleanupFailures.push({ checkpoint, failureCode, retry });
  }
  async filterProtectedObjectKeys(candidateKeys: readonly string[]): Promise<Set<string>> {
    return new Set(candidateKeys.filter((key) => this.protectedKeys.has(key)));
  }
}

function storageFixture() {
  const objects = new Map<string, { bytes: Uint8Array; metadata: StoredObjectMetadata }>();
  const writes: string[] = [];
  const deletes: string[] = [];
  const storage: ObjectStorage = {
    createUploadUrl: async () => { throw new Error("unused"); },
    completeUpload: async () => { throw new Error("unused"); },
    createDownloadUrl: async () => { throw new Error("unused"); },
    streamObject: async () => { throw new Error("workers use bounded reads"); },
    readObject: async (key, maximumBytes) => {
      const object = objects.get(key);
      if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "missing");
      if (object.bytes.byteLength > maximumBytes) throw new ObjectStorageError("INVALID_SIZE", "large");
      return object.bytes;
    },
    writeObject: async (input) => {
      const bytes = Buffer.from(input.bytes);
      const metadata: StoredObjectMetadata = {
        key: input.key,
        sizeBytes: bytes.length,
        contentType: input.contentType,
        checksumSha256Base64: createHash("sha256").update(bytes).digest("base64"),
        lastModified: new Date("2026-08-04T10:00:00Z"),
      };
      objects.set(input.key, { bytes, metadata });
      writes.push(input.key);
      return metadata;
    },
    headObject: async (key) => objects.get(key)?.metadata ?? null,
    copyObject: async () => undefined,
    deleteObject: async (key) => {
      objects.delete(key);
      deletes.push(key);
    },
    listObjects: async (prefix: ObjectPurpose) => ({
      objects: [...objects.values()]
        .map((entry) => entry.metadata)
        .filter((entry) => entry.key.startsWith(`${prefix}/`)),
    }),
    getChecksum: async (key) => objects.get(key)?.metadata.checksumSha256Base64,
  };
  return { storage, objects, writes, deletes };
}

function job(bytes: Uint8Array, overrides: Partial<MediaProcessingJob> = {}): MediaProcessingJob {
  return {
    workerId: "media-worker-1",
    eventId: EVENT_ID,
    assetId: ASSET_ID,
    ownerId: ACTOR_ID,
    projectId: PROJECT_ID,
    purpose: "project_media",
    temporaryObjectKey: `temporary/44/${ASSET_ID}`,
    bucket: "buildy-private-media",
    claimedContentType: "image/jpeg",
    expectedSizeBytes: bytes.byteLength,
    expectedSha256Hex: createHash("sha256").update(bytes).digest("hex"),
    privacyVersion: 3,
    attemptCount: 1,
    ...overrides,
  };
}

function putTemporary(
  fixture: ReturnType<typeof storageFixture>,
  mediaJob: MediaProcessingJob,
  bytes: Uint8Array,
): void {
  fixture.objects.set(mediaJob.temporaryObjectKey, {
    bytes,
    metadata: {
      key: mediaJob.temporaryObjectKey,
      sizeBytes: bytes.byteLength,
      contentType: mediaJob.claimedContentType,
      checksumSha256Base64: createHash("sha256").update(bytes).digest("base64"),
      lastModified: new Date("2026-08-04T09:00:00Z"),
    },
  });
}

describe("resumable private media processing", () => {
  it("claims and processes only the explicitly requested asset", async () => {
    const bytes = await sharp({
      create: { width: 12, height: 8, channels: 3, background: "#315f47" },
    }).jpeg().toBuffer();
    const otherAssetId = "66666666-6666-4666-8666-666666666666";
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const otherJob = job(bytes, {
      assetId: otherAssetId,
      temporaryObjectKey: `temporary/66/${otherAssetId}`,
    });
    const requestedJob = job(bytes);
    repository.jobs.push(otherJob, requestedJob);
    putTemporary(fixture, requestedJob, bytes);
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    await expect(worker.processAsset(ASSET_ID)).resolves.toMatchObject({
      status: "processed",
      assetId: ASSET_ID,
    });

    expect(repository.targetedClaims).toEqual([ASSET_ID]);
    expect(repository.jobs.map((candidate) => candidate.assetId)).toEqual([otherAssetId]);
    expect(repository.finalized).toHaveLength(1);
    expect(repository.finalized[0]?.job.assetId).toBe(ASSET_ID);
  });

  it("rejects an invalid target before asking the privileged repository to claim it", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    await expect(worker.processAsset("../../../ander-account")).rejects.toMatchObject({
      reason: "MEDIA_NOT_FOUND",
    });
    expect(repository.targetedClaims).toEqual([]);
  });

  it("sanitizes orientation/metadata and finalizes deterministic original and display objects", async () => {
    const bytes = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#a54f35" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const mediaJob = job(bytes);
    repository.jobs.push(mediaJob);
    putTemporary(fixture, mediaJob, bytes);
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    const result = await worker.processNext();

    expect(result).toEqual({ status: "processed", assetId: ASSET_ID, temporaryCleanupPending: false });
    expect(repository.finalized).toHaveLength(1);
    const command = repository.finalized[0];
    expect(command?.originalObjectKey).toBe(`originals/44/${ASSET_ID}`);
    expect(command?.original).toMatchObject({ widthPixels: 10, heightPixels: 20 });
    expect(command?.derivatives.map((item) => [item.size, item.objectKey])).toEqual([
      ["small", `display/44/${ASSET_ID}/small.webp`],
      ["medium", `display/44/${ASSET_ID}/medium.webp`],
      ["large", `display/44/${ASSET_ID}/large.webp`],
    ]);
    expect(new Set(command?.derivatives.map((item) => item.assetId)).size).toBe(3);
    expect(fixture.objects.has(mediaJob.temporaryObjectKey)).toBe(false);
  });

  it("keeps temp data after a crash following object write and safely overwrites on retry", async () => {
    const bytes = await sharp({
      create: { width: 8, height: 6, channels: 3, background: "#faf7f0" },
    }).jpeg().toBuffer();
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const firstJob = job(bytes, { attemptCount: 1 });
    const retryJob = job(bytes, { attemptCount: 2 });
    repository.jobs.push(firstJob, retryJob);
    putTemporary(fixture, firstJob, bytes);
    const crash = vi.fn((variant: string) => {
      if (variant === "original") throw new Error("simulated process exit");
    });
    const firstWorker = new MediaProcessingWorker(
      repository,
      fixture.storage,
      "media-worker-1",
      undefined,
      { afterObjectWrite: crash },
    );

    await expect(firstWorker.processNext()).resolves.toMatchObject({ status: "retry_scheduled" });
    expect(fixture.objects.has(firstJob.temporaryObjectKey)).toBe(true);
    expect(fixture.objects.has(`originals/44/${ASSET_ID}`)).toBe(true);
    expect(repository.finalized).toHaveLength(0);

    const retryWorker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");
    await expect(retryWorker.processNext()).resolves.toMatchObject({ status: "processed" });
    expect(repository.finalized).toHaveLength(1);
    expect(fixture.writes.filter((key) => key === `originals/44/${ASSET_ID}`)).toHaveLength(2);
    expect(fixture.objects.has(firstJob.temporaryObjectKey)).toBe(false);
  });

  it("dead-letters a corrupt image without publishing derivatives", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const mediaJob = job(bytes, { claimedContentType: "image/jpeg" });
    repository.jobs.push(mediaJob);
    putTemporary(fixture, mediaJob, bytes);
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    const result = await worker.processNext();

    expect(result).toMatchObject({ status: "failed", assetId: ASSET_ID });
    expect(repository.failures[0]).toMatchObject({ failureCode: "IMAGE_DECODE_FAILED", retry: null });
    expect(repository.finalized).toHaveLength(0);
    expect(fixture.objects.has(mediaJob.temporaryObjectKey)).toBe(true);
  });

  it("dead-letters a real image whose claimed MIME does not match its magic bytes", async () => {
    const bytes = await sharp({
      create: { width: 4, height: 3, channels: 3, background: "#4078a0" },
    }).jpeg().toBuffer();
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const mediaJob = job(bytes, { claimedContentType: "image/png" });
    repository.jobs.push(mediaJob);
    putTemporary(fixture, mediaJob, bytes);
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    const result = await worker.processNext();

    expect(result).toMatchObject({ status: "failed", assetId: ASSET_ID });
    expect(repository.failures[0]).toMatchObject({ failureCode: "IMAGE_MIME_MISMATCH", retry: null });
    expect(repository.finalized).toHaveLength(0);
    expect(fixture.objects.has(mediaJob.temporaryObjectKey)).toBe(true);
  });

  it("rejects a changed source checksum before image decoding", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const mediaJob = job(bytes, { expectedSha256Hex: "f".repeat(64) });
    repository.jobs.push(mediaJob);
    putTemporary(fixture, mediaJob, bytes);
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    await expect(worker.processNext()).resolves.toMatchObject({ status: "failed" });
    expect(repository.failures[0]).toMatchObject({
      failureCode: "STORAGE_UPLOAD_MISMATCH",
      retry: null,
    });
  });

  it("deletes only old, unreferenced orphans and preserves protected processing keys", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const orphanKey = `display/55/55555555-5555-4555-8555-555555555555/large.webp`;
    const protectedKey = `originals/44/${ASSET_ID}`;
    const recentKey = `temporary/55/55555555-5555-4555-8555-555555555555`;
    for (const [key, lastModified] of [
      [orphanKey, new Date("2026-08-01T10:00:00Z")],
      [protectedKey, new Date("2026-08-01T10:00:00Z")],
      [recentKey, new Date("2026-08-04T09:59:00Z")],
    ] as const) {
      fixture.objects.set(key, {
        bytes: Buffer.from("x"),
        metadata: { key, sizeBytes: 1, contentType: "image/webp", lastModified },
      });
    }
    repository.protectedKeys.add(protectedKey);
    const worker = new MediaProcessingWorker(
      repository,
      fixture.storage,
      "media-worker-1",
      () => new Date("2026-08-04T10:00:00Z"),
    );

    const result = await worker.cleanupOrphans();

    expect(result).toEqual({
      inspected: 2,
      pages: 3,
      deleteAttempts: 1,
      deleted: 1,
      deleteFailures: 0,
      checkpointsClaimed: 3,
      checkpointsCompleted: 3,
      limitedBy: "none",
      failures: [],
    });
    expect(repository.cleanupFinalizations).toHaveLength(3);
    expect(repository.cleanupFinalizations.every((entry) => entry.scanComplete)).toBe(true);
    expect(fixture.objects.has(orphanKey)).toBe(false);
    expect(fixture.objects.has(protectedKey)).toBe(true);
    expect(fixture.objects.has(recentKey)).toBe(true);
  });

  it("persists the last completed page cursor when a strict page slice is exhausted", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const listObjects = vi.spyOn(fixture.storage, "listObjects")
      .mockImplementation(async (prefix, cursor) => ({
        objects: [],
        cursor: cursor ? `${cursor}-next` : `${prefix}-page-2`,
      }));
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    const result = await worker.cleanupOrphans({ maximumPagesPerPrefix: 1 });

    expect(result).toMatchObject({
      pages: 3,
      checkpointsClaimed: 3,
      checkpointsCompleted: 3,
      limitedBy: "page_limit",
    });
    expect(repository.cleanupFinalizations.map((entry) => ({
      purpose: entry.checkpoint.purpose,
      cursor: entry.nextCursor,
      complete: entry.scanComplete,
    }))).toEqual([
      { purpose: "temporary", cursor: "temporary-page-2", complete: false },
      { purpose: "originals", cursor: "originals-page-2", complete: false },
      { purpose: "display", cursor: "display-page-2", complete: false },
    ]);
    expect(listObjects).toHaveBeenCalledTimes(3);
  });

  it("bounds deletion attempts, keeps the current page resumable and verifies removals", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const keys = [
      `temporary/51/51111111-1111-4111-8111-111111111111`,
      `temporary/52/52222222-2222-4222-8222-222222222222`,
    ];
    for (const key of keys) {
      fixture.objects.set(key, {
        bytes: Buffer.from("x"),
        metadata: {
          key,
          sizeBytes: 1,
          contentType: "image/webp",
          lastModified: new Date("2026-08-01T10:00:00Z"),
        },
      });
    }
    const worker = new MediaProcessingWorker(
      repository,
      fixture.storage,
      "media-worker-1",
      () => new Date("2026-08-04T10:00:00Z"),
    );

    const result = await worker.cleanupOrphans({ maximumDeleteAttempts: 1 });

    expect(result).toMatchObject({
      pages: 1,
      deleteAttempts: 1,
      deleted: 1,
      limitedBy: "delete_limit",
    });
    expect(repository.cleanupFinalizations).toHaveLength(1);
    expect(repository.cleanupFinalizations[0]).toMatchObject({
      nextCursor: undefined,
      scanComplete: false,
    });
    expect(fixture.objects.has(keys[0]!)).toBe(false);
    expect(fixture.objects.has(keys[1]!)).toBe(true);
  });

  it("persists retry and dead-letter details without exposing object keys", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    vi.spyOn(fixture.storage, "listObjects").mockRejectedValue(
      new ObjectStorageError("PROVIDER_ERROR", "provider down"),
    );
    const worker = new MediaProcessingWorker(repository, fixture.storage, "media-worker-1");

    const result = await worker.cleanupOrphans({ maximumPagesPerPrefix: 1 });

    expect(result.failures).toEqual([
      {
        purpose: "temporary",
        status: "retry_scheduled",
        failureCode: "STORAGE_PROVIDER_ERROR",
      },
      {
        purpose: "originals",
        status: "retry_scheduled",
        failureCode: "STORAGE_PROVIDER_ERROR",
      },
      {
        purpose: "display",
        status: "retry_scheduled",
        failureCode: "STORAGE_PROVIDER_ERROR",
      },
    ]);
    expect(repository.cleanupFailures).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("provider down");

    const exhaustedRepository = new WorkerRepository();
    exhaustedRepository.cleanupAttemptCount = 5;
    const exhaustedFixture = storageFixture();
    vi.spyOn(exhaustedFixture.storage, "listObjects").mockRejectedValue(
      new ObjectStorageError("PROVIDER_ERROR", "provider down"),
    );
    const exhaustedWorker = new MediaProcessingWorker(
      exhaustedRepository,
      exhaustedFixture.storage,
      "media-worker-1",
    );

    const exhausted = await exhaustedWorker.cleanupOrphans({ maximumPagesPerPrefix: 1 });

    expect(exhausted.failures.every((failure) => failure.status === "dead_letter")).toBe(true);
    expect(exhaustedRepository.cleanupFailures.every((failure) => failure.retry === null)).toBe(true);
  });
});

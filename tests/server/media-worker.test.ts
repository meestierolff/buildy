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
  protectedKeys = new Set<string>();

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

    expect(result).toEqual({ inspected: 2, deleted: 1, deleteFailures: 0 });
    expect(fixture.objects.has(orphanKey)).toBe(false);
    expect(fixture.objects.has(protectedKey)).toBe(true);
    expect(fixture.objects.has(recentKey)).toBe(true);
  });
});

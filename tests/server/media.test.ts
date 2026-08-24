// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { ProjectActor } from "../../server/projects/actor";
import {
  ObjectStorageError,
  type ClientUploadObjectStorage,
  type ObjectPage,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../../server/storage/objectStorage";
import { MediaError } from "../../server/media/errors";
import { HmacOriginalMediaPurposeGrants } from "../../server/media/purposeGrant";
import { MediaService } from "../../server/media/service";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";
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

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const BLOCKED_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ASSET_ID = "55555555-5555-4555-8555-555555555555";
const CHECKSUM_BASE64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const BLIND_INDEX = new PrivacyBlindIndex(Buffer.alloc(32, 17).toString("base64"));

class FakeMediaRepository implements MediaRepository {
  readonly intents: CreateUploadIntentCommand[] = [];
  readonly rejected: Array<{ actorId: string; assetId: string; failureCode: string }> = [];
  readonly prior = new Map<string, { requestHash: string; intent: InternalUploadIntent }>();
  upload: PendingUpload | null = null;
  display: DisplayObject | null = null;
  original: OriginalObject | null = null;
  privateProject = false;
  blockedActorId: string | null = null;
  completeCalls = 0;

  async createUploadIntent(command: CreateUploadIntentCommand): Promise<InternalUploadIntent> {
    this.intents.push(command);
    const prior = this.prior.get(command.idempotencyKey);
    if (prior) {
      if (prior.requestHash !== command.requestHash) throw new MediaError("UPLOAD_CONFLICT");
      return { ...prior.intent, replayed: true };
    }
    const intent: InternalUploadIntent = {
      asset: {
        id: command.assetId,
        projectId: command.projectId,
        purpose: command.purpose,
        status: "pending_upload",
      },
      temporaryObjectKey: command.temporaryObjectKey,
      contentType: command.contentType,
      sizeBytes: command.sizeBytes,
      checksumSha256Base64: command.checksumSha256Base64,
      replayed: false,
    };
    this.prior.set(command.idempotencyKey, { requestHash: command.requestHash, intent });
    this.upload = {
      asset: intent.asset,
      ownerId: command.actorId,
      temporaryObjectKey: command.temporaryObjectKey,
      contentType: command.contentType,
      maximumBytes: command.sizeBytes,
      checksumSha256Base64: command.checksumSha256Base64,
      checksumSha256Hex: command.checksumSha256Hex,
    };
    return intent;
  }

  async findUploadForCompletion(actorId: string, assetId: string): Promise<PendingUpload | null> {
    if (actorId !== ACTOR_ID || this.upload?.asset.id !== assetId) return null;
    return this.upload;
  }

  async completeUpload(_command: CompleteUploadCommand) {
    this.completeCalls += 1;
    if (!this.upload) throw new MediaError("MEDIA_NOT_FOUND");
    this.upload = {
      ...this.upload,
      asset: { ...this.upload.asset, status: "uploaded" },
    };
    return { asset: this.upload.asset, replayed: false };
  }

  async rejectUpload(actorId: string, assetId: string, failureCode: string): Promise<void> {
    this.rejected.push({ actorId, assetId, failureCode });
    if (this.upload) this.upload = { ...this.upload, asset: { ...this.upload.asset, status: "failed" } };
  }

  async resolveDisplayObject(viewer: ProjectActor): Promise<DisplayObject | null> {
    if (viewer.kind === "authenticated" && viewer.appUserId === this.blockedActorId) return null;
    if (viewer.kind === "anonymous" && this.privateProject) return null;
    return this.display;
  }

  async resolveOwnedOriginal(actorId: string): Promise<OriginalObject | null> {
    return actorId === ACTOR_ID ? this.original : null;
  }

  async claimProcessingJob(): Promise<MediaProcessingJob | null> {
    return null;
  }

  async claimProcessingJobForAsset(): Promise<MediaProcessingJob | null> {
    return null;
  }

  async finalizeProcessing(_command: FinalizeMediaProcessingCommand): Promise<void> {}

  async failProcessing(): Promise<void> {}

  async claimOrphanCleanup(
    _workerId: string,
    _purpose: MediaCleanupPurpose,
  ): Promise<MediaCleanupCheckpoint | null> {
    return null;
  }

  async finalizeOrphanCleanup(): Promise<void> {}

  async failOrphanCleanup(): Promise<void> {}

  async filterProtectedObjectKeys(): Promise<Set<string>> {
    return new Set();
  }
}

function storageFixture() {
  const objects = new Map<string, { bytes: Uint8Array; metadata: StoredObjectMetadata }>();
  const createUploadUrl = vi.fn(async (input: Parameters<ObjectStorage["createUploadUrl"]>[0]) => ({
    provider: "vercel_blob" as const,
    method: "POST" as const,
    pathname: input.key,
    handleUploadPath: `/api/media/${ASSET_ID}/blob-upload`,
    key: input.key,
    maximumBytes: input.maximumBytes,
  }));
  const completeUpload = vi.fn(async (input: Parameters<ObjectStorage["completeUpload"]>[0]) => ({
    key: input.key,
    sizeBytes: input.maximumBytes,
    contentType: input.contentType,
    checksumSha256Base64: input.checksumSha256Base64,
    etag: "upload-etag",
  }));
  const readObject = vi.fn(async (key: string) => {
    const object = objects.get(key);
    if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "missing");
    return object.bytes;
  });
  const streamObject = vi.fn(async (input: Parameters<ObjectStorage["streamObject"]>[0]) => {
    const object = objects.get(input.key);
    if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "missing");
    const bytes = input.range
      ? object.bytes.subarray(input.range.start, input.range.end + 1)
      : object.bytes;
    return {
      metadata: object.metadata,
      stream: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(bytes); controller.close(); },
      }),
      contentLength: bytes.byteLength,
      range: input.range,
    };
  });
  const handleClientUpload = vi.fn(async (
    _input: Parameters<ClientUploadObjectStorage["handleClientUpload"]>[0],
  ): Promise<unknown> => ({ type: "blob.generate-client-token" }));
  const storage: ClientUploadObjectStorage = {
    createUploadUrl,
    completeUpload,
    createDownloadUrl: async () => { throw new Error("unused"); },
    streamObject,
    readObject,
    writeObject: async (input) => {
      const bytes = Buffer.from(input.bytes);
      const checksumSha256Base64 = createHash("sha256").update(bytes).digest("base64");
      const metadata = {
        key: input.key,
        sizeBytes: bytes.length,
        contentType: input.contentType,
        checksumSha256Base64,
      };
      objects.set(input.key, { bytes, metadata });
      return metadata;
    },
    headObject: async (key) => objects.get(key)?.metadata ?? null,
    copyObject: async () => undefined,
    deleteObject: async (key) => { objects.delete(key); },
    listObjects: async (): Promise<ObjectPage> => ({ objects: [] }),
    getChecksum: async (key) => objects.get(key)?.metadata.checksumSha256Base64,
    handleClientUpload,
  };
  return { storage, objects, createUploadUrl, completeUpload, streamObject, readObject, handleClientUpload };
}

function serviceFixture() {
  const repository = new FakeMediaRepository();
  const storage = storageFixture();
  const rateLimiter = {
    consume: vi.fn(async (): Promise<{ allowed: boolean; retryAfterSeconds: number | null }> => ({
      allowed: true,
      retryAfterSeconds: null,
    })),
  };
  const grants = new HmacOriginalMediaPurposeGrants("s".repeat(32), () => Date.parse("2026-08-04T10:00:00Z"));
  const ids = [ASSET_ID, OTHER_ASSET_ID];
  const service = new MediaService(
    repository,
    storage.storage,
    rateLimiter,
    grants,
    "buildy-private-media",
    BLIND_INDEX,
    () => new Date("2026-08-04T10:00:00Z"),
    () => ids.shift() ?? crypto.randomUUID(),
  );
  return { repository, storage, rateLimiter, grants, service };
}

function uploadInput() {
  return {
    idempotencyKey: "media-upload-key-0001",
    projectId: PROJECT_ID,
    purpose: "project_media",
    contentType: "image/jpeg",
    sizeBytes: 42,
    checksumSha256Base64: CHECKSUM_BASE64,
  } as const;
}

describe("private media upload API service", () => {
  it("derives owner, asset ID and opaque temporary key server-side", async () => {
    const { repository, service } = serviceFixture();
    const result = await service.createUploadIntent(ACTOR_ID, uploadInput());
    const command = repository.intents[0];

    expect(command).toMatchObject({ actorId: ACTOR_ID, assetId: ASSET_ID, projectId: PROJECT_ID });
    expect(command?.storageProvider).toBe("vercel_blob");
    expect(command?.temporaryObjectKey).toBe(`temporary/44/${ASSET_ID}`);
    expect(command?.temporaryObjectKey).not.toContain(ACTOR_ID);
    expect(result.upload).toMatchObject({
      provider: "vercel_blob",
      method: "POST",
      pathname: `temporary/44/${ASSET_ID}`,
      handleUploadPath: `/api/media/${ASSET_ID}/blob-upload`,
      exactSizeBytes: 42,
    });
    expect(JSON.stringify(result)).not.toMatch(/objectKey|bucket|ownerId|storageProvider/);
  });

  it("fails closed before creating an intent when only legacy direct-upload storage is composed", async () => {
    const repository = new FakeMediaRepository();
    const { handleClientUpload: _clientUpload, ...legacyStorage } = storageFixture().storage;
    const service = new MediaService(
      repository,
      legacyStorage,
      { consume: async () => ({ allowed: true, retryAfterSeconds: null }) },
      new HmacOriginalMediaPurposeGrants("s".repeat(32)),
      "legacy-private-storage",
      BLIND_INDEX,
    );

    await expect(service.createUploadIntent(ACTOR_ID, uploadInput())).rejects.toMatchObject({
      reason: "STORAGE_UNAVAILABLE",
    });
    expect(repository.intents).toHaveLength(0);
  });

  it("keeps a floorplan intent bound to the authenticated owner and floorplan purpose", async () => {
    const { repository, service } = serviceFixture();
    const input = { ...uploadInput(), purpose: "floorplan" as const };

    const result = await service.createUploadIntent(ACTOR_ID, input);

    expect(result.asset).toMatchObject({
      id: ASSET_ID,
      projectId: PROJECT_ID,
      purpose: "floorplan",
      status: "pending_upload",
    });
    expect(repository.intents[0]).toMatchObject({
      actorId: ACTOR_ID,
      projectId: PROJECT_ID,
      purpose: "floorplan",
    });
    await expect(service.createUploadIntent(ACTOR_ID, {
      ...input,
      purpose: "project_media",
    })).rejects.toMatchObject({ reason: "UPLOAD_CONFLICT" });
  });

  it("rechecks the authenticated owner and exact pending pathname before a Blob token", async () => {
    const { service, storage } = serviceFixture();
    await service.createUploadIntent(ACTOR_ID, uploadInput());
    const pathname = `temporary/44/${ASSET_ID}`;
    storage.handleClientUpload.mockImplementation(async (input) => input.authorize(pathname));

    await expect(service.handleClientUpload(
      ACTOR_ID,
      ASSET_ID,
      new Request(`https://app.buildy.test/api/media/${ASSET_ID}/blob-upload`, { method: "POST" }),
      {},
    )).resolves.toMatchObject({
      actorId: ACTOR_ID,
      assetId: ASSET_ID,
      pathname,
      contentType: "image/jpeg",
      maximumBytes: 42,
      checksumSha256Base64: CHECKSUM_BASE64,
    });
    await expect(service.handleClientUpload(
      BLOCKED_ID,
      ASSET_ID,
      new Request(`https://app.buildy.test/api/media/${ASSET_ID}/blob-upload`, { method: "POST" }),
      {},
    )).rejects.toMatchObject({ reason: "MEDIA_NOT_FOUND" });
    await expect(service.handleClientUpload(
      null,
      ASSET_ID,
      new Request(`https://app.buildy.test/api/media/${ASSET_ID}/blob-upload`, { method: "POST" }),
      {},
    )).rejects.toMatchObject({ reason: "ACTOR_REQUIRED" });
  });

  it("strictly rejects forged owner, key and status fields", async () => {
    const { repository, service } = serviceFixture();

    await expect(service.createUploadIntent(ACTOR_ID, {
      ...uploadInput(),
      ownerId: BLOCKED_ID,
      objectKey: "public/forged",
      status: "ready",
    })).rejects.toBeInstanceOf(ZodError);
    expect(repository.intents).toHaveLength(0);
  });

  it("replays one asset for a duplicate intent and conflicts on changed content", async () => {
    const { service } = serviceFixture();

    const first = await service.createUploadIntent(ACTOR_ID, uploadInput());
    const second = await service.createUploadIntent(ACTOR_ID, uploadInput());

    expect(first.asset.id).toBe(ASSET_ID);
    expect(second).toMatchObject({ asset: { id: ASSET_ID }, replayed: true });
    await expect(service.createUploadIntent(ACTOR_ID, {
      ...uploadInput(),
      contentType: "image/png",
    })).rejects.toMatchObject({ reason: "UPLOAD_CONFLICT" });
  });

  it("verifies completion once and makes duplicate completion side-effect free", async () => {
    const { repository, storage, service } = serviceFixture();
    await service.createUploadIntent(ACTOR_ID, uploadInput());

    const first = await service.completeUpload(ACTOR_ID, ASSET_ID, {});
    const second = await service.completeUpload(ACTOR_ID, ASSET_ID, {});

    expect(first).toMatchObject({ asset: { status: "uploaded" }, replayed: false });
    expect(second).toMatchObject({ asset: { status: "uploaded" }, replayed: true });
    expect(storage.completeUpload).toHaveBeenCalledOnce();
    expect(repository.completeCalls).toBe(1);
  });

  it("rejects forged completion metadata and records checksum/MIME mismatch", async () => {
    const { repository, storage, service } = serviceFixture();
    await service.createUploadIntent(ACTOR_ID, uploadInput());

    await expect(service.completeUpload(ACTOR_ID, ASSET_ID, {
      objectKey: `temporary/55/${OTHER_ASSET_ID}`,
      ownerId: BLOCKED_ID,
      contentType: "text/html",
    })).rejects.toBeInstanceOf(ZodError);
    storage.completeUpload.mockRejectedValueOnce(
      new ObjectStorageError("UPLOAD_MISMATCH", "mismatch"),
    );
    await expect(service.completeUpload(ACTOR_ID, ASSET_ID, {})).rejects.toMatchObject({
      reason: "UPLOAD_INVALID",
    });
    expect(repository.rejected).toEqual([{
      actorId: ACTOR_ID,
      assetId: ASSET_ID,
      failureCode: "UPLOAD_MISMATCH",
    }]);
  });

  it("exposes the upload rate-limit decision without creating an intent", async () => {
    const { repository, rateLimiter, service } = serviceFixture();
    rateLimiter.consume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });

    await expect(service.createUploadIntent(ACTOR_ID, uploadInput())).rejects.toMatchObject({
      reason: "RATE_LIMITED",
      retryAfterSeconds: 17,
    });
    expect(repository.intents).toHaveLength(0);
  });
});

describe("authorizing media reads", () => {
  it("serves only a matching privacy version with ETag and a bounded byte range", async () => {
    const { repository, storage, service } = serviceFixture();
    const bytes = Buffer.from("sanitized-display-image");
    const objectKey = `display/44/${ASSET_ID}/medium.webp`;
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    repository.display = {
      objectKey,
      contentType: "image/webp",
      sizeBytes: bytes.length,
      sha256Hex,
      effectivePrivacyVersion: "2.7",
      publiclyCacheable: true,
    };
    storage.objects.set(objectKey, {
      bytes,
      metadata: {
        key: objectKey,
        sizeBytes: bytes.length,
        contentType: "image/webp",
        checksumSha256Base64: createHash("sha256").update(bytes).digest("base64"),
      },
    });

    const response = await service.readDisplay(
      { kind: "anonymous" },
      ASSET_ID,
      { size: "medium", v: "2.7" },
      new Headers({ range: "bytes=2-9" }),
    );

    expect(response.status).toBe(206);
    expect(Buffer.from(await new Response(response.body).arrayBuffer()).toString())
      .toBe(bytes.subarray(2, 10).toString());
    expect(response.headers["content-range"]).toBe(`bytes 2-9/${bytes.length}`);
    expect(response.headers["cache-control"]).toContain("must-revalidate");
    expect(JSON.stringify(response)).not.toContain(objectKey);
  });

  it("fails closed for old public URLs after the effective privacy version changes", async () => {
    const { repository, storage, service } = serviceFixture();
    repository.display = {
      objectKey: `display/44/${ASSET_ID}/medium.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      sha256Hex: "a".repeat(64),
      effectivePrivacyVersion: "2.8",
      publiclyCacheable: false,
    };

    await expect(service.readDisplay(
      { kind: "anonymous" },
      ASSET_ID,
      { size: "medium", v: "2.7" },
      new Headers(),
    )).rejects.toMatchObject({ reason: "MEDIA_NOT_FOUND" });
    expect(storage.streamObject).not.toHaveBeenCalled();
  });

  it.each([
    ["anonymous private", { kind: "anonymous" } as const, true, null],
    ["blocked authenticated", { kind: "authenticated", appUserId: BLOCKED_ID } as const, false, BLOCKED_ID],
  ])("conceals media from %s viewers", async (_label, viewer, privateProject, blockedActorId) => {
    const { repository, service } = serviceFixture();
    repository.privateProject = privateProject;
    repository.blockedActorId = blockedActorId;
    repository.display = {
      objectKey: `display/44/${ASSET_ID}/medium.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      sha256Hex: "a".repeat(64),
      effectivePrivacyVersion: "1.1",
      publiclyCacheable: false,
    };

    await expect(service.readDisplay(viewer, ASSET_ID, {}, new Headers())).rejects.toMatchObject({
      reason: "MEDIA_NOT_FOUND",
    });
  });

  it("requires both the owner session and an explicit short-lived original-purpose grant", async () => {
    const { repository, storage, service } = serviceFixture();
    const bytes = Buffer.from("sanitized-full-resolution");
    const objectKey = `originals/44/${ASSET_ID}`;
    repository.original = {
      objectKey,
      contentType: "image/jpeg",
      sizeBytes: bytes.length,
      sha256Hex: createHash("sha256").update(bytes).digest("hex"),
    };
    storage.objects.set(objectKey, {
      bytes,
      metadata: { key: objectKey, sizeBytes: bytes.length, contentType: "image/jpeg" },
    });
    const grant = await service.createOriginalGrant(ACTOR_ID, ASSET_ID, { purpose: "photobook" });

    await expect(service.readOriginal(
      ACTOR_ID,
      ASSET_ID,
      "export",
      grant.requiredHeaders["x-buildy-media-purpose-grant"],
      new Headers(),
    )).rejects.toMatchObject({ reason: "PURPOSE_GRANT_INVALID" });
    const response = await service.readOriginal(
      ACTOR_ID,
      ASSET_ID,
      "photobook",
      grant.requiredHeaders["x-buildy-media-purpose-grant"],
      new Headers(),
    );
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});

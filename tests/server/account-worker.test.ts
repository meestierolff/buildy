// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccountLifecycleWorker } from "../../server/account/worker";
import type {
  AccountDeletionAssetJob,
  AccountExportJob,
  AccountWorkerRepository,
  ExpiredExportJob,
} from "../../server/account/types";
import { DataProtectionKeyring } from "../../server/security/dataProtection";
import {
  ObjectStorageError,
  type ObjectPurpose,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../../server/storage/objectStorage";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const EXPORT_ASSET_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ASSET_ID = "44444444-4444-4444-8444-444444444444";
const DELETION_ASSET_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
const FEEDBACK_ID = "88888888-8888-4888-8888-888888888888";
const BUCKET = "buildy-private-media";

const keyring = new DataProtectionKeyring({
  currentVersion: 1,
  keys: { 1: Buffer.alloc(32, 7).toString("base64") },
});

class WorkerRepository implements AccountWorkerRepository {
  exportJobs: AccountExportJob[] = [];
  expiredJobs: ExpiredExportJob[] = [];
  deletionJobs: AccountDeletionAssetJob[] = [];
  finalizedExports: Array<{
    archiveSha256: string;
    archiveSizeBytes: number;
    manifestSha256: string;
  }> = [];
  failedExports: Array<{ code: string; retry: { delaySeconds: number } | null }> = [];
  cleanedExports: string[] = [];
  failedCleanups: Array<{ code: string; retry: { delaySeconds: number } | null }> = [];
  verifiedDeletionAssets: string[] = [];
  failedDeletions: Array<{ code: string; retry: { delaySeconds: number } | null }> = [];
  finalizedDeletions: string[] = [];
  acceptExportFinalization = true;
  deletionFinalStatus: "completed" | "blocked_active_order" = "completed";

  async claimExport(workerId: string): Promise<AccountExportJob | null> {
    const job = this.exportJobs.shift();
    return job ? { ...job, workerId } : null;
  }

  async finalizeExport(
    _job: AccountExportJob,
    archiveSha256: string,
    archiveSizeBytes: number,
    manifestSha256: string,
  ): Promise<boolean> {
    this.finalizedExports.push({ archiveSha256, archiveSizeBytes, manifestSha256 });
    return this.acceptExportFinalization;
  }

  async failExport(
    _job: AccountExportJob,
    code: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    this.failedExports.push({ code, retry });
  }

  async claimExpiredExport(workerId: string): Promise<ExpiredExportJob | null> {
    const job = this.expiredJobs.shift();
    return job ? { ...job, workerId } : null;
  }

  async finalizeExportCleanup(job: ExpiredExportJob): Promise<void> {
    this.cleanedExports.push(job.jobId);
  }

  async failExportCleanup(
    _job: ExpiredExportJob,
    code: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    this.failedCleanups.push({ code, retry });
  }

  async claimDeletion(workerId: string): Promise<AccountDeletionAssetJob | null> {
    const job = this.deletionJobs.shift();
    return job ? { ...job, workerId } : null;
  }

  async verifyDeletionAsset(job: AccountDeletionAssetJob): Promise<void> {
    if (!job.deletionAssetId) throw new Error("missing deletion asset");
    this.verifiedDeletionAssets.push(job.deletionAssetId);
  }

  async failDeletion(
    _job: AccountDeletionAssetJob,
    code: string,
    retry: { delaySeconds: number } | null,
  ): Promise<void> {
    this.failedDeletions.push({ code, retry });
  }

  async finalizeDeletion(job: AccountDeletionAssetJob): Promise<"completed" | "blocked_active_order"> {
    this.finalizedDeletions.push(job.jobId);
    return this.deletionFinalStatus;
  }
}

function storageFixture() {
  const objects = new Map<string, { bytes: Uint8Array; metadata: StoredObjectMetadata }>();
  const writes: string[] = [];
  const deletes: string[] = [];
  const storage: ObjectStorage = {
    createUploadUrl: async () => { throw new Error("unused"); },
    completeUpload: async () => { throw new Error("unused"); },
    createDownloadUrl: async () => { throw new Error("workers never create public downloads"); },
    streamObject: async () => { throw new Error("workers use bounded reads"); },
    readObject: async (key, maximumBytes) => {
      const object = objects.get(key);
      if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "missing");
      if (object.bytes.byteLength > maximumBytes) {
        throw new ObjectStorageError("INVALID_SIZE", "too large");
      }
      return object.bytes;
    },
    writeObject: async (input) => {
      const bytes = Uint8Array.from(input.bytes);
      const metadata: StoredObjectMetadata = {
        key: input.key,
        sizeBytes: bytes.byteLength,
        contentType: input.contentType,
        checksumSha256Base64: createHash("sha256").update(bytes).digest("base64"),
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
        .map((item) => item.metadata)
        .filter((item) => item.key.startsWith(`${prefix}/`)),
    }),
    getChecksum: async (key) => objects.get(key)?.metadata.checksumSha256Base64,
  };
  return { storage, objects, writes, deletes };
}

function encryptedPayload() {
  return {
    schemaVersion: 1,
    account: { id: USER_ID },
    projectPrivateDetails: [{
      project_id: PROJECT_ID,
      address_line_1_ciphertext: keyring.encrypt("Bouwstraat 12", `project:${PROJECT_ID}:private:address_line_1`),
      address_line_2_ciphertext: null,
      postal_code_ciphertext: keyring.encrypt("1234 AB", `project:${PROJECT_ID}:private:postal_code`),
      city_ciphertext: keyring.encrypt("Utrecht", `project:${PROJECT_ID}:private:city`),
      contractor_notes_ciphertext: null,
      encryption_key_version: 1,
    }],
    photobookOrders: [{
      id: ORDER_ID,
      customer_email_ciphertext: keyring.encrypt("ada@example.com", `photobook-order:${ORDER_ID}:customer-email`),
      shipping_details_ciphertext: keyring.encrypt(
        JSON.stringify({ city: "Utrecht", countryCode: "NL" }),
        `photobook-order:${ORDER_ID}:shipping-address`,
      ),
      pii_encryption_key_version: 1,
    }],
    feedback: [{
      id: FEEDBACK_ID,
      message: null,
      message_ciphertext: keyring.encrypt(
        "De fotoknop reageert niet.",
        `feedback-submission:${FEEDBACK_ID}:message`,
      ),
      contact_ciphertext: keyring.encrypt(
        "ada@example.com",
        `feedback-submission:${FEEDBACK_ID}:contact`,
      ),
      contact_hash: "a".repeat(64),
      idempotency_key: "internal-command-key",
      request_hash: "b".repeat(64),
      source_fingerprint_hash: "c".repeat(64),
      assigned_to_id: "99999999-9999-4999-8999-999999999999",
    }],
  };
}

function exportJob(sourceBytes: Uint8Array, overrides: Partial<AccountExportJob> = {}): AccountExportJob {
  return {
    workerId: "placeholder",
    jobId: JOB_ID,
    userId: USER_ID,
    exportAssetId: EXPORT_ASSET_ID,
    objectKey: `exports/33/${EXPORT_ASSET_ID}/buildy-export.zip`,
    includeMedia: true,
    attemptCount: 1,
    requestedAt: "2026-08-04T12:00:00.000Z",
    payload: encryptedPayload(),
    sourceAssets: [{
      id: SOURCE_ASSET_ID,
      storageProvider: "vercel_blob",
      bucket: BUCKET,
      objectKey: `originals/44/${SOURCE_ASSET_ID}/original.jpg`,
      contentType: "image/jpeg",
      sizeBytes: sourceBytes.byteLength,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      purpose: "project_media",
    }],
    ...overrides,
  };
}

function deletionJob(overrides: Partial<AccountDeletionAssetJob> = {}): AccountDeletionAssetJob {
  return {
    workerId: "placeholder",
    jobId: JOB_ID,
    targetId: USER_ID,
    deletionAssetId: DELETION_ASSET_ID,
    mediaAssetId: SOURCE_ASSET_ID,
    storageProvider: "vercel_blob",
    bucket: BUCKET,
    objectKey: `originals/44/${SOURCE_ASSET_ID}/original.jpg`,
    expectedSha256: "a".repeat(64),
    attemptCount: 1,
    assetAttemptCount: 0,
    ...overrides,
  };
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 4 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    result.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return result;
}

describe("AccountLifecycleWorker", () => {
  it("maakt een deterministische private ZIP met ontsleutelde data en checksummed media", async () => {
    const sourceBytes = Buffer.from("private image bytes");
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const job = exportJob(sourceBytes);
    repository.exportJobs.push(job);
    fixture.objects.set(job.sourceAssets[0].objectKey, {
      bytes: sourceBytes,
      metadata: {
        key: job.sourceAssets[0].objectKey,
        contentType: "image/jpeg",
        sizeBytes: sourceBytes.byteLength,
      },
    });
    const worker = new AccountLifecycleWorker(
      repository,
      fixture.storage,
      keyring,
      BUCKET,
      "account-worker-test",
    );

    const result = await worker.processNext();

    expect(result).toMatchObject({ status: "export_ready", jobId: JOB_ID });
    expect(repository.finalizedExports).toHaveLength(1);
    const archive = fixture.objects.get(job.objectKey)?.bytes;
    if (!archive) throw new Error("Exportarchief ontbreekt in de test.");
    const entries = zipEntries(archive);
    expect([...entries.keys()]).toEqual([
      "data.json",
      `media/${SOURCE_ASSET_ID}/original.jpg`,
      "manifest.json",
    ]);
    const data = JSON.parse(new TextDecoder().decode(entries.get("data.json"))) as {
      projectPrivateDetails: Array<Record<string, unknown>>;
      photobookOrders: Array<Record<string, unknown>>;
      feedback: Array<Record<string, unknown>>;
    };
    expect(data.projectPrivateDetails[0]).toMatchObject({
      address_line_1: "Bouwstraat 12",
      postal_code: "1234 AB",
      city: "Utrecht",
    });
    expect(data.photobookOrders[0]).toMatchObject({
      customer_email: "ada@example.com",
      shipping_address: { city: "Utrecht", countryCode: "NL" },
    });
    expect(data.feedback[0]).toMatchObject({
      id: FEEDBACK_ID,
      message: "De fotoknop reageert niet.",
      contact_email: "ada@example.com",
    });
    expect(data.feedback[0]).not.toHaveProperty("contact_hash");
    expect(data.feedback[0]).not.toHaveProperty("idempotency_key");
    expect(data.feedback[0]).not.toHaveProperty("request_hash");
    expect(data.feedback[0]).not.toHaveProperty("source_fingerprint_hash");
    expect(data.feedback[0]).not.toHaveProperty("assigned_to_id");
    expect(JSON.stringify(data)).not.toContain("_ciphertext");
    const manifestBytes = entries.get("manifest.json");
    if (!manifestBytes) throw new Error("Exportmanifest ontbreekt in de test.");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      media: Array<{ path: string; sha256: string }>;
    };
    expect(manifest.media).toEqual([{
      id: SOURCE_ASSET_ID,
      path: `media/${SOURCE_ASSET_ID}/original.jpg`,
      purpose: "project_media",
      contentType: "image/jpeg",
      sizeBytes: sourceBytes.byteLength,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
    }]);
    expect(repository.finalizedExports[0]?.manifestSha256)
      .toBe(createHash("sha256").update(manifestBytes).digest("hex"));
  });

  it("dead-lettert een bronchecksumfout zonder een export te publiceren", async () => {
    const sourceBytes = Buffer.from("changed image bytes");
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const job = exportJob(sourceBytes, {
      sourceAssets: [{
        ...exportJob(sourceBytes).sourceAssets[0],
        sha256: "f".repeat(64),
      }],
    });
    repository.exportJobs.push(job);
    fixture.objects.set(job.sourceAssets[0].objectKey, {
      bytes: sourceBytes,
      metadata: {
        key: job.sourceAssets[0].objectKey,
        contentType: "image/jpeg",
        sizeBytes: sourceBytes.byteLength,
      },
    });
    const worker = new AccountLifecycleWorker(
      repository,
      fixture.storage,
      keyring,
      BUCKET,
      "account-worker-test",
    );

    await expect(worker.processNext()).resolves.toEqual({
      status: "dead_letter",
      jobId: JOB_ID,
      operation: "export",
    });
    expect(repository.failedExports).toEqual([{ code: "EXPORT_SOURCE_CHECKSUM", retry: null }]);
    expect(repository.finalizedExports).toHaveLength(0);
    expect(fixture.objects.has(job.objectKey)).toBe(false);
  });

  it("plant transient storagefalen opnieuw met begrensde exponential backoff", async () => {
    const sourceBytes = Buffer.from("source");
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    repository.exportJobs.push(exportJob(sourceBytes, { attemptCount: 2 }));
    const worker = new AccountLifecycleWorker(
      repository,
      fixture.storage,
      keyring,
      BUCKET,
      "account-worker-test",
    );

    await expect(worker.processNext()).resolves.toEqual({
      status: "retry_scheduled",
      jobId: JOB_ID,
      operation: "export",
    });
    expect(repository.failedExports).toEqual([{
      code: "STORAGE_OBJECT_NOT_FOUND",
      retry: { delaySeconds: 60 },
    }]);
  });

  it("verwijdert één object per lease, verifieert afwezigheid en finaliseert pas zonder assets", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const assetJob = deletionJob();
    const finalJob = deletionJob({
      deletionAssetId: null,
      mediaAssetId: null,
      storageProvider: null,
      bucket: null,
      objectKey: null,
      expectedSha256: null,
    });
    repository.deletionJobs.push(assetJob, finalJob);
    fixture.objects.set(assetJob.objectKey!, {
      bytes: Buffer.from("delete me"),
      metadata: { key: assetJob.objectKey!, contentType: "image/jpeg", sizeBytes: 9 },
    });
    const worker = new AccountLifecycleWorker(
      repository,
      fixture.storage,
      keyring,
      BUCKET,
      "account-worker-test",
    );

    await expect(worker.processNext()).resolves.toEqual({
      status: "deletion_asset_verified",
      jobId: JOB_ID,
      deletionAssetId: DELETION_ASSET_ID,
    });
    expect(repository.verifiedDeletionAssets).toEqual([DELETION_ASSET_ID]);
    expect(fixture.objects.has(assetJob.objectKey!)).toBe(false);

    await expect(worker.processNext()).resolves.toEqual({
      status: "deletion_completed",
      jobId: JOB_ID,
    });
    expect(repository.finalizedDeletions).toEqual([JOB_ID]);
  });

  it("ruimt verlopen exportobjecten vóór nieuw accountwerk op", async () => {
    const repository = new WorkerRepository();
    const fixture = storageFixture();
    const objectKey = `exports/33/${EXPORT_ASSET_ID}/buildy-export.zip`;
    repository.expiredJobs.push({
      workerId: "placeholder",
      jobId: JOB_ID,
      exportAssetId: EXPORT_ASSET_ID,
      objectKey,
      attemptCount: 1,
    });
    repository.deletionJobs.push(deletionJob({ deletionAssetId: null }));
    fixture.objects.set(objectKey, {
      bytes: Buffer.from("expired"),
      metadata: { key: objectKey, contentType: "application/zip", sizeBytes: 7 },
    });
    const worker = new AccountLifecycleWorker(
      repository,
      fixture.storage,
      keyring,
      BUCKET,
      "account-worker-test",
    );

    await expect(worker.processNext()).resolves.toEqual({ status: "export_expired", jobId: JOB_ID });
    expect(repository.cleanedExports).toEqual([JOB_ID]);
    expect(repository.finalizedDeletions).toHaveLength(0);
  });
});

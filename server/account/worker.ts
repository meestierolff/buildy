import { createHash } from "node:crypto";
import type { DataProtectionKeyring } from "../security/dataProtection.js";
import { DataProtectionError } from "../security/dataProtection.js";
import { canonicalJson } from "../security/canonicalJson.js";
import {
  ObjectStorageError,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/objectStorage.js";
import { AccountError } from "./errors.js";
import type {
  AccountDeletionAssetJob,
  AccountExportJob,
  AccountExportSourceAsset,
  AccountWorkerRepository,
  ExpiredExportJob,
} from "./types.js";
import { createStoredZip, type StoredZipEntry } from "./zip.js";

const DEFAULT_LEASE_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_SOURCE_BYTES = 220 * 1024 * 1024;

export type AccountWorkerResult =
  | { status: "idle" }
  | { status: "export_ready"; jobId: string; archiveSha256: string }
  | { status: "export_cancelled"; jobId: string }
  | { status: "export_expired"; jobId: string }
  | { status: "deletion_asset_verified"; jobId: string; deletionAssetId: string }
  | { status: "deletion_completed"; jobId: string }
  | { status: "deletion_blocked"; jobId: string }
  | { status: "retry_scheduled"; jobId: string; operation: "export" | "export_cleanup" | "deletion" }
  | { status: "dead_letter"; jobId: string; operation: "export" | "export_cleanup" | "deletion" };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function retryDelay(attemptCount: number): number {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, attemptCount - 1)));
}

function failureFacts(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof DataProtectionError) {
    return { code: `DATA_${error.code}`.slice(0, 64), retryable: false };
  }
  if (error instanceof ObjectStorageError) {
    return {
      code: `STORAGE_${error.code}`.slice(0, 64),
      retryable: error.code === "PROVIDER_ERROR" || error.code === "OBJECT_NOT_FOUND",
    };
  }
  if (error instanceof AccountError && error.reason === "WORKER_LEASE_LOST") {
    return { code: "WORKER_LEASE_LOST", retryable: true };
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)) {
    return { code: error.message, retryable: false };
  }
  return { code: "ACCOUNT_WORKER_FAILED", retryable: true };
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EXPORT_PAYLOAD_INVALID");
  }
  return value as Record<string, unknown>;
}

function decryptOptional(
  keyring: DataProtectionKeyring,
  record: Record<string, unknown>,
  ciphertextKey: string,
  plaintextKey: string,
  context: string,
): void {
  const ciphertext = record[ciphertextKey];
  if (ciphertext === null || ciphertext === undefined) {
    record[plaintextKey] = null;
  } else if (typeof ciphertext === "string") {
    record[plaintextKey] = keyring.decrypt(ciphertext, context);
  } else {
    throw new Error("EXPORT_PAYLOAD_INVALID");
  }
  delete record[ciphertextKey];
}

export function decryptAccountExportPayload(
  rawPayload: unknown,
  keyring: DataProtectionKeyring,
): unknown {
  const payload = structuredClone(objectRecord(rawPayload));
  const privateDetails = payload.projectPrivateDetails;
  if (!Array.isArray(privateDetails)) throw new Error("EXPORT_PAYLOAD_INVALID");
  for (const item of privateDetails) {
    const details = objectRecord(item);
    const projectId = details.project_id;
    if (typeof projectId !== "string") throw new Error("EXPORT_PAYLOAD_INVALID");
    for (const [ciphertextKey, plaintextKey, field] of [
      ["address_line_1_ciphertext", "address_line_1", "address_line_1"],
      ["address_line_2_ciphertext", "address_line_2", "address_line_2"],
      ["postal_code_ciphertext", "postal_code", "postal_code"],
      ["city_ciphertext", "city", "city"],
      ["contractor_notes_ciphertext", "contractor_notes", "contractor_notes"],
    ] as const) {
      decryptOptional(
        keyring,
        details,
        ciphertextKey,
        plaintextKey,
        `project:${projectId}:private:${field}`,
      );
    }
    delete details.encryption_key_version;
  }

  const orders = payload.photobookOrders;
  if (!Array.isArray(orders)) throw new Error("EXPORT_PAYLOAD_INVALID");
  for (const item of orders) {
    const order = objectRecord(item);
    const orderId = order.id;
    if (typeof orderId !== "string") throw new Error("EXPORT_PAYLOAD_INVALID");
    decryptOptional(
      keyring,
      order,
      "customer_email_ciphertext",
      "customer_email",
      `photobook-order:${orderId}:customer-email`,
    );
    const shippingCiphertext = order.shipping_details_ciphertext;
    if (shippingCiphertext === null || shippingCiphertext === undefined) {
      order.shipping_address = null;
    } else if (typeof shippingCiphertext === "string") {
      const plaintext = keyring.decrypt(
        shippingCiphertext,
        `photobook-order:${orderId}:shipping-address`,
      );
      try {
        order.shipping_address = JSON.parse(plaintext) as unknown;
      } catch (error) {
        throw new DataProtectionError(
          "DECRYPTION_FAILED",
          "Ontsleutelde verzendgegevens bevatten geen geldige JSON.",
          { cause: error },
        );
      }
    } else {
      throw new Error("EXPORT_PAYLOAD_INVALID");
    }
    delete order.shipping_details_ciphertext;
    delete order.pii_encryption_key_version;
  }

  const feedback = payload.feedback ?? [];
  if (!Array.isArray(feedback)) throw new Error("EXPORT_PAYLOAD_INVALID");
  payload.feedback = feedback;
  for (const item of feedback) {
    const submission = objectRecord(item);
    const submissionId = submission.id;
    if (typeof submissionId !== "string") throw new Error("EXPORT_PAYLOAD_INVALID");

    const messageCiphertext = submission.message_ciphertext;
    if (typeof messageCiphertext === "string") {
      submission.message = keyring.decrypt(
        messageCiphertext,
        `feedback-submission:${submissionId}:message`,
      );
    } else if (
      messageCiphertext !== null
      && messageCiphertext !== undefined
    ) {
      throw new Error("EXPORT_PAYLOAD_INVALID");
    }
    delete submission.message_ciphertext;

    decryptOptional(
      keyring,
      submission,
      "contact_ciphertext",
      "contact_email",
      `feedback-submission:${submissionId}:contact`,
    );
    delete submission.contact_hash;
    delete submission.idempotency_key;
    delete submission.request_hash;
    delete submission.source_fingerprint_hash;
    delete submission.assigned_to_id;
  }
  return payload;
}

function extension(contentType: string): string {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
  } as Record<string, string>)[contentType] ?? "bin";
}

function archivePath(asset: AccountExportSourceAsset): string {
  return `media/${asset.id}/original.${extension(asset.contentType)}`;
}

function assertWrittenArchive(
  metadata: StoredObjectMetadata,
  job: AccountExportJob,
  bytes: Uint8Array,
): void {
  const checksumBase64 = createHash("sha256").update(bytes).digest("base64");
  if (
    metadata.key !== job.objectKey
    || metadata.contentType !== "application/zip"
    || metadata.sizeBytes !== bytes.byteLength
    || (metadata.checksumSha256Base64 !== undefined
      && metadata.checksumSha256Base64 !== checksumBase64)
  ) throw new ObjectStorageError("UPLOAD_MISMATCH", "Het exportarchief is niet volledig bevestigd.");
}

type BuiltArchive = { bytes: Uint8Array; archiveSha256: string; manifestSha256: string };

async function buildArchive(
  job: AccountExportJob,
  storage: ObjectStorage,
  bucket: string,
  keyring: DataProtectionKeyring,
): Promise<BuiltArchive> {
  const totalSourceBytes = job.sourceAssets.reduce((total, asset) => total + asset.sizeBytes, 0);
  if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > MAX_SOURCE_BYTES) {
    throw new Error("EXPORT_TOO_LARGE");
  }

  const dataBytes = new TextEncoder().encode(
    canonicalJson(decryptAccountExportPayload(job.payload, keyring)),
  );
  const entries: Array<{
    id: string;
    path: string;
    purpose: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }> = [];
  const zipEntries: StoredZipEntry[] = [{ name: "data.json", bytes: dataBytes }];
  const paths = new Set<string>();

  for (const asset of job.sourceAssets) {
    if (asset.storageProvider !== "vercel_blob" || asset.bucket !== bucket) {
      throw new Error("EXPORT_SOURCE_UNAVAILABLE");
    }
    const path = archivePath(asset);
    if (paths.has(path)) throw new Error("EXPORT_PAYLOAD_INVALID");
    paths.add(path);
    const bytes = await storage.readObject(asset.objectKey, asset.sizeBytes);
    if (bytes.byteLength !== asset.sizeBytes || sha256(bytes) !== asset.sha256) {
      throw new Error("EXPORT_SOURCE_CHECKSUM");
    }
    zipEntries.push({ name: path, bytes });
    entries.push({
      id: asset.id,
      path,
      purpose: asset.purpose,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
    });
  }

  const manifest = {
    schemaVersion: 1,
    jobId: job.jobId,
    requestedAt: job.requestedAt,
    data: { path: "data.json", sizeBytes: dataBytes.byteLength, sha256: sha256(dataBytes) },
    media: entries,
  };
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  zipEntries.push({ name: "manifest.json", bytes: manifestBytes });
  const bytes = createStoredZip(zipEntries, MAX_ARCHIVE_BYTES);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("EXPORT_TOO_LARGE");
  }
  return {
    bytes,
    archiveSha256: sha256(bytes),
    manifestSha256: sha256(manifestBytes),
  };
}

export class AccountLifecycleWorker {
  constructor(
    private readonly repository: AccountWorkerRepository,
    private readonly storage: ObjectStorage,
    private readonly keyring: DataProtectionKeyring,
    private readonly bucket: string,
    private readonly workerId: string,
    private readonly leaseSeconds = DEFAULT_LEASE_SECONDS,
  ) {
    if (!/^[A-Za-z0-9:_-]{3,80}$/.test(workerId)) throw new Error("Accountworker-ID is ongeldig.");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Accountworker-bucket is ongeldig.");
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 15 * 60) {
      throw new Error("Accountworker-lease is ongeldig.");
    }
  }

  private invocationId(): string {
    return `${this.workerId}:${createHash("sha256")
      .update(crypto.randomUUID())
      .digest("hex")
      .slice(0, 20)}`;
  }

  private async cleanupExpired(workerId: string): Promise<AccountWorkerResult | null> {
    const job = await this.repository.claimExpiredExport(workerId, this.leaseSeconds);
    if (!job) return null;
    try {
      await this.storage.deleteObject(job.objectKey);
      if (await this.storage.headObject(job.objectKey)) {
        throw new ObjectStorageError("PROVIDER_ERROR", "Het verlopen exportarchief bestaat nog na verwijdering.");
      }
      await this.repository.finalizeExportCleanup(job);
      return { status: "export_expired", jobId: job.jobId };
    } catch (error) {
      if (error instanceof AccountError && error.reason === "WORKER_LEASE_LOST") throw error;
      return this.failCleanup(job, error);
    }
  }

  private async failCleanup(job: ExpiredExportJob, error: unknown): Promise<AccountWorkerResult> {
    const failure = failureFacts(error);
    const retryable = failure.retryable && job.attemptCount < MAX_ATTEMPTS;
    await this.repository.failExportCleanup(
      job,
      failure.code,
      retryable ? { delaySeconds: retryDelay(job.attemptCount) } : null,
    );
    return retryable
      ? { status: "retry_scheduled", jobId: job.jobId, operation: "export_cleanup" }
      : { status: "dead_letter", jobId: job.jobId, operation: "export_cleanup" };
  }

  private async processDeletion(workerId: string): Promise<AccountWorkerResult | null> {
    const job = await this.repository.claimDeletion(workerId, this.leaseSeconds);
    if (!job) return null;
    try {
      if (!job.deletionAssetId) {
        const result = await this.repository.finalizeDeletion(job);
        return result === "completed"
          ? { status: "deletion_completed", jobId: job.jobId }
          : { status: "deletion_blocked", jobId: job.jobId };
      }
      if (job.storageProvider !== "vercel_blob" || job.bucket !== this.bucket || !job.objectKey) {
        throw new Error("DELETION_SOURCE_UNAVAILABLE");
      }
      await this.storage.deleteObject(job.objectKey);
      if (await this.storage.headObject(job.objectKey)) {
        throw new ObjectStorageError("PROVIDER_ERROR", "Het privéobject bestaat nog na verwijdering.");
      }
      await this.repository.verifyDeletionAsset(job);
      return {
        status: "deletion_asset_verified",
        jobId: job.jobId,
        deletionAssetId: job.deletionAssetId,
      };
    } catch (error) {
      if (error instanceof AccountError && error.reason === "WORKER_LEASE_LOST") throw error;
      return this.failDeletion(job, error);
    }
  }

  private async failDeletion(job: AccountDeletionAssetJob, error: unknown): Promise<AccountWorkerResult> {
    const failure = failureFacts(error);
    const attempt = Math.max(job.attemptCount, job.assetAttemptCount + 1);
    const retryable = failure.retryable && attempt < MAX_ATTEMPTS;
    await this.repository.failDeletion(
      job,
      failure.code,
      retryable ? { delaySeconds: retryDelay(attempt) } : null,
    );
    return retryable
      ? { status: "retry_scheduled", jobId: job.jobId, operation: "deletion" }
      : { status: "dead_letter", jobId: job.jobId, operation: "deletion" };
  }

  private async processExport(workerId: string): Promise<AccountWorkerResult | null> {
    const job = await this.repository.claimExport(workerId, this.leaseSeconds);
    if (!job) return null;
    let archiveWritten = false;
    try {
      const archive = await buildArchive(job, this.storage, this.bucket, this.keyring);
      const metadata = await this.storage.writeObject({
        key: job.objectKey,
        contentType: "application/zip",
        bytes: archive.bytes,
      });
      archiveWritten = true;
      assertWrittenArchive(metadata, job, archive.bytes);
      const finalized = await this.repository.finalizeExport(
        job,
        archive.archiveSha256,
        archive.bytes.byteLength,
        archive.manifestSha256,
      );
      if (!finalized) {
        await this.storage.deleteObject(job.objectKey).catch(() => undefined);
        return { status: "export_cancelled", jobId: job.jobId };
      }
      return { status: "export_ready", jobId: job.jobId, archiveSha256: archive.archiveSha256 };
    } catch (error) {
      if (archiveWritten) await this.storage.deleteObject(job.objectKey).catch(() => undefined);
      if (error instanceof AccountError && error.reason === "WORKER_LEASE_LOST") throw error;
      const failure = failureFacts(error);
      const retryable = failure.retryable && job.attemptCount < MAX_ATTEMPTS;
      await this.repository.failExport(
        job,
        failure.code,
        retryable ? { delaySeconds: retryDelay(job.attemptCount) } : null,
      );
      return retryable
        ? { status: "retry_scheduled", jobId: job.jobId, operation: "export" }
        : { status: "dead_letter", jobId: job.jobId, operation: "export" };
    }
  }

  async processNext(): Promise<AccountWorkerResult> {
    return await this.cleanupExpired(this.invocationId())
      ?? await this.processDeletion(this.invocationId())
      ?? await this.processExport(this.invocationId())
      ?? { status: "idle" };
  }
}

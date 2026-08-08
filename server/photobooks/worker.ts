import { createHash } from "node:crypto";
import {
  ObjectStorageError,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../storage/objectStorage.js";
import { PhotobookError } from "./errors.js";
import {
  PhotobookRenderError,
  renderPhotobookPdf,
} from "./pdfRenderer.js";
import { loadPhotobookFontBytes, type PhotobookFontBytes } from "./typography.js";
import type { PhotobookRenderJob, PhotobookWorkerRepository } from "./types.js";

const DEFAULT_LEASE_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

export type PhotobookWorkerResult =
  | { status: "idle" }
  | { status: "rendered"; revisionId: string; pageCount: number; pdfSha256: string }
  | { status: "retry_scheduled"; revisionId: string }
  | { status: "failed"; revisionId: string };

function retryDelay(attemptCount: number): number {
  return Math.min(60 * 60, 30 * (2 ** Math.max(0, attemptCount - 1)));
}

function checksumBase64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

function failureFacts(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof PhotobookRenderError) {
    return {
      code: `PROOF_${error.code}`.slice(0, 64),
      retryable: error.code === "PDF_RENDER_FAILED",
    };
  }
  if (error instanceof ObjectStorageError) {
    return {
      code: `STORAGE_${error.code}`.slice(0, 64),
      retryable: !["INVALID_OBJECT_KEY", "INVALID_CONTENT_TYPE", "INVALID_CHECKSUM", "INVALID_SIZE"]
        .includes(error.code),
    };
  }
  if (error instanceof PhotobookError && error.reason === "WORKER_LEASE_LOST") {
    return { code: "WORKER_LEASE_LOST", retryable: true };
  }
  return { code: "PHOTOBOOK_RENDER_FAILED", retryable: true };
}

function assertWrittenPdf(
  metadata: StoredObjectMetadata,
  job: PhotobookRenderJob,
  bytes: Uint8Array,
): void {
  if (
    metadata.key !== job.pdfObjectKey
    || metadata.contentType !== "application/pdf"
    || metadata.sizeBytes !== bytes.byteLength
    || (metadata.checksumSha256Base64 !== undefined
      && metadata.checksumSha256Base64 !== checksumBase64(bytes))
  ) throw new ObjectStorageError("UPLOAD_MISMATCH", "De geschreven printproof is niet volledig bevestigd.");
}

export class PhotobookProofWorker {
  private fontBytes: Promise<PhotobookFontBytes> | undefined;

  constructor(
    private readonly repository: PhotobookWorkerRepository,
    private readonly storage: ObjectStorage,
    private readonly workerId: string,
    private readonly leaseSeconds = DEFAULT_LEASE_SECONDS,
  ) {
    if (!/^[A-Za-z0-9:_-]{3,80}$/.test(workerId)) throw new Error("Bouwboekworker-ID is ongeldig.");
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 15 * 60) {
      throw new Error("Bouwboekworker-lease is ongeldig.");
    }
  }

  async processNext(): Promise<PhotobookWorkerResult> {
    const invocation = createHash("sha256")
      .update(this.workerId)
      .update("\0")
      .update(crypto.randomUUID())
      .digest("hex")
      .slice(0, 24);
    const leaseOwner = `${this.workerId}:${invocation}`;
    const job = await this.repository.claimRenderJob(leaseOwner, this.leaseSeconds);
    if (!job) return { status: "idle" };

    try {
      const proof = await renderPhotobookPdf({
        document: job.document,
        fonts: await (this.fontBytes ??= loadPhotobookFontBytes()),
        assets: {
          readOriginal: async (source) => {
            const record = job.assets.find((asset) => asset.id === source.id);
            if (!record) {
              throw new PhotobookRenderError("ASSET_MISSING", "Een originele bronfoto ontbreekt in de workerclaim.");
            }
            return this.storage.readObject(record.objectKey, record.sizeBytes);
          },
        },
      });
      const metadata = await this.storage.writeObject({
        key: job.pdfObjectKey,
        contentType: "application/pdf",
        bytes: proof.bytes,
      });
      assertWrittenPdf(metadata, job, proof.bytes);
      await this.repository.finalizeProof({
        job,
        pdfSha256: proof.pdfSha256,
        pdfSizeBytes: proof.pdfSizeBytes,
        pageCount: proof.pageCount,
        assetSetSha256: proof.assetSetSha256,
        fontSetSha256: proof.fontSetSha256,
        renderEngine: proof.renderEngine,
        renderVersion: proof.renderVersion,
      });
      return {
        status: "rendered",
        revisionId: job.revisionId,
        pageCount: proof.pageCount,
        pdfSha256: proof.pdfSha256,
      };
    } catch (error) {
      if (error instanceof PhotobookError && error.reason === "WORKER_LEASE_LOST") throw error;
      const failure = failureFacts(error);
      const retryable = failure.retryable && job.attemptCount < MAX_ATTEMPTS;
      await this.repository.failProof(
        job,
        failure.code,
        retryable ? { delaySeconds: retryDelay(job.attemptCount) } : null,
      );
      return retryable
        ? { status: "retry_scheduled", revisionId: job.revisionId }
        : { status: "failed", revisionId: job.revisionId };
    }
  }
}

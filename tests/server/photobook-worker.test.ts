// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPhotobookDocument } from "../../server/photobooks/document";
import { PhotobookProofWorker } from "../../server/photobooks/worker";
import type {
  FinalizePhotobookProofCommand,
  PhotobookRenderJob,
  PhotobookWorkerRepository,
} from "../../server/photobooks/types";
import type { ObjectStorage } from "../../server/storage/objectStorage";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const REVISION_ID = "20000000-0000-4000-8000-000000000001";
const PDF_ASSET_ID = "30000000-0000-4000-8000-000000000001";

function document(coverMediaAssetId?: string) {
  return buildPhotobookDocument({
    projectId: PROJECT_ID,
    projectRevision: 1,
    projectTitle: "Ons Bouwboek",
    coverMediaAssetId,
    maximumPages: 120,
    updates: [],
    measurer: { wrap: ({ text }) => text.trim() ? [text.trim()] : [] },
  });
}

class WorkerRepository implements PhotobookWorkerRepository {
  finalized: FinalizePhotobookProofCommand | null = null;
  failure: { code: string; retry: { delaySeconds: number } | null } | null = null;

  constructor(readonly job: PhotobookRenderJob | null) {}

  async claimRenderJob() { return this.job; }
  async finalizeProof(command: FinalizePhotobookProofCommand) { this.finalized = command; }
  async failProof(_job: PhotobookRenderJob, code: string, retry: { delaySeconds: number } | null) {
    this.failure = { code, retry };
  }
}

function storage(writes: Array<{ key: string; bytes: Uint8Array }>): ObjectStorage {
  return {
    async createUploadUrl() { throw new Error("unused"); },
    async completeUpload() { throw new Error("unused"); },
    async createDownloadUrl() { throw new Error("unused"); },
    async readObject() { throw new Error("empty proof must not read photos"); },
    async writeObject(input) {
      writes.push({ key: input.key, bytes: input.bytes });
      return {
        key: input.key,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
        checksumSha256Base64: createHash("sha256").update(input.bytes).digest("base64"),
      };
    },
    async headObject() { return null; },
    async copyObject() {},
    async deleteObject() {},
    async listObjects() { return { objects: [] }; },
    async getChecksum() { return undefined; },
  };
}

function job(proofDocument = document()): PhotobookRenderJob {
  return {
    workerId: "unused-until-claimed",
    eventId: "40000000-0000-4000-8000-000000000001",
    revisionId: REVISION_ID,
    pdfAssetId: PDF_ASSET_ID,
    pdfObjectKey: `photobook-pdfs/${PDF_ASSET_ID.slice(0, 2)}/${PDF_ASSET_ID}`,
    document: proofDocument,
    assets: [],
    attemptCount: 1,
  };
}

describe("PhotobookProofWorker", () => {
  it("writes and finalizes the exact deterministic PDF metadata", async () => {
    const writes: Array<{ key: string; bytes: Uint8Array }> = [];
    const repository = new WorkerRepository(job());
    const worker = new PhotobookProofWorker(
      repository,
      storage(writes),
      "photobook-worker:test",
    );

    const result = await worker.processNext();

    expect(result).toMatchObject({ status: "rendered", revisionId: REVISION_ID, pageCount: 24 });
    expect(writes).toHaveLength(1);
    expect(Buffer.from(writes[0]!.bytes).subarray(0, 8).toString("ascii")).toMatch(/^%PDF-1\./);
    expect(repository.finalized).toMatchObject({
      pdfSizeBytes: writes[0]!.bytes.byteLength,
      pageCount: 24,
      renderEngine: "pdfkit",
      renderVersion: "pdfkit-0.19.1-buildy-1",
    });
    expect(repository.finalized?.pdfSha256).toBe(
      createHash("sha256").update(writes[0]!.bytes).digest("hex"),
    );
  }, 20_000);

  it("dead-letters a document with blocking preflight diagnostics without writing a PDF", async () => {
    const writes: Array<{ key: string; bytes: Uint8Array }> = [];
    const repository = new WorkerRepository(job(document("50000000-0000-4000-8000-000000000001")));
    const worker = new PhotobookProofWorker(
      repository,
      storage(writes),
      "photobook-worker:test",
    );

    const result = await worker.processNext();

    expect(result).toEqual({ status: "failed", revisionId: REVISION_ID });
    expect(writes).toHaveLength(0);
    expect(repository.failure).toEqual({ code: "PROOF_PROOF_BLOCKED", retry: null });
  });

  it("returns idle when no leased render job exists", async () => {
    const worker = new PhotobookProofWorker(
      new WorkerRepository(null),
      storage([]),
      "photobook-worker:test",
    );
    await expect(worker.processNext()).resolves.toEqual({ status: "idle" });
  });
});

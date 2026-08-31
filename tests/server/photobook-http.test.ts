// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPhotobookHttpHandler, type PhotobookHttpService } from "../../server/photobooks/http";
import type { ProjectActorResolver } from "../../server/projects/actor";
import type { ObjectStorage } from "../../server/storage/objectStorage";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const REVISION_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const PDF_BYTES = Buffer.from("%PDF-1.7\nprivate-proof-bytes\n%%EOF", "utf8");
const PDF_SHA = createHash("sha256").update(PDF_BYTES).digest("hex");
const DOCUMENT_SHA = "a".repeat(64);
const APPROVAL_KEY = "50000000-0000-4000-8000-000000000003";

function storage(bytes = PDF_BYTES): ObjectStorage {
  return {
    async createUploadUrl() { throw new Error("unused"); },
    async completeUpload() { throw new Error("unused"); },
    async createDownloadUrl() { throw new Error("unused"); },
    async streamObject(input) {
      const selected = input.range
        ? bytes.subarray(input.range.start, input.range.end + 1)
        : bytes;
      return {
        metadata: {
          key: input.key,
          sizeBytes: PDF_BYTES.byteLength,
          contentType: "application/pdf",
        },
        stream: new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(selected); controller.close(); },
        }),
        contentLength: selected.byteLength,
        range: input.range,
      };
    },
    async readObject() { return bytes; },
    async writeObject() { throw new Error("unused"); },
    async headObject() { return null; },
    async copyObject() {},
    async deleteObject() {},
    async listObjects() { return { objects: [] }; },
    async getChecksum() { return undefined; },
  };
}

const actors: ProjectActorResolver = {
  async resolve() { return { kind: "authenticated", appUserId: ACTOR_ID }; },
};

function service(): PhotobookHttpService {
  return {
    async editor() { throw new Error("unused"); },
    async updateSettings() { throw new Error("unused"); },
    async replaceExclusions() { throw new Error("unused"); },
    async requestProof() { return { revisionId: REVISION_ID, status: "rendering", replayed: false }; },
    async approveProof() { return { revisionId: REVISION_ID, status: "approved", replayed: false }; },
    async proofObject() {
      return {
        revisionId: REVISION_ID,
        status: "ready",
        documentSha256: DOCUMENT_SHA,
        objectKey: `photobook-pdfs/${REVISION_ID.slice(0, 2)}/${REVISION_ID}`,
        contentType: "application/pdf",
        sizeBytes: PDF_BYTES.byteLength,
        sha256: PDF_SHA,
      };
    },
  };
}

function approvalRequest(proofViewed: true | false | undefined): Request {
  return new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: APPROVAL_KEY,
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      ...(proofViewed === undefined ? {} : { proofViewed }),
    }),
  });
}

describe("photobook HTTP boundary", () => {
  it("streams only the authenticated immutable proof and supports PDF byte ranges", async () => {
    const handler = createPhotobookHttpHandler({ actors, service: service(), storage: storage() });
    const response = await handler(
      new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`, {
        headers: { range: "bytes=0-7" },
      }),
      REQUEST_ID,
      { revisionId: REVISION_ID },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-7/${PDF_BYTES.byteLength}`);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.has("x-buildy-proof-view-receipt")).toBe(false);
    expect(Buffer.from(await response.arrayBuffer()).toString("ascii")).toBe("%PDF-1.7");
  });

  it("rejects storage bytes that no longer match the approved database hash", async () => {
    const handler = createPhotobookHttpHandler({
      actors,
      service: service(),
      storage: storage(Buffer.alloc(PDF_BYTES.byteLength, 120)),
    });

    const response = await handler(
      new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`),
      REQUEST_ID,
      { revisionId: REVISION_ID },
    );
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  });

  it("streams a complete verified response without issuing a view receipt", async () => {
    const handler = createPhotobookHttpHandler({ actors, service: service(), storage: storage() });
    const response = await handler(
      new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`),
      REQUEST_ID,
      { revisionId: REVISION_ID },
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("x-buildy-proof-view-receipt")).toBe(false);
    expect(response.headers.has("x-buildy-proof-view-receipt-expires-at")).toBe(false);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("never issues a view receipt on HEAD", async () => {
    const handler = createPhotobookHttpHandler({ actors, service: service(), storage: storage() });
    const response = await handler(
      new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`, { method: "HEAD" }),
      REQUEST_ID,
      { revisionId: REVISION_ID },
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("x-buildy-proof-view-receipt")).toBe(false);
    expect(response.headers.has("x-buildy-proof-view-receipt-expires-at")).toBe(false);
  });

  it("approves only after the exact private object reaches verified EOF", async () => {
    let reachedEof = false;
    let reads = 0;
    const exactStorage = storage();
    exactStorage.streamObject = async (input) => ({
      metadata: {
        key: input.key,
        sizeBytes: PDF_BYTES.byteLength,
        contentType: "application/pdf",
        checksumSha256Base64: Buffer.from(PDF_SHA, "hex").toString("base64"),
      },
      stream: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (reads === 0) controller.enqueue(PDF_BYTES.subarray(0, 8));
          else if (reads === 1) controller.enqueue(PDF_BYTES.subarray(8));
          else {
            reachedEof = true;
            controller.close();
          }
          reads += 1;
        },
      }),
      contentLength: PDF_BYTES.byteLength,
    });
    const approveProof = vi.fn<PhotobookHttpService["approveProof"]>(async () => {
      expect(reachedEof).toBe(true);
      return { revisionId: REVISION_ID, status: "approved", replayed: false };
    });
    const handler = createPhotobookHttpHandler({
      actors,
      service: { ...service(), approveProof },
      storage: exactStorage,
    });

    const response = await handler(approvalRequest(true), REQUEST_ID, { revisionId: REVISION_ID });

    expect(response.status).toBe(200);
    expect(approveProof).toHaveBeenCalledWith(ACTOR_ID, REVISION_ID, {
      idempotencyKey: APPROVAL_KEY,
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      proofViewed: true,
    });
  });

  it.each([
    ["corrupt", Buffer.alloc(PDF_BYTES.byteLength, 120)],
    ["truncated", PDF_BYTES.subarray(0, PDF_BYTES.byteLength - 1)],
  ])("fails closed before approval for %s proof storage", async (_label, bytes) => {
    const approveProof = vi.fn<PhotobookHttpService["approveProof"]>();
    const handler = createPhotobookHttpHandler({
      actors,
      service: { ...service(), approveProof },
      storage: storage(bytes),
    });

    await expect(handler(approvalRequest(true), REQUEST_ID, { revisionId: REVISION_ID }))
      .rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(approveProof).not.toHaveBeenCalled();
  });

  it("fails closed when the proof stream is cancelled before EOF", async () => {
    const cancelledStorage = storage();
    cancelledStorage.streamObject = async (input) => {
      let pulls = 0;
      return {
        metadata: {
          key: input.key,
          sizeBytes: PDF_BYTES.byteLength,
          contentType: "application/pdf",
        },
        stream: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulls++ === 0) controller.enqueue(PDF_BYTES.subarray(0, 8));
            else controller.error(new DOMException("cancelled", "AbortError"));
          },
        }),
        contentLength: PDF_BYTES.byteLength,
      };
    };
    const approveProof = vi.fn<PhotobookHttpService["approveProof"]>();
    const handler = createPhotobookHttpHandler({
      actors,
      service: { ...service(), approveProof },
      storage: cancelledStorage,
    });

    await expect(handler(approvalRequest(true), REQUEST_ID, { revisionId: REVISION_ID }))
      .rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(approveProof).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("rejects proofViewed=%s before storage or approval", async (proofViewed) => {
    const approveProof = vi.fn<PhotobookHttpService["approveProof"]>();
    const proofObject = vi.fn<PhotobookHttpService["proofObject"]>();
    const handler = createPhotobookHttpHandler({
      actors,
      service: { ...service(), approveProof, proofObject },
      storage: storage(),
    });

    await expect(handler(approvalRequest(proofViewed), REQUEST_ID, { revisionId: REVISION_ID }))
      .rejects.toMatchObject({ name: "ZodError" });
    expect(proofObject).not.toHaveBeenCalled();
    expect(approveProof).not.toHaveBeenCalled();
  });

  it("requires an authenticated actor even when a revision UUID is known", async () => {
    const anonymous: ProjectActorResolver = { async resolve() { return { kind: "anonymous" }; } };
    const handler = createPhotobookHttpHandler({ actors: anonymous, service: service(), storage: storage() });

    await expect(handler(
      new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`),
      REQUEST_ID,
      { revisionId: REVISION_ID },
    )).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("returns 202 for a newly queued exact proof revision", async () => {
    const requestProof = vi.fn<PhotobookHttpService["requestProof"]>(async () => ({
      revisionId: REVISION_ID,
      status: "rendering",
      replayed: false,
    }));
    const handler = createPhotobookHttpHandler({
      actors,
      storage: storage(),
      service: { ...service(), requestProof },
    });
    const response = await handler(
      new Request(`https://buildy.test/api/projects/${PROJECT_ID}/photobook/proofs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "50000000-0000-4000-8000-000000000001",
          expectedDraftVersion: 1,
          expectedDocumentSha256: "a".repeat(64),
        }),
      }),
      REQUEST_ID,
      { projectId: PROJECT_ID },
    );

    expect(response.status).toBe(202);
    expect(requestProof).toHaveBeenCalledWith(
      ACTOR_ID,
      PROJECT_ID,
      expect.objectContaining({ expectedDraftVersion: 1 }),
    );
  });

  it("returns the terminal result when request-driven proof processing completes", async () => {
    const requestProof = vi.fn<PhotobookHttpService["requestProof"]>(async () => ({
      revisionId: REVISION_ID,
      status: "ready",
      replayed: false,
    }));
    const handler = createPhotobookHttpHandler({
      actors,
      storage: storage(),
      service: { ...service(), requestProof },
    });

    const response = await handler(
      new Request(`https://buildy.test/api/projects/${PROJECT_ID}/photobook/proofs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "50000000-0000-4000-8000-000000000002",
          expectedDraftVersion: 1,
          expectedDocumentSha256: "a".repeat(64),
        }),
      }),
      REQUEST_ID,
      { projectId: PROJECT_ID },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { revisionId: REVISION_ID, status: "ready", replayed: false },
    });
    expect(requestProof).toHaveBeenCalledOnce();
  });
});

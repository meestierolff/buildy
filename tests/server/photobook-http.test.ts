// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPhotobookCronHandler } from "../../server/photobooks/cron";
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
const VIEW_RECEIPT = `v1.1893456000.${"a".repeat(43)}`;

function storage(bytes = PDF_BYTES): ObjectStorage {
  return {
    async createUploadUrl() { throw new Error("unused"); },
    async completeUpload() { throw new Error("unused"); },
    async createDownloadUrl() { throw new Error("unused"); },
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
    issueProofViewReceipt() {
      return { token: VIEW_RECEIPT, expiresAt: "2030-01-01T00:00:00.000Z" };
    },
  };
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
    expect(Buffer.from(await response.arrayBuffer()).toString("ascii")).toBe("%PDF-1.7");
  });

  it("rejects storage bytes that no longer match the approved database hash", async () => {
    const handler = createPhotobookHttpHandler({
      actors,
      service: service(),
      storage: storage(Buffer.from("tampered")),
    });

    await expect(handler(
      new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`),
      REQUEST_ID,
      { revisionId: REVISION_ID },
    )).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
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
});

describe("photobook cron boundary", () => {
  it("uses constant-time Bearer authentication before processing one leased job", async () => {
    const processNext = vi.fn(async () => ({ status: "idle" as const }));
    const handler = createPhotobookCronHandler(() => ({
      cronSecret: "x".repeat(32),
      worker: { processNext } as never,
    }));
    await expect(handler(
      new Request("https://buildy.test/api/internal/cron/photobooks", {
        headers: { authorization: `Bearer ${"x".repeat(32)}` },
      }),
      REQUEST_ID,
    )).resolves.toMatchObject({ status: 200 });
    expect(processNext).toHaveBeenCalledOnce();
  });
});

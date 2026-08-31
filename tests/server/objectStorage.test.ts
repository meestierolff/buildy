import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ObjectStorageError,
  assertChecksumSha256Base64,
  assertMaximumBytes,
  assertObjectKey,
  assertSafeContentDispositionFilename,
  assertUploadPolicy,
  createObjectKey,
  guardObjectStream,
} from "../../server/storage/objectStorage";

const assetId = "9d061f28-8a45-4e3b-a57c-a036d3799957";

describe("private object storage policy", () => {
  it("creates opaque purpose-scoped keys without a user identifier", () => {
    expect(createObjectKey("originals", assetId)).toBe(`originals/9d/${assetId}`);
    expect(createObjectKey("display", assetId, "large.webp")).toBe(`display/9d/${assetId}/large.webp`);
  });

  it.each([
    "../secret",
    `originals/9d/${assetId}/../secret`,
    `public/${assetId}`,
    `originals/9d/not-a-uuid`,
    `originals\\9d\\${assetId}`,
  ])("rejects unsafe or non-canonical keys: %s", (key) => {
    expect(() => assertObjectKey(key)).toThrow(ObjectStorageError);
  });

  it("requires a real SHA-256 base64 checksum and bounded upload size", () => {
    expect(assertChecksumSha256Base64("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toHaveLength(44);
    expect(() => assertChecksumSha256Base64("deadbeef")).toThrow(ObjectStorageError);
    expect(assertMaximumBytes(8_000_000)).toBe(8_000_000);
    expect(() => assertMaximumBytes(50 * 1024 * 1024 + 1)).toThrow(ObjectStorageError);
  });

  it("keeps content-disposition filenames header-safe", () => {
    expect(assertSafeContentDispositionFilename("Bouwboek – augustus.pdf")).toBe("Bouwboek – augustus.pdf");
    expect(() => assertSafeContentDispositionFilename("boek\r\nX-Evil: yes.pdf")).toThrow(ObjectStorageError);
    expect(() => assertSafeContentDispositionFilename("../../boek.pdf")).toThrow(ObjectStorageError);
  });

  it("enforces purpose-specific MIME and size ceilings", () => {
    const originalKey = createObjectKey("originals", assetId);
    const proofKey = createObjectKey("photobook-pdfs", assetId);

    expect(assertUploadPolicy(originalKey, "image/jpeg", 50 * 1024 * 1024)).toBe(50 * 1024 * 1024);
    expect(assertUploadPolicy(proofKey, "application/pdf", 120 * 1024 * 1024)).toBe(120 * 1024 * 1024);
    expect(() => assertUploadPolicy(originalKey, "text/html", 100)).toThrow(ObjectStorageError);
    expect(() => assertUploadPolicy(originalKey, "image/jpeg", 51 * 1024 * 1024)).toThrow(ObjectStorageError);
  });

  it("fails a response stream closed on overflow or a checksum mismatch", async () => {
    const bytes = Buffer.from("exact-stream");
    const source = () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    });

    await expect(new Response(guardObjectStream({
      stream: source(),
      expectedBytes: bytes.byteLength - 1,
    })).arrayBuffer()).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });

    await expect(new Response(guardObjectStream({
      stream: source(),
      expectedBytes: bytes.byteLength,
      expectedSha256Hex: createHash("sha256").update("different").digest("hex"),
    })).arrayBuffer()).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  });

  it("propagates downstream cancellation to the private provider stream", async () => {
    let cancelled = false;
    const guarded = guardObjectStream({
      stream: new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(Uint8Array.of(1)); },
        cancel() { cancelled = true; },
      }),
      expectedBytes: 10,
    });
    const reader = guarded.getReader();

    await reader.read();
    await reader.cancel("client disconnected");

    expect(cancelled).toBe(true);
  });

});

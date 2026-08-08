import { describe, expect, it } from "vitest";
import {
  ObjectStorageError,
  assertChecksumSha256Base64,
  assertMaximumBytes,
  assertObjectKey,
  assertSafeContentDispositionFilename,
  assertUploadPolicy,
  createObjectKey,
} from "../../server/storage/objectStorage";
import { R2ObjectStorage } from "../../server/storage/r2ObjectStorage";

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

  it("allows seven-day provider grants while keeping interactive downloads short-lived", async () => {
    const storage = new R2ObjectStorage({
      accountId: "test-account",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      bucketName: "buildy-private",
    });
    const key = createObjectKey("photobook-pdfs", assetId);

    await expect(storage.createDownloadUrl({
      key,
      grantPurpose: "provider_fulfilment",
      expiresInSeconds: 604_800,
    })).resolves.toMatchObject({ method: "GET", key });
    await expect(storage.createDownloadUrl({
      key,
      grantPurpose: "provider_fulfilment",
      expiresInSeconds: 604_801,
    })).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(storage.createDownloadUrl({
      key,
      expiresInSeconds: 901,
    })).rejects.toBeInstanceOf(ObjectStorageError);
  });
});

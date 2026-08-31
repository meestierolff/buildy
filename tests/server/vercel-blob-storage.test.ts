// @vitest-environment node

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectStorageError } from "../../server/storage/objectStorage";
import {
  VercelBlobObjectStorage,
  type VercelBlobDetails,
  type VercelBlobSdk,
  type VercelBlobTokenOptions,
} from "../../server/storage/vercelBlobObjectStorage";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const PATHNAME = `temporary/22/${ASSET_ID}`;
const TOKEN = `vercel_blob_rw_${"x".repeat(40)}`;
const APP_ORIGIN = "https://app.buildy.test";
const CONTENT_TYPE = "image/jpeg";

type Stored = { bytes: Uint8Array; contentType: string; etag: string; uploadedAt: Date };

function privateUrl(pathname: string): string {
  return `https://store123.private.blob.vercel-storage.com/${pathname}`;
}

function details(
  pathname: string,
  stored: Stored,
): VercelBlobDetails & { size: number; uploadedAt: Date } {
  const url = privateUrl(pathname);
  return {
    pathname,
    contentType: stored.contentType,
    url,
    downloadUrl: `${url}?download=1`,
    etag: stored.etag,
    size: stored.bytes.byteLength,
    uploadedAt: stored.uploadedAt,
  };
}

function notFound(): Error {
  return Object.assign(new Error("missing"), { name: "BlobNotFoundError" });
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fixture() {
  const objects = new Map<string, Stored>();
  const sdk: VercelBlobSdk = {
    put: vi.fn(async (pathname, body, options) => {
      const stored = {
        bytes: new Uint8Array(body),
        contentType: options.contentType,
        etag: '"written-etag"',
        uploadedAt: new Date("2026-08-23T08:00:00.000Z"),
      };
      objects.set(pathname, stored);
      return details(pathname, stored);
    }),
    get: vi.fn(async (pathname, options) => {
      const stored = objects.get(pathname);
      if (!stored) return null;
      const rangeHeader = new Headers(options.headers).get("range");
      const match = rangeHeader ? /^bytes=(\d+)-(\d+)$/.exec(rangeHeader) : null;
      const start = match ? Number(match[1]) : 0;
      const end = match ? Number(match[2]) : stored.bytes.byteLength - 1;
      const responseBytes = stored.bytes.slice(start, end + 1);
      const responseDetails = details(pathname, stored);
      const headers = new Headers({
        "content-length": String(responseBytes.byteLength),
        "content-type": stored.contentType,
        etag: stored.etag,
      });
      if (match) headers.set("content-range", `bytes ${start}-${end}/${stored.bytes.byteLength}`);
      return {
        statusCode: 200,
        stream: stream(responseBytes),
        blob: { ...responseDetails, size: responseBytes.byteLength },
        headers,
      };
    }),
    head: vi.fn(async (pathname) => {
      const stored = objects.get(pathname);
      if (!stored) throw notFound();
      return details(pathname, stored);
    }),
    copy: vi.fn(async (source, destination, options) => {
      const stored = objects.get(source);
      if (!stored) throw notFound();
      const copied = { ...stored, contentType: options.contentType, etag: '"copied-etag"' };
      objects.set(destination, copied);
      return details(destination, copied);
    }),
    del: vi.fn(async (pathname) => { objects.delete(pathname); }),
    list: vi.fn(async ({ prefix }) => ({
      blobs: [...objects.entries()]
        .filter(([pathname]) => pathname.startsWith(prefix))
        .map(([pathname, stored]) => details(pathname, stored)),
      hasMore: false,
    })),
    handleUpload: vi.fn(async () => ({ type: "blob.generate-client-token", clientToken: "test" })),
  };
  const storage = new VercelBlobObjectStorage({
    token: TOKEN,
    callbackOrigin: APP_ORIGIN,
    sdk,
    now: () => Date.parse("2026-08-23T08:00:00.000Z"),
  });
  return { objects, sdk, storage };
}

function authorization(bytes: Uint8Array) {
  return {
    actorId: ACTOR_ID,
    assetId: ASSET_ID,
    pathname: PATHNAME,
    contentType: CONTENT_TYPE,
    maximumBytes: bytes.byteLength,
    checksumSha256Base64: createHash("sha256").update(bytes).digest("base64"),
  };
}

describe("private Vercel Blob object storage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns only a same-origin client-upload instruction with an opaque server pathname", async () => {
    const { storage } = fixture();
    const bytes = Buffer.from("exact-photo");

    await expect(storage.createUploadUrl({
      key: PATHNAME,
      contentType: CONTENT_TYPE,
      checksumSha256Base64: createHash("sha256").update(bytes).digest("base64"),
      maximumBytes: bytes.byteLength,
    })).resolves.toEqual({
      provider: "vercel_blob",
      method: "POST",
      pathname: PATHNAME,
      handleUploadPath: `/api/media/${ASSET_ID}/blob-upload`,
      key: PATHNAME,
      maximumBytes: bytes.byteLength,
    });
    expect(PATHNAME).not.toContain(ACTOR_ID);
  });

  it("keeps the full 50 MiB source-photo boundary", async () => {
    const { storage } = fixture();
    const maximumBytes = 50 * 1024 * 1024;

    await expect(storage.createUploadUrl({
      key: PATHNAME,
      contentType: CONTENT_TYPE,
      checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      maximumBytes,
    })).resolves.toMatchObject({ maximumBytes });
  });

  it("authorizes owner, exact path, MIME and size before issuing a five-minute private token", async () => {
    const { sdk, storage } = fixture();
    const bytes = Buffer.from("exact-photo");
    const authorize = vi.fn(async () => authorization(bytes));
    let tokenOptions: VercelBlobTokenOptions | undefined;
    vi.mocked(sdk.handleUpload).mockImplementationOnce(async (options) => {
      tokenOptions = await options.onBeforeGenerateToken(PATHNAME, null, false);
      return { type: "blob.generate-client-token", clientToken: "test-client-token" };
    });

    const result = await storage.handleClientUpload({
      request: new Request(`${APP_ORIGIN}/api/media/${ASSET_ID}/blob-upload`, { method: "POST" }),
      body: { type: "blob.generate-client-token" },
      authorize,
      complete: vi.fn(),
    });

    expect(result).toEqual({ type: "blob.generate-client-token", clientToken: "test-client-token" });
    expect(authorize).toHaveBeenCalledWith(PATHNAME);
    expect(tokenOptions).toMatchObject({
      allowedContentTypes: [CONTENT_TYPE],
      maximumSizeInBytes: bytes.byteLength,
      validUntil: Date.parse("2026-08-23T08:05:00.000Z"),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      callbackUrl: `${APP_ORIGIN}/api/media/blob-upload-completed`,
    });
    expect(JSON.parse(tokenOptions?.tokenPayload ?? "{}")).toEqual({
      schemaVersion: 1,
      ...authorization(bytes),
    });
  });

  it("derives the fixed callback route from the current HTTPS deployment request", async () => {
    const { sdk } = fixture();
    const bytes = Buffer.from("exact-photo");
    const storage = new VercelBlobObjectStorage({ token: TOKEN, sdk });
    let tokenOptions: VercelBlobTokenOptions | undefined;
    vi.mocked(sdk.handleUpload).mockImplementationOnce(async (options) => {
      tokenOptions = await options.onBeforeGenerateToken(PATHNAME, null, false);
      return { type: "blob.generate-client-token" };
    });

    await storage.handleClientUpload({
      request: new Request(`${APP_ORIGIN}/api/media/${ASSET_ID}/blob-upload`, {
        method: "POST",
        headers: { origin: APP_ORIGIN },
      }),
      body: {},
      authorize: async () => authorization(bytes),
      complete: vi.fn(),
    });

    expect(tokenOptions?.callbackUrl).toBe(`${APP_ORIGIN}/api/media/blob-upload-completed`);
  });

  it("rejects caller payload, multipart and a path that differs from the pending asset", async () => {
    const { sdk, storage } = fixture();
    const bytes = Buffer.from("exact-photo");
    const authorize = vi.fn(async () => authorization(bytes));
    const invoke = async (pathname: string, payload: string | null, multipart: boolean) => {
      vi.mocked(sdk.handleUpload).mockImplementationOnce(async (options) =>
        options.onBeforeGenerateToken(pathname, payload, multipart));
      return storage.handleClientUpload({
        request: new Request(`${APP_ORIGIN}/api/media/${ASSET_ID}/blob-upload`, { method: "POST" }),
        body: {},
        authorize,
        complete: vi.fn(),
      });
    };

    await expect(invoke(PATHNAME, "owner-controlled", false)).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(invoke(PATHNAME, "", false)).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(invoke(PATHNAME, null, true)).rejects.toBeInstanceOf(ObjectStorageError);
    await expect(invoke(`temporary/33/33333333-3333-4333-8333-333333333333`, null, false))
      .rejects.toBeInstanceOf(ObjectStorageError);
  });

  it("accepts only a private exact-path completion callback and forwards no provider URL", async () => {
    const { sdk, storage } = fixture();
    const bytes = Buffer.from("exact-photo");
    const complete = vi.fn(async () => undefined);
    const payload = JSON.stringify({ schemaVersion: 1, ...authorization(bytes) });
    vi.mocked(sdk.handleUpload).mockImplementationOnce(async (options) => {
      await options.onUploadCompleted({
        blob: {
          ...details(PATHNAME, {
            bytes,
            contentType: CONTENT_TYPE,
            etag: '"callback-etag"',
            uploadedAt: new Date(),
          }),
        },
        tokenPayload: payload,
      });
      return { type: "blob.upload-completed", response: "ok" };
    });

    await storage.handleClientUpload({
      request: new Request(`${APP_ORIGIN}/api/media/blob-upload-completed`, { method: "POST" }),
      body: { type: "blob.upload-completed" },
      authorize: vi.fn(),
      complete,
    });

    expect(complete).toHaveBeenCalledWith({ ...authorization(bytes), etag: "callback-etag" });
    expect(JSON.stringify(complete.mock.calls)).not.toContain("blob.vercel-storage.com");
  });

  it("reads and hashes exact private bytes before accepting upload completion", async () => {
    const { objects, sdk, storage } = fixture();
    const bytes = Buffer.from("exact-photo");
    const expected = authorization(bytes);
    objects.set(PATHNAME, {
      bytes,
      contentType: CONTENT_TYPE,
      etag: '"stored-etag"',
      uploadedAt: new Date(),
    });

    await expect(storage.completeUpload({
      key: PATHNAME,
      contentType: CONTENT_TYPE,
      checksumSha256Base64: expected.checksumSha256Base64,
      maximumBytes: bytes.byteLength,
    })).resolves.toMatchObject({
      key: PATHNAME,
      sizeBytes: bytes.byteLength,
      contentType: CONTENT_TYPE,
      checksumSha256Base64: expected.checksumSha256Base64,
      etag: "stored-etag",
    });
    expect(sdk.get).toHaveBeenCalledWith(PATHNAME, { access: "private", token: TOKEN });
  });

  it("deletes a tampered pending object and never creates a download URL", async () => {
    const { objects, sdk, storage } = fixture();
    const expectedBytes = Buffer.from("expected");
    const tampered = Buffer.from("tampered");
    objects.set(PATHNAME, {
      bytes: tampered,
      contentType: CONTENT_TYPE,
      etag: '"tampered-etag"',
      uploadedAt: new Date(),
    });

    await expect(storage.completeUpload({
      key: PATHNAME,
      contentType: CONTENT_TYPE,
      checksumSha256Base64: createHash("sha256").update(expectedBytes).digest("base64"),
      maximumBytes: tampered.byteLength,
    })).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
    expect(sdk.del).toHaveBeenCalledWith(PATHNAME, { token: TOKEN });
    expect(objects.has(PATHNAME)).toBe(false);
    await expect(storage.createDownloadUrl({ key: PATHNAME }))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("uses explicit private access for server writes and verifies the persisted bytes", async () => {
    const { sdk, storage } = fixture();
    const pathname = `display/22/${ASSET_ID}/large.webp`;
    const bytes = Buffer.from("processed-display");

    await expect(storage.writeObject({
      key: pathname,
      contentType: "image/webp",
      bytes,
    })).resolves.toMatchObject({
      key: pathname,
      sizeBytes: bytes.byteLength,
      contentType: "image/webp",
    });
    expect(sdk.put).toHaveBeenCalledWith(pathname, bytes, {
      access: "private",
      token: TOKEN,
      contentType: "image/webp",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  });

  it("streams a private response above Vercel's buffered 4.5 MiB limit", async () => {
    const { objects, storage } = fixture();
    const pathname = `originals/22/${ASSET_ID}`;
    const bytes = new Uint8Array(5 * 1024 * 1024 + 17).fill(23);
    objects.set(pathname, {
      bytes,
      contentType: CONTENT_TYPE,
      etag: '"large-etag"',
      uploadedAt: new Date(),
    });

    const result = await storage.streamObject({ key: pathname, maximumBytes: bytes.byteLength });

    expect(result.metadata).toMatchObject({
      key: pathname,
      sizeBytes: bytes.byteLength,
      contentType: CONTENT_TYPE,
    });
    expect(result.contentLength).toBe(bytes.byteLength);
    expect((await new Response(result.stream).arrayBuffer()).byteLength).toBe(bytes.byteLength);
  });

  it("forwards and validates exact byte ranges without exposing a Blob URL", async () => {
    const { objects, sdk, storage } = fixture();
    const bytes = Buffer.from("0123456789");
    objects.set(PATHNAME, {
      bytes,
      contentType: CONTENT_TYPE,
      etag: '"range-etag"',
      uploadedAt: new Date(),
    });

    const result = await storage.streamObject({
      key: PATHNAME,
      maximumBytes: bytes.byteLength,
      range: { start: 2, end: 6 },
    });

    expect(sdk.get).toHaveBeenLastCalledWith(PATHNAME, {
      access: "private",
      token: TOKEN,
      headers: { range: "bytes=2-6" },
    });
    expect(result.range).toEqual({ start: 2, end: 6 });
    expect(result.metadata.sizeBytes).toBe(bytes.byteLength);
    await expect(new Response(result.stream).text()).resolves.toBe("23456");
  });

  it("makes server-generated object keys idempotent and immutable", async () => {
    const { sdk, storage } = fixture();
    const pathname = `display/22/${ASSET_ID}/large.webp`;
    const bytes = Buffer.from("immutable-display");

    await storage.writeObject({ key: pathname, contentType: "image/webp", bytes });
    await expect(storage.writeObject({ key: pathname, contentType: "image/webp", bytes }))
      .resolves.toMatchObject({ key: pathname });
    expect(sdk.put).toHaveBeenCalledTimes(1);

    await expect(storage.writeObject({
      key: pathname,
      contentType: "image/webp",
      bytes: Buffer.alloc(bytes.byteLength, 120),
    })).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
    expect(sdk.put).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the provider returns an unconfirmed byte range", async () => {
    const { objects, sdk, storage } = fixture();
    const bytes = Buffer.from("0123456789");
    objects.set(PATHNAME, {
      bytes,
      contentType: CONTENT_TYPE,
      etag: '"range-etag"',
      uploadedAt: new Date(),
    });
    const originalGet = vi.mocked(sdk.get).getMockImplementation();
    vi.mocked(sdk.get).mockImplementationOnce(async (...args) => {
      const result = await originalGet!(...args);
      result?.headers.set("content-range", "bytes 3-6/10");
      return result;
    });

    await expect(storage.streamObject({
      key: PATHNAME,
      maximumBytes: bytes.byteLength,
      range: { start: 2, end: 6 },
    })).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  });

  it("fails closed for public Blob metadata and unsafe callback origins", async () => {
    const { objects, sdk, storage } = fixture();
    const bytes = Buffer.from("exact-photo");
    objects.set(PATHNAME, {
      bytes,
      contentType: CONTENT_TYPE,
      etag: '"etag"',
      uploadedAt: new Date(),
    });
    vi.mocked(sdk.head).mockResolvedValueOnce({
      ...details(PATHNAME, objects.get(PATHNAME)!),
      url: `https://store123.public.blob.vercel-storage.com/${PATHNAME}`,
    });

    await expect(storage.headObject(PATHNAME)).rejects.toBeInstanceOf(ObjectStorageError);
    expect(() => new VercelBlobObjectStorage({
      token: TOKEN,
      callbackOrigin: "http://app.buildy.test",
      sdk,
    })).toThrow(ObjectStorageError);
  });
});

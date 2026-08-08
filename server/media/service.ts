import { createHash } from "node:crypto";
import {
  completeMediaUploadInputSchema,
  createMediaUploadIntentInputSchema,
  mediaDisplayQuerySchema,
  originalMediaGrantInputSchema,
  type MediaUploadCompletion,
  type MediaUploadIntent,
  type OriginalMediaGrant,
  type OriginalMediaPurpose,
} from "../../shared/contracts/media.js";
import type { ProjectActor } from "../projects/actor.js";
import {
  ObjectStorageError,
  createObjectKey,
  type ObjectStorage,
} from "../storage/objectStorage.js";
import { MediaError } from "./errors.js";
import { mediaRequestHash, scopedMediaUploadKey } from "./idempotency.js";
import type { OriginalMediaPurposeGrants } from "./purposeGrant.js";
import type { MediaUploadRateLimiter } from "./rateLimit.js";
import type { MediaClock, MediaIdFactory, MediaRepository } from "./types.js";

const MAX_BINARY_BYTES = 50 * 1024 * 1024;

export type MediaBinaryResponse = {
  status: 200 | 206 | 304 | 416;
  body: Uint8Array | null;
  headers: Readonly<Record<string, string>>;
};

type ByteRange = { start: number; end: number };

function checksumHexFromBase64(value: string): string {
  return Buffer.from(value, "base64").toString("hex");
}

function withoutIdempotencyKey<T extends { idempotencyKey: string }>(
  input: T,
): Omit<T, "idempotencyKey"> {
  const { idempotencyKey: _idempotencyKey, ...payload } = input;
  return payload;
}

function storageError(error: unknown): MediaError {
  if (error instanceof ObjectStorageError) {
    if (
      error.code === "UPLOAD_MISMATCH" ||
      error.code === "INVALID_CHECKSUM" ||
      error.code === "INVALID_CONTENT_TYPE" ||
      error.code === "INVALID_SIZE"
    ) return new MediaError("UPLOAD_INVALID", { cause: error });
    if (error.code === "OBJECT_NOT_FOUND") return new MediaError("MEDIA_NOT_FOUND", { cause: error });
  }
  return new MediaError("STORAGE_UNAVAILABLE", { cause: error });
}

function etagMatches(value: string | null, etag: string): boolean {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}

function parseRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return "invalid";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) return "invalid";
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function cacheHeaders(publiclyCacheable: boolean): Record<string, string> {
  return {
    "cache-control": publiclyCacheable
      ? "public, max-age=0, must-revalidate, no-transform"
      : "private, no-store",
    vary: "authorization, cookie, range",
  };
}

function binaryHeaders(input: {
  contentType: string;
  etag: string;
  sizeBytes: number;
  publiclyCacheable: boolean;
}): Record<string, string> {
  return {
    ...cacheHeaders(input.publiclyCacheable),
    "accept-ranges": "bytes",
    "content-type": input.contentType,
    etag: input.etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-site",
    "content-length": String(input.sizeBytes),
  };
}

async function verifiedObjectBytes(
  storage: ObjectStorage,
  object: { objectKey: string; sizeBytes: number; sha256Hex: string },
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(object.sizeBytes) ||
    object.sizeBytes < 1 ||
    object.sizeBytes > MAX_BINARY_BYTES ||
    !/^[0-9a-f]{64}$/.test(object.sha256Hex)
  ) throw new MediaError("MEDIA_NOT_FOUND");
  let bytes: Uint8Array;
  try {
    bytes = await storage.readObject(object.objectKey, object.sizeBytes);
  } catch (error) {
    throw storageError(error);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== object.sizeBytes || actual !== object.sha256Hex) {
    throw new MediaError("STORAGE_UNAVAILABLE");
  }
  return bytes;
}

export class MediaService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly rateLimiter: MediaUploadRateLimiter,
    private readonly purposeGrants: OriginalMediaPurposeGrants,
    private readonly bucket: string,
    private readonly clock: MediaClock = () => new Date(),
    private readonly createId: MediaIdFactory = () => crypto.randomUUID(),
  ) {}

  async createUploadIntent(actorId: string, rawInput: unknown): Promise<MediaUploadIntent> {
    const input = createMediaUploadIntentInputSchema.parse(rawInput);
    const rateLimit = await this.rateLimiter.consume({
      actorId,
      projectId: input.projectId,
      requestedBytes: input.sizeBytes,
    });
    if (!rateLimit.allowed) {
      throw new MediaError("RATE_LIMITED", {
        retryAfterSeconds: rateLimit.retryAfterSeconds ?? undefined,
      });
    }

    const assetId = this.createId();
    const idempotencyKey = scopedMediaUploadKey(actorId, input.projectId, input.idempotencyKey);
    const intent = await this.repository.createUploadIntent({
      assetId,
      actorId,
      projectId: input.projectId,
      purpose: input.purpose,
      temporaryObjectKey: createObjectKey("temporary", assetId),
      bucket: this.bucket,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      checksumSha256Base64: input.checksumSha256Base64,
      checksumSha256Hex: checksumHexFromBase64(input.checksumSha256Base64),
      idempotencyKey,
      requestHash: mediaRequestHash(withoutIdempotencyKey(input)),
    });

    if (intent.asset.status !== "pending_upload") {
      return { asset: intent.asset, upload: null, replayed: true };
    }

    try {
      const grant = await this.storage.createUploadUrl({
        key: intent.temporaryObjectKey,
        contentType: intent.contentType,
        checksumSha256Base64: intent.checksumSha256Base64,
        maximumBytes: intent.sizeBytes,
        expiresInSeconds: 5 * 60,
      });
      if (grant.key !== intent.temporaryObjectKey || grant.maximumBytes !== intent.sizeBytes) {
        throw new ObjectStorageError("PROVIDER_ERROR", "Uploadgrant wijkt af van de intentie.");
      }
      return {
        asset: intent.asset,
        upload: {
          method: "PUT",
          url: grant.url,
          expiresAt: grant.expiresAt,
          requiredHeaders: grant.requiredHeaders,
          exactSizeBytes: intent.sizeBytes,
        },
        replayed: intent.replayed,
      };
    } catch (error) {
      throw storageError(error);
    }
  }

  async completeUpload(
    actorId: string,
    assetId: string,
    rawInput: unknown,
  ): Promise<MediaUploadCompletion> {
    completeMediaUploadInputSchema.parse(rawInput);
    const upload = await this.repository.findUploadForCompletion(actorId, assetId);
    if (!upload || upload.asset.status === "failed") throw new MediaError("MEDIA_NOT_FOUND");
    if (upload.asset.status !== "pending_upload") {
      return { asset: upload.asset, replayed: true };
    }

    try {
      const object = await this.storage.completeUpload({
        key: upload.temporaryObjectKey,
        contentType: upload.contentType,
        checksumSha256Base64: upload.checksumSha256Base64,
        maximumBytes: upload.maximumBytes,
      });
      if (
        object.key !== upload.temporaryObjectKey ||
        object.sizeBytes !== upload.maximumBytes ||
        object.contentType !== upload.contentType ||
        object.checksumSha256Base64 !== upload.checksumSha256Base64
      ) throw new ObjectStorageError("UPLOAD_MISMATCH", "Uploadbevestiging wijkt af.");
      return await this.repository.completeUpload({
        actorId,
        assetId,
        objectSizeBytes: object.sizeBytes,
        objectContentType: object.contentType,
        objectChecksumSha256Base64: object.checksumSha256Base64,
        objectEtag: object.etag ?? null,
      });
    } catch (error) {
      const mapped = storageError(error);
      if (mapped.reason === "UPLOAD_INVALID") {
        await this.repository.rejectUpload(actorId, assetId, "UPLOAD_MISMATCH");
      }
      throw mapped;
    }
  }

  async readDisplay(
    viewer: ProjectActor,
    assetId: string,
    rawQuery: unknown,
    requestHeaders: Headers,
    headOnly = false,
  ): Promise<MediaBinaryResponse> {
    const query = mediaDisplayQuerySchema.parse(rawQuery);
    const object = await this.repository.resolveDisplayObject(viewer, assetId, query.size);
    if (!object || (query.v && query.v !== object.effectivePrivacyVersion)) {
      throw new MediaError("MEDIA_NOT_FOUND");
    }
    const versionedPublic = object.publiclyCacheable && query.v === object.effectivePrivacyVersion;
    const etag = `"${object.sha256Hex}"`;
    const headers = binaryHeaders({
      contentType: object.contentType,
      etag,
      sizeBytes: object.sizeBytes,
      publiclyCacheable: versionedPublic,
    });
    if (etagMatches(requestHeaders.get("if-none-match"), etag)) {
      const { "content-length": _length, ...notModifiedHeaders } = headers;
      return { status: 304, body: null, headers: notModifiedHeaders };
    }

    const range = parseRange(requestHeaders.get("range"), object.sizeBytes);
    if (range === "invalid") {
      return {
        status: 416,
        body: null,
        headers: { ...headers, "content-range": `bytes */${object.sizeBytes}`, "content-length": "0" },
      };
    }
    if (headOnly) return { status: 200, body: null, headers };
    const bytes = await verifiedObjectBytes(this.storage, object);
    if (!range) return { status: 200, body: bytes, headers };
    const body = bytes.slice(range.start, range.end + 1);
    return {
      status: 206,
      body,
      headers: {
        ...headers,
        "content-range": `bytes ${range.start}-${range.end}/${object.sizeBytes}`,
        "content-length": String(body.byteLength),
      },
    };
  }

  async createOriginalGrant(
    actorId: string,
    assetId: string,
    rawInput: unknown,
  ): Promise<OriginalMediaGrant> {
    const input = originalMediaGrantInputSchema.parse(rawInput);
    const object = await this.repository.resolveOwnedOriginal(actorId, assetId);
    if (!object) throw new MediaError("MEDIA_NOT_FOUND");
    const grant = this.purposeGrants.issue({ actorId, assetId, purpose: input.purpose });
    return {
      path: `/api/media/${assetId}/original`,
      purpose: input.purpose,
      expiresAt: grant.expiresAt,
      requiredHeaders: { "x-buildy-media-purpose-grant": grant.token },
    };
  }

  async readOriginal(
    actorId: string,
    assetId: string,
    purpose: OriginalMediaPurpose,
    token: string,
    requestHeaders: Headers,
    headOnly = false,
  ): Promise<MediaBinaryResponse> {
    if (!this.purposeGrants.verify({ actorId, assetId, purpose, token })) {
      throw new MediaError("PURPOSE_GRANT_INVALID");
    }
    const object = await this.repository.resolveOwnedOriginal(actorId, assetId);
    if (!object) throw new MediaError("MEDIA_NOT_FOUND");
    const etag = `"${object.sha256Hex}"`;
    const headers = binaryHeaders({
      contentType: object.contentType,
      etag,
      sizeBytes: object.sizeBytes,
      publiclyCacheable: false,
    });
    if (etagMatches(requestHeaders.get("if-none-match"), etag)) {
      const { "content-length": _length, ...notModifiedHeaders } = headers;
      return { status: 304, body: null, headers: notModifiedHeaders };
    }
    const range = parseRange(requestHeaders.get("range"), object.sizeBytes);
    if (range === "invalid") {
      return {
        status: 416,
        body: null,
        headers: { ...headers, "content-range": `bytes */${object.sizeBytes}`, "content-length": "0" },
      };
    }
    if (headOnly) return { status: 200, body: null, headers };
    const bytes = await verifiedObjectBytes(this.storage, object);
    if (!range) return { status: 200, body: bytes, headers };
    const body = bytes.slice(range.start, range.end + 1);
    return {
      status: 206,
      body,
      headers: {
        ...headers,
        "content-range": `bytes ${range.start}-${range.end}/${object.sizeBytes}`,
        "content-length": String(body.byteLength),
      },
    };
  }
}

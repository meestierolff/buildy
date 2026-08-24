import { createHash } from "node:crypto";
import {
  ObjectStorageError,
  assertChecksumSha256Base64,
  assertMaximumBytes,
  assertObjectKey,
  assertUploadPolicy,
  type ClientUploadAuthorization,
  type ClientUploadObjectStorage,
  type CompleteUploadInput,
  type CreateDownloadGrantInput,
  type CreateUploadGrantInput,
  type DownloadGrant,
  type ObjectPage,
  type ObjectByteRange,
  type ObjectPurpose,
  type StreamObjectInput,
  type StreamedObject,
  type StoredObjectMetadata,
  type UploadGrant,
  type WriteObjectInput,
} from "./objectStorage.js";

const CLIENT_TOKEN_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_READ_BYTES = 512 * 1024 * 1024;
const PRIVATE_BLOB_HOST = /^[a-z0-9]+\.private\.blob\.vercel-storage\.com$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Logical database namespace; no store ID, token, owner or other PII is persisted. */
export const VERCEL_BLOB_STORAGE_NAMESPACE = "vercel-blob-private";

export type VercelBlobLocation = {
  pathname: string;
  url: string;
  downloadUrl: string;
  etag: string;
  uploadedAt?: Date;
};

export type VercelBlobDetails = VercelBlobLocation & {
  contentType: string;
  size?: number;
};

export type VercelBlobGetResult = {
  statusCode: number;
  stream: ReadableStream<Uint8Array> | null;
  blob: VercelBlobLocation & { contentType: string | null; size: number | null };
  headers: Headers;
};

export type VercelBlobListResult = {
  blobs: Array<VercelBlobLocation & { size: number; uploadedAt: Date }>;
  cursor?: string;
  hasMore?: boolean;
};

export type VercelBlobTokenOptions = {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  validUntil: number;
  addRandomSuffix: false;
  allowOverwrite: false;
  cacheControlMaxAge: number;
  callbackUrl?: string;
  tokenPayload: string;
};

export interface VercelBlobSdk {
  put(
    pathname: string,
    body: Uint8Array,
    options: {
      access: "private";
      token: string;
      contentType: string;
      addRandomSuffix: false;
      allowOverwrite: false;
    },
  ): Promise<VercelBlobDetails>;
  get(
    pathname: string,
    options: { access: "private"; token: string; headers?: HeadersInit },
  ): Promise<VercelBlobGetResult | null>;
  head(pathname: string, options: { token: string }): Promise<VercelBlobDetails & { size: number }>;
  copy(
    sourcePathname: string,
    destinationPathname: string,
    options: {
      access: "private";
      token: string;
      contentType: string;
      addRandomSuffix: false;
      allowOverwrite: false;
    },
  ): Promise<VercelBlobDetails>;
  del(pathname: string, options: { token: string }): Promise<void>;
  list(options: {
    token: string;
    prefix: string;
    cursor?: string;
    limit: number;
    mode: "expanded";
  }): Promise<VercelBlobListResult>;
  handleUpload(options: {
    token: string;
    request: Request;
    body: unknown;
    onBeforeGenerateToken(
      pathname: string,
      clientPayload: string | null,
      multipart: boolean,
    ): Promise<VercelBlobTokenOptions>;
    onUploadCompleted(input: {
      blob: VercelBlobDetails;
      tokenPayload: string | null;
    }): Promise<void>;
  }): Promise<unknown>;
}

export interface VercelBlobObjectStorageConfig {
  token: string;
  callbackOrigin?: string;
  sdk: VercelBlobSdk;
  now?: () => number;
}

type UploadTokenPayload = ClientUploadAuthorization & { schemaVersion: 1 };

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "BlobNotFoundError",
  );
}

function privateBlobLocation<T extends VercelBlobLocation>(
  expectedPathname: string,
  details: T,
): T {
  if (details.pathname !== expectedPathname || !details.etag) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob gaf afwijkende objectmetadata terug.");
  }
  privateBlobUrl(expectedPathname, details.url, false);
  privateBlobUrl(expectedPathname, details.downloadUrl, true);
  return details;
}

function privateBlobUrl(
  expectedPathname: string,
  rawUrl: string,
  download: boolean,
): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob gaf geen geldige private objectlocatie terug.", { cause });
  }
  let returnedPathname: string;
  try {
    returnedPathname = decodeURIComponent(url.pathname.slice(1));
  } catch (cause) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob gaf een ongeldig objectpad terug.", { cause });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search !== (download ? "?download=1" : "") ||
    url.hash ||
    !PRIVATE_BLOB_HOST.test(url.hostname) ||
    returnedPathname !== expectedPathname
  ) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob bevestigde geen private Buildy-locatie.");
  }
}

function privateBlobDetails(
  expectedPathname: string,
  details: VercelBlobDetails,
): VercelBlobDetails {
  privateBlobLocation(expectedPathname, details);
  if (details.contentType.length < 1) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob gaf geen MIME-type terug.");
  }
  return details;
}

function configuredOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch (cause) {
    throw new ObjectStorageError("PROVIDER_ERROR", "De Buildy-origin voor Blob-callbacks is ongeldig.", { cause });
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Blob-callbacks vereisen een kale HTTPS-origin.");
  }
  return origin.origin;
}

function callbackOriginFromBrowserRequest(request: Request): string {
  const requestOrigin = configuredOrigin(new URL(request.url).origin);
  if (request.headers.get("origin") !== requestOrigin) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Blob-tokenaanvraag is niet same-origin.");
  }
  return requestOrigin;
}

function assetIdFromTemporaryPathname(pathname: string): string {
  const safePathname = assertObjectKey(pathname);
  const match = /^temporary\/[0-9a-f]{2}\/([0-9a-f-]{36})$/.exec(safePathname);
  if (!match?.[1] || !UUID.test(match[1])) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY", "Clientuploads vereisen een tijdelijk, opaque assetpad.");
  }
  return match[1];
}

function uploadTokenPayload(value: string | null): UploadTokenPayload {
  if (!value || Buffer.byteLength(value, "utf8") > 1_024) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-callback bevat geen geldige uploadcontext.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (cause) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-callback bevat ongeldige uploadcontext.", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-callback bevat ongeldige uploadcontext.");
  }
  const candidate = parsed as Partial<UploadTokenPayload>;
  const exactKeys = Object.keys(candidate).sort().join(",") === [
    "actorId",
    "assetId",
    "checksumSha256Base64",
    "contentType",
    "maximumBytes",
    "pathname",
    "schemaVersion",
  ].sort().join(",");
  if (
    !exactKeys ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.actorId !== "string" ||
    !UUID.test(candidate.actorId) ||
    typeof candidate.assetId !== "string" ||
    !UUID.test(candidate.assetId) ||
    typeof candidate.pathname !== "string" ||
    typeof candidate.contentType !== "string" ||
    typeof candidate.maximumBytes !== "number" ||
    typeof candidate.checksumSha256Base64 !== "string"
  ) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-callback bevat afwijkende uploadcontext.");
  }
  assertObjectKey(candidate.pathname);
  assertUploadPolicy(candidate.pathname, candidate.contentType, candidate.maximumBytes);
  assertChecksumSha256Base64(candidate.checksumSha256Base64);
  if (assetIdFromTemporaryPathname(candidate.pathname) !== candidate.assetId) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-callback wijst naar een ander asset.");
  }
  return candidate as UploadTokenPayload;
}

function metadataFromDetails(details: VercelBlobDetails & { size: number }): StoredObjectMetadata {
  return {
    key: details.pathname,
    sizeBytes: details.size,
    contentType: details.contentType,
    etag: details.etag.replaceAll('"', ""),
    lastModified: details.uploadedAt,
  };
}

async function boundedStreamBytes(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw new ObjectStorageError("INVALID_SIZE", "Private Blob overschrijdt de leesgrens.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validatedContentLength(headers: Headers): number {
  const raw = headers.get("content-length");
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Private Blob gaf geen geldige inhoudsgrootte terug.");
  }
  return value;
}

function validatedResponseRange(
  value: string | null,
  requested: ObjectByteRange,
  maximumBytes: number,
): { range: ObjectByteRange; totalBytes: number } {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value) : null;
  if (!match) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Private Blob bevestigde het gevraagde bytebereik niet.");
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalBytes = Number(match[3]);
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || !Number.isSafeInteger(totalBytes)
    || start !== requested.start
    || end !== requested.end
    || totalBytes < 1
    || totalBytes > maximumBytes
    || end >= totalBytes
  ) {
    throw new ObjectStorageError("UPLOAD_MISMATCH", "Private Blob gaf een afwijkend bytebereik terug.");
  }
  return { range: { start, end }, totalBytes };
}

export class VercelBlobObjectStorage implements ClientUploadObjectStorage {
  private readonly callbackOrigin: string | undefined;
  private readonly now: () => number;

  constructor(private readonly config: VercelBlobObjectStorageConfig) {
    if (!config.token || Buffer.byteLength(config.token, "utf8") < 32 || /\s/.test(config.token)) {
      throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob-token is onvolledig.");
    }
    if (!config.sdk) throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob-SDK ontbreekt.");
    this.callbackOrigin = config.callbackOrigin
      ? configuredOrigin(config.callbackOrigin)
      : undefined;
    this.now = config.now ?? Date.now;
  }

  async createUploadUrl(input: CreateUploadGrantInput): Promise<UploadGrant> {
    const pathname = assertObjectKey(input.key);
    const assetId = assetIdFromTemporaryPathname(pathname);
    assertChecksumSha256Base64(input.checksumSha256Base64);
    const maximumBytes = assertUploadPolicy(pathname, input.contentType, input.maximumBytes);
    return {
      provider: "vercel_blob",
      method: "POST",
      pathname,
      handleUploadPath: `/api/media/${assetId}/blob-upload`,
      key: pathname,
      maximumBytes,
    };
  }

  async handleClientUpload(input: Parameters<ClientUploadObjectStorage["handleClientUpload"]>[0]): Promise<unknown> {
    return this.config.sdk.handleUpload({
      token: this.config.token,
      request: input.request,
      body: input.body,
      onBeforeGenerateToken: async (pathname, clientPayload, multipart) => {
        if (clientPayload !== null) {
          throw new ObjectStorageError("UPLOAD_MISMATCH", "Clientpayload is niet toegestaan voor mediauploads.");
        }
        if (multipart) {
          throw new ObjectStorageError("INVALID_SIZE", "Multipart is niet nodig binnen de media-uploadgrens.");
        }
        const authorization = await input.authorize(assertObjectKey(pathname));
        if (
          authorization.pathname !== pathname ||
          assetIdFromTemporaryPathname(pathname) !== authorization.assetId
        ) {
          throw new ObjectStorageError("UPLOAD_MISMATCH", "Uploadtoken wijkt af van het geautoriseerde asset.");
        }
        assertUploadPolicy(pathname, authorization.contentType, authorization.maximumBytes);
        assertChecksumSha256Base64(authorization.checksumSha256Base64);
        const callbackOrigin = this.callbackOrigin ?? callbackOriginFromBrowserRequest(input.request);
        return {
          allowedContentTypes: [authorization.contentType],
          maximumSizeInBytes: authorization.maximumBytes,
          validUntil: this.now() + CLIENT_TOKEN_LIFETIME_MS,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          callbackUrl: `${callbackOrigin}/api/media/blob-upload-completed`,
          tokenPayload: JSON.stringify({ schemaVersion: 1, ...authorization }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const authorization = uploadTokenPayload(tokenPayload);
        const safeBlob = privateBlobDetails(authorization.pathname, blob);
        if (safeBlob.contentType !== authorization.contentType) {
          throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-callback bevat een afwijkend MIME-type.");
        }
        const { schemaVersion: _schemaVersion, ...completedUpload } = authorization;
        await input.complete({ ...completedUpload, etag: safeBlob.etag.replaceAll('"', "") });
      },
    });
  }

  async completeUpload(input: CompleteUploadInput): Promise<StoredObjectMetadata> {
    const pathname = assertObjectKey(input.key);
    const expectedChecksum = assertChecksumSha256Base64(input.checksumSha256Base64);
    const maximumBytes = assertUploadPolicy(pathname, input.contentType, input.maximumBytes);
    const object = await this.headObject(pathname);
    if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "Private Blob bestaat niet.");
    if (object.sizeBytes !== maximumBytes || object.contentType !== input.contentType) {
      await this.deleteObject(pathname).catch(() => undefined);
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-metadata komt niet overeen met de uploadintentie.");
    }
    const bytes = await this.readObject(pathname, maximumBytes);
    const actualChecksum = createHash("sha256").update(bytes).digest("base64");
    if (actualChecksum !== expectedChecksum) {
      await this.deleteObject(pathname).catch(() => undefined);
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-bytes komen niet overeen met de uploadintentie.");
    }
    return { ...object, checksumSha256Base64: actualChecksum };
  }

  async createDownloadUrl(_input: CreateDownloadGrantInput): Promise<DownloadGrant> {
    throw new ObjectStorageError(
      "PROVIDER_ERROR",
      "Private Blob wordt uitsluitend via een geautoriseerde same-origin route geleverd.",
    );
  }

  async streamObject(input: StreamObjectInput): Promise<StreamedObject> {
    const pathname = assertObjectKey(input.key);
    const safeMaximum = assertMaximumBytes(input.maximumBytes, MAX_READ_BYTES);
    const requestedRange = input.range;
    if (
      requestedRange
      && (
        !Number.isSafeInteger(requestedRange.start)
        || !Number.isSafeInteger(requestedRange.end)
        || requestedRange.start < 0
        || requestedRange.end < requestedRange.start
        || requestedRange.end >= safeMaximum
      )
    ) {
      throw new ObjectStorageError("INVALID_SIZE", "Het gevraagde bytebereik is ongeldig.");
    }

    try {
      const result = await this.config.sdk.get(pathname, {
        access: "private",
        token: this.config.token,
        ...(requestedRange
          ? { headers: { range: `bytes=${requestedRange.start}-${requestedRange.end}` } }
          : {}),
      });
      if (!result) {
        throw new ObjectStorageError("OBJECT_NOT_FOUND", "Private Blob bestaat niet.");
      }
      if (result.statusCode !== 200 || !result.stream) {
        throw new ObjectStorageError("PROVIDER_ERROR", "Private Blob gaf geen leesbare inhoud terug.");
      }
      privateBlobLocation(pathname, result.blob);
      if (typeof result.blob.contentType !== "string") {
        throw new ObjectStorageError("UPLOAD_MISMATCH", "Private Blob gaf geen MIME-type terug.");
      }

      const contentLength = validatedContentLength(result.headers);
      let totalBytes: number;
      let range: ObjectByteRange | undefined;
      if (requestedRange) {
        const validated = validatedResponseRange(
          result.headers.get("content-range"),
          requestedRange,
          safeMaximum,
        );
        totalBytes = validated.totalBytes;
        range = validated.range;
        if (
          contentLength !== range.end - range.start + 1
          || result.blob.size !== contentLength
        ) {
          throw new ObjectStorageError("UPLOAD_MISMATCH", "Private Blob gaf een afwijkende deelgrootte terug.");
        }
      } else {
        if (result.headers.has("content-range")) {
          throw new ObjectStorageError("UPLOAD_MISMATCH", "Private Blob gaf onverwacht gedeeltelijke inhoud terug.");
        }
        totalBytes = contentLength;
        if (result.blob.size !== totalBytes || totalBytes > safeMaximum) {
          throw new ObjectStorageError("INVALID_SIZE", "Private Blob overschrijdt de leesgrens.");
        }
      }

      assertUploadPolicy(pathname, result.blob.contentType, totalBytes);
      return {
        metadata: {
          key: pathname,
          sizeBytes: totalBytes,
          contentType: result.blob.contentType,
          etag: result.blob.etag.replaceAll('"', ""),
          lastModified: result.blob.uploadedAt,
        },
        stream: result.stream,
        contentLength,
        range,
      };
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      if (isNotFound(error)) throw new ObjectStorageError("OBJECT_NOT_FOUND", "Private Blob bestaat niet.");
      throw new ObjectStorageError("PROVIDER_ERROR", "Private Blob kon niet veilig worden gestreamd.", { cause: error });
    }
  }

  async readObject(keyInput: string, maximumBytes: number): Promise<Uint8Array> {
    const pathname = assertObjectKey(keyInput);
    const safeMaximum = assertMaximumBytes(maximumBytes, MAX_READ_BYTES);
    const object = await this.streamObject({ key: pathname, maximumBytes: safeMaximum });
    const bytes = await boundedStreamBytes(object.stream, safeMaximum);
    if (bytes.byteLength !== object.contentLength) {
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Blob-inhoud heeft een afwijkende grootte.");
    }
    return bytes;
  }

  private async verifiedExistingObject(
    pathname: string,
    contentType: string,
    expectedBytes: Uint8Array,
    checksumSha256Base64: string,
  ): Promise<StoredObjectMetadata | null> {
    const existing = await this.headObject(pathname);
    if (!existing) return null;
    if (
      existing.contentType !== contentType
      || existing.sizeBytes !== expectedBytes.byteLength
    ) {
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Een immutable Blobkey bevat al een ander object.");
    }
    const actualBytes = await this.readObject(pathname, existing.sizeBytes);
    const actualChecksum = createHash("sha256").update(actualBytes).digest("base64");
    if (actualChecksum !== checksumSha256Base64) {
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Een immutable Blobkey bevat al afwijkende bytes.");
    }
    return { ...existing, checksumSha256Base64: actualChecksum };
  }

  async writeObject(input: WriteObjectInput): Promise<StoredObjectMetadata> {
    const pathname = assertObjectKey(input.key);
    assertUploadPolicy(pathname, input.contentType, input.bytes.byteLength);
    const checksum = createHash("sha256").update(input.bytes).digest("base64");
    const existing = await this.verifiedExistingObject(
      pathname,
      input.contentType,
      input.bytes,
      checksum,
    );
    if (existing) return existing;
    try {
      privateBlobDetails(pathname, await this.config.sdk.put(pathname, input.bytes, {
        access: "private",
        token: this.config.token,
        contentType: input.contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      }));
      return await this.completeUpload({
        key: pathname,
        contentType: input.contentType,
        checksumSha256Base64: checksum,
        maximumBytes: input.bytes.byteLength,
      });
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      const racedObject = await this.verifiedExistingObject(
        pathname,
        input.contentType,
        input.bytes,
        checksum,
      ).catch(() => null);
      if (racedObject) return racedObject;
      throw new ObjectStorageError("PROVIDER_ERROR", "Serverobject kon niet naar private Blob worden geschreven.", { cause: error });
    }
  }

  async headObject(keyInput: string): Promise<StoredObjectMetadata | null> {
    const pathname = assertObjectKey(keyInput);
    try {
      const details = privateBlobDetails(
        pathname,
        await this.config.sdk.head(pathname, { token: this.config.token }),
      );
      if (!Number.isSafeInteger(details.size) || (details.size ?? 0) < 1) {
        throw new ObjectStorageError("PROVIDER_ERROR", "Vercel Blob gaf een ongeldige objectgrootte terug.");
      }
      return metadataFromDetails(details as VercelBlobDetails & { size: number });
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError("PROVIDER_ERROR", "Private Blob-metadata kon niet worden gelezen.", { cause: error });
    }
  }

  async copyObject(sourceKeyInput: string, destinationKeyInput: string): Promise<void> {
    const sourcePathname = assertObjectKey(sourceKeyInput);
    const destinationPathname = assertObjectKey(destinationKeyInput);
    const source = await this.headObject(sourcePathname);
    if (!source) throw new ObjectStorageError("OBJECT_NOT_FOUND", "Bron-Blob bestaat niet.");
    assertUploadPolicy(destinationPathname, source.contentType, source.sizeBytes);
    const sourceBytes = await this.readObject(sourcePathname, source.sizeBytes);
    const sourceChecksum = createHash("sha256").update(sourceBytes).digest("base64");
    const existing = await this.verifiedExistingObject(
      destinationPathname,
      source.contentType,
      sourceBytes,
      sourceChecksum,
    );
    if (existing) return;
    try {
      privateBlobDetails(destinationPathname, await this.config.sdk.copy(
        sourcePathname,
        destinationPathname,
        {
          access: "private",
          token: this.config.token,
          contentType: source.contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
        },
      ));
      await this.completeUpload({
        key: destinationPathname,
        contentType: source.contentType,
        checksumSha256Base64: sourceChecksum,
        maximumBytes: source.sizeBytes,
      });
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      const racedObject = await this.verifiedExistingObject(
        destinationPathname,
        source.contentType,
        sourceBytes,
        sourceChecksum,
      ).catch(() => null);
      if (racedObject) return;
      throw new ObjectStorageError("PROVIDER_ERROR", "Private Blob kon niet worden gekopieerd.", { cause: error });
    }
  }

  async deleteObject(keyInput: string): Promise<void> {
    const pathname = assertObjectKey(keyInput);
    try {
      await this.config.sdk.del(pathname, { token: this.config.token });
    } catch (error) {
      throw new ObjectStorageError("PROVIDER_ERROR", "Private Blob kon niet worden verwijderd.", { cause: error });
    }
  }

  async listObjects(prefix: ObjectPurpose, cursor?: string): Promise<ObjectPage> {
    try {
      const result = await this.config.sdk.list({
        token: this.config.token,
        prefix: `${prefix}/`,
        cursor,
        limit: 250,
        mode: "expanded",
      });
      const objects = result.blobs.map((details) => {
        const pathname = assertObjectKey(details.pathname);
        privateBlobLocation(pathname, details);
        if (!Number.isSafeInteger(details.size) || details.size < 1) {
          throw new ObjectStorageError("PROVIDER_ERROR", "Blob-lijst bevat een ongeldige objectgrootte.");
        }
        return {
          key: pathname,
          sizeBytes: details.size,
          contentType: "application/octet-stream",
          etag: details.etag.replaceAll('"', ""),
          lastModified: details.uploadedAt,
        } satisfies StoredObjectMetadata;
      });
      if (result.hasMore && !result.cursor) {
        throw new ObjectStorageError("PROVIDER_ERROR", "Blob-paginering bevat geen vervolgcursor.");
      }
      return { objects, cursor: result.hasMore ? result.cursor : undefined };
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError("PROVIDER_ERROR", "Private Blob-lijst kon niet worden gelezen.", { cause: error });
    }
  }

  async getChecksum(keyInput: string): Promise<string | undefined> {
    const pathname = assertObjectKey(keyInput);
    const metadata = await this.headObject(pathname);
    if (!metadata) return undefined;
    const bytes = await this.readObject(pathname, metadata.sizeBytes);
    return createHash("sha256").update(bytes).digest("base64");
  }
}

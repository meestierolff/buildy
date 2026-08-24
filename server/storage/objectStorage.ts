import { createHash } from "node:crypto";

export const OBJECT_PURPOSES = [
  "originals",
  "display",
  "avatars",
  "floorplans",
  "photobook-pdfs",
  "exports",
  "temporary",
] as const;

export type ObjectPurpose = (typeof OBJECT_PURPOSES)[number];

export interface StoredObjectMetadata {
  key: string;
  sizeBytes: number;
  contentType: string;
  checksumSha256Base64?: string;
  etag?: string;
  lastModified?: Date;
}

export interface VercelBlobClientUploadGrant {
  provider: "vercel_blob";
  method: "POST";
  pathname: string;
  handleUploadPath: string;
  key: string;
  maximumBytes: number;
}

export type UploadGrant = VercelBlobClientUploadGrant;

export interface DownloadGrant {
  method: "GET";
  url: string;
  key: string;
  expiresAt: string;
}

export interface CreateUploadGrantInput {
  key: string;
  contentType: string;
  checksumSha256Base64: string;
  maximumBytes: number;
  expiresInSeconds?: number;
}

export interface CompleteUploadInput {
  key: string;
  contentType: string;
  checksumSha256Base64: string;
  maximumBytes: number;
}

export interface WriteObjectInput {
  key: string;
  contentType: string;
  bytes: Uint8Array;
}

export type ObjectByteRange = {
  start: number;
  end: number;
};

export interface StreamObjectInput {
  key: string;
  maximumBytes: number;
  range?: ObjectByteRange;
}

export interface StreamedObject {
  metadata: StoredObjectMetadata;
  stream: ReadableStream<Uint8Array>;
  contentLength: number;
  range?: ObjectByteRange;
}

export interface CreateDownloadGrantInput {
  key: string;
  filename?: string;
  disposition?: "inline" | "attachment";
  expiresInSeconds?: number;
}

export interface ObjectPage {
  objects: StoredObjectMetadata[];
  cursor?: string;
}

export interface ObjectStorage {
  createUploadUrl(input: CreateUploadGrantInput): Promise<UploadGrant>;
  completeUpload(input: CompleteUploadInput): Promise<StoredObjectMetadata>;
  createDownloadUrl(input: CreateDownloadGrantInput): Promise<DownloadGrant>;
  streamObject(input: StreamObjectInput): Promise<StreamedObject>;
  readObject(key: string, maximumBytes: number): Promise<Uint8Array>;
  writeObject(input: WriteObjectInput): Promise<StoredObjectMetadata>;
  headObject(key: string): Promise<StoredObjectMetadata | null>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: ObjectPurpose, cursor?: string): Promise<ObjectPage>;
  getChecksum(key: string): Promise<string | undefined>;
}

export function guardObjectStream(input: {
  stream: ReadableStream<Uint8Array>;
  expectedBytes: number;
  expectedSha256Hex?: string;
}): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 1) {
    throw new ObjectStorageError("INVALID_SIZE", "De verwachte streamgrootte is ongeldig.");
  }
  if (
    input.expectedSha256Hex !== undefined
    && !/^[0-9a-f]{64}$/.test(input.expectedSha256Hex)
  ) {
    throw new ObjectStorageError("INVALID_CHECKSUM", "De verwachte streamchecksum is ongeldig.");
  }

  const reader = input.stream.getReader();
  const hash = input.expectedSha256Hex ? createHash("sha256") : undefined;
  let receivedBytes = 0;
  let finished = false;

  const release = () => {
    if (finished) return;
    finished = true;
    reader.releaseLock();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          if (receivedBytes !== input.expectedBytes) {
            throw new ObjectStorageError("UPLOAD_MISMATCH", "Objectstream heeft een afwijkende grootte.");
          }
          if (hash && hash.digest("hex") !== input.expectedSha256Hex) {
            throw new ObjectStorageError("UPLOAD_MISMATCH", "Objectstream heeft een afwijkende checksum.");
          }
          release();
          controller.close();
          return;
        }
        receivedBytes += result.value.byteLength;
        if (receivedBytes > input.expectedBytes) {
          throw new ObjectStorageError("UPLOAD_MISMATCH", "Objectstream overschrijdt de verwachte grootte.");
        }
        hash?.update(result.value);
        controller.enqueue(result.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      release();
    },
  });
}

export type ClientUploadAuthorization = {
  actorId: string;
  assetId: string;
  pathname: string;
  contentType: string;
  maximumBytes: number;
  checksumSha256Base64: string;
};

export type CompletedClientUpload = ClientUploadAuthorization & {
  etag: string;
};

export interface ClientUploadObjectStorage extends ObjectStorage {
  handleClientUpload(input: {
    request: Request;
    body: unknown;
    authorize(pathname: string): Promise<ClientUploadAuthorization>;
    complete(upload: CompletedClientUpload): Promise<void>;
  }): Promise<unknown>;
}

export function supportsClientUpload(storage: ObjectStorage): storage is ClientUploadObjectStorage {
  return "handleClientUpload" in storage && typeof storage.handleClientUpload === "function";
}

export class ObjectStorageError extends Error {
  constructor(
    public readonly code:
      | "INVALID_OBJECT_KEY"
      | "INVALID_CONTENT_TYPE"
      | "INVALID_CHECKSUM"
      | "INVALID_SIZE"
      | "OBJECT_NOT_FOUND"
      | "UPLOAD_MISMATCH"
      | "PROVIDER_ERROR",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ObjectStorageError";
  }
}

const OPAQUE_OBJECT_KEY = /^(originals|display|avatars|floorplans|photobook-pdfs|exports|temporary)\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/[a-z0-9][a-z0-9._-]{0,79})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

const UPLOAD_POLICIES: Record<ObjectPurpose, { maximumBytes: number; contentTypes: ReadonlySet<string> }> = {
  originals: {
    maximumBytes: 50 * 1024 * 1024,
    contentTypes: new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]),
  },
  display: {
    maximumBytes: 15 * 1024 * 1024,
    contentTypes: new Set(["image/webp", "image/avif", "image/jpeg"]),
  },
  avatars: {
    maximumBytes: 10 * 1024 * 1024,
    contentTypes: new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]),
  },
  floorplans: {
    maximumBytes: 30 * 1024 * 1024,
    contentTypes: new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  },
  "photobook-pdfs": {
    maximumBytes: 150 * 1024 * 1024,
    contentTypes: new Set(["application/pdf"]),
  },
  exports: {
    maximumBytes: 250 * 1024 * 1024,
    contentTypes: new Set(["application/zip"]),
  },
  temporary: {
    maximumBytes: 50 * 1024 * 1024,
    contentTypes: new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/heic",
      "image/heif",
      "application/pdf",
    ]),
  },
};

export function createObjectKey(
  purpose: ObjectPurpose,
  assetId: string,
  variant?: string,
): string {
  const normalizedId = assetId.toLowerCase();
  if (!UUID.test(normalizedId)) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY", "Asset-ID is geen geldige UUID.");
  }

  if (variant && !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(variant)) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY", "Objectvariant bevat onveilige tekens.");
  }

  return `${purpose}/${normalizedId.slice(0, 2)}/${normalizedId}${variant ? `/${variant}` : ""}`;
}

export function assertObjectKey(key: string): string {
  if (!OPAQUE_OBJECT_KEY.test(key) || key.includes("..") || key.includes("\\")) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY", "Objectkey valt buiten de Buildy-namespace.");
  }
  return key;
}

export function assertChecksumSha256Base64(checksum: string): string {
  if (!SHA256_BASE64.test(checksum)) {
    throw new ObjectStorageError("INVALID_CHECKSUM", "SHA-256-checksum moet base64-gecodeerd zijn.");
  }
  return checksum;
}

export function assertMaximumBytes(size: number, ceiling = 50 * 1024 * 1024): number {
  if (!Number.isSafeInteger(size) || size < 1 || size > ceiling) {
    throw new ObjectStorageError("INVALID_SIZE", "Bestandsgrootte valt buiten de toegestane grens.");
  }
  return size;
}

export function assertUploadPolicy(key: string, contentType: string, maximumBytes: number): number {
  const safeKey = assertObjectKey(key);
  const purpose = safeKey.slice(0, safeKey.indexOf("/")) as ObjectPurpose;
  const policy = UPLOAD_POLICIES[purpose];
  if (!policy.contentTypes.has(contentType)) {
    throw new ObjectStorageError("INVALID_CONTENT_TYPE", "MIME-type is niet toegestaan voor dit mediatype.");
  }
  return assertMaximumBytes(maximumBytes, policy.maximumBytes);
}

export function assertSafeContentDispositionFilename(filename: string): string {
  const normalized = filename.normalize("NFC").trim();
  const containsUnsafeCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 || ['"', "\\", "/"].includes(character);
  });
  if (
    normalized.length < 1 ||
    normalized.length > 120 ||
    containsUnsafeCharacter
  ) {
    throw new ObjectStorageError("INVALID_OBJECT_KEY", "Downloadnaam bevat onveilige tekens.");
  }
  return normalized;
}

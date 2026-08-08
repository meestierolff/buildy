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

export interface UploadGrant {
  method: "PUT";
  url: string;
  key: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
  maximumBytes: number;
}

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

export interface CreateDownloadGrantInput {
  key: string;
  filename?: string;
  disposition?: "inline" | "attachment";
  expiresInSeconds?: number;
  grantPurpose?: "interactive_download" | "provider_fulfilment";
}

export interface ObjectPage {
  objects: StoredObjectMetadata[];
  cursor?: string;
}

export interface ObjectStorage {
  createUploadUrl(input: CreateUploadGrantInput): Promise<UploadGrant>;
  completeUpload(input: CompleteUploadInput): Promise<StoredObjectMetadata>;
  createDownloadUrl(input: CreateDownloadGrantInput): Promise<DownloadGrant>;
  readObject(key: string, maximumBytes: number): Promise<Uint8Array>;
  writeObject(input: WriteObjectInput): Promise<StoredObjectMetadata>;
  headObject(key: string): Promise<StoredObjectMetadata | null>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: ObjectPurpose, cursor?: string): Promise<ObjectPage>;
  getChecksum(key: string): Promise<string | undefined>;
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

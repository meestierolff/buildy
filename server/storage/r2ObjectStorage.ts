import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectStorageError,
  assertChecksumSha256Base64,
  assertMaximumBytes,
  assertObjectKey,
  assertSafeContentDispositionFilename,
  assertUploadPolicy,
  type CompleteUploadInput,
  type CreateDownloadGrantInput,
  type CreateUploadGrantInput,
  type DownloadGrant,
  type ObjectPage,
  type ObjectPurpose,
  type ObjectStorage,
  type StoredObjectMetadata,
  type UploadGrant,
  type WriteObjectInput,
} from "./objectStorage.js";

export interface R2ObjectStorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

const UPLOAD_EXPIRY_SECONDS = 5 * 60;
const DOWNLOAD_EXPIRY_SECONDS = 60;
const MAX_INTERACTIVE_EXPIRY_SECONDS = 15 * 60;
const MAX_PROVIDER_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

function assertExpiry(value: number | undefined, fallback: number, maximum: number): number {
  const expiry = value ?? fallback;
  if (!Number.isSafeInteger(expiry) || expiry < 1 || expiry > maximum) {
    throw new ObjectStorageError("PROVIDER_ERROR", "Signed-URL-vervaltijd valt buiten de veiligheidsgrens.");
  }
  return expiry;
}

function expiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1_000).toISOString();
}

function encodeCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function metadataFromHead(key: string, output: HeadObjectCommandOutput): StoredObjectMetadata {
  if (typeof output.ContentLength !== "number" || !output.ContentType) {
    throw new ObjectStorageError("PROVIDER_ERROR", "R2 gaf onvolledige objectmetadata terug.");
  }

  return {
    key,
    sizeBytes: output.ContentLength,
    contentType: output.ContentType,
    checksumSha256Base64: output.Metadata?.["buildy-sha256"],
    etag: output.ETag?.replaceAll('"', ""),
    lastModified: output.LastModified,
  };
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: R2ObjectStorageConfig) {
    if (![config.accountId, config.accessKeyId, config.secretAccessKey, config.bucketName].every(Boolean)) {
      throw new ObjectStorageError("PROVIDER_ERROR", "R2-configuratie is onvolledig.");
    }

    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUploadUrl(input: CreateUploadGrantInput): Promise<UploadGrant> {
    const key = assertObjectKey(input.key);
    const checksum = assertChecksumSha256Base64(input.checksumSha256Base64);
    const maximumBytes = assertUploadPolicy(key, input.contentType, input.maximumBytes);
    const expiry = assertExpiry(
      input.expiresInSeconds,
      UPLOAD_EXPIRY_SECONDS,
      MAX_INTERACTIVE_EXPIRY_SECONDS,
    );

    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ContentLength: maximumBytes,
      ContentType: input.contentType,
      Metadata: { "buildy-sha256": checksum },
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: expiry });

    return {
      method: "PUT",
      url,
      key,
      expiresAt: expiresAt(expiry),
      requiredHeaders: {
        "content-length": String(maximumBytes),
        "content-type": input.contentType,
        "x-amz-meta-buildy-sha256": checksum,
      },
      maximumBytes,
    };
  }

  async completeUpload(input: CompleteUploadInput): Promise<StoredObjectMetadata> {
    const key = assertObjectKey(input.key);
    const expectedChecksum = assertChecksumSha256Base64(input.checksumSha256Base64);
    const maximumBytes = assertUploadPolicy(key, input.contentType, input.maximumBytes);
    const object = await this.headObject(key);

    if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "Uploadobject bestaat niet.");
    if (
      object.sizeBytes !== maximumBytes ||
      object.contentType !== input.contentType ||
      object.checksumSha256Base64 !== expectedChecksum
    ) {
      await this.deleteObject(key).catch(() => undefined);
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Uploadmetadata komt niet overeen met de uploadgrant.");
    }
    const actualChecksum = await this.getChecksum(key);
    if (actualChecksum !== expectedChecksum) {
      await this.deleteObject(key).catch(() => undefined);
      throw new ObjectStorageError("UPLOAD_MISMATCH", "Uploadchecksum komt niet overeen met de uploadgrant.");
    }

    return object;
  }

  async createDownloadUrl(input: CreateDownloadGrantInput): Promise<DownloadGrant> {
    const key = assertObjectKey(input.key);
    const providerGrant = input.grantPurpose === "provider_fulfilment";
    const expiry = assertExpiry(
      input.expiresInSeconds,
      DOWNLOAD_EXPIRY_SECONDS,
      providerGrant ? MAX_PROVIDER_EXPIRY_SECONDS : MAX_INTERACTIVE_EXPIRY_SECONDS,
    );
    const disposition = input.disposition ?? "inline";
    const filename = input.filename ? assertSafeContentDispositionFilename(input.filename) : undefined;
    const responseContentDisposition = filename
      ? `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
      : disposition;
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    });

    return {
      method: "GET",
      url: await getSignedUrl(this.client, command, { expiresIn: expiry }),
      key,
      expiresAt: expiresAt(expiry),
    };
  }

  async readObject(keyInput: string, maximumBytes: number): Promise<Uint8Array> {
    const key = assertObjectKey(keyInput);
    const object = await this.headObject(key);
    if (!object) throw new ObjectStorageError("OBJECT_NOT_FOUND", "R2-object bestaat niet.");
    assertUploadPolicy(key, object.contentType, object.sizeBytes);
    const safeMaximum = assertMaximumBytes(maximumBytes, 512 * 1024 * 1024);
    if (object.sizeBytes > safeMaximum) {
      throw new ObjectStorageError("INVALID_SIZE", "R2-object overschrijdt de leesgrens.");
    }

    try {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
      }));
      if (!output.Body) throw new ObjectStorageError("OBJECT_NOT_FOUND", "R2-object heeft geen inhoud.");

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const reader = output.Body.transformToWebStream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > safeMaximum) {
            throw new ObjectStorageError("INVALID_SIZE", "R2-object overschrijdt de leesgrens.");
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
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      if (isNotFound(error)) throw new ObjectStorageError("OBJECT_NOT_FOUND", "R2-object bestaat niet.");
      throw new ObjectStorageError("PROVIDER_ERROR", "R2-object kon niet veilig worden gelezen.", { cause: error });
    }
  }

  async writeObject(input: WriteObjectInput): Promise<StoredObjectMetadata> {
    const key = assertObjectKey(input.key);
    assertUploadPolicy(key, input.contentType, input.bytes.byteLength);
    const checksum = createHash("sha256").update(input.bytes).digest("base64");

    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        Body: input.bytes,
        ContentLength: input.bytes.byteLength,
        ContentType: input.contentType,
        Metadata: { "buildy-sha256": checksum },
      }));
      const object = await this.headObject(key);
      if (
        !object ||
        object.sizeBytes !== input.bytes.byteLength ||
        object.contentType !== input.contentType ||
        object.checksumSha256Base64 !== checksum
      ) {
        throw new ObjectStorageError("UPLOAD_MISMATCH", "Serverobject is niet correct door R2 bevestigd.");
      }
      return object;
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError("PROVIDER_ERROR", "Serverobject kon niet naar R2 worden geschreven.", { cause: error });
    }
  }

  async headObject(keyInput: string): Promise<StoredObjectMetadata | null> {
    const key = assertObjectKey(keyInput);
    try {
      const output = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
      }));
      return metadataFromHead(key, output);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new ObjectStorageError("PROVIDER_ERROR", "R2-objectmetadata kon niet worden gelezen.", { cause: error });
    }
  }

  async copyObject(sourceKeyInput: string, destinationKeyInput: string): Promise<void> {
    const sourceKey = assertObjectKey(sourceKeyInput);
    const destinationKey = assertObjectKey(destinationKeyInput);
    await this.client.send(new CopyObjectCommand({
      Bucket: this.config.bucketName,
      Key: destinationKey,
      CopySource: encodeCopySource(this.config.bucketName, sourceKey),
      MetadataDirective: "COPY",
    }));
  }

  async deleteObject(keyInput: string): Promise<void> {
    const key = assertObjectKey(keyInput);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucketName, Key: key }));
  }

  async listObjects(prefix: ObjectPurpose, cursor?: string): Promise<ObjectPage> {
    const output = await this.client.send(new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: `${prefix}/`,
      ContinuationToken: cursor,
      MaxKeys: 250,
    }));

    const objects = (output.Contents ?? []).flatMap((entry) => {
      if (!entry.Key || typeof entry.Size !== "number") return [];
      return [{
        key: assertObjectKey(entry.Key),
        sizeBytes: entry.Size,
        contentType: "application/octet-stream",
        etag: entry.ETag?.replaceAll('"', ""),
        lastModified: entry.LastModified,
      } satisfies StoredObjectMetadata];
    });

    return { objects, cursor: output.NextContinuationToken };
  }

  async getChecksum(key: string): Promise<string | undefined> {
    const safeKey = assertObjectKey(key);
    try {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: safeKey,
      }));
      if (!output.Body) throw new ObjectStorageError("PROVIDER_ERROR", "R2-object heeft geen leesbare inhoud.");
      const hash = createHash("sha256");
      const reader = output.Body.transformToWebStream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
        }
      } finally {
        reader.releaseLock();
      }
      return hash.digest("base64");
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      if (isNotFound(error)) return undefined;
      throw new ObjectStorageError("PROVIDER_ERROR", "R2-checksum kon niet worden berekend.", { cause: error });
    }
  }
}

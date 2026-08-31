import {
  mediaUploadCompletionResponseSchema,
  mediaUploadIntentResponseSchema,
  projectImageContentTypeSchema,
  sha256Base64Schema,
  type MediaAssetState,
  type MediaUploadPurpose,
  type ProjectImageContentType,
} from "../../shared/contracts/media";
import { apiRequest } from "./apiClient";
import { prepareUpload } from "./compressImage";

const MAX_PROJECT_IMAGE_BYTES = 50 * 1024 * 1024;
const DEFAULT_READY_TIMEOUT_MS = 2 * 60 * 1_000;
const DEFAULT_POLL_DELAY_MS = 1_000;
const MAX_POLL_DELAY_MS = 5_000;
const PRIVATE_BLOB_HOST = /^[a-z0-9]+\.private\.blob\.vercel-storage\.com$/;

export type PreparedProjectImage = {
  file: File;
  contentType: ProjectImageContentType;
  sizeBytes: number;
  checksumSha256Base64: string;
};

export type ProjectMediaUploadStage = "uploading" | "processing" | "ready";

export type PrivateProjectImageUploadInput = {
  projectId: string;
  idempotencyKey: string;
  prepared: PreparedProjectImage;
  signal?: AbortSignal;
  onStage?: (stage: ProjectMediaUploadStage) => void;
};

export class PrivateMediaUploadError extends Error {
  constructor(
    public readonly code:
      | "UNSUPPORTED_FILE"
      | "CHECKSUM_UNAVAILABLE"
      | "UNSAFE_UPLOAD_GRANT"
      | "UPLOAD_FAILED"
      | "PROCESSING_FAILED"
      | "PROCESSING_TIMEOUT"
      | "READINESS_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrivateMediaUploadError";
  }
}

export function isSupportedProjectImageType(value: string): value is ProjectImageContentType {
  return projectImageContentTypeSchema.safeParse(value).success;
}

export async function browserSha256Base64(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new PrivateMediaUploadError(
      "CHECKSUM_UNAVAILABLE",
      "Deze browser kan de foto niet veilig controleren.",
    );
  }

  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const bytes = new Uint8Array(digest);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } catch (cause) {
    throw new PrivateMediaUploadError(
      "CHECKSUM_UNAVAILABLE",
      "De foto kon niet veilig worden gecontroleerd. Probeer het opnieuw.",
      { cause },
    );
  }
}

export async function preparePrivateProjectImage(file: File): Promise<PreparedProjectImage> {
  if (!isSupportedProjectImageType(file.type)) {
    throw new PrivateMediaUploadError(
      "UNSUPPORTED_FILE",
      `${file.name} heeft geen ondersteund fotoformaat. Gebruik JPG, PNG, WebP, AVIF, HEIC of HEIF.`,
    );
  }

  let prepared: File;
  try {
    prepared = await prepareUpload(file);
  } catch (cause) {
    throw new PrivateMediaUploadError(
      "UNSUPPORTED_FILE",
      cause instanceof Error ? cause.message : "De foto kon niet veilig worden voorbereid.",
      { cause },
    );
  }

  if (
    !isSupportedProjectImageType(prepared.type) ||
    !Number.isSafeInteger(prepared.size) ||
    prepared.size < 1 ||
    prepared.size > MAX_PROJECT_IMAGE_BYTES
  ) {
    throw new PrivateMediaUploadError(
      "UNSUPPORTED_FILE",
      `${file.name} valt buiten de veilige uploadgrenzen.`,
    );
  }

  return {
    file: prepared,
    contentType: prepared.type,
    sizeBytes: prepared.size,
    checksumSha256Base64: await browserSha256Base64(prepared),
  };
}

type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export type VercelBlobBrowserUpload = (
  pathname: string,
  body: Blob,
  options: {
    access: "private";
    handleUploadUrl: string;
    contentType: string;
    multipart: false;
    abortSignal?: AbortSignal;
  },
) => Promise<{
  pathname: string;
  contentType: string;
  url: string;
  downloadUrl: string;
  etag: string;
}>;

let configuredBlobUpload: VercelBlobBrowserUpload | undefined;

/** Integration seam for the official `upload` export from `@vercel/blob/client`. */
export function configureVercelBlobClientUpload(upload: VercelBlobBrowserUpload): void {
  if (configuredBlobUpload) throw new Error("De Vercel Blob-clientupload is al geconfigureerd.");
  configuredBlobUpload = upload;
}

export function resetVercelBlobClientUploadForTests(): void {
  configuredBlobUpload = undefined;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Afgebroken", "AbortError"));
      return;
    }
    const handleAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Afgebroken", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

type MediaUploadRuntime = {
  fetch?: typeof globalThis.fetch;
  blobUpload?: VercelBlobBrowserUpload;
  now?: () => number;
  sleep?: Sleep;
  readyTimeoutMs?: number;
  initialPollDelayMs?: number;
  maximumPollDelayMs?: number;
};

function assertPrivateBlobResult(
  result: Awaited<ReturnType<VercelBlobBrowserUpload>>,
  pathname: string,
  contentType: ProjectImageContentType,
): void {
  const assertPrivateUrl = (rawUrl: string, download: boolean): void => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch (cause) {
      throw new PrivateMediaUploadError(
        "UNSAFE_UPLOAD_GRANT",
        "De opslagprovider bevestigde geen geldige private upload.",
        { cause },
      );
    }
    let returnedPathname = "";
    try {
      returnedPathname = decodeURIComponent(url.pathname.slice(1));
    } catch (cause) {
      throw new PrivateMediaUploadError(
        "UNSAFE_UPLOAD_GRANT",
        "De opslagprovider bevestigde een ongeldig objectpad.",
        { cause },
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search !== (download ? "?download=1" : "") ||
      url.hash ||
      !PRIVATE_BLOB_HOST.test(url.hostname) ||
      returnedPathname !== pathname
    ) {
      throw new PrivateMediaUploadError(
        "UNSAFE_UPLOAD_GRANT",
        "De opslagprovider bevestigde geen private Buildy-upload.",
      );
    }
  };

  assertPrivateUrl(result.url, false);
  assertPrivateUrl(result.downloadUrl, true);

  if (
    result.pathname !== pathname ||
    result.contentType !== contentType ||
    !result.etag
  ) {
    throw new PrivateMediaUploadError(
      "UNSAFE_UPLOAD_GRANT",
      "De opslagprovider bevestigde geen private Buildy-upload.",
    );
  }
}

export async function waitForProjectMediaReady(
  assetId: string,
  options: MediaUploadRuntime & { signal?: AbortSignal } = {},
): Promise<void> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeout = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const startedAt = now();
  let delay = options.initialPollDelayMs ?? DEFAULT_POLL_DELAY_MS;
  const maximumDelay = options.maximumPollDelayMs ?? MAX_POLL_DELAY_MS;

  while (now() - startedAt < timeout) {
    let processingResponseLost = false;
    try {
      const response = await fetcher(`/api/media/${encodeURIComponent(assetId)}/complete`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: "{}",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: options.signal,
      });
      if (response.ok) {
        const parsed = mediaUploadCompletionResponseSchema.safeParse(
          await response.json().catch(() => undefined),
        );
        if (!parsed.success || parsed.data.data.asset.id !== assetId) {
          throw new PrivateMediaUploadError(
            "READINESS_FAILED",
            "De verwerkingsstatus van de foto kon niet veilig worden gecontroleerd.",
          );
        }
        if (parsed.data.data.asset.status === "ready") return;
        if (parsed.data.data.asset.status === "failed") {
          throw new PrivateMediaUploadError(
            "PROCESSING_FAILED",
            "Deze foto kon niet veilig worden verwerkt.",
          );
        }
      } else if (response.status === 404) {
        throw new PrivateMediaUploadError(
          "PROCESSING_FAILED",
          "Deze foto kon niet veilig worden verwerkt.",
        );
      } else if (response.status !== 429 && response.status < 500) {
        throw new PrivateMediaUploadError(
          "READINESS_FAILED",
          "De verwerkingsstatus van de foto kon niet veilig worden gecontroleerd.",
        );
      }
    } catch (cause) {
      if (cause instanceof PrivateMediaUploadError || options.signal?.aborted) throw cause;
      processingResponseLost = true;
    }

    try {
      const response = await fetcher(`/api/media/${encodeURIComponent(assetId)}?size=small`, {
        method: "HEAD",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: options.signal,
      });
      if (response.ok) return;
      if (response.status !== 404 && response.status !== 429 && response.status < 500) {
        throw new PrivateMediaUploadError(
          "READINESS_FAILED",
          "De verwerkingsstatus van de foto kon niet veilig worden gecontroleerd.",
        );
      }
    } catch (cause) {
      if (cause instanceof PrivateMediaUploadError || options.signal?.aborted) throw cause;
      // A lost processing or readiness response is safe to retry: completion
      // and the exact-asset worker claim are both idempotent and leased.
      processingResponseLost = true;
    }
    await sleep(delay, options.signal);
    delay = Math.min(
      maximumDelay,
      Math.max(1, Math.round(delay * (processingResponseLost ? 1.25 : 1.6))),
    );
  }

  throw new PrivateMediaUploadError(
    "PROCESSING_TIMEOUT",
    "De foto wordt nog verwerkt. Probeer over een moment opnieuw; je selectie blijft staan.",
  );
}

function assertScopedAsset(
  asset: MediaAssetState,
  projectId: string,
  purpose: MediaUploadPurpose,
): void {
  if (asset.projectId !== projectId || asset.purpose !== purpose) {
    throw new PrivateMediaUploadError(
      "UNSAFE_UPLOAD_GRANT",
      "De uploadopdracht hoort niet bij deze verbouwing of dit gebruiksdoel.",
    );
  }
}

async function uploadPrivateProjectImage(
  purpose: "project_media" | "floorplan",
  input: PrivateProjectImageUploadInput,
  runtime: MediaUploadRuntime = {},
): Promise<MediaAssetState> {
  if (
    input.prepared.file.size !== input.prepared.sizeBytes ||
    input.prepared.file.type !== input.prepared.contentType ||
    !isSupportedProjectImageType(input.prepared.contentType) ||
    !Number.isSafeInteger(input.prepared.sizeBytes) ||
    input.prepared.sizeBytes < 1 ||
    input.prepared.sizeBytes > MAX_PROJECT_IMAGE_BYTES ||
    !sha256Base64Schema.safeParse(input.prepared.checksumSha256Base64).success
  ) {
    throw new PrivateMediaUploadError(
      "UNSAFE_UPLOAD_GRANT",
      "De voorbereide foto wijkt af van de veilige uploadopdracht.",
    );
  }

  const intent = (await apiRequest(
    "/api/media/upload-intents",
    mediaUploadIntentResponseSchema,
    {
      method: "POST",
      signal: input.signal,
      body: {
        idempotencyKey: input.idempotencyKey,
        projectId: input.projectId,
        purpose,
        contentType: input.prepared.contentType,
        sizeBytes: input.prepared.sizeBytes,
        checksumSha256Base64: input.prepared.checksumSha256Base64,
      },
    },
  )).data;

  assertScopedAsset(intent.asset, input.projectId, purpose);

  if (intent.asset.status === "failed") {
    throw new PrivateMediaUploadError("PROCESSING_FAILED", "Deze foto kon niet veilig worden verwerkt.");
  }
  if (intent.asset.status === "ready") {
    input.onStage?.("ready");
    return intent.asset;
  }

  let asset = intent.asset;
  if (intent.upload) {
    if (
      asset.status !== "pending_upload" ||
      intent.upload.method !== "POST" ||
      intent.upload.provider !== "vercel_blob" ||
      intent.upload.exactSizeBytes !== input.prepared.sizeBytes ||
      intent.upload.pathname !== `temporary/${asset.id.slice(0, 2)}/${asset.id}` ||
      intent.upload.handleUploadPath !== `/api/media/${asset.id}/blob-upload`
    ) {
      throw new PrivateMediaUploadError("UNSAFE_UPLOAD_GRANT", "De uploadopdracht heeft een ongeldige toestand.");
    }
    input.onStage?.("uploading");
    const blobUpload = runtime.blobUpload ?? configuredBlobUpload;
    if (!blobUpload) {
      throw new PrivateMediaUploadError(
        "UPLOAD_FAILED",
        "De private foto-opslag is nog niet beschikbaar.",
      );
    }
    let uploadFailure: unknown;
    try {
      const result = await blobUpload(intent.upload.pathname, input.prepared.file, {
        access: "private",
        handleUploadUrl: intent.upload.handleUploadPath,
        contentType: input.prepared.contentType,
        multipart: false,
        abortSignal: input.signal,
      });
      assertPrivateBlobResult(result, intent.upload.pathname, input.prepared.contentType);
    } catch (cause) {
      if (input.signal?.aborted) throw cause;
      if (cause instanceof PrivateMediaUploadError) throw cause;
      uploadFailure = cause;
    }

    let completed: MediaAssetState | undefined;
    try {
      completed = (await apiRequest(
        `/api/media/${encodeURIComponent(asset.id)}/complete`,
        mediaUploadCompletionResponseSchema,
        { method: "POST", body: {}, signal: input.signal },
      )).data.asset;
    } catch (cause) {
      if (uploadFailure) {
        throw new PrivateMediaUploadError(
          "UPLOAD_FAILED",
          "De foto kon niet veilig worden geüpload. Probeer opnieuw.",
          { cause: uploadFailure },
        );
      }
      if (input.signal?.aborted) throw cause;
      // The upload bytes were accepted by Blob. A lost or transient complete
      // response is recovered by the bounded, owner-authenticated polling loop.
    }
    if (completed) {
      assertScopedAsset(completed, input.projectId, purpose);
      if (completed.id !== asset.id) {
        throw new PrivateMediaUploadError("UNSAFE_UPLOAD_GRANT", "De uploadbevestiging wijkt af van de foto-opdracht.");
      }
      asset = completed;
    }
  } else if (asset.status === "pending_upload") {
    throw new PrivateMediaUploadError("UNSAFE_UPLOAD_GRANT", "De uploadopdracht bevat geen uploadtoestemming.");
  }

  if (asset.status === "failed") {
    throw new PrivateMediaUploadError("PROCESSING_FAILED", "Deze foto kon niet veilig worden verwerkt.");
  }
  if (asset.status !== "ready") {
    input.onStage?.("processing");
    await waitForProjectMediaReady(asset.id, { ...runtime, signal: input.signal });
    asset = { ...asset, status: "ready" };
  }
  input.onStage?.("ready");
  return asset;
}

/** Uploads update media with a caller-invariant purpose. */
export function uploadProjectImage(
  input: PrivateProjectImageUploadInput,
  runtime: MediaUploadRuntime = {},
): Promise<MediaAssetState> {
  return uploadPrivateProjectImage("project_media", input, runtime);
}

/** Uploads a floorplan without exposing a caller-controlled media purpose. */
export function uploadFloorplanImage(
  input: PrivateProjectImageUploadInput,
  runtime: MediaUploadRuntime = {},
): Promise<MediaAssetState> {
  return uploadPrivateProjectImage("floorplan", input, runtime);
}

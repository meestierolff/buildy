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
const RETRYABLE_UPLOAD_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_UPLOAD_HEADERS = new Set([
  "content-length",
  "content-type",
  "x-amz-meta-buildy-sha256",
]);

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
  now?: () => number;
  sleep?: Sleep;
  readyTimeoutMs?: number;
  initialPollDelayMs?: number;
  maximumPollDelayMs?: number;
};

function normalizedGrantHeaders(
  requiredHeaders: Readonly<Record<string, string>>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [name, value] of Object.entries(requiredHeaders)) {
    const normalizedName = name.trim().toLowerCase();
    if (!ALLOWED_UPLOAD_HEADERS.has(normalizedName) || result.has(normalizedName)) {
      throw new PrivateMediaUploadError(
        "UNSAFE_UPLOAD_GRANT",
        "De uploadopdracht bevat onverwachte headers.",
      );
    }
    result.set(normalizedName, value);
  }
  return result;
}

function browserPutHeaders(
  requiredHeaders: Readonly<Record<string, string>>,
  prepared: PreparedProjectImage,
): Headers {
  const grantHeaders = normalizedGrantHeaders(requiredHeaders);
  if (
    grantHeaders.size !== ALLOWED_UPLOAD_HEADERS.size ||
    grantHeaders.get("content-length") !== String(prepared.sizeBytes) ||
    grantHeaders.get("content-type") !== prepared.contentType ||
    grantHeaders.get("x-amz-meta-buildy-sha256") !== prepared.checksumSha256Base64
  ) {
    throw new PrivateMediaUploadError(
      "UNSAFE_UPLOAD_GRANT",
      "De uploadopdracht wijkt af van de gecontroleerde foto.",
    );
  }

  const headers = new Headers();
  headers.set("content-type", prepared.contentType);
  headers.set("x-amz-meta-buildy-sha256", prepared.checksumSha256Base64);
  // Browsers forbid setting Content-Length from script. The signed exact value
  // is checked above; fetch derives the wire header from this immutable body.
  return headers;
}

function safeSignedUploadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new PrivateMediaUploadError(
      "UNSAFE_UPLOAD_GRANT",
      "De opslagprovider gaf geen geldige uploadverbinding.",
      { cause },
    );
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PrivateMediaUploadError(
      "UNSAFE_UPLOAD_GRANT",
      "De opslagprovider gaf geen veilige uploadverbinding.",
    );
  }
  // Do not reserialize the presigned URL: even harmless normalization can
  // change bytes covered by a provider signature.
  return value;
}

async function putWithBoundedRetry(input: {
  url: string;
  headers: Headers;
  file: File;
  expiresAt: string;
  signal?: AbortSignal;
  fetcher: typeof globalThis.fetch;
  now: () => number;
  sleep: Sleep;
}): Promise<void> {
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new PrivateMediaUploadError("UNSAFE_UPLOAD_GRANT", "De uploadopdracht heeft geen geldige vervaltijd.");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (input.now() >= expiresAt - 5_000) {
      throw new PrivateMediaUploadError("UPLOAD_FAILED", "De uploadopdracht is verlopen. Probeer opnieuw.");
    }
    try {
      const response = await input.fetcher(input.url, {
        method: "PUT",
        headers: input.headers,
        body: input.file,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: input.signal,
      });
      if (response.ok) return;
      if (!RETRYABLE_UPLOAD_STATUSES.has(response.status) || attempt === 1) {
        throw new PrivateMediaUploadError("UPLOAD_FAILED", "De foto kon niet veilig worden geüpload.");
      }
    } catch (cause) {
      if (cause instanceof PrivateMediaUploadError) throw cause;
      if (input.signal?.aborted) throw cause;
      if (attempt === 1) {
        throw new PrivateMediaUploadError(
          "UPLOAD_FAILED",
          "De foto-upload werd onderbroken. Probeer opnieuw.",
          { cause },
        );
      }
    }
    await input.sleep(500, input.signal);
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
      // A brief connection loss does not restart or duplicate the upload. Keep
      // polling the authenticated proxy within the same bounded deadline.
    }
    await sleep(delay, options.signal);
    delay = Math.min(maximumDelay, Math.max(1, Math.round(delay * 1.6)));
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
      "De uploadopdracht hoort niet bij dit project of dit gebruiksdoel.",
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
    if (asset.status !== "pending_upload" || intent.upload.exactSizeBytes !== input.prepared.sizeBytes) {
      throw new PrivateMediaUploadError("UNSAFE_UPLOAD_GRANT", "De uploadopdracht heeft een ongeldige toestand.");
    }
    input.onStage?.("uploading");
    await putWithBoundedRetry({
      url: safeSignedUploadUrl(intent.upload.url),
      headers: browserPutHeaders(intent.upload.requiredHeaders, input.prepared),
      file: input.prepared.file,
      expiresAt: intent.upload.expiresAt,
      signal: input.signal,
      fetcher: runtime.fetch ?? globalThis.fetch,
      now: runtime.now ?? Date.now,
      sleep: runtime.sleep ?? defaultSleep,
    });
    const completed = (await apiRequest(
      `/api/media/${encodeURIComponent(asset.id)}/complete`,
      mediaUploadCompletionResponseSchema,
      { method: "POST", body: {}, signal: input.signal },
    )).data.asset;
    assertScopedAsset(completed, input.projectId, purpose);
    if (completed.id !== asset.id) {
      throw new PrivateMediaUploadError("UNSAFE_UPLOAD_GRANT", "De uploadbevestiging wijkt af van de foto-opdracht.");
    }
    asset = completed;
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

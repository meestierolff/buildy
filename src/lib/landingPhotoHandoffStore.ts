import {
  projectImageContentTypeSchema,
  type ProjectImageContentType,
} from "../../shared/contracts/media";

const DATABASE_NAME = "buildy-local-photo-handoff";
const DATABASE_VERSION = 1;
const STORE_NAME = "handoff";
const RECORD_KEY = "first-moment-photo";
const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export const LANDING_PHOTO_INTENT = "eerste-bouwmoment";

export type LandingPhotoHandoff = {
  version: 1;
  id: string;
  contentType: ProjectImageContentType;
  bytes: Blob;
  savedAt: string;
};

type PersistedLandingPhotoHandoff = Omit<LandingPhotoHandoff, "bytes"> & {
  bytes: ArrayBuffer;
};

type StoredRecord = {
  key: typeof RECORD_KEY;
  photo: LandingPhotoHandoff | PersistedLandingPhotoHandoff;
};

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSupportedProjectImageType(value: string): value is ProjectImageContentType {
  return projectImageContentTypeSchema.safeParse(value).success;
}

export function isLandingPhotoSupported(photo: Blob): photo is Blob & { type: ProjectImageContentType } {
  return isSupportedProjectImageType(photo.type)
    && Number.isSafeInteger(photo.size)
    && photo.size > 0
    && photo.size <= MAX_PHOTO_BYTES;
}

function safePhotoName(contentType: ProjectImageContentType): string {
  switch (contentType) {
    case "image/jpeg":
      return "eerste-bouwmoment.jpg";
    case "image/png":
      return "eerste-bouwmoment.png";
    case "image/webp":
      return "eerste-bouwmoment.webp";
    case "image/avif":
      return "eerste-bouwmoment.avif";
    case "image/heic":
      return "eerste-bouwmoment.heic";
    case "image/heif":
      return "eerste-bouwmoment.heif";
  }
}

export function normalizeLandingPhotoHandoff(
  value: unknown,
  now = Date.now(),
): LandingPhotoHandoff | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LandingPhotoHandoff> & { bytes?: unknown };
  if (
    candidate.version !== 1
    || !isUuid(candidate.id)
    || !isSupportedProjectImageType(candidate.contentType ?? "")
    || typeof candidate.savedAt !== "string"
  ) return null;

  const savedAt = Date.parse(candidate.savedAt);
  if (
    !Number.isFinite(savedAt)
    || savedAt < now - MAX_AGE_MS
    || savedAt > now + MAX_CLOCK_SKEW_MS
  ) return null;

  const rawBytes = candidate.bytes;
  if (
    rawBytes instanceof Blob
    && rawBytes.type
    && rawBytes.type !== candidate.contentType
  ) return null;
  const bytes = rawBytes instanceof Blob
    ? rawBytes
    : isArrayBuffer(rawBytes)
      ? new Blob([rawBytes], { type: candidate.contentType })
      : null;
  if (!bytes || bytes.size < 1 || bytes.size > MAX_PHOTO_BYTES) return null;

  return {
    version: 1,
    id: candidate.id,
    contentType: candidate.contentType,
    bytes,
    savedAt: candidate.savedAt,
  };
}

export function landingPhotoHandoffFile(photo: LandingPhotoHandoff): File {
  return new File([photo.bytes], safePhotoName(photo.contentType), {
    type: photo.contentType,
    lastModified: Date.parse(photo.savedAt),
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("De lokale foto-opslag is niet bereikbaar.")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("De lokale foto-opslag werd afgebroken.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("De lokale foto-opslag is mislukt.")),
      { once: true },
    );
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    throw new Error("Deze browser ondersteunt geen lokale foto-overdracht.");
  }
  const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    }
  });
  return requestResult(request);
}

export async function saveLandingPhotoHandoff(photo: File): Promise<void> {
  if (
    !isLandingPhotoSupported(photo)
    || !globalThis.crypto?.randomUUID
  ) {
    throw new Error("Deze foto kan niet veilig lokaal worden bewaard.");
  }

  const candidate: LandingPhotoHandoff = {
    version: 1,
    id: globalThis.crypto.randomUUID(),
    contentType: photo.type,
    bytes: photo,
    savedAt: new Date().toISOString(),
  };
  const normalized = normalizeLandingPhotoHandoff(candidate);
  if (!normalized) throw new Error("Deze foto kan niet veilig lokaal worden bewaard.");

  // ArrayBuffer is reliably structured-cloneable in the WebKit storage contexts
  // where persisting a Blob or File can otherwise abort the transaction.
  const persisted: PersistedLandingPhotoHandoff = {
    ...normalized,
    bytes: await normalized.bytes.arrayBuffer(),
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put({
      key: RECORD_KEY,
      photo: persisted,
    } satisfies StoredRecord);
    await completed;
  } finally {
    database.close();
  }
}

export async function loadLandingPhotoHandoff(): Promise<LandingPhotoHandoff | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestResult(
      store.get(RECORD_KEY) as IDBRequest<StoredRecord | undefined>,
    );
    const normalized = normalizeLandingPhotoHandoff(record?.photo);
    if (record && !normalized) store.delete(RECORD_KEY);
    await completed;
    return normalized;
  } finally {
    database.close();
  }
}

export async function deleteLandingPhotoHandoff(expectedPhotoId?: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    if (expectedPhotoId) {
      const record = await requestResult(
        store.get(RECORD_KEY) as IDBRequest<StoredRecord | undefined>,
      );
      if (record?.photo.id === expectedPhotoId) store.delete(RECORD_KEY);
    } else {
      store.delete(RECORD_KEY);
    }
    await completed;
  } finally {
    database.close();
  }
}

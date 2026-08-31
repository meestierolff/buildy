import {
  createUpdateInputSchema,
  type CreateUpdateInput,
} from "../../shared/contracts/projects";

const DATABASE_NAME = "buildy-private-update-drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const MAX_FILES = 50;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export type StoredUpdateDraftFile = {
  id: string;
  name: string;
  contentType: string;
  lastModified: number;
  bytes: Blob;
  compareRole: "before" | "after" | null;
  assetId?: string;
};

export type StoredUpdateComposerDraft = {
  version: 1;
  title: string;
  phaseId: string;
  isMilestone: boolean;
  description: string;
  updateDate: string;
  files: StoredUpdateDraftFile[];
  updateIdempotencyKey: string;
  pendingCommand: CreateUpdateInput | null;
  savedAt: string;
};

type StoredRecord = {
  key: string;
  draft: StoredUpdateComposerDraft | PersistedUpdateComposerDraft;
};

type PersistedUpdateDraftFile = Omit<StoredUpdateDraftFile, "bytes"> & {
  bytes: ArrayBuffer;
};

type PersistedUpdateComposerDraft = Omit<StoredUpdateComposerDraft, "files"> & {
  files: PersistedUpdateDraftFile[];
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{16,128}$/.test(value);
}

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

export function normalizeStoredUpdateDraft(value: unknown): StoredUpdateComposerDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredUpdateComposerDraft>;
  if (
    candidate.version !== 1 ||
    typeof candidate.title !== "string" || candidate.title.length > 120 ||
    typeof candidate.phaseId !== "string" || candidate.phaseId.length > 128 ||
    typeof candidate.isMilestone !== "boolean" ||
    typeof candidate.description !== "string" || candidate.description.length > 10_000 ||
    !isDateOnly(candidate.updateDate) ||
    !isUploadId(candidate.updateIdempotencyKey) ||
    typeof candidate.savedAt !== "string" || !Number.isFinite(Date.parse(candidate.savedAt)) ||
    !Array.isArray(candidate.files) || candidate.files.length > MAX_FILES
  ) return null;

  let totalBytes = 0;
  const files: StoredUpdateDraftFile[] = [];
  for (const file of candidate.files) {
    const rawBytes = (file as { bytes?: unknown } | null)?.bytes;
    if (
      !file || typeof file !== "object" ||
      !isUploadId(file.id) ||
      typeof file.name !== "string" || !file.name || file.name.length > 255 ||
      typeof file.contentType !== "string" || file.contentType.length > 100 ||
      !Number.isSafeInteger(file.lastModified) || file.lastModified < 0 ||
      ![null, "before", "after"].includes(file.compareRole) ||
      (file.assetId !== undefined && !isUuid(file.assetId))
    ) return null;
    const bytes = rawBytes instanceof Blob
      ? rawBytes
      : isArrayBuffer(rawBytes)
        ? new Blob([rawBytes], { type: file.contentType })
        : null;
    if (!bytes || bytes.size < 1 || bytes.size > MAX_FILE_BYTES) return null;
    totalBytes += bytes.size;
    if (totalBytes > MAX_TOTAL_BYTES) return null;
    files.push({
      id: file.id,
      name: file.name,
      contentType: file.contentType,
      lastModified: file.lastModified,
      bytes,
      compareRole: file.compareRole,
      ...(file.assetId ? { assetId: file.assetId } : {}),
    });
  }

  const parsedPending = candidate.pendingCommand === null
    ? null
    : createUpdateInputSchema.safeParse(candidate.pendingCommand);
  if (candidate.pendingCommand !== null && !parsedPending?.success) return null;

  return {
    version: 1,
    title: candidate.title,
    phaseId: candidate.phaseId,
    isMilestone: candidate.isMilestone,
    description: candidate.description,
    updateDate: candidate.updateDate,
    files,
    updateIdempotencyKey: candidate.updateIdempotencyKey,
    pendingCommand: parsedPending && parsedPending.success ? parsedPending.data : null,
    savedAt: candidate.savedAt,
  };
}

function draftKey(userId: string, projectId: string): string {
  if (!userId.trim() || !isUuid(projectId)) throw new Error("Ongeldige scope voor dit Bouwmoment-concept.");
  return `${userId.trim()}:${projectId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Conceptopslag is niet bereikbaar.")), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Conceptopslag werd afgebroken.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Conceptopslag is mislukt.")), { once: true });
  });
}

async function openDraftDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error("Deze browser ondersteunt geen herstelbare conceptopslag.");
  const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    }
  });
  return requestResult(request);
}

export async function loadUpdateComposerDraft(
  userId: string,
  projectId: string,
): Promise<StoredUpdateComposerDraft | null> {
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).get(draftKey(userId, projectId)) as IDBRequest<StoredRecord | undefined>,
    );
    await transactionDone(transaction);
    return normalizeStoredUpdateDraft(record?.draft);
  } finally {
    database.close();
  }
}

export async function saveUpdateComposerDraft(
  userId: string,
  projectId: string,
  draft: StoredUpdateComposerDraft,
): Promise<void> {
  const normalized = normalizeStoredUpdateDraft(draft);
  if (!normalized) throw new Error("Het Bouwmoment-concept is ongeldig en is niet opgeslagen.");
  // Some WebKit storage contexts abort IndexedDB writes containing Blob/File.
  // ArrayBuffer is structured-cloneable there; normalization restores the Blob on read.
  const persisted: PersistedUpdateComposerDraft = {
    ...normalized,
    files: await Promise.all(normalized.files.map(async (file) => ({
      ...file,
      bytes: await file.bytes.arrayBuffer(),
    }))),
  };
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      key: draftKey(userId, projectId),
      draft: persisted,
    } satisfies StoredRecord);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteUpdateComposerDraft(userId: string, projectId: string): Promise<void> {
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(draftKey(userId, projectId));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

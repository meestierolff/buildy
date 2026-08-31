import { z } from "zod";
import {
  approvePhotobookProofInputSchema,
  photobookDraftResponseSchema,
  photobookProofMutationResponseSchema,
  replacePhotobookExclusionsInputSchema,
  requestPhotobookProofInputSchema,
  updatePhotobookSettingsInputSchema,
} from "../../shared/contracts/photobooks";
import { apiErrorSchema } from "../../shared/contracts/api";
import { ApiClientError, apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const MAX_PROOF_BYTES = 150 * 1024 * 1024;

export type PhotobookDraft = z.infer<typeof photobookDraftResponseSchema>["data"];
export type PhotobookProofMutation = z.infer<typeof photobookProofMutationResponseSchema>["data"];
export type UpdatePhotobookSettingsInput = z.input<typeof updatePhotobookSettingsInputSchema>;
export type ReplacePhotobookExclusionsInput = z.input<typeof replacePhotobookExclusionsInputSchema>;
export type RequestPhotobookProofInput = z.input<typeof requestPhotobookProofInputSchema>;
export type ApprovePhotobookProofInput = z.input<typeof approvePhotobookProofInputSchema>;
export type LoadedPhotobookProof = {
  blob: Blob;
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
};

function encodedId(value: string): string {
  return encodeURIComponent(uuidSchema.parse(value));
}

function projectPhotobookPath(projectId: string, suffix = ""): `/api/${string}` {
  return `/api/projects/${encodedId(projectId)}/photobook${suffix}`;
}

export async function getPhotobookDraft(
  projectId: string,
  signal?: AbortSignal,
): Promise<PhotobookDraft> {
  return (await apiRequest(
    projectPhotobookPath(projectId),
    photobookDraftResponseSchema,
    { signal },
  )).data;
}

export async function updatePhotobookSettings(
  projectId: string,
  input: UpdatePhotobookSettingsInput,
): Promise<PhotobookDraft> {
  const parsed = updatePhotobookSettingsInputSchema.parse(input);
  return (await apiRequest(
    projectPhotobookPath(projectId, "/settings"),
    photobookDraftResponseSchema,
    { method: "PUT", body: parsed },
  )).data;
}

export async function replacePhotobookExclusions(
  projectId: string,
  input: ReplacePhotobookExclusionsInput,
): Promise<PhotobookDraft> {
  const parsed = replacePhotobookExclusionsInputSchema.parse(input);
  return (await apiRequest(
    projectPhotobookPath(projectId, "/exclusions"),
    photobookDraftResponseSchema,
    { method: "PUT", body: parsed },
  )).data;
}

export async function requestPhotobookProof(
  projectId: string,
  input: RequestPhotobookProofInput,
): Promise<PhotobookProofMutation> {
  const parsed = requestPhotobookProofInputSchema.parse(input);
  return (await apiRequest(
    projectPhotobookPath(projectId, "/proofs"),
    photobookProofMutationResponseSchema,
    { method: "POST", body: parsed },
  )).data;
}

export async function approvePhotobookProof(
  revisionId: string,
  input: ApprovePhotobookProofInput,
): Promise<PhotobookProofMutation> {
  const parsed = approvePhotobookProofInputSchema.parse(input);
  return (await apiRequest(
    `/api/photobooks/proofs/${encodedId(revisionId)}/approve`,
    photobookProofMutationResponseSchema,
    { method: "POST", body: parsed },
  )).data;
}

function invalidProofResponse(message: string, response: Response): ApiClientError {
  return new ApiClientError({
    status: response.status,
    code: "INTERNAL_ERROR",
    message,
    requestId: response.headers.get("x-request-id") ?? undefined,
  });
}

async function browserSha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ApiClientError({
      status: 0,
      code: "INTERNAL_ERROR",
      message: "Deze browser kan de printproof niet veilig controleren.",
    });
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function loadPhotobookProofView(input: {
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
  signal?: AbortSignal;
}): Promise<LoadedPhotobookProof> {
  const revisionId = uuidSchema.parse(input.revisionId);
  const documentSha256 = sha256Schema.parse(input.documentSha256);
  const pdfSha256 = sha256Schema.parse(input.pdfSha256);
  const response = await fetch(`/api/photobooks/proofs/${encodedId(revisionId)}/pdf`, {
    method: "GET",
    headers: { accept: "application/pdf" },
    credentials: "include",
    signal: input.signal,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiClientError({
        status: response.status,
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        requestId: parsed.data.error.requestId,
        fieldErrors: parsed.data.error.fieldErrors,
      });
    }
    throw invalidProofResponse("De private printproof kon niet worden geladen.", response);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    response.status !== 200
    || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf"
    || !Number.isSafeInteger(contentLength)
    || contentLength < 1
    || contentLength > MAX_PROOF_BYTES
  ) throw invalidProofResponse("De printproofresponse is ongeldig.", response);

  const responseRevisionId = uuidSchema.safeParse(response.headers.get("x-buildy-proof-revision"));
  const responseDocumentSha256 = sha256Schema.safeParse(response.headers.get("x-buildy-proof-document-sha256"));
  const responsePdfSha256 = sha256Schema.safeParse(response.headers.get("x-buildy-proof-pdf-sha256"));
  if (
    !responseRevisionId.success
    || !responseDocumentSha256.success
    || !responsePdfSha256.success
    || responseRevisionId.data !== revisionId
    || responseDocumentSha256.data !== documentSha256
    || responsePdfSha256.data !== pdfSha256
  ) throw invalidProofResponse("De printproof hoort niet bij de actuele revisie.", response);

  const bytes = await response.arrayBuffer();
  const magic = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (bytes.byteLength !== contentLength || magic !== "%PDF-") {
    throw invalidProofResponse("De geladen printproof is geen volledige PDF.", response);
  }
  if (await browserSha256Hex(bytes) !== pdfSha256) {
    throw invalidProofResponse("De checksum van de geladen printproof wijkt af.", response);
  }

  return {
    blob: new Blob([bytes], { type: "application/pdf" }),
    revisionId,
    documentSha256,
    pdfSha256,
  };
}

export function createPhotobookIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Deze browser kan geen veilige opdracht-ID maken.");
  }
  return uuidSchema.parse(globalThis.crypto.randomUUID());
}

export function photobookMediaProxyPath(
  assetId: string,
  size: "small" | "medium" | "large" = "large",
): `/api/media/${string}` {
  return `/api/media/${encodedId(assetId)}?size=${size}`;
}

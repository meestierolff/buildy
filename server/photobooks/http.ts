import type { PhotobookEditorState, PhotobookProofMutation } from "./types.js";
import { approvePhotobookProofInputSchema } from "../../shared/contracts/photobooks.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import {
  guardObjectStream,
  type ObjectStorage,
} from "../storage/objectStorage.js";
import type { ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { PhotobookError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

export type PhotobookRouteParameters = Readonly<Record<string, string>>;

export interface PhotobookHttpService {
  editor(actorId: string, projectId: string): Promise<PhotobookEditorState>;
  updateSettings(actorId: string, projectId: string, input: unknown): Promise<PhotobookEditorState>;
  replaceExclusions(actorId: string, projectId: string, input: unknown): Promise<PhotobookEditorState>;
  requestProof(actorId: string, projectId: string, input: unknown): Promise<PhotobookProofMutation>;
  approveProof(actorId: string, revisionId: string, input: unknown): Promise<PhotobookProofMutation>;
  proofObject(actorId: string, revisionId: string): ReturnType<import("./service.js").PhotobookService["proofObject"]>;
}

export type PhotobookHttpDependencies = {
  actors: ProjectActorResolver;
  service: PhotobookHttpService;
  storage: ObjectStorage;
};

function validatedId(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw new PhotobookError("PHOTOBOOK_NOT_FOUND");
  return value.toLowerCase();
}

async function jsonInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(400, "BAD_REQUEST", "Gebruik application/json voor deze aanvraag.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "De JSON-body is ongeldig.");
  }
}

function parseRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    throw new HttpError(416, "BAD_REQUEST", "Dit bytebereik is niet beschikbaar.");
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) {
      throw new HttpError(416, "BAD_REQUEST", "Dit bytebereik is niet beschikbaar.");
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
  ) throw new HttpError(416, "BAD_REQUEST", "Dit bytebereik is niet beschikbaar.");
  return { start, end: Math.min(end, size - 1) };
}

function proofHeaders(input: {
  sha256: string;
  size: number;
  contentLength: number;
  range?: { start: number; end: number };
}): Headers {
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": "inline; filename=\"bouwboek-printproof.pdf\"",
    "content-length": String(input.contentLength),
    "content-type": "application/pdf",
    "cross-origin-resource-policy": "same-origin",
    etag: `"sha256-${input.sha256}"`,
    "x-content-type-options": "nosniff",
  });
  if (input.range) {
    headers.set("content-range", `bytes ${input.range.start}-${input.range.end}/${input.size}`);
  }
  return headers;
}

function rethrowPhotobookError(error: unknown): never {
  if (error instanceof PhotobookError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  if (error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

async function consumeExactProofObject(input: {
  storage: ObjectStorage;
  proof: Awaited<ReturnType<PhotobookHttpService["proofObject"]>>;
}): Promise<void> {
  try {
    const object = await input.storage.streamObject({
      key: input.proof.objectKey,
      maximumBytes: input.proof.sizeBytes,
    });
    const metadataChecksum = object.metadata.checksumSha256Base64;
    const expectedChecksumBase64 = Buffer.from(input.proof.sha256, "hex").toString("base64");
    if (
      object.metadata.key !== input.proof.objectKey
      || object.metadata.sizeBytes !== input.proof.sizeBytes
      || object.metadata.contentType !== input.proof.contentType
      || (metadataChecksum !== undefined && metadataChecksum !== expectedChecksumBase64)
      || object.contentLength !== input.proof.sizeBytes
      || object.range !== undefined
    ) throw new PhotobookError("INVALID_STATE");

    const guarded = guardObjectStream({
      stream: object.stream,
      expectedBytes: input.proof.sizeBytes,
      expectedSha256Hex: input.proof.sha256,
    });
    const reader = guarded.getReader();
    try {
      while (!(await reader.read()).done) {
        // Intentionally consume without buffering; approval is allowed only after verified EOF.
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof PhotobookError) throw error;
    throw new PhotobookError("INVALID_STATE", { cause: error });
  }
}

export function createPhotobookHttpHandler(dependencies: PhotobookHttpDependencies) {
  return async (
    request: Request,
    requestId: string,
    parameters: PhotobookRouteParameters = {},
  ): Promise<Response> => {
    try {
      const actor = await dependencies.actors.resolve(request);
      if (actor.kind !== "authenticated") throw new PhotobookError("ACTOR_REQUIRED");
      const actorId = validatedId(actor.appUserId);
      const projectId = parameters.projectId ? validatedId(parameters.projectId) : undefined;
      const revisionId = parameters.revisionId ? validatedId(parameters.revisionId) : undefined;
      const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";

      if (projectId && pathname.endsWith("/photobook")) {
        if (request.method === "GET") {
          return jsonSuccess(await dependencies.service.editor(actorId, projectId), requestId);
        }
      }
      if (projectId && pathname.endsWith("/photobook/settings") && request.method === "PUT") {
        return jsonSuccess(
          await dependencies.service.updateSettings(actorId, projectId, await jsonInput(request)),
          requestId,
        );
      }
      if (projectId && pathname.endsWith("/photobook/exclusions") && request.method === "PUT") {
        return jsonSuccess(
          await dependencies.service.replaceExclusions(actorId, projectId, await jsonInput(request)),
          requestId,
        );
      }
      if (projectId && pathname.endsWith("/photobook/proofs") && request.method === "POST") {
        const result = await dependencies.service.requestProof(actorId, projectId, await jsonInput(request));
        return jsonSuccess(result, requestId, {
          status: result.replayed || result.status !== "rendering" ? 200 : 202,
        });
      }
      if (revisionId && pathname.endsWith("/approve") && request.method === "POST") {
        const input = approvePhotobookProofInputSchema.parse(await jsonInput(request));
        const proof = await dependencies.service.proofObject(actorId, revisionId);
        if (
          proof.revisionId !== revisionId
          || proof.documentSha256 !== input.documentSha256
          || proof.sha256 !== input.pdfSha256
        ) throw new PhotobookError("STALE_DRAFT");
        await consumeExactProofObject({ storage: dependencies.storage, proof });
        return jsonSuccess(
          await dependencies.service.approveProof(actorId, revisionId, input),
          requestId,
        );
      }
      if (revisionId && pathname.endsWith("/pdf") && ["GET", "HEAD"].includes(request.method)) {
        const proof = await dependencies.service.proofObject(actorId, revisionId);
        const etag = `"sha256-${proof.sha256}"`;
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: proofHeaders({
            sha256: proof.sha256,
            size: proof.sizeBytes,
            contentLength: 0,
          }) });
        }
        const range = parseRange(request.headers.get("range"), proof.sizeBytes);
        const contentLength = range ? range.end - range.start + 1 : proof.sizeBytes;
        const headers = proofHeaders({ sha256: proof.sha256, size: proof.sizeBytes, contentLength, range: range ?? undefined });
        if (request.method === "HEAD") return new Response(null, { status: 200, headers });

        const object = await dependencies.storage.streamObject({
          key: proof.objectKey,
          maximumBytes: proof.sizeBytes,
          range: range ?? undefined,
        });
        if (
          object.metadata.key !== proof.objectKey
          || object.metadata.sizeBytes !== proof.sizeBytes
          || object.metadata.contentType !== "application/pdf"
          || object.contentLength !== contentLength
          || (range && (
            !object.range
            || object.range.start !== range.start
            || object.range.end !== range.end
          ))
        ) throw new PhotobookError("INVALID_STATE");
        const body = guardObjectStream({
          stream: object.stream,
          expectedBytes: contentLength,
          expectedSha256Hex: range ? undefined : proof.sha256,
        });
        if (!range) {
          headers.set("x-buildy-proof-revision", proof.revisionId);
          headers.set("x-buildy-proof-document-sha256", proof.documentSha256);
          headers.set("x-buildy-proof-pdf-sha256", proof.sha256);
        }
        return new Response(body, { status: range ? 206 : 200, headers });
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowPhotobookError(error);
    }
  };
}

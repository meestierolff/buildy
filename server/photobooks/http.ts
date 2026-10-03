import type { PhotobookEditorState, PhotobookProofMutation } from "./types.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import {
  type ObjectStorage,
} from "../storage/objectStorage.js";
import type { ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { PhotobookError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

export type PhotobookRouteParameters = Readonly<Record<string, string>>;

export interface PhotobookHttpService {
  preview?(actorId: string, projectId: string, input: unknown): Promise<import("../../shared/contracts/photobooks.js").PhotobookDocument>;
  editor(actorId: string, projectId: string): Promise<PhotobookEditorState>;
  updateSettings(actorId: string, projectId: string, input: unknown): Promise<PhotobookEditorState>;
  replaceExclusions(actorId: string, projectId: string, input: unknown): Promise<PhotobookEditorState>;
  requestProof(actorId: string, projectId: string, input: unknown): Promise<PhotobookProofMutation>;
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

function rethrowPhotobookError(error: unknown): never {
  if (error instanceof PhotobookError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  if (error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
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
      if (projectId && pathname.endsWith("/photobook/preview") && request.method === "POST" && dependencies.service.preview) {
        return jsonSuccess(await dependencies.service.preview(actorId, projectId, await jsonInput(request)), requestId);
      }
      if ((projectId && pathname.endsWith("/photobook/proofs")) || (revisionId && pathname.endsWith("/pdf"))) {
        throw new HttpError(403, "FORBIDDEN", "Alleen Buildy kan een PDF maken voor een boekbestelling.");
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowPhotobookError(error);
    }
  };
}

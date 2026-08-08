import {
  originalMediaPurposeSchema,
  type MediaUploadCompletion,
  type MediaUploadIntent,
  type OriginalMediaGrant,
} from "../../shared/contracts/media.js";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { MediaError } from "./errors.js";
import type { MediaBinaryResponse } from "./service.js";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MediaRouteParameters = Readonly<Record<string, string>>;

export interface MediaHttpService {
  createUploadIntent(actorId: string, input: unknown): Promise<MediaUploadIntent>;
  completeUpload(actorId: string, assetId: string, input: unknown): Promise<MediaUploadCompletion>;
  readDisplay(
    viewer: ProjectActor,
    assetId: string,
    query: unknown,
    headers: Headers,
    headOnly?: boolean,
  ): Promise<MediaBinaryResponse>;
  createOriginalGrant(actorId: string, assetId: string, input: unknown): Promise<OriginalMediaGrant>;
  readOriginal(
    actorId: string,
    assetId: string,
    purpose: "photobook" | "export",
    token: string,
    headers: Headers,
    headOnly?: boolean,
  ): Promise<MediaBinaryResponse>;
}

export type MediaHttpDependencies = {
  actors: ProjectActorResolver;
  service: MediaHttpService;
};

function validatedAssetId(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw new MediaError("MEDIA_NOT_FOUND");
  return value.toLowerCase();
}

function queryInput(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key in result) throw new HttpError(400, "BAD_REQUEST", "Een queryparameter staat dubbel in de URL.");
    result[key] = value;
  }
  return result;
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

function authenticatedActorId(actor: ProjectActor): string {
  if (actor.kind === "anonymous") throw new MediaError("ACTOR_REQUIRED");
  const actorId = actor.appUserId.toLowerCase();
  if (!UUID.test(actorId)) throw new MediaError("ACTOR_MAPPING_UNAVAILABLE");
  return actorId;
}

function binaryResponse(result: MediaBinaryResponse): Response {
  return new Response(result.body ? Buffer.from(result.body) : null, {
    status: result.status,
    headers: result.headers,
  });
}

function mediaErrorResponse(error: MediaError, requestId: string): Response {
  const response = jsonError(error.status, error.apiCode, error.message, requestId);
  if (!error.retryAfterSeconds) return response;
  const headers = new Headers(response.headers);
  headers.set("retry-after", String(error.retryAfterSeconds));
  return new Response(response.body, { status: response.status, headers });
}

export function createMediaHttpHandler(dependencies: MediaHttpDependencies) {
  return async (
    request: Request,
    requestId: string,
    parameters: MediaRouteParameters = {},
  ): Promise<Response> => {
    try {
      const actor = await dependencies.actors.resolve(request);
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";

      if (request.method === "POST" && pathname === "/api/media/upload-intents") {
        const result = await dependencies.service.createUploadIntent(
          authenticatedActorId(actor),
          await jsonInput(request),
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }

      const assetId = validatedAssetId(parameters.assetId);
      if (request.method === "POST" && pathname.endsWith("/complete")) {
        return jsonSuccess(
          await dependencies.service.completeUpload(
            authenticatedActorId(actor),
            assetId,
            await jsonInput(request),
          ),
          requestId,
        );
      }
      if (request.method === "POST" && pathname.endsWith("/original-grant")) {
        return jsonSuccess(
          await dependencies.service.createOriginalGrant(
            authenticatedActorId(actor),
            assetId,
            await jsonInput(request),
          ),
          requestId,
        );
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        pathname.endsWith("/original")
      ) {
        const query = queryInput(url);
        const purpose = originalMediaPurposeSchema.parse(query.purpose);
        if (Object.keys(query).some((key) => key !== "purpose")) {
          throw new HttpError(400, "BAD_REQUEST", "De mediaquery bevat een onbekende parameter.");
        }
        const token = request.headers.get("x-buildy-media-purpose-grant") ?? "";
        return binaryResponse(await dependencies.service.readOriginal(
          authenticatedActorId(actor),
          assetId,
          purpose,
          token,
          request.headers,
          request.method === "HEAD",
        ));
      }
      if (request.method === "GET" || request.method === "HEAD") {
        return binaryResponse(await dependencies.service.readDisplay(
          actor,
          assetId,
          queryInput(url),
          request.headers,
          request.method === "HEAD",
        ));
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof MediaError) return mediaErrorResponse(error, requestId);
      if (error instanceof ProjectError) {
        const reason = error.reason === "ACTOR_MAPPING_UNAVAILABLE"
          ? "ACTOR_MAPPING_UNAVAILABLE"
          : "ACTOR_REQUIRED";
        return mediaErrorResponse(new MediaError(reason, { cause: error }), requestId);
      }
      throw error;
    }
  };
}

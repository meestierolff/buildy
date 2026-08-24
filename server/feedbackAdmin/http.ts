import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ModerationAdminActorResolver } from "../moderation/adminActor.js";
import { ModerationAdminError } from "../moderation/adminErrors.js";
import { FeedbackAdminError } from "./errors.js";
import type { FeedbackAdminServiceContract } from "./types.js";

const MAX_JSON_BODY_BYTES = 8 * 1024;
const QUEUE_QUERY_KEYS = new Set(["status", "kind", "cursor", "limit"]);

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

function queueQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!QUEUE_QUERY_KEYS.has(key) || key in query) {
      throw new HttpError(400, "BAD_REQUEST", "De wachtrijquery bevat ongeldige parameters.");
    }
    query[key] = value;
  }
  return query;
}

function ensureNoQuery(url: URL): void {
  if ([...url.searchParams].length > 0) {
    throw new HttpError(400, "BAD_REQUEST", "Deze route ondersteunt geen queryparameters.");
  }
}

export type FeedbackAdminHttpDependencies = {
  actors: ModerationAdminActorResolver;
  service: FeedbackAdminServiceContract;
};

export function createFeedbackAdminHttpHandler(dependencies: FeedbackAdminHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      const actor = await dependencies.actors.resolve(request);
      if (actor.role !== "admin") throw new ModerationAdminError("FORBIDDEN");

      if (request.method === "GET" && pathname === "/api/admin/feedback/session") {
        ensureNoQuery(url);
        return jsonSuccess(dependencies.service.session(actor), requestId);
      }
      if (request.method === "GET" && pathname === "/api/admin/feedback") {
        return jsonSuccess(await dependencies.service.queue(actor, queueQuery(url)), requestId);
      }

      const statusMatch = /^\/api\/admin\/feedback\/([^/]+)\/status$/.exec(pathname);
      if (request.method === "POST" && statusMatch?.[1]) {
        ensureNoQuery(url);
        const result = await dependencies.service.updateStatus(
          actor,
          decodeURIComponent(statusMatch[1]),
          await jsonInput(request),
          requestId,
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }

      const detailMatch = /^\/api\/admin\/feedback\/([^/]+)$/.exec(pathname);
      if (request.method === "GET" && detailMatch?.[1]) {
        ensureNoQuery(url);
        return jsonSuccess(
          await dependencies.service.detail(actor, decodeURIComponent(detailMatch[1])),
          requestId,
        );
      }
      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof FeedbackAdminError || error instanceof ModerationAdminError) {
        throw new HttpError(error.status, error.apiCode, error.message);
      }
      throw error;
    }
  };
}

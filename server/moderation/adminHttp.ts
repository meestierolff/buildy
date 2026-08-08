import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ModerationAdminActorResolver } from "./adminActor.js";
import { ModerationAdminError } from "./adminErrors.js";
import type { ModerationAdminServiceContract } from "./adminTypes.js";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const QUEUE_QUERY_KEYS = new Set(["status", "urgency", "targetType", "cursor", "limit"]);

async function jsonInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
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

export type ModerationAdminHttpDependencies = {
  actors: ModerationAdminActorResolver;
  service: ModerationAdminServiceContract;
};

export function createModerationAdminHttpHandler(dependencies: ModerationAdminHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      const actor = await dependencies.actors.resolve(request);

      if (request.method === "GET" && pathname === "/api/moderation/admin/session") {
        ensureNoQuery(url);
        return jsonSuccess(dependencies.service.session(actor), requestId);
      }
      if (request.method === "GET" && pathname === "/api/moderation/admin/reports") {
        return jsonSuccess(await dependencies.service.queue(actor, queueQuery(url)), requestId);
      }

      const actionMatch = /^\/api\/moderation\/admin\/reports\/([^/]+)\/actions$/.exec(pathname);
      if (request.method === "POST" && actionMatch?.[1]) {
        ensureNoQuery(url);
        const result = await dependencies.service.action(
          actor,
          decodeURIComponent(actionMatch[1]),
          await jsonInput(request),
          requestId,
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }

      const reportMatch = /^\/api\/moderation\/admin\/reports\/([^/]+)$/.exec(pathname);
      if (request.method === "GET" && reportMatch?.[1]) {
        ensureNoQuery(url);
        return jsonSuccess(
          await dependencies.service.report(actor, decodeURIComponent(reportMatch[1])),
          requestId,
        );
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof ModerationAdminError) {
        throw new HttpError(error.status, error.apiCode, error.message);
      }
      throw error;
    }
  };
}

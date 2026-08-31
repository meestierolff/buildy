import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ModerationAdminActorResolver } from "../moderation/adminActor.js";
import { ModerationAdminError } from "../moderation/adminErrors.js";
import { guardObjectStream, type ObjectStorage } from "../storage/objectStorage.js";
import { OrderAdminError } from "./adminErrors.js";
import type { OrderAdminServiceContract } from "./adminTypes.js";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const QUEUE_QUERY_KEYS = new Set(["status", "cursor", "limit"]);

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
      throw new HttpError(400, "BAD_REQUEST", "De bestellijst bevat ongeldige parameters.");
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

function pdfHeaders(input: {
  orderNumber: string;
  sha256: string;
  sizeBytes: number;
}): Headers {
  return new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-disposition": `attachment; filename="${input.orderNumber}-print.pdf"`,
    "content-length": String(input.sizeBytes),
    "content-type": "application/pdf",
    "cross-origin-resource-policy": "same-origin",
    etag: `"sha256-${input.sha256}"`,
    "x-buildy-pdf-sha256": input.sha256,
    "x-content-type-options": "nosniff",
  });
}

export type OrderAdminHttpDependencies = {
  actors: ModerationAdminActorResolver;
  service: OrderAdminServiceContract;
  storage: ObjectStorage;
};

export function createOrderAdminHttpHandler(dependencies: OrderAdminHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      const actor = await dependencies.actors.resolve(request);

      if (request.method === "GET" && pathname === "/api/admin/orders") {
        return jsonSuccess(await dependencies.service.queue(actor, queueQuery(url)), requestId);
      }

      const pdfMatch = /^\/api\/admin\/orders\/([^/]+)\/pdf$/.exec(pathname);
      if (["GET", "HEAD"].includes(request.method) && pdfMatch?.[1]) {
        ensureNoQuery(url);
        const proof = await dependencies.service.proofObject(
          actor,
          decodeURIComponent(pdfMatch[1]),
        );
        const headers = pdfHeaders(proof);
        if (request.headers.get("if-none-match") === headers.get("etag")) {
          headers.set("content-length", "0");
          return new Response(null, { status: 304, headers });
        }
        if (request.method === "HEAD") return new Response(null, { status: 200, headers });
        const object = await dependencies.storage.streamObject({
          key: proof.objectKey,
          maximumBytes: proof.sizeBytes,
        });
        if (
          object.metadata.key !== proof.objectKey
          || object.metadata.sizeBytes !== proof.sizeBytes
          || object.metadata.contentType !== "application/pdf"
          || object.contentLength !== proof.sizeBytes
          || object.range
        ) throw new OrderAdminError("INVALID_ACTION");
        return new Response(guardObjectStream({
          stream: object.stream,
          expectedBytes: proof.sizeBytes,
          expectedSha256Hex: proof.sha256,
        }), { status: 200, headers });
      }

      const actionMatch = /^\/api\/admin\/orders\/([^/]+)\/actions$/.exec(pathname);
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

      const detailMatch = /^\/api\/admin\/orders\/([^/]+)$/.exec(pathname);
      if (request.method === "GET" && detailMatch?.[1]) {
        ensureNoQuery(url);
        return jsonSuccess(
          await dependencies.service.detail(actor, decodeURIComponent(detailMatch[1])),
          requestId,
        );
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof OrderAdminError || error instanceof ModerationAdminError) {
        throw new HttpError(error.status, error.apiCode, error.message);
      }
      throw error;
    }
  };
}

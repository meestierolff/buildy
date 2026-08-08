import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActorResolver } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { OrderError } from "./errors.js";
import type { OrderService } from "./service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JSON_BODY_BYTES = 64 * 1024;

export type OrderRouteParameters = Readonly<Record<string, string>>;

export interface OrderHttpService {
  quote: OrderService["quote"];
  checkout: OrderService["checkout"];
  order: OrderService["order"];
}

export interface OrderHttpDependencies {
  actors: ProjectActorResolver;
  service: OrderHttpService;
}

function validatedId(value: string | undefined): string {
  if (!value || !UUID.test(value)) throw new OrderError("ORDER_NOT_FOUND");
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

function rethrowOrderError(error: unknown): never {
  if (error instanceof OrderError || error instanceof ProjectError) {
    throw new HttpError(error.status, error.apiCode, error.message);
  }
  throw error;
}

export function createOrderHttpHandler(dependencies: OrderHttpDependencies) {
  return async (
    request: Request,
    requestId: string,
    parameters: OrderRouteParameters = {},
  ): Promise<Response> => {
    try {
      const actor = await dependencies.actors.resolve(request);
      if (actor.kind !== "authenticated") throw new OrderError("ACTOR_REQUIRED");
      const actorId = validatedId(actor.appUserId);
      const revisionId = parameters.revisionId ? validatedId(parameters.revisionId) : undefined;
      const orderId = parameters.orderId ? validatedId(parameters.orderId) : undefined;
      const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";

      if (revisionId && pathname.endsWith("/quote") && request.method === "POST") {
        return jsonSuccess(
          await dependencies.service.quote(actorId, revisionId, await jsonInput(request)),
          requestId,
        );
      }
      if (revisionId && pathname.endsWith("/checkout") && request.method === "POST") {
        const result = await dependencies.service.checkout(
          actorId,
          revisionId,
          await jsonInput(request),
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (orderId && request.method === "GET") {
        return jsonSuccess(await dependencies.service.order(actorId, orderId), requestId);
      }
      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      rethrowOrderError(error);
    }
  };
}

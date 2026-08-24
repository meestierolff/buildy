import { ZodError } from "zod";

import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "../projects/actor.js";
import {
  clearProjectShareCookie,
  projectShareCookie,
  withProjectShareCookie,
} from "./cookie.js";
import { ProjectShareError } from "./errors.js";
import type { ProjectShareService } from "./service.js";

const MAX_BODY_BYTES = 16 * 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProjectShareRouteParameters = Readonly<Record<string, string>>;

export type ProjectShareHttpDependencies = {
  actors: ProjectActorResolver;
  secureCookies: boolean;
  tokens: import("./crypto.js").HmacProjectShareTokens;
  service: Pick<ProjectShareService, "ownerState" | "create" | "rotate" | "revoke" | "redeem">;
};

async function jsonInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(400, "BAD_REQUEST", "Gebruik application/json voor deze aanvraag.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  }
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De aanvraag is te groot.");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "De JSON-body is ongeldig.");
  }
}

function projectId(parameters: ProjectShareRouteParameters): string {
  const value = parameters.projectId;
  if (!value || !UUID.test(value)) throw new ProjectShareError("PROJECT_NOT_FOUND");
  return value.toLowerCase();
}

function shareErrorResponse(error: ProjectShareError, requestId: string, secure: boolean): Response {
  const response = jsonError(error.status, error.apiCode, error.message, requestId);
  return ["LINK_EXPIRED", "LINK_UNAVAILABLE"].includes(error.reason)
    ? withProjectShareCookie(response, clearProjectShareCookie(secure))
    : response;
}

export function createProjectShareHttpHandler(dependencies: ProjectShareHttpDependencies) {
  return async (
    request: Request,
    requestId: string,
    parameters: ProjectShareRouteParameters = {},
  ): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    try {
      if ([...url.searchParams].length > 0) {
        throw new HttpError(400, "BAD_REQUEST", "Deellinkgegevens horen niet in de querystring.");
      }
      const actor: ProjectActor = await dependencies.actors.resolve(request);

      if (request.method === "POST" && pathname === "/api/project-share-links/redeem") {
        const result = await dependencies.service.redeem(actor, await jsonInput(request));
        const { linkId, ...publicResult } = result;
        return withProjectShareCookie(
          jsonSuccess(publicResult, requestId),
          projectShareCookie(
            linkId,
            new Date(publicResult.expiresAt),
            dependencies.secureCookies,
            dependencies.tokens,
          ),
        );
      }

      const targetProjectId = projectId(parameters);
      if (request.method === "GET" && pathname.endsWith("/share-link")) {
        return jsonSuccess(await dependencies.service.ownerState(actor, targetProjectId), requestId);
      }
      if (request.method === "POST" && pathname.endsWith("/share-link/rotate")) {
        const result = await dependencies.service.rotate(
          actor,
          targetProjectId,
          await jsonInput(request),
          requestId,
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (request.method === "POST" && pathname.endsWith("/share-link")) {
        const result = await dependencies.service.create(
          actor,
          targetProjectId,
          await jsonInput(request),
          requestId,
        );
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (request.method === "DELETE" && pathname.endsWith("/share-link")) {
        return jsonSuccess(
          await dependencies.service.revoke(actor, targetProjectId, await jsonInput(request), requestId),
          requestId,
        );
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof ProjectShareError) {
        return shareErrorResponse(error, requestId, dependencies.secureCookies);
      }
      if (error instanceof ZodError && pathname === "/api/project-share-links/redeem") {
        return withProjectShareCookie(
          jsonError(400, "VALIDATION_FAILED", "Deze deellink heeft geen geldig formaat.", requestId),
          clearProjectShareCookie(dependencies.secureCookies),
        );
      }
      throw error;
    }
  };
}

import { isIP } from "node:net";
import { HttpError } from "../http/errors.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import type { ProjectActor, ProjectActorResolver } from "../projects/actor.js";
import { ANONYMOUS_PROJECT_ACTOR } from "../projects/actor.js";
import { ProjectError } from "../projects/errors.js";
import { ModerationError } from "./errors.js";
import type { SubmissionRequestContext } from "./types.js";
import type {
  FeedbackSubmissionReceipt,
  ModerationReportReceipt,
} from "../../shared/contracts/moderation.js";

const MAX_JSON_BODY_BYTES = 32 * 1024;

export interface ModerationHttpService {
  submitReport(
    actor: ProjectActor,
    input: unknown,
    requestContext: SubmissionRequestContext,
  ): Promise<ModerationReportReceipt>;
  submitFeedback(
    actor: ProjectActor,
    input: unknown,
    requestContext: SubmissionRequestContext,
  ): Promise<FeedbackSubmissionReceipt>;
  submitSupport(
    actor: ProjectActor,
    input: unknown,
    requestContext: SubmissionRequestContext,
  ): Promise<FeedbackSubmissionReceipt>;
}

export type ModerationHttpDependencies = {
  actors: ProjectActorResolver;
  service: ModerationHttpService;
};

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

function networkIdentifier(request: Request): string {
  const value = request.headers.get("x-vercel-forwarded-for");
  if (!value || value.length > 256) return "unknown";
  const first = value.split(",", 1)[0]?.trim();
  return first && isIP(first) ? first : "unknown";
}

export function userAgentFamily(value: string): SubmissionRequestContext["userAgentFamily"] {
  if (!value) return "unknown";
  if (/Edg\//i.test(value)) return "edge";
  if (/(Chrome|CriOS)\//i.test(value)) return "chrome";
  if (/(Firefox|FxiOS)\//i.test(value)) return "firefox";
  if (/Safari\//i.test(value) && !/(Chrome|Chromium|CriOS)\//i.test(value)) return "safari";
  return "other";
}

function requestContext(request: Request): SubmissionRequestContext {
  const rawUserAgent = request.headers.get("user-agent")?.slice(0, 512) ?? "";
  return {
    networkIdentifier: networkIdentifier(request),
    rawUserAgent,
    userAgentFamily: userAgentFamily(rawUserAgent),
  };
}

function ensureNoQuery(url: URL): void {
  if ([...url.searchParams].length > 0) {
    throw new HttpError(400, "BAD_REQUEST", "Deze route ondersteunt geen queryparameters.");
  }
}

function rateLimitResponse(error: ModerationError, requestId: string): Response {
  const response = jsonError(error.status, error.apiCode, error.message, requestId);
  if (!error.retryAfterSeconds) return response;
  const headers = new Headers(response.headers);
  headers.set("retry-after", String(error.retryAfterSeconds));
  return new Response(response.body, { status: response.status, headers });
}

export function createModerationHttpHandler(dependencies: ModerationHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    try {
      const url = new URL(request.url);
      ensureNoQuery(url);
      const pathname = url.pathname.replace(/\/$/, "") || "/";
      let actor: ProjectActor;
      try {
        actor = await dependencies.actors.resolve(request);
      } catch (error) {
        // Support and appeals deliberately remain reachable after an account
        // suspension. A stale revoked session is treated as anonymous only on
        // this contact-required public route; other routes stay fail-closed.
        if (
          pathname === "/api/support"
          && error instanceof ProjectError
          && error.reason === "ACTOR_MAPPING_UNAVAILABLE"
        ) {
          actor = ANONYMOUS_PROJECT_ACTOR;
        } else {
          throw error;
        }
      }
      const context = requestContext(request);

      if (request.method === "POST" && pathname === "/api/moderation/reports") {
        const result = await dependencies.service.submitReport(actor, await jsonInput(request), context);
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (request.method === "POST" && pathname === "/api/feedback") {
        const result = await dependencies.service.submitFeedback(actor, await jsonInput(request), context);
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }
      if (request.method === "POST" && pathname === "/api/support") {
        const result = await dependencies.service.submitSupport(actor, await jsonInput(request), context);
        return jsonSuccess(result, requestId, { status: result.replayed ? 200 : 201 });
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof ModerationError) {
        if (error.reason === "RATE_LIMITED") return rateLimitResponse(error, requestId);
        throw new HttpError(error.status, error.apiCode, error.message);
      }
      if (error instanceof ProjectError) {
        throw new HttpError(error.status, error.apiCode, error.message);
      }
      throw error;
    }
  };
}

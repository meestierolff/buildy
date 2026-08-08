import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import type { ProjectActorResolver } from "../projects/actor.js";
import type { BetaStatus, ProductEventReceipt } from "../../shared/contracts/beta.js";
import type { ProjectActor } from "../projects/actor.js";
import { jsonError, jsonSuccess } from "../http/responses.js";
import {
  betaReservationCookie,
  BETA_RESERVATION_COOKIE,
  clearBetaReservationCookie,
} from "./authGate.js";
import { BETA_OPAQUE_TOKEN } from "./crypto.js";
import { BetaError } from "./errors.js";
import type { BetaService } from "./service.js";

const ANALYTICS_COOKIE = "buildy_product_subject";
const MAX_JSON_BODY_BYTES = 8 * 1024;

export interface BetaHttpDependencies {
  actors: ProjectActorResolver;
  secureCookies: boolean;
  service: BetaHttpService;
}

export interface BetaHttpService {
  status(): BetaStatus;
  reserveInvite(
    rawInput: unknown,
    context: { networkIdentifier: string; userAgent: string },
  ): ReturnType<BetaService["reserveInvite"]>;
  recordClientEvent(
    actor: ProjectActor,
    anonymousIdentifier: string,
    rawInput: unknown,
  ): Promise<ProductEventReceipt>;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 16_384) return null;
  const segment = header.split(";").find((part) => part.trim().startsWith(`${name}=`));
  if (!segment) return null;
  const raw = segment.trim().slice(name.length + 1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function analyticsIdentifier(request: Request): { identifier: string; isNew: boolean } {
  const existing = cookieValue(request, ANALYTICS_COOKIE);
  if (existing && BETA_OPAQUE_TOKEN.test(existing)) {
    return { identifier: existing, isNew: false };
  }
  return { identifier: randomBytes(32).toString("base64url"), isNew: true };
}

function analyticsCookie(identifier: string, secure: boolean): string {
  return [
    `${ANALYTICS_COOKIE}=${identifier}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${30 * 24 * 60 * 60}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function jsonInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new BetaError("INVALID_STATE");
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new BetaError("INVALID_STATE");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BetaError("INVALID_STATE");
  }
}

function requestContext(request: Request) {
  const firstAddress = request.headers.get("x-vercel-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  return {
    networkIdentifier: firstAddress && isIP(firstAddress) ? firstAddress : "unknown",
    userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? "unknown",
  };
}

function betaErrorResponse(error: BetaError, requestId: string, secure: boolean): Response {
  let response = jsonError(error.status, error.apiCode, error.message, requestId);
  if (error.retryAfterSeconds) {
    const headers = new Headers(response.headers);
    headers.set("retry-after", String(error.retryAfterSeconds));
    response = new Response(response.body, { headers, status: response.status });
  }
  if (error.reason === "INVITE_INVALID" || error.reason === "INVALID_STATE") {
    response = withCookie(response, clearBetaReservationCookie(secure));
  }
  return response;
}

export function createBetaHttpHandler(dependencies: BetaHttpDependencies) {
  return async (request: Request, requestId: string): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    try {
      if ([...url.searchParams].length > 0) throw new BetaError("INVALID_STATE");
      if (request.method === "GET" && pathname === "/api/beta/status") {
        return jsonSuccess(dependencies.service.status(), requestId);
      }

      if (request.method === "POST" && pathname === "/api/beta/reservations") {
        const reserved = await dependencies.service.reserveInvite(
          await jsonInput(request),
          requestContext(request),
        );
        return withCookie(
          jsonSuccess(reserved.publicResult, requestId, {
            status: reserved.publicResult.replayed ? 200 : 201,
          }),
          betaReservationCookie(
            reserved.provider,
            reserved.cookieToken,
            dependencies.secureCookies,
          ),
        );
      }

      if (request.method === "POST" && pathname === "/api/product-events") {
        const subject = analyticsIdentifier(request);
        const actor = await dependencies.actors.resolve(request);
        const receipt = await dependencies.service.recordClientEvent(
          actor,
          subject.identifier,
          await jsonInput(request),
        );
        const response = jsonSuccess(receipt, requestId, {
          status: receipt.replayed ? 200 : 201,
        });
        return subject.isNew
          ? withCookie(response, analyticsCookie(subject.identifier, dependencies.secureCookies))
          : response;
      }

      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    } catch (error) {
      if (error instanceof ZodError) {
        const response = jsonError(
          400,
          "VALIDATION_FAILED",
          "Controleer de ingevoerde gegevens en probeer opnieuw.",
          requestId,
        );
        return pathname === "/api/beta/reservations"
          ? withCookie(response, clearBetaReservationCookie(dependencies.secureCookies))
          : response;
      }
      if (error instanceof BetaError) {
        return betaErrorResponse(error, requestId, dependencies.secureCookies);
      }
      throw error;
    }
  };
}

export const betaCookieNames = {
  analytics: ANALYTICS_COOKIE,
  reservation: BETA_RESERVATION_COOKIE,
} as const;

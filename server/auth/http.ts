import { jsonError } from "../http/responses.js";
import { logEvent, safeErrorFields } from "../observability/logger.js";
import { AuthUnavailableError } from "./errors.js";
import type { AuthEngine } from "./factory.js";
import { resolveDefaultAuthEngine } from "./runtime.js";

export type AuthEngineResolver = () => AuthEngine | Promise<AuthEngine>;

const AUTH_PATH = "/api/auth";

export function isAuthPath(pathname: string): boolean {
  return pathname === AUTH_PATH || pathname.startsWith(`${AUTH_PATH}/`);
}

function securedAuthResponse(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-request-id", requestId);

  if (response.status === 429 && !headers.has("retry-after")) {
    const retryAfter = headers.get("x-retry-after");
    if (retryAfter && /^\d+$/.test(retryAfter)) headers.set("retry-after", retryAfter);
  }
  if (response.status === 503 && !headers.has("retry-after")) headers.set("retry-after", "30");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function createAuthHttpHandler(resolveEngine: AuthEngineResolver) {
  return async (request: Request, requestId: string): Promise<Response> => {
    if (!isAuthPath(new URL(request.url).pathname)) {
      return jsonError(404, "NOT_FOUND", "Deze API-route bestaat niet.", requestId);
    }

    try {
      const auth = await resolveEngine();
      const headers = new Headers(request.headers);
      headers.set("x-request-id", requestId);
      const correlatedRequest = new Request(request, { headers });
      return securedAuthResponse(await auth.handler(correlatedRequest), requestId);
    } catch (error) {
      if (!(error instanceof AuthUnavailableError)) {
        logEvent("error", "auth.request_failed", { requestId, ...safeErrorFields(error) });
      }

      return securedAuthResponse(
        jsonError(
          503,
          "AUTH_UNAVAILABLE",
          "Inloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.",
          requestId,
        ),
        requestId,
      );
    }
  };
}

export const handleDefaultAuthRequest = createAuthHttpHandler(resolveDefaultAuthEngine);

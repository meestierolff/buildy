import type { ApiErrorCode } from "../../shared/contracts/api.js";

const securityHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function responseHeaders(requestId: string, headers?: HeadersInit): Headers {
  const result = new Headers(securityHeaders);
  result.set("content-type", "application/json; charset=utf-8");
  result.set("x-request-id", requestId);

  if (headers) {
    new Headers(headers).forEach((value, key) => result.set(key, value));
  }

  return result;
}

export function jsonSuccess<T>(
  data: T,
  requestId: string,
  init: Omit<ResponseInit, "headers"> & { headers?: HeadersInit } = {},
): Response {
  return Response.json(
    { data, meta: { requestId } },
    { ...init, headers: responseHeaders(requestId, init.headers) },
  );
}

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: Record<string, string[]>,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        requestId,
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    },
    { status, headers: responseHeaders(requestId) },
  );
}

export function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

import { z } from "zod";
import { apiErrorSchema, type ApiErrorCode } from "../../shared/contracts/api";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    status: number;
    requestId?: string;
    fieldErrors?: Record<string, string[]>;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.fieldErrors = options.fieldErrors;
  }
}

interface ApiRequestOptions<TBody> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: TBody;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export async function apiRequest<TSchema extends z.ZodTypeAny, TBody = never>(
  path: `/api/${string}`,
  schema: TSchema,
  options: ApiRequestOptions<TBody> = {},
): Promise<z.output<TSchema>> {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    credentials: "include",
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      throw new ApiClientError({
        status: response.status,
        code: parsedError.data.error.code,
        message: parsedError.data.error.message,
        requestId: parsedError.data.error.requestId,
        fieldErrors: parsedError.data.error.fieldErrors,
      });
    }

    throw new ApiClientError({
      status: response.status,
      code: "INTERNAL_ERROR",
      message: "De server gaf een ongeldige respons. Probeer het later opnieuw.",
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError({
      status: response.status,
      code: "INTERNAL_ERROR",
      message: "De serverrespons kon niet veilig worden verwerkt.",
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
  }

  return parsed.data;
}

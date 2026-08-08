import type { ApiErrorCode } from "../../shared/contracts/api.js";

export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type FeedbackAdminErrorReason =
  | "SUBMISSION_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "INVALID_TRANSITION";

const details: Record<FeedbackAdminErrorReason, { code: ApiErrorCode; message: string; status: number }> = {
  SUBMISSION_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze inzending bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  VERSION_CONFLICT: {
    code: "CONFLICT",
    message: "De inzending is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
    status: 409,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze aanvraag-ID is al voor een andere beoordeling gebruikt.",
    status: 409,
  },
  INVALID_CURSOR: {
    code: "BAD_REQUEST",
    message: "De paginacursor is ongeldig of hoort bij een andere wachtrij.",
    status: 400,
  },
  INVALID_TRANSITION: {
    code: "CONFLICT",
    message: "Deze statuswijziging is vanuit de huidige toestand niet toegestaan.",
    status: 409,
  },
};

export class FeedbackAdminError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: FeedbackAdminErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "FeedbackAdminError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

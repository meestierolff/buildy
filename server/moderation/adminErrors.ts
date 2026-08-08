import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type ModerationAdminErrorReason =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "REPORT_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "INVALID_ACTION"
  | "AUTH_UNAVAILABLE";

const details: Record<ModerationAdminErrorReason, {
  code: ApiErrorCode;
  message: string;
  status: number;
}> = {
  UNAUTHENTICATED: {
    code: "UNAUTHENTICATED",
    message: "Log in om de moderatieomgeving te openen.",
    status: 401,
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    message: "Je hebt geen actieve moderatierol.",
    status: 403,
  },
  REPORT_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze melding bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  VERSION_CONFLICT: {
    code: "CONFLICT",
    message: "De melding is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
    status: 409,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze aanvraag-ID is al voor een andere moderatieactie gebruikt.",
    status: 409,
  },
  INVALID_CURSOR: {
    code: "BAD_REQUEST",
    message: "De paginacursor is ongeldig of hoort bij een andere wachtrij.",
    status: 400,
  },
  INVALID_ACTION: {
    code: "CONFLICT",
    message: "Deze moderatieactie is in de huidige toestand niet toegestaan.",
    status: 409,
  },
  AUTH_UNAVAILABLE: {
    code: "AUTH_UNAVAILABLE",
    message: "De moderatieautorisatie is tijdelijk niet beschikbaar.",
    status: 503,
  },
};

export class ModerationAdminError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: ModerationAdminErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "ModerationAdminError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

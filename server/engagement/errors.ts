import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type EngagementErrorReason =
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "ACTOR_REQUIRED"
  | "CONTENT_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "NOTIFICATION_NOT_FOUND"
  | "VERSION_CONFLICT";

const details: Record<
  EngagementErrorReason,
  { code: ApiErrorCode; message: string; status: number }
> = {
  ACTOR_MAPPING_UNAVAILABLE: {
    code: "AUTH_UNAVAILABLE",
    message: "Je accountkoppeling is tijdelijk niet beschikbaar.",
    status: 503,
  },
  ACTOR_REQUIRED: {
    code: "UNAUTHENTICATED",
    message: "Log in om deze actie uit te voeren.",
    status: 401,
  },
  CONTENT_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze update of reactie bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze idempotency-key is al voor andere inhoud gebruikt.",
    status: 409,
  },
  INVALID_CURSOR: {
    code: "BAD_REQUEST",
    message: "De paginacursor is ongeldig of hoort bij een andere lijst.",
    status: 400,
  },
  NOTIFICATION_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze notificatie bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  VERSION_CONFLICT: {
    code: "CONFLICT",
    message: "De reactie is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
    status: 409,
  },
};

export class EngagementError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: EngagementErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "EngagementError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

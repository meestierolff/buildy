import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type ModerationErrorReason =
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "ACTOR_REQUIRED"
  | "CONTENT_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE"
  | "RATE_LIMITED";

const details: Record<ModerationErrorReason, {
  code: ApiErrorCode;
  message: string;
  status: number;
}> = {
  ACTOR_MAPPING_UNAVAILABLE: {
    code: "AUTH_UNAVAILABLE",
    message: "Je accountkoppeling is tijdelijk niet beschikbaar.",
    status: 503,
  },
  ACTOR_REQUIRED: {
    code: "UNAUTHENTICATED",
    message: "Log in om productfeedback te versturen.",
    status: 401,
  },
  CONTENT_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze inhoud bestaat niet of is niet voor jou zichtbaar.",
    status: 404,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze aanvraag-ID is al voor een andere inzending gebruikt.",
    status: 409,
  },
  INVALID_STATE: {
    code: "CONFLICT",
    message: "De inzending kon niet veilig worden vastgelegd.",
    status: 409,
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Je hebt kort na elkaar te veel inzendingen verstuurd. Probeer het later opnieuw.",
    status: 429,
  },
};

export class ModerationError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(
    public readonly reason: ModerationErrorReason,
    public readonly retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super(details[reason].message, options);
    this.name = "ModerationError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}


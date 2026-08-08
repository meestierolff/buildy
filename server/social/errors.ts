import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type SocialErrorReason =
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "ACTOR_REQUIRED"
  | "INVALID_CURSOR"
  | "INVALID_TRANSITION"
  | "SELF_ACTION"
  | "TARGET_NOT_FOUND";

const details: Record<
  SocialErrorReason,
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
  INVALID_CURSOR: {
    code: "BAD_REQUEST",
    message: "De paginacursor is ongeldig of hoort bij een andere zoekopdracht.",
    status: 400,
  },
  INVALID_TRANSITION: {
    code: "CONFLICT",
    message: "Deze aanvraag kan niet meer in de huidige toestand worden verwerkt.",
    status: 409,
  },
  SELF_ACTION: {
    code: "BAD_REQUEST",
    message: "Je kunt deze actie niet op je eigen account uitvoeren.",
    status: 400,
  },
  TARGET_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Dit profiel of project bestaat niet of is niet toegankelijk.",
    status: 404,
  },
};

export class SocialError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: SocialErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "SocialError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type PlanningErrorReason =
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "ACTOR_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT";

const details: Record<PlanningErrorReason, {
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
    message: "Log in om deze actie uit te voeren.",
    status: 401,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze idempotency-key is al voor andere inhoud gebruikt.",
    status: 409,
  },
  INVALID_STATE: {
    code: "CONFLICT",
    message: "Deze wijziging botst met de huidige projectinhoud.",
    status: 409,
  },
  RESOURCE_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze projectinhoud bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  VERSION_CONFLICT: {
    code: "CONFLICT",
    message: "De inhoud is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
    status: 409,
  },
};

export class PlanningError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: PlanningErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "PlanningError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

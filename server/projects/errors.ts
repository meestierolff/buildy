import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type ProjectErrorReason =
  | "ACTOR_REQUIRED"
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "PROJECT_NOT_FOUND"
  | "UPDATE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "INVALID_PHASE"
  | "PHASE_CONFLICT"
  | "INVALID_MEDIA"
  | "INVALID_PROJECT_DATES"
  | "PROJECT_NOT_ACTIVE"
  | "ACTIVE_ORDER";

const details: Record<ProjectErrorReason, {
  status: number;
  code: ApiErrorCode;
  message: string;
}> = {
  ACTOR_REQUIRED: {
    status: 401,
    code: "UNAUTHENTICATED",
    message: "Log in om deze actie uit te voeren.",
  },
  ACTOR_MAPPING_UNAVAILABLE: {
    status: 503,
    code: "AUTH_UNAVAILABLE",
    message: "Je accountkoppeling is tijdelijk niet beschikbaar.",
  },
  PROJECT_NOT_FOUND: {
    status: 404,
    code: "NOT_FOUND",
    message: "Dit project bestaat niet of is niet toegankelijk.",
  },
  UPDATE_NOT_FOUND: {
    status: 404,
    code: "NOT_FOUND",
    message: "Deze update bestaat niet of is niet toegankelijk.",
  },
  VERSION_CONFLICT: {
    status: 409,
    code: "CONFLICT",
    message: "De inhoud is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    code: "CONFLICT",
    message: "Deze idempotency-key is al voor andere inhoud gebruikt.",
  },
  INVALID_CURSOR: {
    status: 400,
    code: "BAD_REQUEST",
    message: "De paginacursor is ongeldig of hoort bij een andere feed.",
  },
  INVALID_PHASE: {
    status: 400,
    code: "BAD_REQUEST",
    message: "De gekozen projectfase hoort niet bij dit project.",
  },
  PHASE_CONFLICT: {
    status: 409,
    code: "CONFLICT",
    message: "Er bestaat al een projectfase met deze naam. Kies een andere naam.",
  },
  INVALID_MEDIA: {
    status: 400,
    code: "BAD_REQUEST",
    message: "Een of meer media-assets zijn niet veilig beschikbaar voor dit project.",
  },
  INVALID_PROJECT_DATES: {
    status: 400,
    code: "BAD_REQUEST",
    message: "De projectdatums vormen geen geldige periode.",
  },
  PROJECT_NOT_ACTIVE: {
    status: 409,
    code: "CONFLICT",
    message: "Dit project kan in de huidige status niet worden gewijzigd.",
  },
  ACTIVE_ORDER: {
    status: 409,
    code: "CONFLICT",
    message: "Dit project kan nog niet worden verwijderd omdat een Bouwboekbestelling actief is.",
  },
};

export class ProjectError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: ProjectErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "ProjectError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

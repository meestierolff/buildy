import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type ProfileErrorReason =
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "ACTOR_REQUIRED"
  | "AVATAR_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE"
  | "PROFILE_NOT_FOUND"
  | "SLUG_CONFLICT"
  | "VERSION_CONFLICT";

const details: Record<ProfileErrorReason, {
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
    message: "Log in om je profiel te beheren.",
    status: 401,
  },
  AVATAR_UNAVAILABLE: {
    code: "NOT_FOUND",
    message: "Deze avatar bestaat niet of kan niet veilig worden gebruikt.",
    status: 404,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze idempotency-key is al voor andere profielgegevens gebruikt.",
    status: 409,
  },
  INVALID_STATE: {
    code: "CONFLICT",
    message: "De profielwijziging botst met de huidige accountstatus.",
    status: 409,
  },
  PROFILE_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Dit profiel bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  SLUG_CONFLICT: {
    code: "CONFLICT",
    message: "Deze profielnaam is al in gebruik. Kies een andere profielnaam.",
    status: 409,
  },
  VERSION_CONFLICT: {
    code: "CONFLICT",
    message: "Je profiel is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
    status: 409,
  },
};

export class ProfileError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: ProfileErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "ProfileError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

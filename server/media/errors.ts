import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type MediaErrorReason =
  | "ACTOR_REQUIRED"
  | "ACTOR_MAPPING_UNAVAILABLE"
  | "MEDIA_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "UPLOAD_INVALID"
  | "UPLOAD_CONFLICT"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "PURPOSE_GRANT_INVALID"
  | "WORKER_LEASE_LOST";

const details: Record<MediaErrorReason, { status: number; code: ApiErrorCode; message: string }> = {
  ACTOR_REQUIRED: {
    status: 401,
    code: "UNAUTHENTICATED",
    message: "Log in om media te beheren.",
  },
  ACTOR_MAPPING_UNAVAILABLE: {
    status: 503,
    code: "AUTH_UNAVAILABLE",
    message: "Je accountkoppeling is tijdelijk niet beschikbaar.",
  },
  MEDIA_NOT_FOUND: {
    status: 404,
    code: "NOT_FOUND",
    message: "Dit mediabestand bestaat niet of is niet toegankelijk.",
  },
  PROJECT_NOT_FOUND: {
    status: 404,
    code: "NOT_FOUND",
    message: "Dit project bestaat niet of is niet toegankelijk.",
  },
  UPLOAD_INVALID: {
    status: 400,
    code: "BAD_REQUEST",
    message: "De upload komt niet overeen met de afgesproken bestandsgegevens.",
  },
  UPLOAD_CONFLICT: {
    status: 409,
    code: "CONFLICT",
    message: "Deze uploadopdracht is al voor andere bestandsgegevens gebruikt.",
  },
  RATE_LIMITED: {
    status: 429,
    code: "RATE_LIMITED",
    message: "Je start te veel uploads. Wacht even en probeer opnieuw.",
  },
  STORAGE_UNAVAILABLE: {
    status: 503,
    code: "PROVIDER_UNAVAILABLE",
    message: "Mediaopslag is tijdelijk niet beschikbaar.",
  },
  PURPOSE_GRANT_INVALID: {
    status: 404,
    code: "NOT_FOUND",
    message: "Dit mediabestand bestaat niet of is niet toegankelijk.",
  },
  WORKER_LEASE_LOST: {
    status: 409,
    code: "CONFLICT",
    message: "De mediaverwerking is door een andere worker overgenomen.",
  },
};

export class MediaError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(
    public readonly reason: MediaErrorReason,
    options?: ErrorOptions & { retryAfterSeconds?: number },
  ) {
    super(details[reason].message, options);
    this.name = "MediaError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }

  readonly retryAfterSeconds: number | undefined;
}

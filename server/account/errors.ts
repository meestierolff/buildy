import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type AccountErrorReason =
  | "ACTOR_REQUIRED"
  | "ACTIVE_ORDER"
  | "AUTH_UNAVAILABLE"
  | "EXPORT_NOT_FOUND"
  | "EXPORT_NOT_READY"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE"
  | "REAUTH_REQUIRED"
  | "SESSION_NOT_FOUND"
  | "WORKER_LEASE_LOST";

const details: Record<AccountErrorReason, { code: ApiErrorCode; message: string; status: number }> = {
  ACTOR_REQUIRED: {
    code: "UNAUTHENTICATED",
    message: "Log in om je account te beheren.",
    status: 401,
  },
  ACTIVE_ORDER: {
    code: "CONFLICT",
    message: "Je account kan nog niet worden verwijderd omdat een bouwboekbestelling actief is.",
    status: 409,
  },
  AUTH_UNAVAILABLE: {
    code: "AUTH_UNAVAILABLE",
    message: "Sessiebeheer is tijdelijk niet beschikbaar.",
    status: 503,
  },
  EXPORT_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze data-export bestaat niet.",
    status: 404,
  },
  EXPORT_NOT_READY: {
    code: "CONFLICT",
    message: "Deze data-export is nog niet klaar of is verlopen.",
    status: 409,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze aanvraagkey is al voor een andere accountactie gebruikt.",
    status: 409,
  },
  INVALID_STATE: {
    code: "CONFLICT",
    message: "De accountactie botst met de huidige accountstatus.",
    status: 409,
  },
  REAUTH_REQUIRED: {
    code: "FORBIDDEN",
    message: "Bevestig je wachtwoord of log opnieuw in voordat je je account verwijdert.",
    status: 403,
  },
  SESSION_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze sessie bestaat niet meer.",
    status: 404,
  },
  WORKER_LEASE_LOST: {
    code: "CONFLICT",
    message: "De accountworkerlease is verlopen.",
    status: 409,
  },
};

export class AccountError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: AccountErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "AccountError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

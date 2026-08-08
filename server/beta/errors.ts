import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type BetaErrorReason =
  | "DISABLED"
  | "INVITE_INVALID"
  | "INVITE_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_STATE";

const details: Record<BetaErrorReason, {
  apiCode: ApiErrorCode;
  message: string;
  status: number;
}> = {
  DISABLED: {
    apiCode: "NOT_FOUND",
    message: "Deze API-route is niet beschikbaar.",
    status: 404,
  },
  INVITE_INVALID: {
    apiCode: "BETA_INVITE_INVALID",
    message: "Deze uitnodiging kan niet worden gebruikt. Vraag zo nodig een nieuwe uitnodiging aan.",
    status: 403,
  },
  INVITE_REQUIRED: {
    apiCode: "BETA_INVITE_REQUIRED",
    message: "Voor een nieuw account is een geldige bèta-uitnodiging nodig.",
    status: 403,
  },
  IDEMPOTENCY_CONFLICT: {
    apiCode: "CONFLICT",
    message: "Deze registratiepoging kan niet veilig opnieuw worden gebruikt.",
    status: 409,
  },
  RATE_LIMITED: {
    apiCode: "RATE_LIMITED",
    message: "Je hebt dit te vaak geprobeerd. Wacht even en probeer opnieuw.",
    status: 429,
  },
  INVALID_STATE: {
    apiCode: "CONFLICT",
    message: "De aanvraag kan in de huidige toestand niet worden verwerkt.",
    status: 409,
  },
};

export class BetaError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(
    readonly reason: BetaErrorReason,
    readonly retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    const detail = details[reason];
    super(detail.message, options);
    this.name = "BetaError";
    this.apiCode = detail.apiCode;
    this.status = detail.status;
  }
}

import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type OrderErrorReason =
  | "ACTOR_REQUIRED"
  | "ORDER_NOT_FOUND"
  | "PROOF_NOT_APPROVED"
  | "PROOF_MISMATCH"
  | "PRICE_UNAVAILABLE"
  | "QUOTE_EXPIRED"
  | "TERMS_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "CHECKOUT_UNAVAILABLE"
  | "ORDER_STATE_CONFLICT";

const DETAILS: Record<OrderErrorReason, { status: number; apiCode: ApiErrorCode; message: string }> = {
  ACTOR_REQUIRED: {
    status: 401,
    apiCode: "UNAUTHENTICATED",
    message: "Log in om je Bouwboek te bestellen.",
  },
  ORDER_NOT_FOUND: {
    status: 404,
    apiCode: "NOT_FOUND",
    message: "Deze bestelling bestaat niet of je hebt geen toegang.",
  },
  PROOF_NOT_APPROVED: {
    status: 409,
    apiCode: "CONFLICT",
    message: "Keur eerst de actuele printproof goed.",
  },
  PROOF_MISMATCH: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De goedgekeurde printproof is gewijzigd. Controleer de proof opnieuw.",
  },
  PRICE_UNAVAILABLE: {
    status: 503,
    apiCode: "PROVIDER_UNAVAILABLE",
    message: "Bestellen is voor deze bestemming nog niet beschikbaar.",
  },
  QUOTE_EXPIRED: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De prijsopgave is verlopen. Vraag de actuele prijs opnieuw op.",
  },
  TERMS_MISMATCH: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De bestelvoorwaarden zijn gewijzigd. Lees en accepteer de actuele versie.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    apiCode: "CONFLICT",
    message: "Deze aanvraag-ID is al voor een andere bestelling gebruikt.",
  },
  CHECKOUT_UNAVAILABLE: {
    status: 503,
    apiCode: "PROVIDER_UNAVAILABLE",
    message: "De betaalpagina kon niet veilig worden gestart. Probeer het later opnieuw.",
  },
  ORDER_STATE_CONFLICT: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De bestelling is intussen gewijzigd. Vernieuw de pagina.",
  },
};

export class OrderError extends Error {
  readonly status: number;
  readonly apiCode: ApiErrorCode;

  constructor(readonly reason: OrderErrorReason, options?: ErrorOptions) {
    const details = DETAILS[reason];
    super(details.message, options);
    this.name = "OrderError";
    this.status = details.status;
    this.apiCode = details.apiCode;
  }
}

import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type OrderAdminErrorReason =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ORDER_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_CURSOR"
  | "INVALID_ACTION"
  | "AUTH_UNAVAILABLE";

const details: Record<OrderAdminErrorReason, {
  code: ApiErrorCode;
  message: string;
  status: number;
}> = {
  UNAUTHENTICATED: {
    code: "UNAUTHENTICATED",
    message: "Log in om bestellingen te beheren.",
    status: 401,
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    message: "Je hebt geen actieve beheerrol voor bestellingen.",
    status: 403,
  },
  ORDER_NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Deze betaalde bestelling bestaat niet of is niet toegankelijk.",
    status: 404,
  },
  VERSION_CONFLICT: {
    code: "CONFLICT",
    message: "De bestelling is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
    status: 409,
  },
  IDEMPOTENCY_CONFLICT: {
    code: "CONFLICT",
    message: "Deze aanvraag-ID is al voor een andere bestelling gebruikt.",
    status: 409,
  },
  INVALID_CURSOR: {
    code: "BAD_REQUEST",
    message: "De paginacursor is ongeldig of hoort bij een andere bestellijst.",
    status: 400,
  },
  INVALID_ACTION: {
    code: "CONFLICT",
    message: "Deze fulfilmentactie is in de huidige toestand niet toegestaan.",
    status: 409,
  },
  AUTH_UNAVAILABLE: {
    code: "AUTH_UNAVAILABLE",
    message: "De beheerautorisatie is tijdelijk niet beschikbaar.",
    status: 503,
  },
};

export class OrderAdminError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: OrderAdminErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "OrderAdminError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

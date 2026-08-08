import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type PhotobookErrorReason =
  | "ACTOR_REQUIRED"
  | "PHOTOBOOK_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "STALE_DRAFT"
  | "IDEMPOTENCY_CONFLICT"
  | "PROOF_BLOCKED"
  | "PROOF_NOT_READY"
  | "PROOF_NOT_APPROVABLE"
  | "PROOF_NOT_VIEWED"
  | "INVALID_STATE"
  | "WORKER_LEASE_LOST";

const ERROR_DETAILS: Record<PhotobookErrorReason, {
  status: number;
  apiCode: ApiErrorCode;
  message: string;
}> = {
  ACTOR_REQUIRED: {
    status: 401,
    apiCode: "UNAUTHENTICATED",
    message: "Log in om je Bouwboek te beheren.",
  },
  PHOTOBOOK_NOT_FOUND: {
    status: 404,
    apiCode: "NOT_FOUND",
    message: "Dit Bouwboek bestaat niet of je hebt geen toegang.",
  },
  VERSION_CONFLICT: {
    status: 409,
    apiCode: "CONFLICT",
    message: "Je Bouwboek is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw.",
  },
  STALE_DRAFT: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De inhoud van je project is gewijzigd. Maak eerst een nieuw Bouwboekconcept.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    apiCode: "CONFLICT",
    message: "Deze aanvraag-ID is al voor een andere Bouwboekactie gebruikt.",
  },
  PROOF_BLOCKED: {
    status: 422,
    apiCode: "VALIDATION_FAILED",
    message: "Los eerst de blokkerende printwaarschuwingen op.",
  },
  PROOF_NOT_READY: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De printproof is nog niet klaar.",
  },
  PROOF_NOT_APPROVABLE: {
    status: 409,
    apiCode: "CONFLICT",
    message: "Deze printproof kan niet meer worden goedgekeurd.",
  },
  PROOF_NOT_VIEWED: {
    status: 409,
    apiCode: "CONFLICT",
    message: "Bekijk eerst de actuele printproof volledig voordat je deze goedkeurt.",
  },
  INVALID_STATE: {
    status: 409,
    apiCode: "CONFLICT",
    message: "De Bouwboekstatus is ongeldig. Vernieuw de pagina en probeer opnieuw.",
  },
  WORKER_LEASE_LOST: {
    status: 503,
    apiCode: "PROVIDER_UNAVAILABLE",
    message: "De Bouwboekworker verloor zijn taaklease.",
  },
};

export class PhotobookError extends Error {
  readonly status: number;
  readonly apiCode: ApiErrorCode;

  constructor(
    readonly reason: PhotobookErrorReason,
    options?: ErrorOptions,
  ) {
    const details = ERROR_DETAILS[reason];
    super(details.message, options);
    this.name = "PhotobookError";
    this.status = details.status;
    this.apiCode = details.apiCode;
  }
}

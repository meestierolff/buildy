import type { ApiErrorCode } from "../../shared/contracts/api.js";

export type ProjectShareErrorReason =
  | "ACTOR_REQUIRED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NOT_UNLISTED"
  | "LINK_ALREADY_EXISTS"
  | "LINK_NOT_FOUND"
  | "LINK_EXPIRED"
  | "LINK_UNAVAILABLE"
  | "EXPIRY_INVALID"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT";

const details: Record<ProjectShareErrorReason, { status: number; code: ApiErrorCode; message: string }> = {
  ACTOR_REQUIRED: { status: 401, code: "UNAUTHENTICATED", message: "Log in om een deellink te beheren." },
  PROJECT_NOT_FOUND: { status: 404, code: "NOT_FOUND", message: "Deze verbouwing bestaat niet of is niet toegankelijk." },
  PROJECT_NOT_UNLISTED: { status: 409, code: "CONFLICT", message: "Zet de verbouwing eerst op ‘Alleen via deellink’." },
  LINK_ALREADY_EXISTS: { status: 409, code: "CONFLICT", message: "Er bestaat al een deellink. Roteer die link om een nieuwe te maken." },
  LINK_NOT_FOUND: { status: 404, code: "NOT_FOUND", message: "Er is geen deellink om te beheren." },
  LINK_EXPIRED: { status: 410, code: "NOT_FOUND", message: "Deze deellink is verlopen. Vraag de maker om een nieuwe link." },
  LINK_UNAVAILABLE: { status: 404, code: "NOT_FOUND", message: "Deze deellink is niet meer beschikbaar." },
  EXPIRY_INVALID: { status: 400, code: "BAD_REQUEST", message: "Kies een vervaldatum tussen vijf minuten en negentig dagen vanaf nu." },
  VERSION_CONFLICT: { status: 409, code: "CONFLICT", message: "De deellink is intussen gewijzigd. Vernieuw en probeer opnieuw." },
  IDEMPOTENCY_CONFLICT: { status: 409, code: "CONFLICT", message: "Deze opdracht-ID is al voor andere deellinkgegevens gebruikt." },
};

export class ProjectShareError extends Error {
  readonly apiCode: ApiErrorCode;
  readonly status: number;

  constructor(public readonly reason: ProjectShareErrorReason, options?: ErrorOptions) {
    super(details[reason].message, options);
    this.name = "ProjectShareError";
    this.apiCode = details[reason].code;
    this.status = details[reason].status;
  }
}

import { HttpError } from "./errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertTrustedMutationOrigin(request: Request, trustedOrigins: Set<string>): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const origin = request.headers.get("origin");
  if (!origin || !trustedOrigins.has(origin)) {
    throw new HttpError(403, "FORBIDDEN", "Deze aanvraag komt niet van een vertrouwde Buildy-origin.");
  }
}

import { jsonError } from "../http/responses.js";
import { createBetaHttpHandler, type BetaHttpDependencies } from "./http.js";

type BetaHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: BetaHandler | undefined;

export function configureDefaultBetaRuntime(dependencies: BetaHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard private-bèta-runtime is al geconfigureerd.");
  defaultHandler = createBetaHttpHandler(dependencies);
}

export function handleDefaultBetaRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De private-bèta-API is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultBetaRuntimeForTests(): void {
  defaultHandler = undefined;
}

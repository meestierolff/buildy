import { jsonError } from "../http/responses.js";
import { createProfileHttpHandler, type ProfileHttpDependencies } from "./http.js";

type ProfileHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: ProfileHandler | undefined;

/** Compose only after the trusted server-owned actor resolver is available. */
export function configureDefaultProfileRuntime(dependencies: ProfileHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard profielruntime is al geconfigureerd.");
  defaultHandler = createProfileHttpHandler(dependencies);
}

export function handleDefaultProfileRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De profiel-API is nog niet veilig aan de sessieruntime gekoppeld.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultProfileRuntimeForTests(): void {
  defaultHandler = undefined;
}

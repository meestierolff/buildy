import { jsonError } from "../http/responses.js";
import {
  createEngagementHttpHandler,
  type EngagementHttpDependencies,
  type EngagementRouteParameters,
} from "./http.js";

type EngagementHandler = (
  request: Request,
  requestId: string,
  parameters?: EngagementRouteParameters,
) => Promise<Response>;

let defaultHandler: EngagementHandler | undefined;

/** Compose only after a trusted Better Auth session-to-app-user mapper exists. */
export function configureDefaultEngagementRuntime(
  dependencies: EngagementHttpDependencies,
): void {
  if (defaultHandler) throw new Error("De standaard engagementruntime is al geconfigureerd.");
  defaultHandler = createEngagementHttpHandler(dependencies);
}

export function handleDefaultEngagementRequest(
  request: Request,
  requestId: string,
  parameters: EngagementRouteParameters = {},
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De engagement-API is nog niet veilig aan de sessieruntime gekoppeld.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId, parameters);
}

export function resetDefaultEngagementRuntimeForTests(): void {
  defaultHandler = undefined;
}

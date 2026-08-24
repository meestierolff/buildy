import { jsonError } from "../http/responses.js";
import { createProjectHttpHandler, type ProjectHttpDependencies, type ProjectRouteParameters } from "./http.js";

type ProjectHandler = (
  request: Request,
  requestId: string,
  parameters?: ProjectRouteParameters,
) => Promise<Response>;

let defaultHandler: ProjectHandler | undefined;

/** Compose only after a trusted session-to-app-user mapper exists. */
export function configureDefaultProjectRuntime(dependencies: ProjectHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard projectruntime is al geconfigureerd.");
  defaultHandler = createProjectHttpHandler(dependencies);
}

export function handleDefaultProjectRequest(
  request: Request,
  requestId: string,
  parameters: ProjectRouteParameters = {},
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De project-API is nog niet veilig aan de sessieruntime gekoppeld.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId, parameters);
}

export function resetDefaultProjectRuntimeForTests(): void {
  defaultHandler = undefined;
}

import { jsonError } from "../http/responses.js";
import { createPlanningHttpHandler, type PlanningHttpDependencies } from "./http.js";

type PlanningHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: PlanningHandler | undefined;

/** Compose only after a trusted session-to-app-user mapper exists. */
export function configureDefaultPlanningRuntime(dependencies: PlanningHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard planningruntime is al geconfigureerd.");
  defaultHandler = createPlanningHttpHandler(dependencies);
}

export function handleDefaultPlanningRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De planning-API is nog niet veilig aan de sessieruntime gekoppeld.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultPlanningRuntimeForTests(): void {
  defaultHandler = undefined;
}

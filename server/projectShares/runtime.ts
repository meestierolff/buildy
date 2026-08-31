import { jsonError } from "../http/responses.js";
import {
  createProjectShareHttpHandler,
  type ProjectShareHttpDependencies,
  type ProjectShareRouteParameters,
} from "./http.js";

type ProjectShareHandler = (
  request: Request,
  requestId: string,
  parameters?: ProjectShareRouteParameters,
) => Promise<Response>;

let defaultHandler: ProjectShareHandler | undefined;

export function configureDefaultProjectShareRuntime(dependencies: ProjectShareHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard deellinkruntime is al geconfigureerd.");
  defaultHandler = createProjectShareHttpHandler(dependencies);
}

export function handleDefaultProjectShareRequest(
  request: Request,
  requestId: string,
  parameters: ProjectShareRouteParameters = {},
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De deellink-API is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId, parameters);
}

export function resetDefaultProjectShareRuntimeForTests(): void {
  defaultHandler = undefined;
}

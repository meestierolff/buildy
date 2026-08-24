import { jsonError } from "../http/responses.js";
import {
  createMediaHttpHandler,
  type MediaHttpDependencies,
  type MediaRouteParameters,
} from "./http.js";

type MediaHandler = (
  request: Request,
  requestId: string,
  parameters?: MediaRouteParameters,
) => Promise<Response>;

let defaultHandler: MediaHandler | undefined;

export function configureDefaultMediaRuntime(
  dependencies: MediaHttpDependencies,
): void {
  if (defaultHandler) throw new Error("De standaard mediaruntime is al geconfigureerd.");
  defaultHandler = createMediaHttpHandler(dependencies);
}

export function handleDefaultMediaRequest(
  request: Request,
  requestId: string,
  parameters: MediaRouteParameters = {},
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "PROVIDER_UNAVAILABLE",
      "De private mediaopslag is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId, parameters);
}

export function resetDefaultMediaRuntimeForTests(): void {
  defaultHandler = undefined;
}

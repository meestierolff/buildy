import { jsonError } from "../http/responses.js";
import {
  createPhotobookHttpHandler,
  type PhotobookHttpDependencies,
  type PhotobookRouteParameters,
} from "./http.js";

type PhotobookHandler = (
  request: Request,
  requestId: string,
  parameters?: PhotobookRouteParameters,
) => Promise<Response>;

let defaultHandler: PhotobookHandler | undefined;

export function configureDefaultPhotobookRuntime(
  dependencies: PhotobookHttpDependencies,
): void {
  if (defaultHandler) throw new Error("De standaard Bouwboekruntime is al geconfigureerd.");
  defaultHandler = createPhotobookHttpHandler(dependencies);
}

export function handleDefaultPhotobookRequest(
  request: Request,
  requestId: string,
  parameters: PhotobookRouteParameters = {},
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "PROVIDER_UNAVAILABLE",
      "De private Bouwboekservice is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId, parameters);
}

export function resetDefaultPhotobookRuntimeForTests(): void {
  defaultHandler = undefined;
}

import { jsonError } from "../http/responses.js";
import { createModerationHttpHandler, type ModerationHttpDependencies } from "./http.js";

type ModerationHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: ModerationHandler | undefined;

export function configureDefaultModerationRuntime(dependencies: ModerationHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard moderatieruntime is al geconfigureerd.");
  defaultHandler = createModerationHttpHandler(dependencies);
}

export function handleDefaultModerationRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De meldings- en feedback-API is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultModerationRuntimeForTests(): void {
  defaultHandler = undefined;
}


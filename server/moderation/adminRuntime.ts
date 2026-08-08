import { jsonError } from "../http/responses.js";
import {
  createModerationAdminHttpHandler,
  type ModerationAdminHttpDependencies,
} from "./adminHttp.js";

type ModerationAdminHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: ModerationAdminHandler | undefined;

export function configureDefaultModerationAdminRuntime(
  dependencies: ModerationAdminHttpDependencies,
): void {
  if (defaultHandler) throw new Error("De standaard moderatie-adminruntime is al geconfigureerd.");
  defaultHandler = createModerationAdminHttpHandler(dependencies);
}

export function handleDefaultModerationAdminRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De moderatie-admin-API is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultModerationAdminRuntimeForTests(): void {
  defaultHandler = undefined;
}

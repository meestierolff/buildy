import { jsonError } from "../http/responses.js";
import { createFeedbackAdminHttpHandler, type FeedbackAdminHttpDependencies } from "./http.js";

type FeedbackAdminHandler = (request: Request, requestId: string) => Promise<Response>;
let defaultHandler: FeedbackAdminHandler | undefined;

export function configureDefaultFeedbackAdminRuntime(dependencies: FeedbackAdminHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard feedback-adminruntime is al geconfigureerd.");
  defaultHandler = createFeedbackAdminHttpHandler(dependencies);
}

export function handleDefaultFeedbackAdminRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De feedback-admin-API is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultFeedbackAdminRuntimeForTests(): void {
  defaultHandler = undefined;
}

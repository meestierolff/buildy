import { jsonError } from "../http/responses.js";
import { createSocialHttpHandler, type SocialHttpDependencies } from "./http.js";

type SocialHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: SocialHandler | undefined;

export function configureDefaultSocialRuntime(dependencies: SocialHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard socialruntime is al geconfigureerd.");
  defaultHandler = createSocialHttpHandler(dependencies);
}

export function handleDefaultSocialRequest(request: Request, requestId: string): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "De sociale API is nog niet veilig aan de sessieruntime gekoppeld.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultSocialRuntimeForTests(): void {
  defaultHandler = undefined;
}

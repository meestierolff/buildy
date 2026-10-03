import { jsonError } from "../http/responses.js";
import { createBookOrderHttpHandler, type BookOrderHttpDependencies } from "./http.js";
let handler: ReturnType<typeof createBookOrderHttpHandler> | undefined;
export function configureDefaultBookOrderRuntime(dependencies: BookOrderHttpDependencies) {
  if (handler) throw new Error("De boekbestellingenruntime is al geconfigureerd.");
  handler = createBookOrderHttpHandler(dependencies);
}
export function handleDefaultBookOrderRequest(request: Request, requestId: string, parameters: Readonly<Record<string, string>> = {}) {
  return handler ? handler(request, requestId, parameters) : Promise.resolve(jsonError(503, "PROVIDER_UNAVAILABLE", "Boekaanvragen zijn tijdelijk niet beschikbaar.", requestId));
}
export function resetDefaultBookOrderRuntimeForTests() { handler = undefined; }

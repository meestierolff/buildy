import { jsonError } from "../http/responses.js";
import {
  createMediaHttpHandler,
  type MediaHttpDependencies,
  type MediaRouteParameters,
} from "./http.js";
import type { MediaProcessingWorker } from "./worker.js";

type MediaHandler = (
  request: Request,
  requestId: string,
  parameters?: MediaRouteParameters,
) => Promise<Response>;

let defaultHandler: MediaHandler | undefined;
let defaultWorker: { cronSecret: string; worker: MediaProcessingWorker } | undefined;

export function configureDefaultMediaRuntime(
  dependencies: MediaHttpDependencies & { cronSecret: string; worker: MediaProcessingWorker },
): void {
  if (defaultHandler || defaultWorker) throw new Error("De standaard mediaruntime is al geconfigureerd.");
  if (Buffer.byteLength(dependencies.cronSecret, "utf8") < 32) {
    throw new Error("De mediaworker-cronsecret is ongeldig.");
  }
  defaultHandler = createMediaHttpHandler(dependencies);
  defaultWorker = { cronSecret: dependencies.cronSecret, worker: dependencies.worker };
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

export function resolveDefaultMediaWorker(): { cronSecret: string; worker: MediaProcessingWorker } {
  if (!defaultWorker) throw new Error("De mediaworker is niet geconfigureerd.");
  return defaultWorker;
}

export function resetDefaultMediaRuntimeForTests(): void {
  defaultHandler = undefined;
  defaultWorker = undefined;
}

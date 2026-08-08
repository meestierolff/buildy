import { jsonError } from "../http/responses.js";
import {
  createPhotobookHttpHandler,
  type PhotobookHttpDependencies,
  type PhotobookRouteParameters,
} from "./http.js";
import type { PhotobookProofWorker } from "./worker.js";

type PhotobookHandler = (
  request: Request,
  requestId: string,
  parameters?: PhotobookRouteParameters,
) => Promise<Response>;

let defaultHandler: PhotobookHandler | undefined;
let defaultWorker: { cronSecret: string; worker: PhotobookProofWorker } | undefined;

export function configureDefaultPhotobookRuntime(
  dependencies: PhotobookHttpDependencies & { cronSecret: string; worker: PhotobookProofWorker },
): void {
  if (defaultHandler || defaultWorker) throw new Error("De standaard Bouwboekruntime is al geconfigureerd.");
  if (Buffer.byteLength(dependencies.cronSecret, "utf8") < 32) {
    throw new Error("De Bouwboekworker-cronsecret is ongeldig.");
  }
  defaultHandler = createPhotobookHttpHandler(dependencies);
  defaultWorker = { cronSecret: dependencies.cronSecret, worker: dependencies.worker };
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

export function resolveDefaultPhotobookWorker(): { cronSecret: string; worker: PhotobookProofWorker } {
  if (!defaultWorker) throw new Error("De Bouwboekworker is niet geconfigureerd.");
  return defaultWorker;
}

export function resetDefaultPhotobookRuntimeForTests(): void {
  defaultHandler = undefined;
  defaultWorker = undefined;
}

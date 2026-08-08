import { HttpError } from "../http/errors.js";
import type { PrintProvider } from "../print/printProvider.js";
import { createPeechoCallbackHandler } from "./callback.js";
import type { PeechoFulfilmentWorker } from "./worker.js";
import type {
  PeechoFulfilmentRepository,
  ProviderInboxEnvironment,
} from "./types.js";

type PeechoCallbackHandler = ReturnType<typeof createPeechoCallbackHandler>;

export interface PeechoFulfilmentRuntime {
  cronSecret: string;
  worker: PeechoFulfilmentWorker;
  applicationEnvironment: ProviderInboxEnvironment;
  provider: Pick<PrintProvider, "environment" | "verifyCallback" | "getOrder">;
  repository: Pick<PeechoFulfilmentRepository, "recordCallback">;
}

let defaultRuntime: PeechoFulfilmentRuntime | undefined;
let defaultCallback: PeechoCallbackHandler | undefined;

export function configureDefaultPeechoFulfilmentRuntime(runtime: PeechoFulfilmentRuntime): void {
  if (defaultRuntime || defaultCallback) throw new Error("De standaard Peecho-fulfilmentruntime is al geconfigureerd.");
  if (Buffer.byteLength(runtime.cronSecret, "utf8") < 32) {
    throw new Error("De Peecho-worker-cronsecret is ongeldig.");
  }
  defaultRuntime = runtime;
  defaultCallback = createPeechoCallbackHandler({
    applicationEnvironment: runtime.applicationEnvironment,
    provider: runtime.provider,
    repository: runtime.repository,
  });
}

export function resolveDefaultPeechoFulfilmentRuntime(): PeechoFulfilmentRuntime {
  if (!defaultRuntime) throw new Error("De Peecho-fulfilmentworker is niet geconfigureerd.");
  return defaultRuntime;
}

export function handleDefaultPeechoCallback(request: Request, requestId: string): Promise<Response> {
  if (!defaultCallback) {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De Peecho-callback is niet veilig geconfigureerd.");
  }
  return defaultCallback(request, requestId);
}

export function resetDefaultPeechoFulfilmentRuntimeForTests(): void {
  defaultRuntime = undefined;
  defaultCallback = undefined;
}

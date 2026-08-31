import { jsonError } from "../http/responses.js";
import { createAccountHttpHandler, type AccountHttpDependencies } from "./http.js";
import type { MediaProcessingWorker } from "../media/worker.js";
import type { AccountLifecycleWorker } from "./worker.js";

type AccountHandler = (request: Request, requestId: string) => Promise<Response>;

export interface AccountWorkerRuntime {
  cronSecret: string;
  worker: AccountLifecycleWorker;
  orphanCleanup?: Pick<MediaProcessingWorker, "cleanupOrphans">;
}

let defaultHandler: AccountHandler | undefined;
let workerRuntime: AccountWorkerRuntime | undefined;

export function configureDefaultAccountRuntime(
  dependencies: AccountHttpDependencies & AccountWorkerRuntime,
): void {
  if (defaultHandler || workerRuntime) throw new Error("De standaard accountruntime is al geconfigureerd.");
  defaultHandler = createAccountHttpHandler(dependencies);
  workerRuntime = {
    cronSecret: dependencies.cronSecret,
    worker: dependencies.worker,
    ...(dependencies.orphanCleanup ? { orphanCleanup: dependencies.orphanCleanup } : {}),
  };
}

export function handleDefaultAccountRequest(request: Request, requestId: string): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "Accountbeheer is nog niet veilig aan de serverruntime gekoppeld.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resolveDefaultAccountWorker(): AccountWorkerRuntime {
  if (!workerRuntime) throw new Error("De accountworker is niet geconfigureerd.");
  return workerRuntime;
}

export function resetDefaultAccountRuntimeForTests(): void {
  defaultHandler = undefined;
  workerRuntime = undefined;
}

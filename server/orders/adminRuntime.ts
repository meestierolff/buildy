import { jsonError } from "../http/responses.js";
import {
  createOrderAdminHttpHandler,
  type OrderAdminHttpDependencies,
} from "./adminHttp.js";

type OrderAdminHandler = (request: Request, requestId: string) => Promise<Response>;

let defaultHandler: OrderAdminHandler | undefined;

export function configureDefaultOrderAdminRuntime(
  dependencies: OrderAdminHttpDependencies,
): void {
  if (defaultHandler) throw new Error("De standaard bestellingbeheer-runtime is al geconfigureerd.");
  defaultHandler = createOrderAdminHttpHandler(dependencies);
}

export function handleDefaultOrderAdminRequest(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "AUTH_UNAVAILABLE",
      "Bestellingbeheer is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultOrderAdminRuntimeForTests(): void {
  defaultHandler = undefined;
}

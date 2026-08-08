import { jsonError } from "../http/responses.js";
import {
  createOrderHttpHandler,
  type OrderHttpDependencies,
  type OrderRouteParameters,
} from "./http.js";

type OrderHandler = (
  request: Request,
  requestId: string,
  parameters?: OrderRouteParameters,
) => Promise<Response>;

let defaultHandler: OrderHandler | undefined;

export function configureDefaultOrderRuntime(dependencies: OrderHttpDependencies): void {
  if (defaultHandler) throw new Error("De standaard bestelruntime is al geconfigureerd.");
  defaultHandler = createOrderHttpHandler(dependencies);
}

export function handleDefaultOrderRequest(
  request: Request,
  requestId: string,
  parameters: OrderRouteParameters = {},
): Promise<Response> {
  if (!defaultHandler) {
    return Promise.resolve(jsonError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Bestellen is nog niet veilig geconfigureerd.",
      requestId,
    ));
  }
  return defaultHandler(request, requestId, parameters);
}

export function resetDefaultOrderRuntimeForTests(): void {
  defaultHandler = undefined;
}

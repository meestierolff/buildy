import { HttpError } from "../http/errors.js";
import {
  createStripePaymentWebhookHandler,
  type ProviderInboxEnvironment,
  type StripePaymentEventRepository,
} from "./paymentWebhook.js";
import type { PaymentProvider } from "../payments/paymentProvider.js";

type StripePaymentWebhookHandler = ReturnType<typeof createStripePaymentWebhookHandler>;

let defaultHandler: StripePaymentWebhookHandler | undefined;

export function configureDefaultStripePaymentWebhookRuntime(input: {
  applicationEnvironment: ProviderInboxEnvironment;
  payments: Pick<PaymentProvider, "verifyWebhook">;
  repository: StripePaymentEventRepository;
}): void {
  if (defaultHandler) throw new Error("De Stripe-webhookruntime is al geconfigureerd.");
  defaultHandler = createStripePaymentWebhookHandler(input);
}

export function handleDefaultStripePaymentWebhook(
  request: Request,
  requestId: string,
): Promise<Response> {
  if (!defaultHandler) {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De betaalwebhook is niet veilig geconfigureerd.");
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultStripePaymentWebhookRuntimeForTests(): void {
  defaultHandler = undefined;
}

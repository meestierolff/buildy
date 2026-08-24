export type PaymentEnvironment = "test" | "live";

export interface CheckoutLine {
  label: string;
  description?: string;
  unitAmountMinor: number;
  quantity: number;
}

export interface CreateCheckoutInput {
  orderId: string;
  orderNumber: string;
  merchantReference: string;
  currency: "EUR";
  lines: CheckoutLine[];
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface CheckoutSession {
  provider: "stripe";
  sessionId: string;
  url: string;
  expiresAt: string;
}

export interface VerifiedPaymentEvent {
  provider: "stripe";
  providerEventId: string;
  type: string;
  objectId: string;
  createdAt: string;
  environment: PaymentEnvironment;
  accountId?: string;
  orderId?: string;
  orderNumber?: string;
  merchantReference?: string;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  paymentStatus?: string;
  amountTotalMinor?: number;
  amountRefundedMinor?: number;
  refunded?: boolean;
  currency?: string;
  rawEvent: unknown;
}

export interface PaymentProvider {
  verifyAccount(): Promise<void>;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(payload: string | Uint8Array, signature: string): Promise<VerifiedPaymentEvent>;
}

export class PaymentProviderError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CHECKOUT"
      | "ACCOUNT_MISMATCH"
      | "ENVIRONMENT_MISMATCH"
      | "INVALID_SIGNATURE"
      | "PROVIDER_UNAVAILABLE",
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PaymentProviderError";
  }
}

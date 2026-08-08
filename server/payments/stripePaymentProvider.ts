import Stripe from "stripe";
import {
  PaymentProviderError,
  type CheckoutSession,
  type CreateCheckoutInput,
  type PaymentEnvironment,
  type PaymentProvider,
  type VerifiedPaymentEvent,
} from "./paymentProvider.js";

export interface StripePaymentProviderConfig {
  secretKey: string;
  webhookSecret: string;
  expectedAccountId: string;
  environment: PaymentEnvironment;
}

const ISO_COUNTRY = /^[A-Z]{2}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireHttpsCheckoutUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((!local && url.protocol !== "https:") || (local && !["http:", "https:"].includes(url.protocol))) {
    throw new PaymentProviderError("INVALID_CHECKOUT", "Checkoutredirect vereist een veilige origin.", false);
  }
  if (url.username || url.password) {
    throw new PaymentProviderError("INVALID_CHECKOUT", "Checkoutredirect mag geen credentials bevatten.", false);
  }
  return url.toString();
}

function validateCheckout(input: CreateCheckoutInput): CreateCheckoutInput {
  if (!UUID.test(input.orderId) || !/^BLD-[A-Z0-9-]{8,40}$/.test(input.orderNumber)) {
    throw new PaymentProviderError("INVALID_CHECKOUT", "Checkoutorder heeft geen geldige identiteit.", false);
  }
  if (
    input.merchantReference.length < 8 ||
    input.merchantReference.length > 100 ||
    !IDEMPOTENCY_KEY.test(input.idempotencyKey)
  ) {
    throw new PaymentProviderError("INVALID_CHECKOUT", "Checkoutreferentie is ongeldig.", false);
  }
  if (input.lines.length < 1 || input.lines.length > 8) {
    throw new PaymentProviderError("INVALID_CHECKOUT", "Checkout bevat een ongeldig aantal regels.", false);
  }
  for (const line of input.lines) {
    if (
      !line.label.trim() ||
      line.label.length > 120 ||
      !Number.isSafeInteger(line.unitAmountMinor) ||
      line.unitAmountMinor < 0 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 20
    ) {
      throw new PaymentProviderError("INVALID_CHECKOUT", "Checkoutregel is ongeldig.", false);
    }
  }
  if (
    input.allowedShippingCountries.length < 1 ||
    input.allowedShippingCountries.length > 20 ||
    input.allowedShippingCountries.some((country) => !ISO_COUNTRY.test(country))
  ) {
    throw new PaymentProviderError("INVALID_CHECKOUT", "Verzendlanden zijn ongeldig.", false);
  }
  requireHttpsCheckoutUrl(input.successUrl);
  requireHttpsCheckoutUrl(input.cancelUrl);
  return input;
}

function objectMetadata(object: Stripe.Event.Data.Object): Record<string, string> {
  if (!("metadata" in object) || !object.metadata) return {};
  return Object.fromEntries(
    Object.entries(object.metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function objectString(object: Stripe.Event.Data.Object, key: string): string | undefined {
  if (!(key in object)) return undefined;
  const value = (object as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function objectNumber(object: Stripe.Event.Data.Object, key: string): number | undefined {
  if (!(key in object)) return undefined;
  const value = (object as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function objectBoolean(object: Stripe.Event.Data.Object, key: string): boolean | undefined {
  if (!(key in object)) return undefined;
  const value = (object as unknown as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

function relatedObjectId(object: Stripe.Event.Data.Object, key: string): string | undefined {
  if (!(key in object)) return undefined;
  const value = (object as unknown as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("id" in value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

export class StripePaymentProvider implements PaymentProvider {
  private readonly stripe: Stripe;
  private accountVerification: Promise<void> | undefined;

  constructor(
    private readonly config: StripePaymentProviderConfig,
    stripe?: Stripe,
  ) {
    const expectedKeyPrefix = config.environment === "live" ? "sk_live_" : "sk_test_";
    if (
      !config.secretKey.startsWith(expectedKeyPrefix)
      || !config.webhookSecret.startsWith("whsec_")
      || !/^acct_[A-Za-z0-9]+$/.test(config.expectedAccountId)
    ) {
      throw new PaymentProviderError("PROVIDER_UNAVAILABLE", "Stripe-configuratie is onvolledig.", false);
    }
    this.stripe = stripe ?? new Stripe(config.secretKey, {
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
    });
  }

  async verifyAccount(): Promise<void> {
    let account: Stripe.Account;
    try {
      account = await this.stripe.accounts.retrieveCurrent();
    } catch (error) {
      throw new PaymentProviderError("PROVIDER_UNAVAILABLE", "Stripe-account kon niet worden geverifieerd.", true, {
        cause: error,
      });
    }
    if (account.id !== this.config.expectedAccountId) {
      throw new PaymentProviderError("ACCOUNT_MISMATCH", "Stripe-key hoort niet bij het verwachte Buildy-account.", false);
    }
  }

  async createCheckout(inputValue: CreateCheckoutInput): Promise<CheckoutSession> {
    const input = validateCheckout(inputValue);
    this.accountVerification ??= this.verifyAccount().catch((error: unknown) => {
      this.accountVerification = undefined;
      throw error;
    });
    await this.accountVerification;
    const allowedCountries = input.allowedShippingCountries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[];
    let session: Stripe.Checkout.Session;

    try {
      session = await this.stripe.checkout.sessions.create({
        mode: "payment",
        submit_type: "pay",
        client_reference_id: input.orderId,
        customer_email: input.customerEmail,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(Date.now() / 1_000) + 30 * 60,
        shipping_address_collection: { allowed_countries: allowedCountries },
        line_items: input.lines.map((line) => ({
          quantity: line.quantity,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: line.unitAmountMinor,
            product_data: {
              name: line.label,
              description: line.description,
              metadata: { app: "buildy", order_id: input.orderId },
            },
          },
        })),
        metadata: {
          app: "buildy",
          order_id: input.orderId,
          order_number: input.orderNumber,
          merchant_reference: input.merchantReference,
        },
        payment_intent_data: {
          statement_descriptor_suffix: "BUILDY BOUWBOEK",
          metadata: {
            app: "buildy",
            order_id: input.orderId,
            order_number: input.orderNumber,
            merchant_reference: input.merchantReference,
          },
        },
      }, { idempotencyKey: input.idempotencyKey });
    } catch (error) {
      throw new PaymentProviderError("PROVIDER_UNAVAILABLE", "Stripe Checkout kon niet worden aangemaakt.", true, {
        cause: error,
      });
    }

    if (!session.url || !session.expires_at) {
      throw new PaymentProviderError("PROVIDER_UNAVAILABLE", "Stripe Checkout gaf geen bruikbare sessie terug.", true);
    }

    return {
      provider: "stripe",
      sessionId: session.id,
      url: session.url,
      expiresAt: new Date(session.expires_at * 1_000).toISOString(),
    };
  }

  async verifyWebhook(payload: string | Uint8Array, signature: string): Promise<VerifiedPaymentEvent> {
    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(payload, signature, this.config.webhookSecret);
    } catch (error) {
      throw new PaymentProviderError("INVALID_SIGNATURE", "Stripe-webhooksignature is ongeldig.", false, {
        cause: error,
      });
    }

    const eventEnvironment: PaymentEnvironment = event.livemode ? "live" : "test";
    if (eventEnvironment !== this.config.environment) {
      throw new PaymentProviderError("ENVIRONMENT_MISMATCH", "Stripe-event hoort bij een andere omgeving.", false);
    }
    if (event.account && event.account !== this.config.expectedAccountId) {
      throw new PaymentProviderError("ACCOUNT_MISMATCH", "Stripe-event hoort niet bij het Buildy-account.", false);
    }

    const object = event.data.object;
    const metadata = objectMetadata(object);
    if (metadata.app !== "buildy") {
      throw new PaymentProviderError("ACCOUNT_MISMATCH", "Stripe-object hoort niet bij Buildy.", false);
    }

    const objectId = objectString(object, "id") ?? event.id;
    const checkoutSessionId = event.type.startsWith("checkout.session.") ? objectId : undefined;
    const paymentIntentId = event.type.startsWith("payment_intent.")
      ? objectId
      : relatedObjectId(object, "payment_intent");

    return {
      provider: "stripe",
      providerEventId: event.id,
      type: event.type,
      objectId,
      createdAt: new Date(event.created * 1_000).toISOString(),
      environment: eventEnvironment,
      accountId: event.account ?? undefined,
      orderId: metadata.order_id,
      orderNumber: metadata.order_number,
      merchantReference: metadata.merchant_reference,
      checkoutSessionId,
      paymentIntentId,
      paymentStatus: objectString(object, "payment_status") ?? objectString(object, "status"),
      amountTotalMinor: objectNumber(object, "amount_total") ?? objectNumber(object, "amount"),
      amountRefundedMinor: objectNumber(object, "amount_refunded"),
      refunded: objectBoolean(object, "refunded"),
      currency: objectString(object, "currency")?.toUpperCase(),
      rawEvent: event,
    };
  }
}

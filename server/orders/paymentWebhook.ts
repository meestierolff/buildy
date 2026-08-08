import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RuntimeConfig } from "../config/runtime.js";
import type { BuildyDatabase } from "../db/client.js";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import {
  PaymentProviderError,
  type PaymentProvider,
  type VerifiedPaymentEvent,
} from "../payments/paymentProvider.js";

const MAX_WEBHOOK_BYTES = 512 * 1024;
const MAX_SIGNATURE_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_NUMBER = /^BLD-[A-Z0-9-]{8,40}$/;
const PROVIDER_EVENT_ID = /^evt_[A-Za-z0-9_]{3,250}$/;
const CHECKOUT_SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9_]{3,250}$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{3,250}$/;

export const STRIPE_ORDER_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
] as const;

export type StripeOrderEventType = (typeof STRIPE_ORDER_EVENT_TYPES)[number];
export type ProviderInboxEnvironment = "preview" | "staging" | "production" | "test";

export interface ApplyStripePaymentEventCommand {
  applicationEnvironment: ProviderInboxEnvironment;
  providerEnvironment: "test" | "live";
  providerEventId: string;
  eventType: StripeOrderEventType;
  eventAt: Date;
  orderId: string;
  orderNumber: string;
  merchantReference: string;
  objectId: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  paymentStatus: string | null;
  amountTotalMinor: number | null;
  amountRefundedMinor: number | null;
  currency: string | null;
  payloadSha256: string;
}

export interface StripePaymentEventResult {
  applied: boolean;
  orderId: string | null;
  outcome:
    | "paid"
    | "processing"
    | "payment_failed"
    | "expired"
    | "partially_refunded"
    | "refunded"
    | "ignored"
    | "manual_review"
    | "duplicate"
    | "order_not_found";
}

export interface StripePaymentEventRepository {
  apply(command: ApplyStripePaymentEventCommand): Promise<StripePaymentEventResult>;
}

function applicationEnvironment(environment: RuntimeConfig["APP_ENV"]): ProviderInboxEnvironment {
  return environment === "local" ? "test" : environment;
}

function supportedEventType(value: string): value is StripeOrderEventType {
  return (STRIPE_ORDER_EVENT_TYPES as readonly string[]).includes(value);
}

function optionalInteger(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event bevat een ongeldig bedrag.");
  }
  return value;
}

function requiredMetadata(event: VerifiedPaymentEvent): {
  merchantReference: string;
  orderId: string;
  orderNumber: string;
} {
  if (
    !event.orderId
    || !UUID.test(event.orderId)
    || !event.orderNumber
    || !ORDER_NUMBER.test(event.orderNumber)
    || !event.merchantReference
    || event.merchantReference.length < 8
    || event.merchantReference.length > 100
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event mist geldige Buildy-referenties.");
  }
  return {
    orderId: event.orderId.toLowerCase(),
    orderNumber: event.orderNumber,
    merchantReference: event.merchantReference,
  };
}

function commandFromEvent(
  event: VerifiedPaymentEvent,
  rawBody: string,
  environment: ProviderInboxEnvironment,
): ApplyStripePaymentEventCommand {
  if (!supportedEventType(event.type) || !PROVIDER_EVENT_ID.test(event.providerEventId)) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event wordt niet ondersteund.");
  }
  const references = requiredMetadata(event);
  const eventAt = new Date(event.createdAt);
  if (
    !Number.isFinite(eventAt.getTime())
    || eventAt < new Date("2020-01-01T00:00:00.000Z")
    || eventAt.getTime() > Date.now() + 5 * 60_000
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event heeft een ongeldige tijd.");
  }

  const isCheckoutEvent = event.type.startsWith("checkout.session.");
  if (isCheckoutEvent && (!event.checkoutSessionId || !CHECKOUT_SESSION_ID.test(event.checkoutSessionId))) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event mist de Checkout Session.");
  }
  if (event.paymentIntentId && !PAYMENT_INTENT_ID.test(event.paymentIntentId)) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event bevat een ongeldige PaymentIntent.");
  }
  if (!event.objectId || event.objectId.length > 255) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event heeft geen geldig object-ID.");
  }
  if (event.currency && !/^[A-Z]{3}$/.test(event.currency)) {
    throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event bevat een ongeldige valuta.");
  }

  return {
    applicationEnvironment: environment,
    providerEnvironment: event.environment,
    providerEventId: event.providerEventId,
    eventType: event.type,
    eventAt,
    ...references,
    objectId: event.objectId,
    checkoutSessionId: event.checkoutSessionId ?? null,
    paymentIntentId: event.paymentIntentId ?? null,
    paymentStatus: event.paymentStatus?.slice(0, 80) ?? null,
    amountTotalMinor: optionalInteger(event.amountTotalMinor),
    amountRefundedMinor: optionalInteger(event.amountRefundedMinor),
    currency: event.currency ?? null,
    payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
  };
}

function translateProviderError(error: unknown): never {
  if (!(error instanceof PaymentProviderError)) throw error;
  if (error.code === "PROVIDER_UNAVAILABLE") {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De betaalprovider is tijdelijk niet beschikbaar.");
  }
  throw new HttpError(400, "BAD_REQUEST", "Het betaalprovider-event kon niet veilig worden geverifieerd.");
}

export class PostgresStripePaymentEventRepository implements StripePaymentEventRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async apply(command: ApplyStripePaymentEventCommand): Promise<StripePaymentEventResult> {
    const result = await this.database.execute<{
      applied: boolean;
      order_id: string | null;
      outcome: StripePaymentEventResult["outcome"];
    }>(sql`
      select *
      from public.app_apply_stripe_payment_event(
        ${command.applicationEnvironment},
        ${command.providerEnvironment},
        ${command.providerEventId},
        ${command.eventType},
        ${command.eventAt},
        ${command.orderId}::uuid,
        ${command.orderNumber},
        ${command.merchantReference},
        ${command.objectId},
        ${command.checkoutSessionId},
        ${command.paymentIntentId},
        ${command.paymentStatus},
        ${command.amountTotalMinor},
        ${command.amountRefundedMinor},
        ${command.currency},
        ${command.payloadSha256}
      )
    `);
    const row = result.rows[0];
    if (!row) throw new Error("Stripe-event is niet duurzaam verwerkt.");
    return { applied: row.applied, orderId: row.order_id, outcome: row.outcome };
  }
}

export function createStripePaymentWebhookHandler(input: {
  applicationEnvironment: ProviderInboxEnvironment;
  payments: Pick<PaymentProvider, "verifyWebhook">;
  repository: StripePaymentEventRepository;
}) {
  return async (request: Request, requestId: string): Promise<Response> => {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
      throw new HttpError(413, "BAD_REQUEST", "De betaalwebhookpayload is te groot.");
    }
    const signature = request.headers.get("stripe-signature");
    if (!signature || Buffer.byteLength(signature, "utf8") > MAX_SIGNATURE_BYTES) {
      throw new HttpError(400, "BAD_REQUEST", "De betaalwebhooksignature ontbreekt of is ongeldig.");
    }
    const rawBody = await request.text();
    const bodyBytes = Buffer.byteLength(rawBody, "utf8");
    if (bodyBytes < 2 || bodyBytes > MAX_WEBHOOK_BYTES) {
      throw new HttpError(400, "BAD_REQUEST", "De betaalwebhookpayload heeft een ongeldige grootte.");
    }

    let event: VerifiedPaymentEvent;
    try {
      event = await input.payments.verifyWebhook(rawBody, signature);
    } catch (error) {
      translateProviderError(error);
    }

    if (!supportedEventType(event.type)) {
      return jsonSuccess({ accepted: false, reason: "event_ignored" as const }, requestId, { status: 202 });
    }

    const command = commandFromEvent(event, rawBody, input.applicationEnvironment);
    const applied = await input.repository.apply(command);
    return jsonSuccess({ accepted: true, ...applied }, requestId);
  };
}

export function stripeWebhookApplicationEnvironment(
  environment: RuntimeConfig["APP_ENV"],
): ProviderInboxEnvironment {
  return applicationEnvironment(environment);
}

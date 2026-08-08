import { z } from "zod";
import {
  sellerSnapshotSchema,
  shippingAddressSchema,
} from "../../shared/contracts/orders.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import {
  buildOrderConfirmationEmail,
  renderTransactionalEmail,
  type RenderedTransactionalEmail,
} from "./render.js";
import type { EmailTemplateCatalog, EmailTemplateKey } from "./templates.js";
import type { TransactionalEmailMessage } from "./transactionalEmail.js";

const orderEmailKinds = [
  "confirmation",
  "payment_failed",
  "in_production",
  "shipped",
  "refund_review",
] as const;
export type OrderEmailKind = (typeof orderEmailKinds)[number];

const eventTypeByKind: Readonly<Record<OrderEmailKind, string>> = {
  confirmation: "order.email.confirmation.requested.v1",
  payment_failed: "order.email.payment_failed.requested.v1",
  in_production: "order.email.in_production.requested.v1",
  shipped: "order.email.shipped.requested.v1",
  refund_review: "order.email.refund_review.requested.v1",
};

const idempotencyLabelByKind: Readonly<Record<OrderEmailKind, string>> = {
  confirmation: "confirmation",
  payment_failed: "payment-failed",
  in_production: "in-production",
  shipped: "shipped",
  refund_review: "refund-review",
};

const templateKeyByKind: Readonly<Record<OrderEmailKind, EmailTemplateKey>> = {
  confirmation: "order.confirmation",
  payment_failed: "order.payment_failed",
  in_production: "order.in_production",
  shipped: "order.shipped",
  refund_review: "order.refund_review",
};

const eventSchema = z.object({
  id: z.string().uuid(),
  aggregateId: z.string().uuid(),
  aggregateType: z.literal("photobook_order"),
  eventType: z.string().min(1).max(120),
  idempotencyKey: z.string().min(16).max(160),
  payload: z.record(z.unknown()),
  attemptCount: z.number().int().nonnegative(),
}).strict();

const checkoutSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sku: z.literal("a4-landscape-hardcover-v1"),
  format: z.literal("a4-landscape-hardcover-v1"),
  projectTitle: z.string().trim().min(1).max(120),
  pageCount: z.number().int().min(24).max(400),
  taxTreatment: z.enum(["vat_included", "vat_exclusive", "vat_exempt"]),
  personalisedProduct: z.literal(true),
}).passthrough();

export const orderEmailContextSchema = z.object({
  orderId: z.string().uuid(),
  ownerId: z.string().uuid(),
  orderNumber: z.string().regex(/^BLD-[A-Z0-9-]{8,40}$/),
  currency: z.literal("EUR"),
  quantity: z.number().int().min(1).max(100),
  subtotalMinor: z.number().int().nonnegative(),
  shippingMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  refundedMinor: z.number().int().nonnegative(),
  shippingCountry: z.string().regex(/^[A-Z]{2}$/),
  customerEmailCiphertext: z.string().min(1).max(200_000),
  shippingDetailsCiphertext: z.string().min(1).max(200_000),
  checkoutSnapshot: z.record(z.unknown()),
  sellerSnapshot: z.record(z.unknown()),
  termsVersion: z.string().trim().min(1).max(80),
  deliveryEstimate: z.string().trim().min(1).max(160),
  status: z.string().min(1).max(80),
  paymentStatus: z.string().min(1).max(80),
  fulfilmentStatus: z.string().min(1).max(80),
  trackingUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  paidAt: z.coerce.date().nullable(),
}).strict().refine(
  (context) => context.totalMinor === context.subtotalMinor + context.shippingMinor + context.taxMinor,
  { message: "Het ordermailsnapshot heeft geen sluitend totaal." },
).refine(
  (context) => context.refundedMinor <= context.totalMinor,
  { message: "Het terugbetaalde bedrag is hoger dan het ordertotaal." },
);

export type OrderEmailContext = z.infer<typeof orderEmailContextSchema>;

export interface PreparedOrderEmail {
  delivery: {
    idempotencyKey: string;
    recipientHash: string;
    templateKey: EmailTemplateKey;
    templateVersion: string;
  };
  message: TransactionalEmailMessage;
}

export class OrderEmailPayloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OrderEmailPayloadError";
  }
}

function eventKind(eventType: string): OrderEmailKind | undefined {
  return orderEmailKinds.find((kind) => eventTypeByKind[kind] === eventType);
}

function assertOrderStateForEmail(kind: OrderEmailKind, context: OrderEmailContext): void {
  const valid = (() => {
    switch (kind) {
      case "confirmation":
        return context.paidAt !== null
          && ["paid", "partially_refunded", "refunded"].includes(context.paymentStatus);
      case "payment_failed":
        return context.status === "payment_failed" && context.paymentStatus === "failed";
      case "in_production":
        return ["in_production", "shipped", "delivered"].includes(context.fulfilmentStatus);
      case "shipped":
        return ["shipped", "delivered"].includes(context.fulfilmentStatus);
      case "refund_review":
        return context.refundedMinor > 0
          && ["partially_refunded", "refunded"].includes(context.paymentStatus);
    }
  })();

  if (!valid) {
    throw new OrderEmailPayloadError("Ordermail past niet bij de actuele serverstatus.");
  }
}

function money(minor: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(minor / 100);
}

function dateTime(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(value);
}

function orderUrl(appOrigin: string, orderId: string): string {
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
    throw new OrderEmailPayloadError("Orderstatus vereist een veilige applicatie-origin.");
  }
  return new URL(`/bestellingen/${orderId}`, origin).toString();
}

function addressLabel(address: z.infer<typeof shippingAddressSchema>): string {
  return [
    `${address.firstName} ${address.lastName}`,
    address.addressLine1,
    address.addressLine2,
    `${address.postalCode} ${address.city}`,
    address.state,
    address.countryCode,
  ].filter((part): part is string => Boolean(part)).join(", ");
}

function taxLabel(treatment: z.infer<typeof checkoutSnapshotSchema>["taxTreatment"], taxMinor: number): string {
  if (treatment === "vat_exempt") return "Vrijgesteld";
  return treatment === "vat_included"
    ? `${money(taxMinor)} inbegrepen`
    : `${money(taxMinor)} apart berekend`;
}

function statusEmail(input: {
  kind: Exclude<OrderEmailKind, "confirmation">;
  context: OrderEmailContext;
  orderStatusUrl: string;
}): RenderedTransactionalEmail {
  const { context, kind, orderStatusUrl } = input;
  const sharedFacts = [
    { label: "Ordernummer", value: context.orderNumber },
    { label: "Bouwboek", value: `A4 liggend hardcover · ${context.quantity}×` },
    { label: "Totaal", value: money(context.totalMinor) },
  ];

  if (kind === "payment_failed") {
    return renderTransactionalEmail({
      subject: `Betaling voor ${context.orderNumber} is niet gelukt`,
      previewText: "Je Bouwboek is niet naar productie gestuurd.",
      heading: "Betaling niet voltooid",
      paragraphs: [
        "We hebben geen geldige betaalbevestiging ontvangen. Je Bouwboek is daarom niet naar productie gestuurd.",
        "Open je Bouwboek vanuit Buildy om de actuele, serverbevestigde status te bekijken.",
      ],
      facts: sharedFacts,
      callToAction: { label: "Bekijk je bestelling", url: orderStatusUrl },
    });
  }
  if (kind === "in_production") {
    return renderTransactionalEmail({
      subject: `Je Bouwboek ${context.orderNumber} is in productie`,
      previewText: "De drukker is met je persoonlijke Bouwboek begonnen.",
      heading: "Je Bouwboek wordt gemaakt",
      paragraphs: ["Je goedgekeurde printproof is door de drukker geaccepteerd en de productie is gestart."],
      facts: [...sharedFacts, { label: "Verwachte levering", value: context.deliveryEstimate }],
      callToAction: { label: "Bekijk de orderstatus", url: orderStatusUrl },
    });
  }
  if (kind === "shipped") {
    return renderTransactionalEmail({
      subject: `Je Bouwboek ${context.orderNumber} is verzonden`,
      previewText: "Je persoonlijke Bouwboek is onderweg.",
      heading: "Je Bouwboek is onderweg",
      paragraphs: ["De drukker heeft je Bouwboek verzonden. Gebruik de beveiligde orderstatus voor de actuele bezorginformatie."],
      facts: sharedFacts,
      callToAction: { label: "Bekijk verzending", url: context.trackingUrl ?? orderStatusUrl },
    });
  }
  return renderTransactionalEmail({
    subject: `Terugbetaling voor ${context.orderNumber} wordt gecontroleerd`,
    previewText: "Betaling en fysieke productie worden afzonderlijk beoordeeld.",
    heading: "Handmatige controle gestart",
    paragraphs: [
      "Stripe heeft een terugbetaling gemeld. Omdat dit een fysiek maatwerkproduct is, controleren we de betaal- en productiestatus afzonderlijk.",
      "Een terugbetaling annuleert de drukopdracht niet automatisch. De actuele status blijft zichtbaar in Buildy.",
    ],
    facts: [
      ...sharedFacts,
      { label: "Terugbetaald", value: money(context.refundedMinor) },
    ],
    callToAction: { label: "Bekijk de orderstatus", url: orderStatusUrl },
  });
}

export function prepareOrderEmail(input: {
  rawEvent: unknown;
  rawContext: unknown;
  keyring: DataProtectionKeyring;
  blindIndex: PrivacyBlindIndex;
  templates: EmailTemplateCatalog;
  appOrigin: string;
}): { event: z.infer<typeof eventSchema>; prepared: PreparedOrderEmail } {
  try {
    const event = eventSchema.parse(input.rawEvent);
    const context = orderEmailContextSchema.parse(input.rawContext);
    const kind = eventKind(event.eventType);
    if (!kind || event.aggregateId !== context.orderId) {
      throw new OrderEmailPayloadError("Ordermail-event en ordersnapshot komen niet overeen.");
    }
    const expectedIdempotencyKey = `order:${context.orderId}:email:${idempotencyLabelByKind[kind]}:v1`;
    if (event.idempotencyKey !== expectedIdempotencyKey) {
      throw new OrderEmailPayloadError("Ordermail-idempotentiesleutel is ongeldig.");
    }
    assertOrderStateForEmail(kind, context);

    const customerEmail = input.keyring.decrypt(
      context.customerEmailCiphertext,
      `photobook-order:${context.orderId}:customer-email`,
    );
    const shippingAddress = shippingAddressSchema.parse(JSON.parse(input.keyring.decrypt(
      context.shippingDetailsCiphertext,
      `photobook-order:${context.orderId}:shipping-address`,
    )) as unknown);
    if (shippingAddress.countryCode !== context.shippingCountry) {
      throw new OrderEmailPayloadError("Ordermail-bestemming wijkt af van het ordersnapshot.");
    }
    const checkout = checkoutSnapshotSchema.parse(context.checkoutSnapshot);
    const seller = sellerSnapshotSchema.parse(context.sellerSnapshot);
    const orderStatusUrl = orderUrl(input.appOrigin, context.orderId);
    const templateKey = templateKeyByKind[kind];
    const template = input.templates.resolve(templateKey);

    const content = kind === "confirmation"
      ? buildOrderConfirmationEmail({
        orderNumber: context.orderNumber,
        orderDate: dateTime(context.createdAt),
        bookVariant: `Bouwboek “${checkout.projectTitle}” · A4 liggend hardcover`,
        pageCount: checkout.pageCount,
        quantity: context.quantity,
        subtotal: money(context.subtotalMinor),
        vatStatus: taxLabel(checkout.taxTreatment, context.taxMinor),
        shipping: money(context.shippingMinor),
        total: money(context.totalMinor),
        currency: context.currency,
        deliveryEstimate: context.deliveryEstimate,
        shippingDestination: addressLabel(shippingAddress),
        sellerLegalIdentity: `${seller.legalName} · ${seller.registrationNumber}${seller.vatNumber ? ` · ${seller.vatNumber}` : ""}`,
        sellerContact: `${seller.tradeName} · ${seller.supportEmail} · ${seller.address}`,
        acceptedTermsVersion: context.termsVersion,
        customizationNotice: "Gepersonaliseerd maatwerk op basis van jouw goedgekeurde printproof; de maatwerkuitzondering op het herroepingsrecht is van toepassing.",
        orderStatusUrl,
      })
      : statusEmail({ kind, context, orderStatusUrl });

    return {
      event,
      prepared: {
        delivery: {
          idempotencyKey: event.idempotencyKey,
          recipientHash: input.blindIndex.create("email-recipient", customerEmail),
          templateKey,
          templateVersion: template.version,
        },
        message: {
          recipient: {
            email: customerEmail,
            name: `${shippingAddress.firstName} ${shippingAddress.lastName}`,
          },
          content,
          idempotencyKey: event.idempotencyKey,
          tags: ["order", kind.replaceAll("_", "-")],
        },
      },
    };
  } catch (error) {
    if (error instanceof OrderEmailPayloadError) throw error;
    throw new OrderEmailPayloadError("Beschermde ordermailpayload is ongeldig.", { cause: error });
  }
}

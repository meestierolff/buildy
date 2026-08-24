import { z } from "zod";
import { apiSuccessSchema } from "./api.js";
import { LAUNCH_PHOTOBOOK_FORMAT } from "./photobooks.js";

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const isoCountrySchema = z.string().regex(/^[A-Z]{2}$/);

export const launchPhotobookSkuSchema = z.literal("a4-landscape-hardcover-v1");

export const shippingAddressSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().min(1).max(160),
  addressLine2: z.string().trim().max(160).nullable(),
  postalCode: z.string().trim().min(1).max(24),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).nullable(),
  countryCode: isoCountrySchema,
}).strict();

const photobookPurchaseSelectionSchema = z.object({
  documentSha256: sha256Schema,
  pdfSha256: sha256Schema,
  quantity: z.number().int().min(1).max(5),
  shippingAddress: shippingAddressSchema,
}).strict();

export const requestPhotobookQuoteInputSchema = photobookPurchaseSelectionSchema;

export const photobookOrderStatusSchema = z.enum([
  "draft",
  "awaiting_payment",
  "checkout_open",
  "paid",
  "payment_failed",
  "expired",
  "cancelled",
  "manual_review",
]);

export const paymentStatusSchema = z.enum([
  "unpaid",
  "processing",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
]);

export const fulfilmentStatusSchema = z.enum([
  "awaiting_review",
  "reviewed",
  "ordered_manually",
  "in_production",
  "shipped",
  "completed",
  "manual_review",
  "cancelled",
  "refund_review",
]);

export const manualFulfilmentActionSchema = z.enum([
  "review",
  "ordered_manually",
  "mark_in_production",
  "mark_shipped",
  "mark_completed",
  "manual_review",
  "cancel",
  "refund_review",
  "update_details",
]);

export const photobookOrderAmountSchema = z.object({
  currency: z.literal("EUR"),
  subtotalMinor: z.number().int().nonnegative(),
  shippingMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
}).strict().refine(
  (amount) => amount.totalMinor === amount.subtotalMinor + amount.shippingMinor + amount.taxMinor,
  { message: "Het ordertotaal moet exact uit product, verzending en belasting bestaan." },
);

export const createPhotobookCheckoutInputSchema = photobookPurchaseSelectionSchema.extend({
  idempotencyKey: uuidSchema,
  expectedQuoteReference: z.string().trim().min(1).max(200),
  expectedQuoteExpiresAt: z.string().datetime(),
  expectedAmounts: photobookOrderAmountSchema,
  termsVersion: z.string().trim().min(1).max(80),
  termsAccepted: z.literal(true),
  personalisedProductAccepted: z.literal(true),
}).strict();

export const sellerSnapshotSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().min(1).max(160),
  registrationNumber: z.string().trim().min(1).max(80),
  vatNumber: z.string().trim().min(1).max(80).nullable(),
  address: z.string().trim().min(1).max(500),
  countryCode: isoCountrySchema,
  supportEmail: z.string().email(),
}).strict();

export const photobookQuoteResponseSchema = apiSuccessSchema(z.object({
  proofRevisionId: uuidSchema,
  sku: launchPhotobookSkuSchema,
  format: z.literal(LAUNCH_PHOTOBOOK_FORMAT),
  pageCount: z.number().int().min(24).max(400),
  quantity: z.number().int().min(1).max(5),
  destinationCountry: isoCountrySchema,
  quoteReference: z.string().min(1).max(200),
  amounts: photobookOrderAmountSchema,
  deliveryEstimate: z.string().trim().min(1).max(160),
  taxTreatment: z.enum(["vat_included", "vat_exclusive", "vat_exempt"]),
  expiresAt: z.string().datetime(),
  termsVersion: z.string().min(1).max(80),
  seller: sellerSnapshotSchema,
  personalisedProduct: z.literal(true),
}));

export const photobookCheckoutResponseSchema = apiSuccessSchema(z.object({
  orderId: uuidSchema,
  orderNumber: z.string().regex(/^BLD-[A-Z0-9-]{8,40}$/),
  projectId: uuidSchema,
  proofRevisionId: uuidSchema,
  sku: launchPhotobookSkuSchema,
  format: z.literal(LAUNCH_PHOTOBOOK_FORMAT),
  pageCount: z.number().int().min(24).max(400),
  quantity: z.number().int().min(1).max(5),
  destinationCountry: isoCountrySchema,
  amounts: photobookOrderAmountSchema,
  deliveryEstimate: z.string().trim().min(1).max(160),
  termsVersion: z.string().min(1).max(80),
  status: z.literal("checkout_open"),
  checkoutUrl: z.string().url(),
  checkoutExpiresAt: z.string().datetime(),
  replayed: z.boolean(),
}));

export const photobookOrderHistoryEntrySchema = z.object({
  id: uuidSchema,
  eventType: z.string().trim().min(1).max(100),
  fromStatus: z.string().trim().min(1).max(80).nullable(),
  toStatus: z.string().trim().min(1).max(80).nullable(),
  occurredAt: z.string().datetime(),
}).strict();

export const photobookOrderDetailSchema = z.object({
  orderId: uuidSchema,
  orderNumber: z.string().regex(/^BLD-[A-Z0-9-]{8,40}$/),
  projectId: uuidSchema,
  projectTitle: z.string().trim().min(1).max(120),
  proofRevisionId: uuidSchema,
  sku: launchPhotobookSkuSchema,
  format: z.literal(LAUNCH_PHOTOBOOK_FORMAT),
  pageCount: z.number().int().min(24).max(400),
  quantity: z.number().int().positive(),
  destinationCountry: isoCountrySchema,
  amounts: photobookOrderAmountSchema,
  deliveryEstimate: z.string().trim().min(1).max(160),
  termsVersion: z.string().min(1).max(80),
  status: photobookOrderStatusSchema,
  paymentStatus: paymentStatusSchema,
  refundedMinor: z.number().int().nonnegative(),
  fulfilmentStatus: fulfilmentStatusSchema,
  trackingUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  paidAt: z.string().datetime().nullable(),
  statusHistory: z.array(photobookOrderHistoryEntrySchema),
}).strict();

export const photobookOrderResponseSchema = apiSuccessSchema(photobookOrderDetailSchema);

export const customerOrderListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const customerOrderListItemSchema = photobookOrderDetailSchema.omit({
  proofRevisionId: true,
  sku: true,
  format: true,
  destinationCountry: true,
  deliveryEstimate: true,
  termsVersion: true,
  refundedMinor: true,
  trackingUrl: true,
  statusHistory: true,
});

export const customerOrderListPageSchema = z.object({
  items: z.array(customerOrderListItemSchema),
  nextCursor: z.string().nullable(),
}).strict();

export const customerOrderListResponseSchema = apiSuccessSchema(customerOrderListPageSchema);

export const adminOrderQueueQuerySchema = z.object({
  status: z.union([z.literal("all"), fulfilmentStatusSchema]).default("all"),
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export const adminOrderQueueItemSchema = z.object({
  orderId: uuidSchema,
  orderNumber: z.string().regex(/^BLD-[A-Z0-9-]{8,40}$/),
  customerName: z.string().trim().min(1).max(80),
  projectId: uuidSchema,
  projectTitle: z.string().trim().min(1).max(160),
  paidAt: z.string().datetime(),
  quantity: z.number().int().positive(),
  pageCount: z.number().int().min(24).max(400),
  currency: z.literal("EUR"),
  totalMinor: z.number().int().nonnegative(),
  paymentStatus: paymentStatusSchema,
  fulfilmentStatus: fulfilmentStatusSchema,
  needsAttention: z.boolean(),
  version: z.number().int().positive(),
}).strict();

export const adminOrderQueuePageSchema = z.object({
  items: z.array(adminOrderQueueItemSchema),
  nextCursor: z.string().nullable(),
}).strict();

export const adminOrderEventSchema = z.object({
  id: uuidSchema,
  eventType: z.string().trim().min(1).max(100),
  actorUserId: uuidSchema.nullable(),
  fromStatus: z.string().trim().min(1).max(80).nullable(),
  toStatus: z.string().trim().min(1).max(80).nullable(),
  occurredAt: z.string().datetime(),
}).strict();

export const adminOrderDetailSchema = adminOrderQueueItemSchema.extend({
  ownerId: uuidSchema,
  customerEmail: z.string().email(),
  shippingAddress: shippingAddressSchema,
  proofRevisionId: uuidSchema,
  documentSha256: sha256Schema,
  pdfSha256: sha256Schema,
  amounts: photobookOrderAmountSchema,
  refundedMinor: z.number().int().nonnegative(),
  manualProviderReference: z.string().trim().min(1).max(200).nullable(),
  fulfilmentNotes: z.string().max(4000).nullable(),
  trackingUrl: z.string().url().nullable(),
  seller: sellerSnapshotSchema,
  stripeReferences: z.object({
    checkoutSessionId: z.string().nullable(),
    paymentIntentId: z.string().nullable(),
    chargeId: z.string().nullable(),
  }).strict(),
  milestones: z.object({
    reviewedAt: z.string().datetime().nullable(),
    orderedManuallyAt: z.string().datetime().nullable(),
    inProductionAt: z.string().datetime().nullable(),
    shippedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    refundReviewAt: z.string().datetime().nullable(),
  }).strict(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pdfPath: z.string().min(1),
  events: z.array(adminOrderEventSchema),
}).strict();

export const adminOrderActionInputSchema = z.object({
  action: manualFulfilmentActionSchema,
  expectedVersion: z.number().int().positive(),
  externalReference: z.string().trim().min(1).max(200).nullable().optional(),
  trackingUrl: z.string().url().refine((url) => url.startsWith("https://"), {
    message: "De trackinglink moet HTTPS gebruiken.",
  }).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  idempotencyKey: uuidSchema,
}).strict();

export const adminOrderActionResultSchema = z.object({
  orderId: uuidSchema,
  fulfilmentStatus: fulfilmentStatusSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
}).strict();

export const adminOrderQueueResponseSchema = apiSuccessSchema(adminOrderQueuePageSchema);
export const adminOrderDetailResponseSchema = apiSuccessSchema(adminOrderDetailSchema);
export const adminOrderActionResponseSchema = apiSuccessSchema(adminOrderActionResultSchema);

export type CreatePhotobookCheckoutInput = z.infer<typeof createPhotobookCheckoutInputSchema>;
export type RequestPhotobookQuoteInput = z.infer<typeof requestPhotobookQuoteInputSchema>;
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
export type PhotobookOrderAmount = z.infer<typeof photobookOrderAmountSchema>;
export type PhotobookOrderHistoryEntry = z.infer<typeof photobookOrderHistoryEntrySchema>;
export type PhotobookOrderDetail = z.infer<typeof photobookOrderDetailSchema>;
export type CustomerOrderListQuery = z.infer<typeof customerOrderListQuerySchema>;
export type CustomerOrderListItem = z.infer<typeof customerOrderListItemSchema>;
export type CustomerOrderListPage = z.infer<typeof customerOrderListPageSchema>;
export type SellerSnapshot = z.infer<typeof sellerSnapshotSchema>;
export type ManualFulfilmentStatus = z.infer<typeof fulfilmentStatusSchema>;
export type ManualFulfilmentAction = z.infer<typeof manualFulfilmentActionSchema>;
export type AdminOrderQueueQuery = z.infer<typeof adminOrderQueueQuerySchema>;
export type AdminOrderQueueItem = z.infer<typeof adminOrderQueueItemSchema>;
export type AdminOrderQueuePage = z.infer<typeof adminOrderQueuePageSchema>;
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;
export type AdminOrderActionInput = z.infer<typeof adminOrderActionInputSchema>;
export type AdminOrderActionResult = z.infer<typeof adminOrderActionResultSchema>;

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

export const createPhotobookCheckoutInputSchema = photobookPurchaseSelectionSchema.extend({
  idempotencyKey: uuidSchema,
  expectedQuoteReference: z.string().trim().min(1).max(200),
  expectedTotalMinor: z.number().int().nonnegative(),
  termsVersion: z.string().trim().min(1).max(80),
  personalisedProductAccepted: z.literal(true),
}).strict();

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
  "unclaimed",
  "claimed",
  "peecho_order_created",
  "peecho_payment_pending",
  "submitted_to_production",
  "in_production",
  "shipped",
  "delivered",
  "failed",
  "retry_scheduled",
  "manual_review",
  "cancelled",
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

export const photobookOrderDetailSchema = z.object({
  orderId: uuidSchema,
  orderNumber: z.string().regex(/^BLD-[A-Z0-9-]{8,40}$/),
  projectId: uuidSchema,
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
}).strict();

export const photobookOrderResponseSchema = apiSuccessSchema(photobookOrderDetailSchema);

export type CreatePhotobookCheckoutInput = z.infer<typeof createPhotobookCheckoutInputSchema>;
export type RequestPhotobookQuoteInput = z.infer<typeof requestPhotobookQuoteInputSchema>;
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
export type PhotobookOrderAmount = z.infer<typeof photobookOrderAmountSchema>;
export type PhotobookOrderDetail = z.infer<typeof photobookOrderDetailSchema>;
export type SellerSnapshot = z.infer<typeof sellerSnapshotSchema>;

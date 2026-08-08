import { z } from "zod";

const trimmedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => trimmedText(maximum).optional();
const providerIdSchema = z.string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((value) => Number.isSafeInteger(Number(value)), "Provider-ID valt buiten het veilige integerbereik.");
const countryCodeSchema = z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase());
const currencySchema = z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
const idempotencyKeySchema = z.string()
  .trim()
  .min(16)
  .max(100)
  .regex(/^[A-Za-z0-9:_-]+$/);

const httpsUrlSchema = z.string().url().max(2_048).superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Printbestanden vereisen een HTTPS-URL zonder credentials of fragment.",
    });
  }
});

export const printOfferingsQuerySchema = z.object({
  countryCode: countryCodeSchema.optional(),
  categoryCode: z.string().trim().min(1).max(40).optional(),
  subcategoryCode: z.string().trim().min(1).max(40).optional(),
  currency: currencySchema.default("EUR"),
}).strict();

export const printQuoteInputSchema = z.object({
  countryCode: countryCodeSchema,
  state: optionalText(120),
  currency: currencySchema.default("EUR"),
  items: z.array(z.object({
    offeringId: providerIdSchema,
    pageCount: z.number().int().positive().max(10_000).optional(),
    quantity: z.number().int().positive().max(10_000),
  }).strict()).min(1).max(20),
}).strict();

export const printAddressSchema = z.object({
  firstName: trimmedText(100),
  lastName: trimmedText(100),
  addressLine1: trimmedText(200),
  addressLine2: optionalText(200),
  postalCode: trimmedText(40),
  city: trimmedText(120),
  state: optionalText(120),
  countryCode: countryCodeSchema,
  phoneNumber: optionalText(40),
  companyName: optionalText(160),
  vatNumber: optionalText(80),
  vatCountryCode: countryCodeSchema.optional(),
}).strict();

export const printFileSchema = z.object({
  contentUrl: httpsUrlSchema,
  coverUrl: httpsUrlSchema.optional(),
  customSpineUrl: httpsUrlSchema.optional(),
  widthMm: z.number().positive().max(10_000),
  heightMm: z.number().positive().max(10_000),
  pageCount: z.number().int().positive().max(10_000),
}).strict();

export const createPrintOrderInputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  currency: currencySchema,
  customerEmail: z.string().trim().email().max(320),
  shippingAddress: printAddressSchema,
  billingAddress: printAddressSchema.optional(),
  purchaseOrder: optionalText(120),
  costCentre: optionalText(120),
  billingEntityId: z.number().int().positive().optional(),
  items: z.array(z.object({
    reference: trimmedText(120),
    title: optionalText(160),
    offeringId: providerIdSchema,
    quantity: z.number().int().positive().max(10_000),
    file: printFileSchema.optional(),
  }).strict()).min(1).max(20),
}).strict().superRefine((input, context) => {
  const references = new Set<string>();
  input.items.forEach((item, index) => {
    if (references.has(item.reference)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Itemreferenties moeten uniek zijn binnen de order.",
        path: ["items", index, "reference"],
      });
    }
    references.add(item.reference);
  });
});

export const payPrintOrderInputSchema = z.object({
  providerOrderId: providerIdSchema,
}).strict();

export const getPrintOrderInputSchema = z.object({
  providerOrderId: providerIdSchema,
  merchantReference: optionalText(100),
}).strict();

export type PrintProviderEnvironment = "test" | "live";
export type PrintProviderOperation =
  | "configure"
  | "getOfferings"
  | "getProductSpecification"
  | "getQuote"
  | "createOrder"
  | "payOrder"
  | "getOrder"
  | "verifyCallback";

export type PrintOrderStatus =
  | "awaiting_payment"
  | "paid"
  | "manual_review"
  | "queued"
  | "submitted"
  | "in_production"
  | "shipped"
  | "cancelled"
  | "refunded"
  | "failed"
  | "unknown";

export interface MappedPrintStatus {
  status: PrintOrderStatus;
  providerStatus: string;
  known: boolean;
  terminal: boolean;
}

export interface PrintMoney {
  currency: string;
  amountMinor: number;
}

export interface PrintOffering {
  id: string;
  name: string;
  categoryCode: string;
  subcategoryCode: string;
  paperType: string | null;
  catalogueItemCode: string;
  minimumQuantity: number;
  minimumPageCount: number;
  maximumPageCount: number;
  widthMm: number;
  heightMm: number;
  dynamicSize: boolean;
  minimumWidthMm: number | null;
  minimumHeightMm: number | null;
  basePrice: PrintMoney;
  pricePerPage: PrintMoney;
}

export type PrintProductSpecification = PrintOffering;

export interface PrintQuote {
  destination: { countryCode: string; state: string | null };
  currency: string;
  exchangeRate: string;
  items: Array<{
    offeringId: string;
    pageCount: number;
    quantity: number;
    basePrice: PrintMoney;
    pricePerPage: PrintMoney;
    productPrice: PrintMoney;
    shippingPrice: PrintMoney;
    quantityDiscount: PrintMoney;
    taxRateBasisPoints: number;
    tax: PrintMoney;
    total: PrintMoney;
  }>;
  summary: {
    itemCount: number;
    wholesalePrice: PrintMoney;
    shippingPrice: PrintMoney;
    quantityDiscount: PrintMoney;
    taxes: Array<{ rateBasisPoints: number; amount: PrintMoney }>;
  };
}

export type PrintOfferingsQuery = z.input<typeof printOfferingsQuerySchema>;
export type PrintQuoteInput = z.input<typeof printQuoteInputSchema>;
export type CreatePrintOrderInput = z.input<typeof createPrintOrderInputSchema>;
export type PayPrintOrderInput = z.input<typeof payPrintOrderInputSchema>;
export type GetPrintOrderInput = z.input<typeof getPrintOrderInputSchema>;

export interface PrintOrderCreated {
  providerOrderId: string;
  merchantReference: string;
  status: MappedPrintStatus;
}

export interface PrintOrderPayment {
  providerOrderId: string;
  status: MappedPrintStatus;
}

export interface PrintOrder {
  providerOrderId: string;
  merchantReference: string | null;
  status: MappedPrintStatus;
  createdAt: string | null;
  currency: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  moderationReason: string | null;
  fulfilmentLocation: {
    countryCode: string | null;
    labCode: string | null;
  } | null;
}

export interface VerifiedPrintCallback {
  eventKey: string;
  providerOrderId: string;
  merchantReference: string;
  oldStatus: MappedPrintStatus;
  newStatus: MappedPrintStatus;
  trackingCode: string | null;
  trackingUrl: string | null;
  verifiedAt: string;
}

export interface PrintProviderRetryDecision {
  action: "retry" | "reconcile" | "do_not_retry";
  reason:
    | "safe_read"
    | "rate_limited"
    | "mutation_outcome_unknown"
    | "duplicate_reference"
    | "payment_state_unknown"
    | "invalid_request"
    | "invalid_response"
    | "authentication"
    | "cancelled"
    | "unknown";
  retryAfterMs?: number;
}

export type PrintProviderErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "OFFERING_NOT_FOUND"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "REQUEST_CANCELLED"
  | "PROVIDER_REJECTED"
  | "INVALID_RESPONSE"
  | "INVALID_CALLBACK";

export class PrintProviderError extends Error {
  constructor(
    public readonly code: PrintProviderErrorCode,
    public readonly operation: PrintProviderOperation,
    message: string,
    public readonly retry: PrintProviderRetryDecision,
    public readonly options: {
      httpStatus?: number;
      providerCode?: string;
      occurredAt: string;
    },
  ) {
    super(message);
    this.name = "PrintProviderError";
  }
}

export interface PrintProvider {
  readonly provider: string;
  readonly environment: PrintProviderEnvironment;
  readonly idempotency: {
    createOrder: "unique-merchant-reference";
    payOrder: "status-reconciliation-required";
  };
  getOfferings(input?: PrintOfferingsQuery): Promise<PrintOffering[]>;
  getProductSpecification(input: PrintOfferingsQuery & { offeringId: string }): Promise<PrintProductSpecification>;
  getQuote(input: PrintQuoteInput): Promise<PrintQuote>;
  createOrder(input: CreatePrintOrderInput): Promise<PrintOrderCreated>;
  payOrder(input: PayPrintOrderInput): Promise<PrintOrderPayment>;
  getOrder(input: GetPrintOrderInput): Promise<PrintOrder>;
  mapStatus(providerStatus: string): MappedPrintStatus;
  verifyCallback(payload: unknown): VerifiedPrintCallback;
  classifyRetry(error: unknown): PrintProviderRetryDecision;
}

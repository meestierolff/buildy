import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  PrintProviderError,
  createPrintOrderInputSchema,
  getPrintOrderInputSchema,
  payPrintOrderInputSchema,
  printOfferingsQuerySchema,
  printQuoteInputSchema,
  type CreatePrintOrderInput,
  type GetPrintOrderInput,
  type MappedPrintStatus,
  type PayPrintOrderInput,
  type PrintMoney,
  type PrintOffering,
  type PrintOfferingsQuery,
  type PrintOrder,
  type PrintOrderCreated,
  type PrintOrderPayment,
  type PrintProductSpecification,
  type PrintProvider,
  type PrintProviderEnvironment,
  type PrintProviderOperation,
  type PrintProviderRetryDecision,
  type PrintQuote,
  type PrintQuoteInput,
  type VerifiedPrintCallback,
} from "./printProvider.js";

export const PEECHO_V3_BASE_URLS = {
  test: "https://test.www.peecho.com/rest/v3/",
  live: "https://www.peecho.com/rest/v3/",
} as const satisfies Record<PrintProviderEnvironment, string>;

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const PROVIDER_STATUS = /^[A-Z][A-Z0-9_]{0,79}$/;
const READ_OPERATIONS = new Set<PrintProviderOperation>([
  "getOfferings",
  "getProductSpecification",
  "getQuote",
  "getOrder",
]);

const pricingSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  price: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pricePerPage: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

const offeringSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().min(1).max(500),
  paperType: z.string().max(200).nullable().optional(),
  catalogueItemCode: z.string().min(1).max(200),
  minimumQuantity: z.number().int().nonnegative().max(10_000),
  minNumberOfPages: z.number().int().nonnegative().max(10_000),
  maxNumberOfPages: z.number().int().positive().max(10_000),
  dimensionWidth: z.number().positive().max(10_000),
  dimensionHeight: z.number().positive().max(10_000),
  dynamicSize: z.boolean(),
  minDimensionWidth: z.number().positive().max(10_000).optional(),
  minDimensionHeight: z.number().positive().max(10_000).optional(),
  pricingDto: pricingSchema,
}).strict().refine(
  (offering) => offering.maxNumberOfPages >= offering.minNumberOfPages,
  "Maximum page count is lower than minimum page count.",
);

const offeringCatalogSchema = z.record(
  z.string().min(1).max(40),
  z.record(z.string().min(1).max(40), z.array(offeringSchema).max(10_000)),
);

const quoteResponseSchema = z.object({
  quoteDetails: z.object({
    countryCode: z.string().length(2),
    state: z.string().max(120).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    exchangeRate: z.union([z.string(), z.number()]).transform(String),
  }).strict(),
  quotedItems: z.array(z.object({
    offeringId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    numberOfPages: z.number().int().nonnegative().max(10_000),
    quantity: z.number().int().positive().max(10_000),
    basePrice: z.number().nonnegative(),
    pricePerPage: z.number().nonnegative(),
    productPrice: z.number().nonnegative(),
    shippingWholesale: z.number().nonnegative(),
    totalQuantityDiscount: z.number().nonnegative(),
    vatPercentage: z.number().nonnegative().max(100),
    vat: z.number().nonnegative(),
    totalItemPrice: z.number().nonnegative(),
  }).strict()).min(1).max(20),
  quoteSummary: z.object({
    numberOfItems: z.number().int().positive().max(20),
    totalWholesalePrice: z.number().nonnegative(),
    totalShippingPrice: z.number().nonnegative(),
    vatSummary: z.array(z.object({
      vatPercentage: z.number().nonnegative().max(100),
      vat: z.number().nonnegative(),
    }).strict()).max(20),
    totalQuantityDiscount: z.number().nonnegative(),
  }).strict(),
}).strict();

const createOrderResponseSchema = z.object({
  order_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();

const paymentResponseSchema = z.object({
  order_state: z.string().regex(PROVIDER_STATUS),
}).strict();

const providerIdResponseSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string()
    .regex(/^[1-9][0-9]{0,15}$/)
    .refine((value) => Number.isSafeInteger(Number(value))),
]);

const taxSchema = z.object({
  tax_name: z.union([z.string(), z.number()]).optional(),
  tax_percentage: z.union([z.string(), z.number()]).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
}).strict();

const orderPriceSchema = z.object({
  total_retail_product_price_ex_taxes: z.string().optional(),
  total_retail_shipping_ex_taxes: z.string().optional(),
  total_retail_price_ex_taxes: z.string().optional(),
  total_retail_price_inc_taxes: z.string().optional(),
  retail_product_taxes: taxSchema.optional(),
  retail_shipping_taxes: taxSchema.optional(),
  total_wholesale_product_price_ex_taxes: z.string().optional(),
  total_wholesale_shipping_ex_taxes: z.string().optional(),
  total_wholesale_price_ex_taxes: z.string().optional(),
  total_wholesale_price_inc_taxes: z.string().optional(),
  wholesale_product_taxes: taxSchema.optional(),
  wholesale_shipping_taxes: taxSchema.optional(),
}).strict();

const itemPriceSchema = z.object({
  item_id: z.union([z.string(), z.number()]).optional(),
  number_of_pages: z.number().int().nonnegative().optional(),
  offering_id: z.union([z.string(), z.number()]).optional(),
  publication_id: z.union([z.string(), z.number()]).optional(),
  quantity: z.number().int().nonnegative().optional(),
  retail_product_price: z.union([z.string(), z.number()]).optional(),
  retail_product_taxes: taxSchema.optional(),
  retail_shipping_price: z.union([z.string(), z.number()]).optional(),
  retail_shipping_taxes: taxSchema.optional(),
  wholesale_product_price: z.union([z.string(), z.number()]).optional(),
  wholesale_product_taxes: taxSchema.optional(),
  wholesale_shipping_price: z.union([z.string(), z.number()]).optional(),
  wholesale_shipping_taxes: taxSchema.optional(),
  total_wholesale_price_ex_taxes: z.union([z.string(), z.number()]).optional(),
  total_wholesale_price_inc_taxes: z.union([z.string(), z.number()]).optional(),
}).strict();

const returnedAddressSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  address_line_1: z.string().optional(),
  address_line_2: z.union([z.string(), z.number()]).optional(),
  country_code: z.string().optional(),
  zip_code: z.string().optional(),
  city: z.string().optional(),
  state: z.string().nullable().optional(),
}).strict();

const orderDetailsResponseSchema = z.object({
  order_id: providerIdResponseSchema,
  order_state: z.string().regex(PROVIDER_STATUS),
  moderation_reason: z.string().max(5_000).nullable().optional(),
  created_date: z.string().max(100).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  merchant_order_reference: z.union([z.string(), z.number()]).nullable().optional(),
  tracking_code: z.string().max(500).nullable().optional(),
  tracking_url: z.string().url().max(2_048).nullable().optional(),
  order_price_data: orderPriceSchema.nullable().optional(),
  item_price_data: z.union([itemPriceSchema, z.array(itemPriceSchema)]).nullable().optional(),
  address_details: returnedAddressSchema.nullable().optional(),
  fulfilment_location: z.object({
    country_code: z.string().nullable().optional(),
    lab_code: z.string().nullable().optional(),
  }).strict().nullable().optional(),
}).strict();

const providerErrorSchema = z.object({
  custom_code: z.string().regex(PROVIDER_CODE).optional(),
}).passthrough();

const callbackSchema = z.object({
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
  order_id: providerIdResponseSchema,
  order_reference: z.union([
    z.string().min(1).max(100),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ]).transform(String),
  old_status: z.string().regex(PROVIDER_STATUS),
  new_status: z.string().regex(PROVIDER_STATUS),
  tracking_code: z.string().max(500).nullable().optional(),
  tracking_url: z.string().url().max(2_048).nullable().optional(),
}).strict();

const productLookupSchema = printOfferingsQuerySchema.extend({
  offeringId: z.string().regex(/^[1-9][0-9]{0,15}$/),
}).strict();

const STATUS_MAP: Readonly<Record<string, Omit<MappedPrintStatus, "providerStatus">>> = {
  NO_PRINT_FACILITY_ERROR: { status: "failed", known: true, terminal: false },
  OPEN: { status: "awaiting_payment", known: true, terminal: false },
  PAID: { status: "paid", known: true, terminal: false },
  PAYMENT_ERROR: { status: "failed", known: true, terminal: false },
  CHECK_ORDER: { status: "manual_review", known: true, terminal: false },
  HOLD_ORDER_CHECK: { status: "manual_review", known: true, terminal: false },
  WAITING_TO_DISPATCH: { status: "queued", known: true, terminal: false },
  IN_PRINT_QUEUE: { status: "queued", known: true, terminal: false },
  SUBMITTED: { status: "submitted", known: true, terminal: false },
  SUBMISSION_ERROR: { status: "failed", known: true, terminal: false },
  IN_PRODUCTION: { status: "in_production", known: true, terminal: false },
  PRODUCTION_ERROR: { status: "failed", known: true, terminal: false },
  SHIPPED: { status: "shipped", known: true, terminal: true },
  CANCELLED: { status: "cancelled", known: true, terminal: true },
  REFUNDED: { status: "refunded", known: true, terminal: true },
};

type ClockHandle = unknown;

export interface PeechoV3Clock {
  now(): Date;
  setTimeout(callback: () => void, milliseconds: number): ClockHandle;
  clearTimeout(handle: ClockHandle): void;
}

const systemClock: PeechoV3Clock = {
  now: () => new Date(),
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface PeechoV3ProviderConfig {
  environment: PrintProviderEnvironment;
  merchantApiKey: string;
  secretKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  clock?: PeechoV3Clock;
}

interface ProviderRequest<T> {
  operation: PrintProviderOperation;
  path: string;
  method: "GET" | "POST";
  query?: URLSearchParams;
  body?: unknown;
  successStatuses: readonly number[];
  schema: z.ZodType<T>;
}

function providerOrderId(value: number | string): string {
  return String(value);
}

function safeDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function majorToMinor(value: number): number {
  const minor = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error("Unsafe monetary value");
  }
  return minor;
}

function money(currency: string, majorAmount: number): PrintMoney {
  return { currency, amountMinor: majorToMinor(majorAmount) };
}

function minorMoney(currency: string, minorAmount: number): PrintMoney {
  if (!Number.isSafeInteger(minorAmount) || minorAmount < 0) {
    throw new Error("Unsafe minor monetary value");
  }
  return { currency, amountMinor: minorAmount };
}

function retryAfterMs(response: Response, now: Date): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  if (/^[0-9]+$/.test(value)) return Math.min(Number(value) * 1_000, 60 * 60 * 1_000);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return Math.max(0, Math.min(date.getTime() - now.getTime(), 60 * 60 * 1_000));
}

function retryDecision(input: {
  operation: PrintProviderOperation;
  code: PrintProviderError["code"];
  httpStatus?: number;
  providerCode?: string;
  retryAfterMs?: number;
}): PrintProviderRetryDecision {
  const isRead = READ_OPERATIONS.has(input.operation);
  if (input.code === "REQUEST_CANCELLED") {
    return { action: "do_not_retry", reason: "cancelled" };
  }
  if (input.providerCode === "ORD_DUPLICATE") {
    return { action: "reconcile", reason: "duplicate_reference" };
  }
  if (input.operation === "payOrder" && input.providerCode === "ORD_PAID_STATE") {
    return { action: "reconcile", reason: "payment_state_unknown" };
  }
  if (input.providerCode === "APP_FORBIDDEN" || input.providerCode === "ORD_SECRET" || input.httpStatus === 401) {
    return { action: "do_not_retry", reason: "authentication" };
  }
  if (input.httpStatus === 429) {
    return {
      action: isRead ? "retry" : "reconcile",
      reason: isRead ? "rate_limited" : "mutation_outcome_unknown",
      ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
    };
  }
  const transient = input.code === "TIMEOUT"
    || input.code === "NETWORK_ERROR"
    || input.httpStatus === 408
    || input.httpStatus === 425
    || (input.httpStatus !== undefined && input.httpStatus >= 500);
  if (transient) {
    return {
      action: isRead ? "retry" : "reconcile",
      reason: isRead ? "safe_read" : "mutation_outcome_unknown",
      ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
    };
  }
  if (input.code === "INVALID_RESPONSE") {
    return {
      action: isRead ? "do_not_retry" : "reconcile",
      reason: isRead ? "invalid_response" : "mutation_outcome_unknown",
    };
  }
  if (
    input.code === "INVALID_CONFIGURATION"
    || input.code === "INVALID_REQUEST"
    || input.code === "OFFERING_NOT_FOUND"
    || input.code === "INVALID_CALLBACK"
    || input.code === "PROVIDER_REJECTED"
  ) {
    return { action: "do_not_retry", reason: "invalid_request" };
  }
  return { action: "do_not_retry", reason: "unknown" };
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function validateConfig(config: PeechoV3ProviderConfig): Required<Pick<
  PeechoV3ProviderConfig,
  "environment" | "merchantApiKey" | "timeoutMs" | "fetch" | "clock"
>> & Pick<PeechoV3ProviderConfig, "secretKey"> {
  const merchantApiKey = config.merchantApiKey;
  const secretKey = config.secretKey;
  const timeoutMs = config.timeoutMs ?? 10_000;
  if (
    !["test", "live"].includes(config.environment)
    || !merchantApiKey
    || merchantApiKey !== merchantApiKey.trim()
    || merchantApiKey.length > 512
    || /\s/.test(merchantApiKey)
    || containsControlCharacter(merchantApiKey)
    || (secretKey !== undefined && (
      secretKey.length < 1
      || secretKey.length > 512
      || secretKey !== secretKey.trim()
      || containsControlCharacter(secretKey)
    ))
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 250
    || timeoutMs > 60_000
    || !(config.fetch ?? globalThis.fetch)
  ) {
    throw new PrintProviderError(
      "INVALID_CONFIGURATION",
      "configure",
      "Peecho-configuratie is onvolledig of ongeldig.",
      { action: "do_not_retry", reason: "invalid_request" },
      { occurredAt: new Date().toISOString() },
    );
  }
  return {
    environment: config.environment,
    merchantApiKey,
    ...(secretKey === undefined ? {} : { secretKey }),
    timeoutMs,
    fetch: config.fetch ?? globalThis.fetch,
    clock: config.clock ?? systemClock,
  };
}

export class PeechoV3HttpProvider implements PrintProvider {
  readonly provider = "peecho-v3";
  readonly environment: PrintProviderEnvironment;
  readonly idempotency = {
    createOrder: "unique-merchant-reference",
    payOrder: "status-reconciliation-required",
  } as const;
  private readonly config: ReturnType<typeof validateConfig>;
  private readonly baseUrl: string;

  constructor(config: PeechoV3ProviderConfig) {
    this.config = validateConfig(config);
    this.environment = this.config.environment;
    this.baseUrl = PEECHO_V3_BASE_URLS[this.environment];
  }

  async getOfferings(input: PrintOfferingsQuery = {}): Promise<PrintOffering[]> {
    const parsed = this.parseInput("getOfferings", printOfferingsQuerySchema, input);
    return this.loadOfferings(parsed, "getOfferings");
  }

  async getProductSpecification(
    input: PrintOfferingsQuery & { offeringId: string },
  ): Promise<PrintProductSpecification> {
    const parsed = this.parseInput("getProductSpecification", productLookupSchema, input);
    const offerings = await this.loadOfferings(parsed, "getProductSpecification");
    const match = offerings.find((offering) => offering.id === parsed.offeringId);
    if (match) return match;
    throw this.error(
      "OFFERING_NOT_FOUND",
      "getProductSpecification",
      "De geconfigureerde Peecho-offering is niet beschikbaar voor deze accountbestemming.",
    );
  }

  async getQuote(input: PrintQuoteInput): Promise<PrintQuote> {
    const parsed = this.parseInput("getQuote", printQuoteInputSchema, input);
    const response = await this.request({
      operation: "getQuote",
      path: "quote",
      method: "POST",
      body: {
        apiKey: this.config.merchantApiKey,
        countryCode: parsed.countryCode,
        ...(parsed.state ? { state: parsed.state } : {}),
        currency: parsed.currency,
        items: parsed.items.map((item) => ({
          offeringId: Number(item.offeringId),
          ...(item.pageCount === undefined ? {} : { numberOfPages: item.pageCount }),
          quantity: item.quantity,
        })),
      },
      successStatuses: [200],
      schema: quoteResponseSchema,
    });
    const currency = response.quoteDetails.currency;
    try {
      return {
        destination: {
          countryCode: response.quoteDetails.countryCode,
          state: response.quoteDetails.state ?? null,
        },
        currency,
        exchangeRate: String(response.quoteDetails.exchangeRate),
        items: response.quotedItems.map((item) => ({
          offeringId: String(item.offeringId),
          pageCount: item.numberOfPages,
          quantity: item.quantity,
          basePrice: money(currency, item.basePrice),
          pricePerPage: money(currency, item.pricePerPage),
          productPrice: money(currency, item.productPrice),
          shippingPrice: money(currency, item.shippingWholesale),
          quantityDiscount: money(currency, item.totalQuantityDiscount),
          taxRateBasisPoints: Math.round(item.vatPercentage * 100),
          tax: money(currency, item.vat),
          total: money(currency, item.totalItemPrice),
        })),
        summary: {
          itemCount: response.quoteSummary.numberOfItems,
          wholesalePrice: money(currency, response.quoteSummary.totalWholesalePrice),
          shippingPrice: money(currency, response.quoteSummary.totalShippingPrice),
          quantityDiscount: money(currency, response.quoteSummary.totalQuantityDiscount),
          taxes: response.quoteSummary.vatSummary.map((tax) => ({
            rateBasisPoints: Math.round(tax.vatPercentage * 100),
            amount: money(currency, tax.vat),
          })),
        },
      };
    } catch {
      throw this.error(
        "INVALID_RESPONSE",
        "getQuote",
        "Peecho gaf prijzen buiten het veilige geldbereik terug.",
      );
    }
  }

  async createOrder(input: CreatePrintOrderInput): Promise<PrintOrderCreated> {
    const parsed = this.parseInput("createOrder", createPrintOrderInputSchema, input);
    const response = await this.request({
      operation: "createOrder",
      path: "order/",
      method: "POST",
      body: {
        merchant_api_key: this.config.merchantApiKey,
        order_reference: parsed.idempotencyKey,
        ...(parsed.purchaseOrder ? { purchase_order: parsed.purchaseOrder } : {}),
        ...(parsed.costCentre ? { cost_centre: parsed.costCentre } : {}),
        ...(parsed.billingEntityId ? { billing_entity_id: parsed.billingEntityId } : {}),
        currency: parsed.currency,
        item_details: parsed.items.map((item) => ({
          item_reference: item.reference,
          ...(item.title ? { title: item.title } : {}),
          offering_id: Number(item.offeringId),
          quantity: item.quantity,
          ...(item.file ? { file_details: this.fileDetails(item.file) } : {}),
        })),
        address_details: {
          email_address: parsed.customerEmail,
          shipping_address: this.addressDetails(parsed.shippingAddress),
          ...(parsed.billingAddress
            ? { billing_address: this.addressDetails(parsed.billingAddress) }
            : {}),
        },
      },
      successStatuses: [201],
      schema: createOrderResponseSchema,
    });
    return {
      providerOrderId: String(response.order_id),
      merchantReference: parsed.idempotencyKey,
      status: this.mapStatus("OPEN"),
    };
  }

  async payOrder(input: PayPrintOrderInput): Promise<PrintOrderPayment> {
    const parsed = this.parseInput("payOrder", payPrintOrderInputSchema, input);
    const secretKey = this.requireSecret("payOrder");
    const secret = createHash("sha256")
      .update(`${secretKey}${parsed.providerOrderId}`, "utf8")
      .digest("hex");
    const response = await this.request({
      operation: "payOrder",
      path: "order/payment",
      method: "POST",
      body: {
        order_id: Number(parsed.providerOrderId),
        merchant_api_key: this.config.merchantApiKey,
        secret,
      },
      successStatuses: [200],
      schema: paymentResponseSchema,
    });
    return {
      providerOrderId: parsed.providerOrderId,
      status: this.mapStatus(response.order_state),
    };
  }

  async getOrder(input: GetPrintOrderInput): Promise<PrintOrder> {
    const parsed = this.parseInput("getOrder", getPrintOrderInputSchema, input);
    const query = new URLSearchParams({
      merchantApiKey: this.config.merchantApiKey,
      orderId: parsed.providerOrderId,
    });
    if (parsed.merchantReference) query.set("orderReference", parsed.merchantReference);
    const response = await this.request({
      operation: "getOrder",
      path: "order/details",
      method: "GET",
      query,
      successStatuses: [200, 201],
      schema: orderDetailsResponseSchema,
    });
    return {
      providerOrderId: providerOrderId(response.order_id),
      merchantReference: response.merchant_order_reference === undefined
        || response.merchant_order_reference === null
        ? null
        : String(response.merchant_order_reference),
      status: this.mapStatus(response.order_state),
      createdAt: safeDate(response.created_date),
      currency: response.currency ?? null,
      trackingCode: response.tracking_code ?? null,
      trackingUrl: response.tracking_url ?? null,
      moderationReason: response.moderation_reason ?? null,
      fulfilmentLocation: response.fulfilment_location
        ? {
            countryCode: response.fulfilment_location.country_code ?? null,
            labCode: response.fulfilment_location.lab_code ?? null,
          }
        : null,
    };
  }

  mapStatus(providerStatus: string): MappedPrintStatus {
    const normalized = providerStatus.trim().toUpperCase();
    const mapped = STATUS_MAP[normalized];
    if (mapped) return { providerStatus: normalized, ...mapped };
    return {
      status: "unknown",
      providerStatus: normalized.slice(0, 80),
      known: false,
      terminal: false,
    };
  }

  verifyCallback(payload: unknown): VerifiedPrintCallback {
    const parsed = callbackSchema.safeParse(payload);
    const secretKey = this.requireSecret("verifyCallback");
    if (!parsed.success) {
      throw this.error(
        "INVALID_CALLBACK",
        "verifyCallback",
        "Peecho-callback heeft geen geldig contract.",
      );
    }
    const orderId = providerOrderId(parsed.data.order_id);
    const expected = createHash("sha256").update(`${secretKey}${orderId}`, "utf8").digest();
    const received = Buffer.from(parsed.data.signature, "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw this.error(
        "INVALID_CALLBACK",
        "verifyCallback",
        "Peecho-callbacksignature is ongeldig.",
      );
    }
    const eventKey = createHash("sha256").update(JSON.stringify([
      orderId,
      parsed.data.order_reference,
      parsed.data.old_status,
      parsed.data.new_status,
      parsed.data.tracking_code ?? null,
      parsed.data.tracking_url ?? null,
    ])).digest("hex");
    return {
      eventKey,
      providerOrderId: orderId,
      merchantReference: parsed.data.order_reference,
      oldStatus: this.mapStatus(parsed.data.old_status),
      newStatus: this.mapStatus(parsed.data.new_status),
      trackingCode: parsed.data.tracking_code ?? null,
      trackingUrl: parsed.data.tracking_url ?? null,
      verifiedAt: this.config.clock.now().toISOString(),
    };
  }

  classifyRetry(error: unknown): PrintProviderRetryDecision {
    return error instanceof PrintProviderError
      ? error.retry
      : { action: "do_not_retry", reason: "unknown" };
  }

  private async loadOfferings(
    input: z.output<typeof printOfferingsQuerySchema>,
    operation: "getOfferings" | "getProductSpecification",
  ): Promise<PrintOffering[]> {
    const query = new URLSearchParams({
      merchantApiKey: this.config.merchantApiKey,
      currency: input.currency,
    });
    if (input.countryCode) query.set("countryIsoCode2", input.countryCode);
    if (input.categoryCode) query.set("categoryFilter", input.categoryCode);
    if (input.subcategoryCode) query.set("subCategoryFilter", input.subcategoryCode);
    const catalog = await this.request({
      operation,
      path: "offering/list",
      method: "GET",
      query,
      successStatuses: [200],
      schema: offeringCatalogSchema,
    });
    const result: PrintOffering[] = [];
    const seenIds = new Set<string>();
    for (const [categoryCode, subcategories] of Object.entries(catalog)) {
      for (const [subcategoryCode, offerings] of Object.entries(subcategories)) {
        for (const offering of offerings) {
          const id = String(offering.id);
          if (seenIds.has(id)) {
            throw this.error(
              "INVALID_RESPONSE",
              operation,
              "Peecho gaf een dubbele offering-identiteit terug.",
            );
          }
          seenIds.add(id);
          result.push({
            id,
            name: offering.name,
            categoryCode,
            subcategoryCode,
            paperType: offering.paperType ?? null,
            catalogueItemCode: offering.catalogueItemCode,
            minimumQuantity: offering.minimumQuantity,
            minimumPageCount: offering.minNumberOfPages,
            maximumPageCount: offering.maxNumberOfPages,
            widthMm: offering.dimensionWidth,
            heightMm: offering.dimensionHeight,
            dynamicSize: offering.dynamicSize,
            minimumWidthMm: offering.minDimensionWidth ?? null,
            minimumHeightMm: offering.minDimensionHeight ?? null,
            basePrice: minorMoney(offering.pricingDto.currency, offering.pricingDto.price),
            pricePerPage: minorMoney(offering.pricingDto.currency, offering.pricingDto.pricePerPage),
          });
        }
      }
    }
    return result;
  }

  private addressDetails(address: z.output<typeof createPrintOrderInputSchema>["shippingAddress"]) {
    return {
      first_name: address.firstName,
      last_name: address.lastName,
      address_line_1: address.addressLine1,
      address_line_2: address.addressLine2 ?? "",
      zip_code: address.postalCode,
      city: address.city,
      state: address.state ?? null,
      country_code: address.countryCode,
      ...(address.phoneNumber ? { phone_number: address.phoneNumber } : {}),
      ...(address.companyName ? { company_name: address.companyName } : {}),
      ...(address.vatNumber ? { vat_number: address.vatNumber } : {}),
      ...(address.vatCountryCode ? { vat_country_code: address.vatCountryCode } : {}),
    };
  }

  private fileDetails(file: NonNullable<z.output<typeof createPrintOrderInputSchema>["items"][number]["file"]>) {
    return {
      content_url: file.contentUrl,
      ...(file.coverUrl ? { cover_url: file.coverUrl } : {}),
      ...(file.customSpineUrl
        ? { spine_details: { custom_spine_url: file.customSpineUrl } }
        : {}),
      content_width: file.widthMm,
      content_height: file.heightMm,
      number_of_pages: file.pageCount,
    };
  }

  private requireSecret(operation: "payOrder" | "verifyCallback"): string {
    if (this.config.secretKey) return this.config.secretKey;
    throw this.error(
      "INVALID_CONFIGURATION",
      operation,
      "Peecho-secret ontbreekt voor deze beveiligde operatie.",
    );
  }

  private parseInput<TSchema extends z.ZodTypeAny>(
    operation: PrintProviderOperation,
    schema: TSchema,
    value: unknown,
  ): z.output<TSchema> {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw this.error(
      "INVALID_REQUEST",
      operation,
      "Peecho-aanvraag voldoet niet aan het lokale printcontract.",
    );
  }

  private async request<T>(input: ProviderRequest<T>): Promise<T> {
    const url = new URL(input.path, this.baseUrl);
    if (input.query) url.search = input.query.toString();
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMarker = Symbol("peecho-timeout");
    let timeoutHandle: ClockHandle | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = this.config.clock.setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(timeoutMarker);
      }, this.config.timeoutMs);
    });
    const headers = new Headers({ accept: "application/json" });
    if (input.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await Promise.race([
        this.config.fetch(url, {
          method: input.method,
          headers,
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
          body: input.body === undefined ? undefined : JSON.stringify(input.body),
        }),
        timeout,
      ]);
    } catch (caught) {
      if (timeoutHandle !== undefined) this.config.clock.clearTimeout(timeoutHandle);
      if (timedOut || caught === timeoutMarker) {
        throw this.error(
          "TIMEOUT",
          input.operation,
          "Peecho antwoordde niet binnen de ingestelde tijd.",
        );
      }
      throw this.error(
        "NETWORK_ERROR",
        input.operation,
        "Peecho kon niet veilig worden bereikt.",
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      if (timeoutHandle !== undefined) this.config.clock.clearTimeout(timeoutHandle);
      throw this.error(
        "INVALID_RESPONSE",
        input.operation,
        "Peecho-respons overschrijdt de veilige limiet.",
        { httpStatus: response.status },
      );
    }
    let text: string;
    try {
      text = await Promise.race([response.text(), timeout]);
    } catch (caught) {
      if (timeoutHandle !== undefined) this.config.clock.clearTimeout(timeoutHandle);
      if (timedOut || caught === timeoutMarker) {
        throw this.error(
          "TIMEOUT",
          input.operation,
          "Peecho-respons was niet op tijd volledig beschikbaar.",
        );
      }
      throw this.error(
        "NETWORK_ERROR",
        input.operation,
        "Peecho-respons kon niet veilig worden gelezen.",
      );
    }
    if (timeoutHandle !== undefined) this.config.clock.clearTimeout(timeoutHandle);
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw this.error(
        "INVALID_RESPONSE",
        input.operation,
        "Peecho-respons overschrijdt de veilige limiet.",
        { httpStatus: response.status },
      );
    }
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!input.successStatuses.includes(response.status)) {
      const parsedError = providerErrorSchema.safeParse(payload);
      const providerCode = parsedError.success ? parsedError.data.custom_code : undefined;
      throw this.error(
        "PROVIDER_REJECTED",
        input.operation,
        "Peecho heeft de aanvraag geweigerd.",
        {
          httpStatus: response.status,
          ...(providerCode ? { providerCode } : {}),
          retryAfterMs: retryAfterMs(response, this.config.clock.now()),
        },
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.includes("application/json")) {
      throw this.error(
        "INVALID_RESPONSE",
        input.operation,
        "Peecho gaf geen JSON-respons terug.",
        { httpStatus: response.status },
      );
    }
    const parsed = input.schema.safeParse(payload);
    if (!parsed.success) {
      throw this.error(
        "INVALID_RESPONSE",
        input.operation,
        "Peecho gaf geen contractgeldige respons terug.",
        { httpStatus: response.status },
      );
    }
    return parsed.data;
  }

  private error(
    code: PrintProviderError["code"],
    operation: PrintProviderOperation,
    message: string,
    detail: {
      httpStatus?: number;
      providerCode?: string;
      retryAfterMs?: number;
    } = {},
  ): PrintProviderError {
    return new PrintProviderError(
      code,
      operation,
      message,
      retryDecision({
        operation,
        code,
        ...(detail.httpStatus === undefined ? {} : { httpStatus: detail.httpStatus }),
        ...(detail.providerCode === undefined ? {} : { providerCode: detail.providerCode }),
        ...(detail.retryAfterMs === undefined ? {} : { retryAfterMs: detail.retryAfterMs }),
      }),
      {
        ...(detail.httpStatus === undefined ? {} : { httpStatus: detail.httpStatus }),
        ...(detail.providerCode === undefined ? {} : { providerCode: detail.providerCode }),
        occurredAt: this.config.clock.now().toISOString(),
      },
    );
  }
}

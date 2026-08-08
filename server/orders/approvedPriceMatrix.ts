import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../security/canonicalJson.js";
import { OrderError } from "./errors.js";
import type { OrderClock, OrderQuoteProvider } from "./types.js";

const matrixEntrySchema = z.object({
  sku: z.literal("a4-landscape-hardcover-v1"),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  minimumPages: z.number().int().min(24).max(400),
  maximumPages: z.number().int().min(24).max(400),
  minimumQuantity: z.number().int().min(1).max(5),
  maximumQuantity: z.number().int().min(1).max(5),
  unitBaseMinor: z.number().int().positive(),
  unitAdditionalPageMinor: z.number().int().nonnegative(),
  shippingBaseMinor: z.number().int().nonnegative(),
  shippingAdditionalCopyMinor: z.number().int().nonnegative(),
  taxRateBasisPoints: z.number().int().min(0).max(10_000),
  taxTreatment: z.enum(["vat_included", "vat_exclusive", "vat_exempt"]),
  deliveryEstimate: z.string().trim().min(1).max(160),
  offeringId: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/),
}).strict().superRefine((entry, context) => {
  if (entry.maximumPages < entry.minimumPages) {
    context.addIssue({ code: "custom", message: "maximumPages ligt vóór minimumPages." });
  }
  if (entry.maximumQuantity < entry.minimumQuantity) {
    context.addIssue({ code: "custom", message: "maximumQuantity ligt vóór minimumQuantity." });
  }
  if (entry.taxTreatment === "vat_exempt" && entry.taxRateBasisPoints !== 0) {
    context.addIssue({ code: "custom", message: "Vrijgestelde prijzen mogen geen belastingtarief hebben." });
  }
});

export const approvedPriceMatrixSchema = z.object({
  version: z.literal(1),
  environment: z.enum(["test", "live"]),
  currency: z.literal("EUR"),
  approvalStatus: z.literal("approved"),
  commercialApprovalId: z.string().trim().min(8).max(120),
  approvedBy: z.string().trim().min(3).max(160),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  entries: z.array(matrixEntrySchema).min(1).max(100),
}).strict().superRefine((matrix, context) => {
  const keys = matrix.entries.map((entry) => `${entry.sku}:${entry.countryCode}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "De prijsmatrix bevat dubbele SKU/landregels." });
  }
});

export type ApprovedPriceMatrix = z.infer<typeof approvedPriceMatrixSchema>;

function safeAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
    throw new OrderError("PRICE_UNAVAILABLE");
  }
  return value;
}

export class ApprovedPriceMatrixQuoteProvider implements OrderQuoteProvider {
  private readonly matrix: ApprovedPriceMatrix;

  constructor(
    rawMatrix: unknown,
    private readonly environment: "test" | "live",
    private readonly clock: OrderClock = () => new Date(),
  ) {
    this.matrix = approvedPriceMatrixSchema.parse(rawMatrix);
    if (this.matrix.environment !== environment) throw new OrderError("PRICE_UNAVAILABLE");
  }

  async quote(input: Parameters<OrderQuoteProvider["quote"]>[0]) {
    const now = this.clock();
    const approvedAt = new Date(this.matrix.approvedAt);
    const expiresAt = new Date(this.matrix.expiresAt);
    if (approvedAt.getTime() > now.getTime() || expiresAt.getTime() <= now.getTime()) {
      throw new OrderError("PRICE_UNAVAILABLE");
    }
    const entry = this.matrix.entries.find((candidate) =>
      candidate.sku === input.sku
      && candidate.countryCode === input.shippingAddress.countryCode
      && input.pageCount >= candidate.minimumPages
      && input.pageCount <= candidate.maximumPages
      && input.quantity >= candidate.minimumQuantity
      && input.quantity <= candidate.maximumQuantity
    );
    if (!entry || input.pageCount % 2 !== 0) return null;

    const extraPages = input.pageCount - entry.minimumPages;
    const unitAmountMinor = safeAmount(
      entry.unitBaseMinor + extraPages * entry.unitAdditionalPageMinor,
    );
    const subtotalMinor = safeAmount(unitAmountMinor * input.quantity);
    const shippingMinor = safeAmount(
      entry.shippingBaseMinor
      + (input.quantity - 1) * entry.shippingAdditionalCopyMinor,
    );
    const taxMinor = safeAmount(Math.round(
      (subtotalMinor + shippingMinor) * entry.taxRateBasisPoints / 10_000,
    ));
    const totalMinor = safeAmount(subtotalMinor + shippingMinor + taxMinor);
    const quoteInput = {
      matrixVersion: this.matrix.version,
      commercialApprovalId: this.matrix.commercialApprovalId,
      sku: input.sku,
      countryCode: input.shippingAddress.countryCode,
      pageCount: input.pageCount,
      quantity: input.quantity,
      unitAmountMinor,
      shippingMinor,
      taxMinor,
      totalMinor,
    };
    const digest = createHash("sha256").update(canonicalJson(quoteInput)).digest("hex");

    return {
      quoteReference: `matrix:${this.matrix.commercialApprovalId}:${digest.slice(0, 32)}`,
      offeringId: entry.offeringId,
      sku: input.sku,
      pageCount: input.pageCount,
      quantity: input.quantity,
      destinationCountry: input.shippingAddress.countryCode,
      unitAmountMinor,
      amounts: {
        currency: "EUR" as const,
        subtotalMinor,
        shippingMinor,
        taxMinor,
        totalMinor,
      },
      deliveryEstimate: entry.deliveryEstimate,
      taxTreatment: entry.taxTreatment,
      commercialApprovalId: this.matrix.commercialApprovalId,
      expiresAt,
    };
  }
}

export function parseApprovedPriceMatrix(rawValue: string): ApprovedPriceMatrix {
  if (Buffer.byteLength(rawValue, "utf8") > 128 * 1024) throw new OrderError("PRICE_UNAVAILABLE");
  try {
    return approvedPriceMatrixSchema.parse(JSON.parse(rawValue) as unknown);
  } catch (error) {
    if (error instanceof OrderError) throw error;
    throw new OrderError("PRICE_UNAVAILABLE", { cause: error });
  }
}

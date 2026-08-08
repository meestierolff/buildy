import { sql } from "drizzle-orm";
import { z } from "zod";

import type { BuildyDatabase } from "../db/client.js";
import type {
  PrintOrderCreated,
  PrintProviderEnvironment,
  VerifiedPrintCallback,
} from "../print/printProvider.js";
import { FulfilmentError } from "./errors.js";
import type {
  PeechoCallbackResult,
  PeechoFulfilmentClaim,
  PeechoFulfilmentJob,
  PeechoFulfilmentRepository,
  PeechoProviderStatusOutcome,
  ProviderInboxEnvironment,
} from "./types.js";

const uuidSchema = z.string().uuid();
const providerIdSchema = z.string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
const providerStatusSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);

const jobRowSchema = z.object({
  order_id: uuidSchema,
  order_number: z.string().regex(/^BLD-[A-Z0-9-]{8,40}$/),
  merchant_reference: z.string().min(8).max(100),
  provider_environment: z.enum(["test", "live"]),
  phase: z.enum(["create", "reconcile_create", "pay", "reconcile_payment"]),
  provider_order_id: providerIdSchema.nullable(),
  provider_status: providerStatusSchema.nullable(),
  attempt_count: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().positive()),
  offering_id: providerIdSchema,
  currency: z.literal("EUR"),
  quantity: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().positive().max(10_000)),
  page_count: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().min(24).max(400)),
  shipping_country: z.string().regex(/^[A-Z]{2}$/),
  customer_email_ciphertext: z.string().min(1).max(200_000),
  shipping_details_ciphertext: z.string().min(1).max(200_000),
  pii_encryption_key_version: z.union([z.number(), z.string()])
    .transform(Number)
    .pipe(z.number().int().positive()),
  pdf_object_key: z.string().min(1).max(1_024),
  pdf_bucket: z.string().min(1).max(255),
  pdf_size_bytes: z.union([z.number(), z.string()])
    .transform(Number)
    .pipe(z.number().int().positive().max(157_286_400)),
  pdf_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const callbackRowSchema = z.object({
  replayed: z.boolean(),
  applied: z.boolean(),
  outcome: z.enum(["applied", "ignored_out_of_order", "manual_review", "reference_rejected"]),
}).strict();

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof FulfilmentError) throw error;
  const code = databaseCode(error);
  if (["40001", "P0002"].includes(code ?? "")) {
    throw new FulfilmentError("WORKER_LEASE_LOST", "Peecho-workerlease is verloren.", { cause: error });
  }
  if (["22023", "23505", "23514"].includes(code ?? "")) {
    throw new FulfilmentError("INVALID_JOB", "Peecho-workerstate is ongeldig.", { cause: error });
  }
  throw error;
}

function ensureBoolean(value: unknown): void {
  if (value !== true) throw new FulfilmentError("WORKER_LEASE_LOST", "Peecho-workerlease is verloren.");
}

export class PostgresPeechoFulfilmentRepository implements PeechoFulfilmentRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async claimNext(
    workerId: string,
    environment: PrintProviderEnvironment,
    leaseSeconds: number,
  ): Promise<PeechoFulfilmentClaim | null> {
    try {
      const result = await this.database.execute<{ order_id: string }>(sql`
        select order_id
        from public.app_peecho_worker_claim(${workerId}, ${environment}, ${leaseSeconds})
      `);
      const orderId = result.rows[0]?.order_id;
      if (!orderId) return null;
      return { workerId, orderId: uuidSchema.parse(orderId) };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async begin(
    claim: PeechoFulfilmentClaim,
    environment: PrintProviderEnvironment,
  ): Promise<PeechoFulfilmentJob | null> {
    try {
      const result = await this.database.execute<Record<string, unknown>>(sql`
        select *
        from public.app_begin_peecho_fulfilment(${claim.workerId}, ${claim.orderId}::uuid, ${environment})
      `);
      const row = result.rows[0];
      if (!row) return null;
      const parsed = jobRowSchema.parse(row);
      return {
        workerId: claim.workerId,
        orderId: parsed.order_id,
        orderNumber: parsed.order_number,
        merchantReference: parsed.merchant_reference,
        providerEnvironment: parsed.provider_environment,
        phase: parsed.phase,
        providerOrderId: parsed.provider_order_id,
        providerStatus: parsed.provider_status,
        attemptCount: parsed.attempt_count,
        offeringId: parsed.offering_id,
        currency: parsed.currency,
        quantity: parsed.quantity,
        pageCount: parsed.page_count,
        shippingCountry: parsed.shipping_country,
        customerEmailCiphertext: parsed.customer_email_ciphertext,
        shippingDetailsCiphertext: parsed.shipping_details_ciphertext,
        piiEncryptionKeyVersion: parsed.pii_encryption_key_version,
        pdfObjectKey: parsed.pdf_object_key,
        pdfBucket: parsed.pdf_bucket,
        pdfSizeBytes: parsed.pdf_size_bytes,
        pdfSha256: parsed.pdf_sha256,
      };
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async beginCreate(job: PeechoFulfilmentJob): Promise<void> {
    try {
      const result = await this.database.execute<{ started: boolean }>(sql`
        select public.app_begin_peecho_order_create(
          ${job.workerId}, ${job.orderId}::uuid, ${job.providerEnvironment},
          ${job.merchantReference}, ${job.pdfSha256}
        ) as started
      `);
      ensureBoolean(result.rows[0]?.started);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async persistCreated(job: PeechoFulfilmentJob, created: PrintOrderCreated): Promise<void> {
    try {
      const result = await this.database.execute<{ persisted: boolean }>(sql`
        select public.app_persist_peecho_order_created(
          ${job.workerId}, ${job.orderId}::uuid, ${job.providerEnvironment},
          ${job.merchantReference}, ${created.providerOrderId}, ${created.status.providerStatus}
        ) as persisted
      `);
      ensureBoolean(result.rows[0]?.persisted);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async beginPayment(job: PeechoFulfilmentJob & { providerOrderId: string }): Promise<void> {
    try {
      const result = await this.database.execute<{ started: boolean }>(sql`
        select public.app_begin_peecho_order_payment(
          ${job.workerId}, ${job.orderId}::uuid, ${job.providerEnvironment}, ${job.providerOrderId}
        ) as started
      `);
      ensureBoolean(result.rows[0]?.started);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async finalizeProviderStatus(
    job: PeechoFulfilmentJob & { providerOrderId: string },
    providerStatus: string,
    tracking: { code?: string | null; url?: string | null } = {},
  ): Promise<PeechoProviderStatusOutcome> {
    try {
      const result = await this.database.execute<{ outcome: string }>(sql`
        select public.app_finalize_peecho_order_status(
          ${job.workerId}, ${job.orderId}::uuid, ${job.providerEnvironment},
          ${job.providerOrderId}, ${providerStatus},
          ${tracking.code ?? null}, ${tracking.url ?? null}
        ) as outcome
      `);
      return z.enum([
        "payment_required",
        "submitted",
        "in_production",
        "shipped",
        "manual_review",
      ]).parse(result.rows[0]?.outcome);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async scheduleRetry(
    claim: PeechoFulfilmentClaim,
    failureCode: string,
    delaySeconds: number,
    deadLetter: boolean,
  ): Promise<void> {
    try {
      const result = await this.database.execute<{ scheduled: boolean }>(sql`
        select public.app_retry_peecho_fulfilment(
          ${claim.workerId}, ${claim.orderId}::uuid, ${failureCode}, ${delaySeconds}, ${deadLetter}
        ) as scheduled
      `);
      ensureBoolean(result.rows[0]?.scheduled);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async moveToManualReview(claim: PeechoFulfilmentClaim, reasonCode: string): Promise<void> {
    try {
      const result = await this.database.execute<{ moved: boolean }>(sql`
        select public.app_mark_peecho_manual_review(
          ${claim.workerId}, ${claim.orderId}::uuid, ${reasonCode}
        ) as moved
      `);
      ensureBoolean(result.rows[0]?.moved);
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async recordCallback(input: {
    inboxEnvironment: ProviderInboxEnvironment;
    providerEnvironment: PrintProviderEnvironment;
    event: VerifiedPrintCallback;
  }): Promise<PeechoCallbackResult> {
    try {
      const result = await this.database.execute<Record<string, unknown>>(sql`
        select * from public.app_record_peecho_callback(
          ${input.inboxEnvironment}, ${input.providerEnvironment}, ${input.event.eventKey},
          ${input.event.providerOrderId}, ${input.event.merchantReference},
          ${input.event.oldStatus.providerStatus}, ${input.event.newStatus.providerStatus},
          ${input.event.trackingCode}, ${input.event.trackingUrl}, ${new Date(input.event.verifiedAt)}
        )
      `);
      return callbackRowSchema.parse(result.rows[0]);
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

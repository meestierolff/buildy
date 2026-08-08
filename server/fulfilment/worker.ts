import { createHash, randomUUID } from "node:crypto";

import { ObjectStorageError, type ObjectStorage } from "../storage/objectStorage.js";
import {
  PrintProviderError,
  type PrintOrder,
  type PrintProvider,
  type PrintProviderEnvironment,
  type PrintProductSpecification,
} from "../print/printProvider.js";
import { FulfilmentError } from "./errors.js";
import type {
  FulfilmentClock,
  FulfilmentPiiReader,
  PeechoFulfilmentJob,
  PeechoFulfilmentRepository,
  PeechoProviderStatusOutcome,
} from "./types.js";
import { systemFulfilmentClock } from "./types.js";

const DEFAULT_LEASE_SECONDS = 10 * 60;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SIGNED_URL_TTL_SECONDS = 5 * 60;
const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 8;
const EXPECTED_WIDTH_MM = 297;
const EXPECTED_HEIGHT_MM = 210;
const DIMENSION_TOLERANCE_MM = 1;

export type PeechoFulfilmentWorkerResult =
  | { status: "idle" }
  | { status: "submitted" | "in_production" | "shipped"; orderId: string; providerOrderId: string }
  | { status: "retry_scheduled" | "manual_review" | "dead_letter"; orderId: string };

export interface PeechoFulfilmentWorkerConfig {
  environment: PrintProviderEnvironment;
  bucketName: string;
  offeringId: string;
  signedUrlTtlSeconds?: number;
  leaseSeconds?: number;
}

type WorkerStage =
  | "begin"
  | "pre_create"
  | "create_requested"
  | "persist_created"
  | "payment_requested"
  | "persist_payment"
  | "status_read";

type FailureDisposition = { action: "retry" | "manual_review"; code: string };

function safeFailureCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized) ? normalized : "PEECHO_FULFILMENT_FAILED";
}

function retryDelaySeconds(orderId: string, attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 10));
  const base = Math.min(6 * 60 * 60, 30 * (2 ** exponent));
  const digest = createHash("sha256").update(orderId).update(":").update(String(attemptCount)).digest();
  const jitterWindow = Math.max(1, Math.floor(base / 5));
  return Math.min(24 * 60 * 60, base + (digest[0] % jitterWindow));
}

function failureDisposition(error: unknown, stage: WorkerStage): FailureDisposition {
  if (stage === "create_requested") {
    return { action: "manual_review", code: "PEECHO_CREATE_OUTCOME_UNKNOWN" };
  }
  if (error instanceof FulfilmentError) {
    if (["SIGNED_URL_INVALID", "PAYMENT_RETRY_REQUIRED"].includes(error.code)) {
      return { action: "retry", code: safeFailureCode(`PEECHO_${error.code}`) };
    }
    return { action: "manual_review", code: safeFailureCode(`PEECHO_${error.code}`) };
  }
  if (error instanceof ObjectStorageError) {
    const retryable = error.code === "PROVIDER_ERROR";
    return {
      action: retryable ? "retry" : "manual_review",
      code: safeFailureCode(`R2_${error.code}`),
    };
  }
  if (error instanceof PrintProviderError) {
    return {
      action: error.retry.action === "do_not_retry" ? "manual_review" : "retry",
      code: safeFailureCode(`PEECHO_${error.code}`),
    };
  }
  return { action: "retry", code: "PEECHO_FULFILMENT_FAILED" };
}

function expectedChecksumBase64(sha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new FulfilmentError("PDF_MISMATCH", "PDF-hash is ongeldig.");
  return Buffer.from(sha256Hex, "hex").toString("base64");
}

function assertOffering(job: PeechoFulfilmentJob, offering: PrintProductSpecification): void {
  if (
    offering.id !== job.offeringId
    || offering.basePrice.currency !== job.currency
    || offering.pricePerPage.currency !== job.currency
    || job.pageCount < offering.minimumPageCount
    || job.pageCount > offering.maximumPageCount
    || job.quantity < offering.minimumQuantity
    || Math.abs(offering.widthMm - EXPECTED_WIDTH_MM) > DIMENSION_TOLERANCE_MM
    || Math.abs(offering.heightMm - EXPECTED_HEIGHT_MM) > DIMENSION_TOLERANCE_MM
  ) {
    throw new FulfilmentError(
      "OFFERING_MISMATCH",
      "Peecho-offering wijkt af van de goedgekeurde A4-liggend-ordersnapshot.",
    );
  }
}

function assertProviderOrder(job: PeechoFulfilmentJob & { providerOrderId: string }, order: PrintOrder): void {
  if (
    order.providerOrderId !== job.providerOrderId
    || order.merchantReference !== job.merchantReference
  ) {
    throw new FulfilmentError(
      "ORDER_REFERENCE_MISMATCH",
      "Peecho-orderidentiteit wijkt af van de immutable Buildy-referentie.",
    );
  }
}

function workerResult(
  orderId: string,
  providerOrderId: string,
  outcome: PeechoProviderStatusOutcome,
): PeechoFulfilmentWorkerResult {
  if (outcome === "submitted" || outcome === "in_production" || outcome === "shipped") {
    return { status: outcome, orderId, providerOrderId };
  }
  if (outcome === "manual_review") return { status: "manual_review", orderId };
  throw new FulfilmentError("INVALID_JOB", "Peecho-status vereist nog een paymentactie.");
}

export class PeechoFulfilmentWorker {
  private readonly leaseSeconds: number;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    private readonly repository: PeechoFulfilmentRepository,
    private readonly provider: PrintProvider,
    private readonly storage: ObjectStorage,
    private readonly pii: FulfilmentPiiReader,
    private readonly workerId: string,
    private readonly config: PeechoFulfilmentWorkerConfig,
    private readonly clock: FulfilmentClock = systemFulfilmentClock,
  ) {
    this.leaseSeconds = config.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.signedUrlTtlSeconds = config.signedUrlTtlSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS;
    if (!/^[A-Za-z0-9:_-]{3,80}$/.test(workerId)) throw new Error("Peecho-worker-ID is ongeldig.");
    if (provider.provider !== "peecho-v3" || provider.environment !== config.environment) {
      throw new Error("Peecho-worker en providerenvironment komen niet overeen.");
    }
    if (
      !config.bucketName
      || config.bucketName.length > 255
      || !/^[1-9][0-9]{0,15}$/.test(config.offeringId)
      || !Number.isSafeInteger(Number(config.offeringId))
    ) {
      throw new Error("Peecho-workerconfiguratie is ongeldig.");
    }
    if (!Number.isSafeInteger(this.leaseSeconds) || this.leaseSeconds < 30 || this.leaseSeconds > 15 * 60) {
      throw new Error("Peecho-workerlease is ongeldig.");
    }
    if (
      !Number.isSafeInteger(this.signedUrlTtlSeconds)
      || this.signedUrlTtlSeconds < MIN_SIGNED_URL_TTL_SECONDS
      || this.signedUrlTtlSeconds > MAX_SIGNED_URL_TTL_SECONDS
    ) {
      throw new Error("Peecho signed-URL-geldigheid is ongeldig.");
    }
  }

  async processNext(): Promise<PeechoFulfilmentWorkerResult> {
    const invocation = createHash("sha256")
      .update(this.workerId)
      .update("\0")
      .update(randomUUID())
      .digest("hex")
      .slice(0, 24);
    const workerId = `${this.workerId}:${invocation}`;
    const claim = await this.repository.claimNext(workerId, this.config.environment, this.leaseSeconds);
    if (!claim) return { status: "idle" };

    let job: PeechoFulfilmentJob | null = null;
    let stage: WorkerStage = "begin";
    try {
      job = await this.repository.begin(claim, this.config.environment);
      if (!job) throw new FulfilmentError("INVALID_JOB", "Geclaimde fulfilmentorder is niet uitvoerbaar.");
      if (job.providerEnvironment !== this.config.environment || job.offeringId !== this.config.offeringId) {
        throw new FulfilmentError("OFFERING_MISMATCH", "Order hoort bij een andere Peecho-configuratie.");
      }

      if (job.phase === "reconcile_create") {
        await this.repository.moveToManualReview(claim, "PEECHO_CREATE_OUTCOME_UNKNOWN");
        return { status: "manual_review", orderId: claim.orderId };
      }
      if (job.phase === "create") return await this.createAndPay(job, (value) => { stage = value; });
      if (!job.providerOrderId) throw new FulfilmentError("INVALID_JOB", "Peecho-order-ID ontbreekt.");
      const withProviderId = { ...job, providerOrderId: job.providerOrderId };
      if (job.phase === "reconcile_payment") {
        stage = "status_read";
        const order = await this.provider.getOrder({
          providerOrderId: withProviderId.providerOrderId,
          merchantReference: job.merchantReference,
        });
        assertProviderOrder(withProviderId, order);
        const outcome = await this.repository.finalizeProviderStatus(
          withProviderId,
          order.status.providerStatus,
          { code: order.trackingCode, url: order.trackingUrl },
        );
        if (outcome !== "payment_required") {
          return workerResult(job.orderId, withProviderId.providerOrderId, outcome);
        }
      }
      return await this.pay(withProviderId, (value) => { stage = value; });
    } catch (error) {
      if (["persist_created", "persist_payment"].includes(stage)) throw error;
      const disposition = failureDisposition(error, stage);
      if (disposition.action === "manual_review") {
        await this.repository.moveToManualReview(claim, disposition.code);
        return { status: "manual_review", orderId: claim.orderId };
      }
      const attemptCount = job?.attemptCount ?? 1;
      const deadLetter = attemptCount >= MAX_ATTEMPTS;
      await this.repository.scheduleRetry(
        claim,
        disposition.code,
        retryDelaySeconds(claim.orderId, attemptCount),
        deadLetter,
      );
      return { status: deadLetter ? "dead_letter" : "retry_scheduled", orderId: claim.orderId };
    }
  }

  private async createAndPay(
    job: PeechoFulfilmentJob,
    setStage: (stage: WorkerStage) => void,
  ): Promise<PeechoFulfilmentWorkerResult> {
    setStage("pre_create");
    const personal = this.pii.reveal(job);
    const [offering, metadata] = await Promise.all([
      this.provider.getProductSpecification({
        offeringId: job.offeringId,
        countryCode: job.shippingCountry,
        currency: job.currency,
      }),
      this.storage.headObject(job.pdfObjectKey),
    ]);
    assertOffering(job, offering);
    if (!metadata) throw new FulfilmentError("PDF_MISSING", "Goedgekeurde PDF ontbreekt in private storage.");
    if (
      metadata.key !== job.pdfObjectKey
      || metadata.contentType !== "application/pdf"
      || metadata.sizeBytes !== job.pdfSizeBytes
      || metadata.checksumSha256Base64 !== expectedChecksumBase64(job.pdfSha256)
      || job.pdfBucket !== this.config.bucketName
    ) {
      throw new FulfilmentError("PDF_MISMATCH", "Private PDF wijkt af van de goedgekeurde revisie.");
    }

    const grant = await this.storage.createDownloadUrl({
      key: job.pdfObjectKey,
      disposition: "inline",
      filename: `${job.orderNumber}-Bouwboek.pdf`,
      expiresInSeconds: this.signedUrlTtlSeconds,
      grantPurpose: "provider_fulfilment",
    });
    const url = new URL(grant.url);
    const expiresAt = new Date(grant.expiresAt);
    const remainingMs = expiresAt.getTime() - this.clock.now().getTime();
    if (
      grant.key !== job.pdfObjectKey
      || grant.method !== "GET"
      || url.protocol !== "https:"
      || !url.hostname.endsWith(".r2.cloudflarestorage.com")
      || url.username
      || url.password
      || url.hash
      || !url.searchParams.has("X-Amz-Signature")
      || Number(url.searchParams.get("X-Amz-Expires")) !== this.signedUrlTtlSeconds
      || !Number.isFinite(expiresAt.getTime())
      || remainingMs < (this.signedUrlTtlSeconds * 1_000) - 60_000
      || remainingMs > (this.signedUrlTtlSeconds * 1_000) + 60_000
    ) {
      throw new FulfilmentError("SIGNED_URL_INVALID", "R2 gaf geen bruikbare tijdelijke print-URL terug.");
    }

    await this.repository.beginCreate(job);
    setStage("create_requested");
    const created = await this.provider.createOrder({
      idempotencyKey: job.merchantReference,
      currency: job.currency,
      customerEmail: personal.customerEmail,
      shippingAddress: {
        firstName: personal.shippingAddress.firstName,
        lastName: personal.shippingAddress.lastName,
        addressLine1: personal.shippingAddress.addressLine1,
        postalCode: personal.shippingAddress.postalCode,
        city: personal.shippingAddress.city,
        countryCode: personal.shippingAddress.countryCode,
        ...(personal.shippingAddress.addressLine2
          ? { addressLine2: personal.shippingAddress.addressLine2 }
          : {}),
        ...(personal.shippingAddress.state ? { state: personal.shippingAddress.state } : {}),
      },
      items: [{
        reference: `${job.merchantReference}:book`,
        offeringId: job.offeringId,
        quantity: job.quantity,
        file: {
          contentUrl: grant.url,
          widthMm: EXPECTED_WIDTH_MM,
          heightMm: EXPECTED_HEIGHT_MM,
          pageCount: job.pageCount,
        },
      }],
    });
    setStage("persist_created");
    await this.repository.persistCreated(job, created);
    const withProviderId = { ...job, providerOrderId: created.providerOrderId };
    return this.pay(withProviderId, setStage);
  }

  private async pay(
    job: PeechoFulfilmentJob & { providerOrderId: string },
    setStage: (stage: WorkerStage) => void,
  ): Promise<PeechoFulfilmentWorkerResult> {
    await this.repository.beginPayment(job);
    setStage("payment_requested");
    const payment = await this.provider.payOrder({ providerOrderId: job.providerOrderId });
    if (payment.providerOrderId !== job.providerOrderId) {
      throw new FulfilmentError("ORDER_REFERENCE_MISMATCH", "Peecho-payment hoort bij een andere order.");
    }
    setStage("persist_payment");
    const outcome = await this.repository.finalizeProviderStatus(job, payment.status.providerStatus);
    setStage("status_read");
    if (outcome === "payment_required") {
      throw new FulfilmentError(
        "PAYMENT_RETRY_REQUIRED",
        "Peecho heeft de orderbetaling nog niet geaccepteerd.",
      );
    }
    return workerResult(job.orderId, job.providerOrderId, outcome);
  }
}

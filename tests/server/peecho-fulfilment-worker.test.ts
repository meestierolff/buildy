// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  PrintProviderError,
  type CreatePrintOrderInput,
  type MappedPrintStatus,
  type PrintOrder,
  type PrintProvider,
} from "../../server/print/printProvider";
import type { ObjectStorage } from "../../server/storage/objectStorage";
import type {
  PeechoFulfilmentClaim,
  PeechoFulfilmentJob,
  PeechoFulfilmentRepository,
  PeechoProviderStatusOutcome,
} from "../../server/fulfilment/types";
import { PeechoFulfilmentWorker } from "../../server/fulfilment/worker";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const ORDER_ID = "10000000-0000-4000-8000-000000000001";
const PDF_SHA256 = "a".repeat(64);
const PDF_KEY = "photobook-pdfs/20/20000000-0000-4000-8000-000000000001";

function mapped(providerStatus: string): MappedPrintStatus {
  const normalized = providerStatus.toUpperCase();
  if (normalized === "OPEN") {
    return { providerStatus: normalized, status: "awaiting_payment", known: true, terminal: false };
  }
  if (normalized === "PAID") {
    return { providerStatus: normalized, status: "paid", known: true, terminal: false };
  }
  if (normalized === "IN_PRODUCTION") {
    return { providerStatus: normalized, status: "in_production", known: true, terminal: false };
  }
  if (normalized === "SHIPPED") {
    return { providerStatus: normalized, status: "shipped", known: true, terminal: true };
  }
  return { providerStatus: normalized, status: "unknown", known: false, terminal: false };
}

function fulfilmentJob(overrides: Partial<PeechoFulfilmentJob> = {}): PeechoFulfilmentJob {
  return {
    workerId: "peecho-worker:test:claim",
    orderId: ORDER_ID,
    orderNumber: "BLD-20260804-ABCDEF1234",
    merchantReference: `buildy:${ORDER_ID}`,
    providerEnvironment: "test",
    phase: "create",
    providerOrderId: null,
    providerStatus: null,
    attemptCount: 1,
    offeringId: "233309",
    currency: "EUR",
    quantity: 1,
    pageCount: 24,
    shippingCountry: "NL",
    customerEmailCiphertext: "ciphertext-email",
    shippingDetailsCiphertext: "ciphertext-address",
    piiEncryptionKeyVersion: 1,
    pdfObjectKey: PDF_KEY,
    pdfBucket: "buildy-private",
    pdfSizeBytes: 12_345,
    pdfSha256: PDF_SHA256,
    ...overrides,
  };
}

class FakeRepository implements PeechoFulfilmentRepository {
  active = true;
  createStarted = 0;
  paymentStarted = 0;
  persisted = 0;
  finalized: string[] = [];
  retries: Array<{ code: string; deadLetter: boolean }> = [];
  manualReasons: string[] = [];
  failAfterPersist = false;
  finalizeOverride?: PeechoProviderStatusOutcome;

  constructor(public job = fulfilmentJob()) {}

  async claimNext(workerId: string): Promise<PeechoFulfilmentClaim | null> {
    return this.active ? { workerId, orderId: this.job.orderId } : null;
  }

  async begin(claim: PeechoFulfilmentClaim): Promise<PeechoFulfilmentJob | null> {
    return this.active ? { ...this.job, workerId: claim.workerId } : null;
  }

  async beginCreate(job: PeechoFulfilmentJob): Promise<void> {
    this.createStarted += 1;
    this.job = { ...job };
  }

  async persistCreated(job: PeechoFulfilmentJob, created: { providerOrderId: string; merchantReference: string; status: MappedPrintStatus }): Promise<void> {
    this.persisted += 1;
    this.job = {
      ...job,
      providerOrderId: created.providerOrderId,
      providerStatus: created.status.providerStatus,
      phase: "pay",
    };
    if (this.failAfterPersist) {
      this.failAfterPersist = false;
      throw new Error("simulated response loss after commit");
    }
  }

  async beginPayment(job: PeechoFulfilmentJob & { providerOrderId: string }): Promise<void> {
    this.paymentStarted += 1;
    this.job = { ...job, phase: "reconcile_payment" };
  }

  async finalizeProviderStatus(
    job: PeechoFulfilmentJob & { providerOrderId: string },
    providerStatus: string,
  ): Promise<PeechoProviderStatusOutcome> {
    this.finalized.push(providerStatus);
    const outcome = this.finalizeOverride
      ?? (providerStatus === "OPEN" || providerStatus === "PAYMENT_ERROR"
        ? "payment_required"
        : providerStatus === "IN_PRODUCTION"
          ? "in_production"
          : providerStatus === "SHIPPED"
            ? "shipped"
            : providerStatus === "PAID"
              ? "submitted"
              : "manual_review");
    if (outcome !== "payment_required") this.active = false;
    this.job = { ...job, providerStatus, phase: "reconcile_payment" };
    return outcome;
  }

  async scheduleRetry(
    _claim: PeechoFulfilmentClaim,
    failureCode: string,
    _delaySeconds: number,
    deadLetter: boolean,
  ): Promise<void> {
    this.retries.push({ code: failureCode, deadLetter });
    if (deadLetter) this.active = false;
  }

  async moveToManualReview(_claim: PeechoFulfilmentClaim, reasonCode: string): Promise<void> {
    this.manualReasons.push(reasonCode);
    this.active = false;
  }

  async recordCallback(): Promise<never> {
    throw new Error("unused");
  }
}

class FakeProvider implements PrintProvider {
  readonly provider = "peecho-v3";
  readonly environment = "test";
  readonly idempotency = {
    createOrder: "unique-merchant-reference",
    payOrder: "status-reconciliation-required",
  } as const;
  createInputs: CreatePrintOrderInput[] = [];
  createError?: unknown;
  payErrors: unknown[] = [];
  payStatuses: string[] = ["PAID"];
  readStatuses: string[] = ["OPEN"];
  getOrderCalls = 0;

  async getOfferings() { return []; }
  async getProductSpecification() {
    return {
      id: "233309",
      name: "A4 landscape hardcover",
      categoryCode: "BOOK",
      subcategoryCode: "HARDCOVER",
      paperType: null,
      catalogueItemCode: "A4-L-HC",
      minimumQuantity: 1,
      minimumPageCount: 24,
      maximumPageCount: 300,
      widthMm: 297,
      heightMm: 210,
      dynamicSize: false,
      minimumWidthMm: null,
      minimumHeightMm: null,
      basePrice: { currency: "EUR", amountMinor: 500 },
      pricePerPage: { currency: "EUR", amountMinor: 5 },
    };
  }
  async getQuote(): Promise<never> { throw new Error("unused"); }
  async createOrder(input: CreatePrintOrderInput) {
    this.createInputs.push(input);
    if (this.createError) throw this.createError;
    return {
      providerOrderId: "9001",
      merchantReference: input.idempotencyKey,
      status: mapped("OPEN"),
    };
  }
  async payOrder(input: { providerOrderId: string }) {
    const error = this.payErrors.shift();
    if (error) throw error;
    const providerStatus = this.payStatuses.shift() ?? "PAID";
    return { providerOrderId: input.providerOrderId, status: mapped(providerStatus) };
  }
  async getOrder(input: { providerOrderId: string; merchantReference?: string }): Promise<PrintOrder> {
    this.getOrderCalls += 1;
    const providerStatus = this.readStatuses.shift() ?? "OPEN";
    return {
      providerOrderId: input.providerOrderId,
      merchantReference: input.merchantReference ?? null,
      status: mapped(providerStatus),
      createdAt: NOW.toISOString(),
      currency: "EUR",
      trackingCode: null,
      trackingUrl: null,
      moderationReason: null,
      fulfilmentLocation: null,
    };
  }
  mapStatus(providerStatus: string) { return mapped(providerStatus); }
  verifyCallback(): never { throw new Error("unused"); }
  classifyRetry() { return { action: "do_not_retry" as const, reason: "unknown" as const }; }
}

function fakeStorage(input: { missing?: boolean; expiresInSeconds?: number; ttlSeen?: number[] } = {}): ObjectStorage {
  return {
    async createUploadUrl() { throw new Error("unused"); },
    async completeUpload() { throw new Error("unused"); },
    async createDownloadUrl(request) {
      input.ttlSeen?.push(request.expiresInSeconds ?? 0);
      const expiresInSeconds = input.expiresInSeconds ?? request.expiresInSeconds ?? 0;
      return {
        method: "GET",
        key: request.key,
        url: `https://account.r2.cloudflarestorage.com/buildy-private/proof?X-Amz-Signature=opaque&X-Amz-Expires=${expiresInSeconds}`,
        expiresAt: new Date(NOW.getTime() + expiresInSeconds * 1_000).toISOString(),
      };
    },
    async readObject() { throw new Error("unused"); },
    async writeObject() { throw new Error("unused"); },
    async headObject(key) {
      if (input.missing) return null;
      return {
        key,
        contentType: "application/pdf",
        sizeBytes: 12_345,
        checksumSha256Base64: Buffer.from(PDF_SHA256, "hex").toString("base64"),
      };
    },
    async copyObject() {},
    async deleteObject() {},
    async listObjects() { return { objects: [] }; },
    async getChecksum() { return undefined; },
  };
}

function worker(
  repository: FakeRepository,
  provider: FakeProvider,
  storage = fakeStorage(),
  signedUrlTtlSeconds = 604_800,
  offeringId = "233309",
) {
  return new PeechoFulfilmentWorker(
    repository,
    provider,
    storage,
    {
      reveal: () => ({
        customerEmail: "klant@example.com",
        shippingAddress: {
          firstName: "Noor",
          lastName: "Bouwer",
          addressLine1: "Teststraat 1",
          addressLine2: null,
          postalCode: "1234 AB",
          city: "Utrecht",
          state: null,
          countryCode: "NL",
        },
      }),
    },
    "peecho-worker:test",
    {
      environment: "test",
      bucketName: "buildy-private",
      offeringId,
      signedUrlTtlSeconds,
    },
    { now: () => new Date(NOW) },
  );
}

function providerError(
  operation: "createOrder" | "payOrder",
  reason: "mutation_outcome_unknown" | "payment_state_unknown",
) {
  return new PrintProviderError(
    "TIMEOUT",
    operation,
    "Provider timeout",
    { action: "reconcile", reason },
    { occurredAt: NOW.toISOString() },
  );
}

describe("Peecho fulfilment worker", () => {
  it("rejects an offering ID outside JavaScript's exact integer range at composition", () => {
    expect(() => worker(
      new FakeRepository(),
      new FakeProvider(),
      fakeStorage(),
      604_800,
      "9999999999999999",
    )).toThrow("Peecho-workerconfiguratie is ongeldig");
  });

  it("creates once, persists before payment, and submits only the locked minimal order payload", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();
    const ttlSeen: number[] = [];

    await expect(worker(repository, provider, fakeStorage({ ttlSeen })).processNext()).resolves.toEqual({
      status: "submitted",
      orderId: ORDER_ID,
      providerOrderId: "9001",
    });

    expect(ttlSeen).toEqual([604_800]);
    expect(repository.createStarted).toBe(1);
    expect(repository.persisted).toBe(1);
    expect(repository.paymentStarted).toBe(1);
    expect(provider.createInputs).toEqual([{
      idempotencyKey: `buildy:${ORDER_ID}`,
      currency: "EUR",
      customerEmail: "klant@example.com",
      shippingAddress: {
        firstName: "Noor",
        lastName: "Bouwer",
        addressLine1: "Teststraat 1",
        postalCode: "1234 AB",
        city: "Utrecht",
        countryCode: "NL",
      },
      items: [{
        reference: `buildy:${ORDER_ID}:book`,
        offeringId: "233309",
        quantity: 1,
        file: {
          contentUrl: expect.stringContaining("X-Amz-Signature="),
          widthMm: 297,
          heightMm: 210,
          pageCount: 24,
        },
      }],
    }]);
  });

  it("moves an ambiguous create timeout to manual review and never blindly retries create", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();
    provider.createError = providerError("createOrder", "mutation_outcome_unknown");

    await expect(worker(repository, provider).processNext()).resolves.toEqual({
      status: "manual_review",
      orderId: ORDER_ID,
    });
    expect(repository.manualReasons).toEqual(["PEECHO_CREATE_OUTCOME_UNKNOWN"]);
    expect(repository.retries).toEqual([]);
    expect(provider.createInputs).toHaveLength(1);
  });

  it("uses a durably persisted provider ID after response loss without recreating the order", async () => {
    const repository = new FakeRepository();
    repository.failAfterPersist = true;
    const provider = new FakeProvider();
    const fulfilment = worker(repository, provider);

    await expect(fulfilment.processNext()).rejects.toThrow("simulated response loss after commit");
    await expect(fulfilment.processNext()).resolves.toMatchObject({ status: "submitted", providerOrderId: "9001" });

    expect(provider.createInputs).toHaveLength(1);
    expect(repository.persisted).toBe(1);
    expect(repository.paymentStarted).toBe(1);
  });

  it("reconciles a failed payment before paying the existing order again", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();
    provider.payErrors.push(providerError("payOrder", "payment_state_unknown"));
    const fulfilment = worker(repository, provider);

    await expect(fulfilment.processNext()).resolves.toMatchObject({ status: "retry_scheduled" });
    await expect(fulfilment.processNext()).resolves.toMatchObject({ status: "submitted" });

    expect(provider.createInputs).toHaveLength(1);
    expect(provider.getOrderCalls).toBe(1);
    expect(repository.paymentStarted).toBe(2);
    expect(repository.retries).toHaveLength(1);
  });

  it("schedules a bounded retry when Peecho returns PAYMENT_ERROR after payment", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();
    provider.payStatuses = ["PAYMENT_ERROR", "PAID"];
    const fulfilment = worker(repository, provider);

    await expect(fulfilment.processNext()).resolves.toMatchObject({ status: "retry_scheduled" });
    await expect(fulfilment.processNext()).resolves.toMatchObject({ status: "submitted" });

    expect(repository.retries).toEqual([{
      code: "PEECHO_PAYMENT_RETRY_REQUIRED",
      deadLetter: false,
    }]);
    expect(provider.createInputs).toHaveLength(1);
    expect(provider.getOrderCalls).toBe(1);
    expect(repository.paymentStarted).toBe(2);
  });

  it("fails closed before create when the locked private PDF is missing", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();

    await expect(worker(repository, provider, fakeStorage({ missing: true })).processNext()).resolves.toMatchObject({
      status: "manual_review",
    });
    expect(repository.manualReasons).toEqual(["PEECHO_PDF_MISSING"]);
    expect(provider.createInputs).toEqual([]);
  });

  it("retries a malformed or prematurely expired signed URL before marking create started", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();

    await expect(worker(
      repository,
      provider,
      fakeStorage({ expiresInSeconds: 100 }),
      300,
    ).processNext()).resolves.toMatchObject({ status: "retry_scheduled" });
    expect(repository.createStarted).toBe(0);
    expect(repository.retries[0]?.code).toBe("PEECHO_SIGNED_URL_INVALID");
    expect(provider.createInputs).toEqual([]);
  });

  it("routes an unknown provider state to manual review", async () => {
    const repository = new FakeRepository();
    const provider = new FakeProvider();
    provider.payStatuses = ["FUTURE_STATE"];

    await expect(worker(repository, provider).processNext()).resolves.toMatchObject({ status: "manual_review" });
    expect(repository.finalized).toEqual(["FUTURE_STATE"]);
    expect(repository.manualReasons).toEqual([]);
  });

  it("does not overwrite a concurrent refund/manual-review decision during reconciliation", async () => {
    const repository = new FakeRepository(fulfilmentJob({
      phase: "reconcile_payment",
      providerOrderId: "9001",
      providerStatus: "OPEN",
    }));
    repository.finalizeOverride = "manual_review";
    const provider = new FakeProvider();
    provider.readStatuses = ["PAID"];

    await expect(worker(repository, provider).processNext()).resolves.toEqual({
      status: "manual_review",
      orderId: ORDER_ID,
    });
    expect(provider.createInputs).toEqual([]);
    expect(repository.paymentStarted).toBe(0);
  });

  it("dead-letters the eighth retry with deterministic bounded backoff", async () => {
    const repository = new FakeRepository(fulfilmentJob({ attemptCount: 8 }));
    const provider = new FakeProvider();
    const storage = fakeStorage({ expiresInSeconds: 100 });

    await expect(worker(repository, provider, storage, 300).processNext()).resolves.toEqual({
      status: "dead_letter",
      orderId: ORDER_ID,
    });
    expect(repository.retries).toEqual([{ code: "PEECHO_SIGNED_URL_INVALID", deadLetter: true }]);
  });
});

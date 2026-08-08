import type { ShippingAddress } from "../../shared/contracts/orders.js";
import type {
  PrintOrderCreated,
  PrintProviderEnvironment,
  VerifiedPrintCallback,
} from "../print/printProvider.js";

export type PeechoFulfilmentPhase =
  | "create"
  | "reconcile_create"
  | "pay"
  | "reconcile_payment";

export type ProviderInboxEnvironment = "test" | "preview" | "staging" | "production";

export interface PeechoFulfilmentClaim {
  workerId: string;
  orderId: string;
}

export interface PeechoFulfilmentJob extends PeechoFulfilmentClaim {
  orderNumber: string;
  merchantReference: string;
  providerEnvironment: PrintProviderEnvironment;
  phase: PeechoFulfilmentPhase;
  providerOrderId: string | null;
  providerStatus: string | null;
  attemptCount: number;
  offeringId: string;
  currency: "EUR";
  quantity: number;
  pageCount: number;
  shippingCountry: string;
  customerEmailCiphertext: string;
  shippingDetailsCiphertext: string;
  piiEncryptionKeyVersion: number;
  pdfObjectKey: string;
  pdfBucket: string;
  pdfSizeBytes: number;
  pdfSha256: string;
}

export interface RevealedFulfilmentPii {
  customerEmail: string;
  shippingAddress: ShippingAddress;
}

export interface FulfilmentPiiReader {
  reveal(job: PeechoFulfilmentJob): RevealedFulfilmentPii;
}

export type PeechoProviderStatusOutcome =
  | "payment_required"
  | "submitted"
  | "in_production"
  | "shipped"
  | "manual_review";

export interface PeechoCallbackResult {
  replayed: boolean;
  applied: boolean;
  outcome: "applied" | "ignored_out_of_order" | "manual_review" | "reference_rejected";
}

export interface PeechoFulfilmentRepository {
  claimNext(
    workerId: string,
    environment: PrintProviderEnvironment,
    leaseSeconds: number,
  ): Promise<PeechoFulfilmentClaim | null>;
  begin(claim: PeechoFulfilmentClaim, environment: PrintProviderEnvironment): Promise<PeechoFulfilmentJob | null>;
  beginCreate(job: PeechoFulfilmentJob): Promise<void>;
  persistCreated(job: PeechoFulfilmentJob, created: PrintOrderCreated): Promise<void>;
  beginPayment(job: PeechoFulfilmentJob & { providerOrderId: string }): Promise<void>;
  finalizeProviderStatus(
    job: PeechoFulfilmentJob & { providerOrderId: string },
    providerStatus: string,
    tracking?: { code?: string | null; url?: string | null },
  ): Promise<PeechoProviderStatusOutcome>;
  scheduleRetry(
    claim: PeechoFulfilmentClaim,
    failureCode: string,
    delaySeconds: number,
    deadLetter: boolean,
  ): Promise<void>;
  moveToManualReview(claim: PeechoFulfilmentClaim, reasonCode: string): Promise<void>;
  recordCallback(input: {
    inboxEnvironment: ProviderInboxEnvironment;
    providerEnvironment: PrintProviderEnvironment;
    event: VerifiedPrintCallback;
  }): Promise<PeechoCallbackResult>;
}

export interface FulfilmentClock {
  now(): Date;
}

export const systemFulfilmentClock: FulfilmentClock = {
  now: () => new Date(),
};

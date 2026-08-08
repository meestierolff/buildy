import { createHash } from "node:crypto";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import {
  AccountEventEmailPayloadError,
  prepareAccountEventEmail,
  type AccountEventEmailContext,
} from "./accountEventEmailPayload.js";
import { AuthEmailPayloadError, prepareAuthEmail } from "./authEmailPayload.js";
import {
  CommunityEmailPayloadError,
  prepareCommunityEmail,
  type CommunityEmailContext,
} from "./communityEmailPayload.js";
import {
  OrderEmailPayloadError,
  prepareOrderEmail,
  type OrderEmailContext,
} from "./orderEmailPayload.js";
import type { EmailTemplateCatalog } from "./templates.js";
import {
  TransactionalEmailError,
  type TransactionalEmailMessage,
  type TransactionalEmailProvider,
  type TransactionalEmailReceipt,
} from "./transactionalEmail.js";

export type EmailDeliveryAttemptStatus = "queued" | "deferred" | "submitted" | "delivered" | "failed";

export interface PreparedEmailDeliveryRecord {
  status: EmailDeliveryAttemptStatus;
  firstAttemptAt: Date;
}

export interface ClaimedEmailEvent {
  id: string;
  aggregateId: string;
  aggregateType:
    | "auth_email"
    | "photobook_order"
    | "moderation_report"
    | "feedback_submission"
    | "account_lifecycle"
    | "project_access"
    | "account_security"
    | "identity_migration";
  eventType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

interface PreparedEmail {
  delivery: {
    idempotencyKey: string;
    recipientHash: string;
    templateKey: string;
    templateVersion: string;
  };
  message: TransactionalEmailMessage;
}

export interface EmailWorkerRepository {
  claim(input: {
    batchSize: number;
    leaseOwner: string;
    leaseSeconds: number;
  }): Promise<ClaimedEmailEvent[]>;
  loadOrderEmailContext(input: {
    eventId: string;
    leaseOwner: string;
  }): Promise<OrderEmailContext | undefined>;
  loadCommunityEmailContext(input: {
    eventId: string;
    leaseOwner: string;
  }): Promise<CommunityEmailContext | undefined>;
  loadAccountEventEmailContext(input: {
    eventId: string;
    leaseOwner: string;
  }): Promise<AccountEventEmailContext | undefined>;
  prepareDelivery(input: {
    eventId: string;
    leaseOwner: string;
    idempotencyKey: string;
    recipientHash: string;
    templateKey: string;
    templateVersion: string;
  }): Promise<PreparedEmailDeliveryRecord>;
  acknowledge(input: { eventId: string; leaseOwner: string }): Promise<void>;
  complete(input: {
    eventId: string;
    leaseOwner: string;
    receipt: TransactionalEmailReceipt;
  }): Promise<void>;
  fail(input: {
    deadLetter: boolean;
    delaySeconds: number;
    errorCode: string;
    eventId: string;
    leaseOwner: string;
  }): Promise<void>;
  reconcileDeliveries(batchSize: number): Promise<number>;
}

export interface EmailWorkerResult {
  claimed: number;
  deadLettered: number;
  delivered: number;
  reconciled: number;
  retried: number;
  skipped: number;
}

export interface EmailWorkerOptions {
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  safeRetryWindowSeconds?: number;
  appOrigin?: string;
  now?: () => Date;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_SECONDS = 90;
const DEFAULT_MAX_ATTEMPTS = 6;
// Brevo's single-message idempotency documentation historically guarantees a
// 15-minute TTL. Keep automatic uncertainty recovery inside a 12-minute guard.
const DEFAULT_SAFE_RETRY_WINDOW_SECONDS = 12 * 60;

function retryDelaySeconds(attemptCount: number, eventId: string): number {
  const exponential = Math.min(600, 15 * 2 ** Math.max(0, attemptCount - 1));
  const jitterByte = createHash("sha256").update(eventId).update(String(attemptCount)).digest()[0];
  return exponential + (jitterByte % 16);
}

function safeErrorCode(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof TransactionalEmailError) {
    return { code: `email_${error.code.toLowerCase()}`, retryable: error.retryable };
  }
  if (error instanceof AuthEmailPayloadError) {
    return { code: "email_payload_invalid", retryable: false };
  }
  if (error instanceof OrderEmailPayloadError) {
    return { code: "order_email_payload_invalid", retryable: false };
  }
  if (error instanceof CommunityEmailPayloadError) {
    return { code: "community_email_payload_invalid", retryable: false };
  }
  if (error instanceof AccountEventEmailPayloadError) {
    return { code: "account_email_payload_invalid", retryable: false };
  }
  return { code: "email_worker_unexpected", retryable: false };
}

export class EmailOutboxWorker {
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly maxAttempts: number;
  private readonly safeRetryWindowSeconds: number;
  private readonly appOrigin: string | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly repository: EmailWorkerRepository,
    private readonly provider: TransactionalEmailProvider,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly templates: EmailTemplateCatalog,
    options: EmailWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.safeRetryWindowSeconds = options.safeRetryWindowSeconds ?? DEFAULT_SAFE_RETRY_WINDOW_SECONDS;
    this.appOrigin = options.appOrigin;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(leaseOwner: string = crypto.randomUUID()): Promise<EmailWorkerResult> {
    const events = await this.repository.claim({
      batchSize: this.batchSize,
      leaseOwner,
      leaseSeconds: this.leaseSeconds,
    });
    const result: EmailWorkerResult = {
      claimed: events.length,
      deadLettered: 0,
      delivered: 0,
      reconciled: 0,
      retried: 0,
      skipped: 0,
    };

    for (const rawEvent of events) {
      let orderContext: OrderEmailContext | undefined;
      let communityContext: CommunityEmailContext | undefined;
      let accountEventContext: AccountEventEmailContext | undefined;
      if (rawEvent.aggregateType === "photobook_order") {
        // Database failures deliberately escape so the lease can recover. A
        // missing context is instead handled as a terminal payload invariant.
        orderContext = await this.repository.loadOrderEmailContext({
          eventId: rawEvent.id,
          leaseOwner,
        });
      } else if (
        rawEvent.aggregateType === "moderation_report"
        || rawEvent.aggregateType === "feedback_submission"
      ) {
        communityContext = await this.repository.loadCommunityEmailContext({
          eventId: rawEvent.id,
          leaseOwner,
        });
      } else if (
        rawEvent.aggregateType === "account_lifecycle"
        || rawEvent.aggregateType === "project_access"
        || rawEvent.aggregateType === "account_security"
        || rawEvent.aggregateType === "identity_migration"
      ) {
        accountEventContext = await this.repository.loadAccountEventEmailContext({
          eventId: rawEvent.id,
          leaseOwner,
        });
      }

      let decoded: { event: ClaimedEmailEvent; prepared: PreparedEmail };
      try {
        if (rawEvent.aggregateType === "auth_email") {
          decoded = prepareAuthEmail(
            rawEvent,
            this.keyring,
            this.blindIndex,
            this.templates,
          );
        } else if (rawEvent.aggregateType === "photobook_order") {
          decoded = prepareOrderEmail({
            rawEvent,
            rawContext: orderContext,
            keyring: this.keyring,
            blindIndex: this.blindIndex,
            templates: this.templates,
            appOrigin: this.appOrigin ?? "",
          });
        } else if (
          rawEvent.aggregateType === "moderation_report"
          || rawEvent.aggregateType === "feedback_submission"
        ) {
          decoded = prepareCommunityEmail({
            rawEvent,
            rawContext: communityContext,
            keyring: this.keyring,
            blindIndex: this.blindIndex,
            templates: this.templates,
          });
        } else {
          decoded = prepareAccountEventEmail({
            rawEvent,
            rawContext: accountEventContext,
            keyring: this.keyring,
            blindIndex: this.blindIndex,
            templates: this.templates,
            appOrigin: this.appOrigin ?? "",
          });
        }
      } catch (error) {
        const classified = safeErrorCode(error);
        await this.repository.fail({
          deadLetter: true,
          delaySeconds: 0,
          errorCode: classified.code,
          eventId: rawEvent.id,
          leaseOwner,
        });
        result.deadLettered += 1;
        continue;
      }

      const { event, prepared } = decoded;
      // Repository failures deliberately escape: marking a database failure as
      // a provider failure could discard an accepted message. The lease then
      // expires and the same provider idempotency UUID is reused.
      const delivery = await this.repository.prepareDelivery({
        eventId: event.id,
        leaseOwner,
        ...prepared.delivery,
      });

      if (delivery.status === "submitted" || delivery.status === "delivered") {
        await this.repository.acknowledge({ eventId: event.id, leaseOwner });
        result.skipped += 1;
        continue;
      }

      let receipt: TransactionalEmailReceipt;
      try {
        receipt = await this.provider.send(prepared.message);
      } catch (error) {
        const classified = safeErrorCode(error);
        const ageSeconds = Math.max(
          0,
          (this.now().getTime() - delivery.firstAttemptAt.getTime()) / 1_000,
        );
        const canRetry = classified.retryable
          && rawEvent.attemptCount < this.maxAttempts
          && ageSeconds < this.safeRetryWindowSeconds;
        await this.repository.fail({
          deadLetter: !canRetry,
          delaySeconds: canRetry ? retryDelaySeconds(rawEvent.attemptCount, rawEvent.id) : 0,
          errorCode: classified.code,
          eventId: rawEvent.id,
          leaseOwner,
        });
        if (canRetry) result.retried += 1;
        else result.deadLettered += 1;
        continue;
      }

      await this.repository.complete({ eventId: event.id, leaseOwner, receipt });
      result.delivered += 1;
    }

    result.reconciled = await this.repository.reconcileDeliveries(100);

    return result;
  }
}

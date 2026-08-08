import { sql } from "drizzle-orm";
import { z } from "zod";
import type { BuildyDatabase } from "../db/client.js";
import {
  accountEventEmailContextSchema,
  type AccountEventEmailContext,
} from "./accountEventEmailPayload.js";
import {
  communityEmailContextSchema,
  type CommunityEmailContext,
} from "./communityEmailPayload.js";
import {
  orderEmailContextSchema,
  type OrderEmailContext,
} from "./orderEmailPayload.js";
import type {
  EmailWorkerRepository,
  PreparedEmailDeliveryRecord,
} from "./worker.js";

const claimedRowSchema = z.object({
  id: z.string().uuid(),
  aggregate_id: z.string().uuid(),
  aggregate_type: z.enum([
    "auth_email",
    "photobook_order",
    "moderation_report",
    "feedback_submission",
    "account_lifecycle",
    "project_access",
    "account_security",
    "identity_migration",
  ]),
  event_type: z.string(),
  idempotency_key: z.string(),
  payload: z.record(z.unknown()),
  attempt_count: z.number().int().nonnegative(),
});

const orderContextRowSchema = z.object({
  order_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  order_number: z.string(),
  currency: z.string(),
  quantity: z.coerce.number().int(),
  subtotal_minor: z.coerce.number().int(),
  shipping_minor: z.coerce.number().int(),
  tax_minor: z.coerce.number().int(),
  total_minor: z.coerce.number().int(),
  refunded_minor: z.coerce.number().int(),
  shipping_country: z.string(),
  customer_email_ciphertext: z.string(),
  shipping_details_ciphertext: z.string(),
  checkout_snapshot: z.record(z.unknown()),
  seller_snapshot: z.record(z.unknown()),
  terms_version: z.string(),
  delivery_estimate: z.string(),
  status: z.string(),
  payment_status: z.string(),
  fulfilment_status: z.string(),
  tracking_url: z.string().nullable(),
  created_at: z.coerce.date(),
  paid_at: z.coerce.date().nullable(),
});

const communityContextRowSchema = z.object({
  aggregate_type: z.enum(["moderation_report", "feedback_submission"]),
  aggregate_id: z.string().uuid(),
  recipient_ciphertext: z.string(),
  contact_hash: z.string(),
  receipt_code: z.string(),
  kind: z.string().nullable(),
  created_at: z.coerce.date(),
  target_type: z.string().nullable(),
  category: z.string().nullable(),
});

const accountEventContextRowSchema = z.object({
  aggregate_type: z.enum([
    "account_lifecycle",
    "project_access",
    "account_security",
    "identity_migration",
  ]),
  aggregate_id: z.string().uuid(),
  recipient_user_id: z.string().uuid(),
  recipient_ciphertext: z.string(),
  recipient_hash: z.string(),
  display_name: z.string(),
  actor_display_name: z.string().nullable(),
  project_title: z.string().nullable(),
  created_at: z.coerce.date(),
});

const preparedRowSchema = z.object({
  status: z.enum(["queued", "deferred", "submitted", "delivered", "failed"]),
  first_attempt_at: z.coerce.date(),
});

export class PostgresEmailWorkerRepository implements EmailWorkerRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async claim(input: Parameters<EmailWorkerRepository["claim"]>[0]) {
    const result = await this.database.execute(sql`
      select * from app_email_worker_claim(
        ${input.leaseOwner},
        ${input.leaseSeconds},
        ${input.batchSize}
      )
    `);

    return result.rows.map((row) => {
      const parsed = claimedRowSchema.parse(row);
      return {
        id: parsed.id,
        aggregateId: parsed.aggregate_id,
        aggregateType: parsed.aggregate_type,
        eventType: parsed.event_type,
        idempotencyKey: parsed.idempotency_key,
        payload: parsed.payload,
        attemptCount: parsed.attempt_count,
      };
    });
  }

  async loadOrderEmailContext(
    input: Parameters<EmailWorkerRepository["loadOrderEmailContext"]>[0],
  ): Promise<OrderEmailContext | undefined> {
    const result = await this.database.execute(sql`
      select * from app_email_worker_load_order(
        ${input.eventId}::uuid,
        ${input.leaseOwner}
      )
    `);
    if (!result.rows[0]) return undefined;

    const row = orderContextRowSchema.parse(result.rows[0]);
    return orderEmailContextSchema.parse({
      orderId: row.order_id,
      ownerId: row.owner_id,
      orderNumber: row.order_number,
      currency: row.currency,
      quantity: row.quantity,
      subtotalMinor: row.subtotal_minor,
      shippingMinor: row.shipping_minor,
      taxMinor: row.tax_minor,
      totalMinor: row.total_minor,
      refundedMinor: row.refunded_minor,
      shippingCountry: row.shipping_country,
      customerEmailCiphertext: row.customer_email_ciphertext,
      shippingDetailsCiphertext: row.shipping_details_ciphertext,
      checkoutSnapshot: row.checkout_snapshot,
      sellerSnapshot: row.seller_snapshot,
      termsVersion: row.terms_version,
      deliveryEstimate: row.delivery_estimate,
      status: row.status,
      paymentStatus: row.payment_status,
      fulfilmentStatus: row.fulfilment_status,
      trackingUrl: row.tracking_url,
      createdAt: row.created_at,
      paidAt: row.paid_at,
    });
  }

  async loadCommunityEmailContext(
    input: Parameters<EmailWorkerRepository["loadCommunityEmailContext"]>[0],
  ): Promise<CommunityEmailContext | undefined> {
    const result = await this.database.execute(sql`
      select * from app_email_worker_load_community_receipt(
        ${input.eventId}::uuid,
        ${input.leaseOwner}
      )
    `);
    if (!result.rows[0]) return undefined;

    const row = communityContextRowSchema.parse(result.rows[0]);
    return communityEmailContextSchema.parse({
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      recipientCiphertext: row.recipient_ciphertext,
      contactHash: row.contact_hash,
      receiptCode: row.receipt_code,
      kind: row.kind,
      createdAt: row.created_at,
      targetType: row.target_type,
      category: row.category,
    });
  }

  async loadAccountEventEmailContext(
    input: Parameters<EmailWorkerRepository["loadAccountEventEmailContext"]>[0],
  ): Promise<AccountEventEmailContext | undefined> {
    const result = await this.database.execute(sql`
      select * from app_email_worker_load_account_event(
        ${input.eventId}::uuid,
        ${input.leaseOwner}
      )
    `);
    if (!result.rows[0]) return undefined;

    const row = accountEventContextRowSchema.parse(result.rows[0]);
    return accountEventEmailContextSchema.parse({
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      recipientUserId: row.recipient_user_id,
      recipientCiphertext: row.recipient_ciphertext,
      recipientHash: row.recipient_hash,
      displayName: row.display_name,
      actorDisplayName: row.actor_display_name,
      projectTitle: row.project_title,
      createdAt: row.created_at,
    });
  }

  async prepareDelivery(
    input: Parameters<EmailWorkerRepository["prepareDelivery"]>[0],
  ): Promise<PreparedEmailDeliveryRecord> {
    const accountTemplate = [
      "lifecycle.welcome",
      "social.access_requested",
      "social.access_accepted",
      "security.account_alert",
      "migration.account",
    ].includes(input.templateKey);
    const result = accountTemplate
      ? await this.database.execute(sql`
      select * from app_email_worker_prepare_account(
        ${input.eventId}::uuid,
        ${input.leaseOwner},
        ${input.idempotencyKey},
        ${input.recipientHash},
        ${input.templateKey},
        ${input.templateVersion}
      )
    `)
      : await this.database.execute(sql`
      select * from app_email_worker_prepare(
        ${input.eventId}::uuid,
        ${input.leaseOwner},
        ${input.idempotencyKey},
        ${input.recipientHash},
        ${input.templateKey},
        ${input.templateVersion}
      )
    `);
    const parsed = preparedRowSchema.parse(result.rows[0]);
    return { status: parsed.status, firstAttemptAt: parsed.first_attempt_at };
  }

  async acknowledge(input: Parameters<EmailWorkerRepository["acknowledge"]>[0]): Promise<void> {
    await this.database.execute(sql`
      select app_email_worker_acknowledge(${input.eventId}::uuid, ${input.leaseOwner})
    `);
  }

  async complete(input: Parameters<EmailWorkerRepository["complete"]>[0]): Promise<void> {
    await this.database.execute(sql`
      select app_email_worker_complete(
        ${input.eventId}::uuid,
        ${input.leaseOwner},
        ${input.receipt.provider},
        ${input.receipt.messageId},
        ${input.receipt.acceptedAt}::timestamptz
      )
    `);
  }

  async fail(input: Parameters<EmailWorkerRepository["fail"]>[0]): Promise<void> {
    await this.database.execute(sql`
      select app_email_worker_fail(
        ${input.eventId}::uuid,
        ${input.leaseOwner},
        ${input.errorCode},
        ${input.delaySeconds},
        ${input.deadLetter}
      )
    `);
  }

  async reconcileDeliveries(batchSize: number): Promise<number> {
    const result = await this.database.execute<{ applied_count: number }>(sql`
      select app_reconcile_brevo_delivery_events(${batchSize}) as applied_count
    `);
    return Number(result.rows[0]?.applied_count ?? 0);
  }
}

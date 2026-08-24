import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminOrderEventSchema,
  fulfilmentStatusSchema,
  paymentStatusSchema,
  sellerSnapshotSchema,
} from "../../shared/contracts/orders.js";
import type { BuildyDatabase } from "../db/client.js";
import { OrderAdminError } from "./adminErrors.js";
import type {
  AdminOrderActionCommand,
  AdminOrderQueueCommand,
  EncryptedAdminOrder,
  OrderAdminRepository,
} from "./adminTypes.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const queueRowSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  customer_name: z.string(),
  project_id: z.string().uuid(),
  project_title: z.string(),
  paid_at: z.coerce.date(),
  quantity: z.coerce.number().int().positive(),
  page_count: z.coerce.number().int(),
  currency: z.literal("EUR"),
  total_minor: z.coerce.number().int().nonnegative(),
  payment_status: paymentStatusSchema,
  fulfilment_state: fulfilmentStatusSchema,
  needs_attention: z.boolean(),
  version: z.coerce.number().int().positive(),
});

const detailRowSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  owner_id: z.string().uuid(),
  customer_name: z.string(),
  customer_email_ciphertext: z.string().min(1),
  shipping_details_ciphertext: z.string().min(1),
  project_id: z.string().uuid(),
  project_title: z.string(),
  proof_revision_id: z.string().uuid(),
  document_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pdf_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pdf_object_key: z.string().min(1),
  pdf_size_bytes: z.coerce.number().int().positive(),
  page_count: z.coerce.number().int().min(24).max(400),
  quantity: z.coerce.number().int().positive(),
  currency: z.literal("EUR"),
  subtotal_minor: z.coerce.number().int().nonnegative(),
  shipping_minor: z.coerce.number().int().nonnegative(),
  tax_minor: z.coerce.number().int().nonnegative(),
  total_minor: z.coerce.number().int().nonnegative(),
  payment_status: paymentStatusSchema,
  refunded_minor: z.coerce.number().int().nonnegative(),
  fulfilment_state: fulfilmentStatusSchema,
  manual_provider_reference: z.string().nullable(),
  fulfilment_notes_ciphertext: z.string().nullable(),
  tracking_url: z.string().nullable(),
  seller_snapshot: sellerSnapshotSchema,
  stripe_checkout_session_id: z.string().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
  stripe_charge_id: z.string().nullable(),
  paid_at: z.coerce.date(),
  reviewed_at: z.coerce.date().nullable(),
  ordered_manually_at: z.coerce.date().nullable(),
  in_production_at: z.coerce.date().nullable(),
  shipped_at: z.coerce.date().nullable(),
  completed_at: z.coerce.date().nullable(),
  refund_review_at: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  version: z.coerce.number().int().positive(),
});

const eventRowSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.string(),
  actor_user_id: z.string().uuid().nullable(),
  from_status: z.string().nullable(),
  to_status: z.string().nullable(),
  payload_summary: z.unknown(),
  occurred_at: z.coerce.date(),
});

const actionRowSchema = z.object({
  order_id: z.string().uuid(),
  fulfilment_state: fulfilmentStatusSchema,
  order_version: z.coerce.number().int().positive(),
  replayed: z.boolean(),
});

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof OrderAdminError) throw error;
  switch (databaseCode(error)) {
    case "42501": throw new OrderAdminError("FORBIDDEN", { cause: error });
    case "P0002": throw new OrderAdminError("ORDER_NOT_FOUND", { cause: error });
    case "40001": throw new OrderAdminError("VERSION_CONFLICT", { cause: error });
    case "23505": throw new OrderAdminError("IDEMPOTENCY_CONFLICT", { cause: error });
    case "22023":
    case "55000": throw new OrderAdminError("INVALID_ACTION", { cause: error });
    default: throw error;
  }
}

async function setActor(
  transaction: DatabaseTransaction,
  actorId: string,
): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export class PostgresOrderAdminRepository implements OrderAdminRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async list(command: AdminOrderQueueCommand) {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor.appUserId);
        const result = await transaction.execute(sql`
          select * from public.app_admin_list_paid_orders(
            ${command.query.status},
            ${command.cursor?.paidAt ?? null}::timestamptz,
            ${command.cursor?.orderId ?? null}::uuid,
            ${command.query.limit}
          )
        `);
        const rows = z.array(queueRowSchema).parse(result.rows);
        const hasMore = rows.length > command.query.limit;
        return {
          items: rows.slice(0, command.query.limit).map((row) => ({
            orderId: row.order_id,
            orderNumber: row.order_number,
            customerName: row.customer_name,
            projectId: row.project_id,
            projectTitle: row.project_title,
            paidAt: row.paid_at.toISOString(),
            quantity: row.quantity,
            pageCount: row.page_count,
            currency: row.currency,
            totalMinor: row.total_minor,
            paymentStatus: row.payment_status,
            fulfilmentStatus: row.fulfilment_state,
            needsAttention: row.needs_attention,
            version: row.version,
          })),
          hasMore,
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async load(actor: AdminOrderQueueCommand["actor"], orderId: string) {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, actor.appUserId);
        const detailResult = await transaction.execute(sql`
          select * from public.app_admin_load_paid_order(${orderId}::uuid)
        `);
        const eventResult = await transaction.execute(sql`
          select * from public.app_admin_list_order_events(${orderId}::uuid)
        `);
        const raw = detailResult.rows[0];
        if (!raw) return null;
        const row = detailRowSchema.parse(raw);
        const events = z.array(eventRowSchema).parse(eventResult.rows).map((event) =>
          adminOrderEventSchema.parse({
            id: event.event_id,
            eventType: event.event_type,
            actorUserId: event.actor_user_id,
            fromStatus: event.from_status,
            toStatus: event.to_status,
            occurredAt: event.occurred_at.toISOString(),
          }));
        return {
          orderId: row.order_id,
          orderNumber: row.order_number,
          ownerId: row.owner_id,
          customerName: row.customer_name,
          customerEmailCiphertext: row.customer_email_ciphertext,
          shippingDetailsCiphertext: row.shipping_details_ciphertext,
          projectId: row.project_id,
          projectTitle: row.project_title,
          paidAt: row.paid_at.toISOString(),
          proofRevisionId: row.proof_revision_id,
          documentSha256: row.document_sha256,
          pdfSha256: row.pdf_sha256,
          pdfObjectKey: row.pdf_object_key,
          pdfSizeBytes: row.pdf_size_bytes,
          pageCount: row.page_count,
          quantity: row.quantity,
          currency: row.currency,
          totalMinor: row.total_minor,
          paymentStatus: row.payment_status,
          fulfilmentStatus: row.fulfilment_state,
          needsAttention: ["manual_review", "refund_review"].includes(row.fulfilment_state),
          version: row.version,
          amounts: {
            currency: row.currency,
            subtotalMinor: row.subtotal_minor,
            shippingMinor: row.shipping_minor,
            taxMinor: row.tax_minor,
            totalMinor: row.total_minor,
          },
          refundedMinor: row.refunded_minor,
          manualProviderReference: row.manual_provider_reference,
          fulfilmentNotesCiphertext: row.fulfilment_notes_ciphertext,
          trackingUrl: row.tracking_url,
          seller: row.seller_snapshot,
          stripeReferences: {
            checkoutSessionId: row.stripe_checkout_session_id,
            paymentIntentId: row.stripe_payment_intent_id,
            chargeId: row.stripe_charge_id,
          },
          milestones: {
            reviewedAt: iso(row.reviewed_at),
            orderedManuallyAt: iso(row.ordered_manually_at),
            inProductionAt: iso(row.in_production_at),
            shippedAt: iso(row.shipped_at),
            completedAt: iso(row.completed_at),
            refundReviewAt: iso(row.refund_review_at),
          },
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          events,
        } satisfies EncryptedAdminOrder;
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async apply(command: AdminOrderActionCommand) {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actor.appUserId);
        const result = await transaction.execute(sql`
          select * from public.app_admin_apply_manual_fulfilment(
            ${command.orderId}::uuid,
            ${command.expectedVersion},
            ${command.action},
            ${command.externalReference},
            ${command.trackingUrl},
            ${command.notesCiphertext},
            ${command.idempotencyKey},
            ${command.requestHash},
            ${command.requestId}
          )
        `);
        const row = actionRowSchema.parse(result.rows[0]);
        return {
          orderId: row.order_id,
          fulfilmentStatus: row.fulfilment_state,
          version: row.order_version,
          replayed: row.replayed,
        };
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }
}

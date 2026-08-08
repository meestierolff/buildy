import { sql } from "drizzle-orm";
import { z } from "zod";
import type { PhotobookOrderDetail } from "../../shared/contracts/orders.js";
import { photobookOrderAmountSchema } from "../../shared/contracts/orders.js";
import type { BuildyDatabase } from "../db/client.js";
import { OrderError } from "./errors.js";
import type {
  CheckoutProofContext,
  CheckoutReservation,
  OrderRepository,
  RecordCheckoutSessionCommand,
  ReserveCheckoutCommand,
} from "./types.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const checkoutSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  sku: z.literal("a4-landscape-hardcover-v1"),
  format: z.literal("a4-landscape-hardcover-v1"),
  projectTitle: z.string().min(1).max(120),
  pageCount: z.number().int().min(24).max(400),
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  pdfSha256: z.string().regex(/^[0-9a-f]{64}$/),
  unitAmountMinor: z.number().int().nonnegative(),
  quoteReference: z.string().min(1).max(200),
  offeringId: z.string().min(1).max(120),
  commercialApprovalId: z.string().min(1).max(160),
  taxTreatment: z.enum(["vat_included", "vat_exclusive", "vat_exempt"]),
  quoteExpiresAt: z.string().datetime(),
  personalisedProduct: z.literal(true),
}).strict();

type ReservationRow = {
  id: string;
  order_number: string;
  merchant_reference: string;
  owner_id: string;
  project_id: string;
  proof_revision_id: string;
  idempotency_key: string;
  quantity: number | string;
  shipping_country: string;
  currency: string;
  subtotal_minor: number | string;
  shipping_minor: number | string;
  tax_minor: number | string;
  total_minor: number | string;
  delivery_estimate: string | null;
  terms_version: string;
  checkout_snapshot: unknown;
  customer_email: string;
};

type OrderDetailRow = Omit<ReservationRow, "customer_email"> & {
  status: PhotobookOrderDetail["status"];
  payment_status: PhotobookOrderDetail["paymentStatus"];
  refunded_minor: number | string;
  fulfilment_status: PhotobookOrderDetail["fulfilmentStatus"];
  tracking_url: string | null;
  created_at: Date | string;
  paid_at: Date | string | null;
};

function numberValue(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new OrderError("ORDER_STATE_CONFLICT");
  return parsed;
}

function objectValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new OrderError("ORDER_STATE_CONFLICT", { cause: error });
  }
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new OrderError("ORDER_STATE_CONFLICT");
  return parsed.toISOString();
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseCode(error.cause) : undefined;
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof OrderError) throw error;
  const code = databaseCode(error);
  if (code === "23505") throw new OrderError("IDEMPOTENCY_CONFLICT", { cause: error });
  if (code === "23503" || code === "42501") throw new OrderError("ORDER_NOT_FOUND", { cause: error });
  if (code === "23514" || code === "40001") {
    throw new OrderError("ORDER_STATE_CONFLICT", { cause: error });
  }
  throw error;
}

async function setActor(transaction: DatabaseTransaction, actorId: string): Promise<void> {
  await transaction.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
}

function reservationFromRow(row: ReservationRow, replayed: boolean): CheckoutReservation {
  const snapshot = checkoutSnapshotSchema.parse(objectValue(row.checkout_snapshot));
  const amounts = photobookOrderAmountSchema.parse({
    currency: row.currency,
    subtotalMinor: numberValue(row.subtotal_minor),
    shippingMinor: numberValue(row.shipping_minor),
    taxMinor: numberValue(row.tax_minor),
    totalMinor: numberValue(row.total_minor),
  });
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    merchantReference: row.merchant_reference,
    actorId: row.owner_id,
    projectId: row.project_id,
    projectTitle: snapshot.projectTitle,
    proofRevisionId: row.proof_revision_id,
    documentSha256: snapshot.documentSha256,
    pdfSha256: snapshot.pdfSha256,
    sku: snapshot.sku,
    format: snapshot.format,
    pageCount: snapshot.pageCount,
    quantity: numberValue(row.quantity),
    destinationCountry: row.shipping_country,
    unitAmountMinor: snapshot.unitAmountMinor,
    amounts,
    deliveryEstimate: row.delivery_estimate ?? "",
    termsVersion: row.terms_version,
    customerEmail: row.customer_email,
    requestHash: snapshot.requestHash,
    idempotencyKey: row.idempotency_key,
    quoteReference: snapshot.quoteReference,
    offeringId: snapshot.offeringId,
    commercialApprovalId: snapshot.commercialApprovalId,
    taxTreatment: snapshot.taxTreatment,
    replayed,
  };
}

const reservationSelect = sql.raw(`
  select
    orders.id,
    orders.order_number,
    orders.merchant_reference,
    orders.owner_id,
    orders.project_id,
    orders.proof_revision_id,
    orders.idempotency_key,
    orders.quantity,
    orders.shipping_country,
    orders.currency,
    orders.subtotal_minor,
    orders.shipping_minor,
    orders.tax_minor,
    orders.total_minor,
    orders.delivery_estimate,
    orders.terms_version,
    orders.checkout_snapshot,
    auth_user.email as customer_email
  from public.photobook_orders orders
  join public.auth_identity_mappings mapping
    on mapping.app_user_id = orders.owner_id
   and mapping.migration_status = 'linked'
   and mapping.auth_user_id is not null
  join public.auth_users auth_user on auth_user.id = mapping.auth_user_id
`);

export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async findCheckoutReservation(actorId: string, idempotencyKey: string, requestHash: string) {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<ReservationRow>(sql`
        ${reservationSelect}
        where orders.owner_id = ${actorId}::uuid
          and orders.idempotency_key = ${idempotencyKey}
        limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      const reservation = reservationFromRow(row, true);
      if (reservation.requestHash !== requestHash) throw new OrderError("IDEMPOTENCY_CONFLICT");
      return reservation;
    });
  }

  async loadCheckoutProof(actorId: string, revisionId: string): Promise<CheckoutProofContext | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<{
        project_id: string;
        project_title: string;
        revision_id: string;
        status: "approved" | "locked";
        document_sha256: string;
        pdf_sha256: string;
        page_count: number | string;
        selected_format: string;
        customer_email: string;
      }>(sql`
        select
          project.id as project_id,
          project.title as project_title,
          revision.id as revision_id,
          revision.status,
          revision.document_sha256,
          revision.pdf_sha256,
          revision.page_count,
          revision.document ->> 'selectedFormat' as selected_format,
          auth_user.email as customer_email
        from public.photobook_revisions revision
        join public.projects project
          on project.id = revision.project_id
         and project.owner_id = revision.owner_id
         and project.lifecycle_status = 'active'
         and project.deleted_at is null
        join public.media_assets pdf
          on pdf.id = revision.pdf_asset_id
         and pdf.project_id = revision.project_id
         and pdf.owner_id = revision.owner_id
         and pdf.purpose = 'photobook_pdf'
         and pdf.status = 'ready'
         and pdf.sha256 = revision.pdf_sha256
         and pdf.size_bytes = revision.pdf_size_bytes
        join public.auth_identity_mappings mapping
          on mapping.app_user_id = revision.owner_id
         and mapping.migration_status = 'linked'
         and mapping.auth_user_id is not null
        join public.auth_users auth_user
          on auth_user.id = mapping.auth_user_id
         and auth_user.email_verified
        where revision.id = ${revisionId}::uuid
          and revision.owner_id = ${actorId}::uuid
          and revision.status in ('approved', 'locked')
          and revision.pdf_sha256 is not null
          and revision.page_count is not null
          and not jsonb_path_exists(
            revision.document,
            '$.warnings[*] ? (@.severity == "blocking")'
          )
        limit 1
      `);
      const row = result.rows[0];
      if (!row || row.selected_format !== "a4-landscape-hardcover-v1") return null;
      return {
        projectId: row.project_id,
        projectTitle: row.project_title,
        revisionId: row.revision_id,
        status: row.status,
        documentSha256: row.document_sha256,
        pdfSha256: row.pdf_sha256,
        pageCount: numberValue(row.page_count),
        format: "a4-landscape-hardcover-v1",
        customerEmail: row.customer_email,
      };
    });
  }

  async reserveCheckout(command: ReserveCheckoutCommand): Promise<CheckoutReservation> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        await transaction.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))
        `);

        const existing = await transaction.execute<ReservationRow>(sql`
          ${reservationSelect}
          where orders.owner_id = ${command.actorId}::uuid
            and orders.idempotency_key = ${command.idempotencyKey}
          limit 1
        `);
        if (existing.rows[0]) {
          const reservation = reservationFromRow(existing.rows[0], true);
          if (reservation.requestHash !== command.requestHash) {
            throw new OrderError("IDEMPOTENCY_CONFLICT");
          }
          return reservation;
        }

        const proof = await transaction.execute<{ id: string }>(sql`
          select revision.id
          from public.photobook_revisions revision
          join public.projects project
            on project.id = revision.project_id
           and project.owner_id = revision.owner_id
           and project.lifecycle_status = 'active'
           and project.deleted_at is null
          join public.media_assets pdf
            on pdf.id = revision.pdf_asset_id
           and pdf.status = 'ready'
           and pdf.sha256 = revision.pdf_sha256
           and pdf.size_bytes = revision.pdf_size_bytes
          where revision.id = ${command.proofRevisionId}::uuid
            and revision.project_id = ${command.projectId}::uuid
            and revision.owner_id = ${command.actorId}::uuid
            and revision.status = 'approved'
            and revision.document_sha256 = ${command.documentSha256}
            and revision.pdf_sha256 = ${command.pdfSha256}
            and revision.page_count = ${command.pageCount}
            and revision.document ->> 'selectedFormat' = ${command.format}
            and not jsonb_path_exists(
              revision.document,
              '$.warnings[*] ? (@.severity == "blocking")'
            )
          for update of revision
        `);
        if (!proof.rows[0]) throw new OrderError("PROOF_NOT_APPROVED");

        const locked = await transaction.execute(sql`
          update public.photobook_revisions
          set status = 'locked', locked_at = ${command.reservedAt}, updated_at = ${command.reservedAt}
          where id = ${command.proofRevisionId}::uuid
            and owner_id = ${command.actorId}::uuid
            and status = 'approved'
        `);
        if (locked.rowCount !== 1) throw new OrderError("PROOF_NOT_APPROVED");

        const checkoutSnapshot = {
          schemaVersion: 1,
          requestHash: command.requestHash,
          sku: command.sku,
          format: command.format,
          projectTitle: command.projectTitle,
          pageCount: command.pageCount,
          documentSha256: command.documentSha256,
          pdfSha256: command.pdfSha256,
          unitAmountMinor: command.unitAmountMinor,
          quoteReference: command.quoteReference,
          offeringId: command.offeringId,
          commercialApprovalId: command.commercialApprovalId,
          taxTreatment: command.taxTreatment,
          quoteExpiresAt: command.quoteExpiresAt.toISOString(),
          personalisedProduct: true,
        };

        const inserted = await transaction.execute<ReservationRow>(sql`
          insert into public.photobook_orders (
            id, order_number, merchant_reference, project_id, owner_id,
            proof_revision_id, idempotency_key, status, payment_status,
            fulfilment_status, currency, quantity, subtotal_minor,
            shipping_minor, tax_minor, total_minor, shipping_country,
            customer_email_ciphertext, shipping_details_ciphertext,
            pii_encryption_key_version, checkout_snapshot, seller_snapshot,
            terms_version, legal_accepted_at, delivery_estimate
          ) values (
            ${command.orderId}::uuid,
            ${command.orderNumber},
            ${command.merchantReference},
            ${command.projectId}::uuid,
            ${command.actorId}::uuid,
            ${command.proofRevisionId}::uuid,
            ${command.idempotencyKey},
            'awaiting_payment', 'unpaid', 'unclaimed', 'EUR',
            ${command.quantity},
            ${command.amounts.subtotalMinor},
            ${command.amounts.shippingMinor},
            ${command.amounts.taxMinor},
            ${command.amounts.totalMinor},
            ${command.destinationCountry},
            ${command.pii.customerEmailCiphertext},
            ${command.pii.shippingDetailsCiphertext},
            ${command.pii.encryptionKeyVersion},
            ${JSON.stringify(checkoutSnapshot)}::jsonb,
            ${JSON.stringify(command.sellerSnapshot)}::jsonb,
            ${command.termsVersion},
            ${command.reservedAt},
            ${command.deliveryEstimate}
          )
          returning
            id, order_number, merchant_reference, owner_id, project_id,
            proof_revision_id, idempotency_key, quantity, shipping_country,
            currency, subtotal_minor, shipping_minor, tax_minor, total_minor,
            delivery_estimate, terms_version, checkout_snapshot,
            ${command.customerEmail}::text as customer_email
        `);
        const row = inserted.rows[0];
        if (!row) throw new OrderError("ORDER_STATE_CONFLICT");

        await transaction.execute(sql`
          insert into public.photobook_order_events (
            order_id, source, event_type, idempotency_key, actor_user_id,
            from_status, to_status, payload_summary, occurred_at
          ) values (
            ${command.orderId}::uuid,
            'user',
            'order.checkout_reserved.v1',
            ${`order:${command.orderId}:checkout-reserved:v1`},
            ${command.actorId}::uuid,
            null,
            'awaiting_payment',
            ${JSON.stringify({ schemaVersion: 1 })}::jsonb,
            ${command.reservedAt}
          )
        `);
        return reservationFromRow(row, false);
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async recordCheckoutSession(command: RecordCheckoutSessionCommand): Promise<void> {
    if (command.expiresAt.getTime() <= command.now.getTime()) {
      throw new OrderError("CHECKOUT_UNAVAILABLE");
    }
    try {
      await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        const current = await transaction.execute<{
          status: string;
          stripe_checkout_session_id: string | null;
        }>(sql`
          select status, stripe_checkout_session_id
          from public.photobook_orders
          where id = ${command.orderId}::uuid
            and owner_id = ${command.actorId}::uuid
          for update
        `);
        const row = current.rows[0];
        if (!row) throw new OrderError("ORDER_NOT_FOUND");
        if (row.status === "checkout_open" && row.stripe_checkout_session_id === command.sessionId) return;
        if (row.status !== "awaiting_payment" || row.stripe_checkout_session_id !== null) {
          throw new OrderError("ORDER_STATE_CONFLICT");
        }

        const updated = await transaction.execute(sql`
          update public.photobook_orders
          set
            status = 'checkout_open',
            stripe_checkout_session_id = ${command.sessionId},
            stripe_checkout_expires_at = ${command.expiresAt},
            version = version + 1,
            updated_at = ${command.now}
          where id = ${command.orderId}::uuid
            and owner_id = ${command.actorId}::uuid
            and status = 'awaiting_payment'
            and stripe_checkout_session_id is null
        `);
        if (updated.rowCount !== 1) throw new OrderError("ORDER_STATE_CONFLICT");
        await transaction.execute(sql`
          insert into public.photobook_order_events (
            order_id, source, event_type, idempotency_key, actor_user_id,
            from_status, to_status, payload_summary, occurred_at
          ) values (
            ${command.orderId}::uuid,
            'user',
            'order.checkout_opened.v1',
            ${`order:${command.orderId}:checkout:${command.sessionId}`},
            ${command.actorId}::uuid,
            'awaiting_payment',
            'checkout_open',
            ${JSON.stringify({ schemaVersion: 1 })}::jsonb,
            ${command.now}
          )
        `);
      });
    } catch (error) {
      translateDatabaseError(error);
    }
  }

  async getOrder(actorId: string, orderId: string): Promise<PhotobookOrderDetail | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<OrderDetailRow>(sql`
        select
          orders.id,
          orders.order_number,
          orders.merchant_reference,
          orders.owner_id,
          orders.project_id,
          orders.proof_revision_id,
          orders.idempotency_key,
          orders.quantity,
          orders.shipping_country,
          orders.currency,
          orders.subtotal_minor,
          orders.shipping_minor,
          orders.tax_minor,
          orders.total_minor,
          orders.delivery_estimate,
          orders.terms_version,
          orders.checkout_snapshot,
          orders.status,
          orders.payment_status,
          orders.refunded_minor,
          orders.fulfilment_status,
          orders.tracking_url,
          orders.created_at,
          orders.paid_at
        from public.photobook_orders orders
        where orders.id = ${orderId}::uuid
          and orders.owner_id = ${actorId}::uuid
        limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      const reservation = reservationFromRow({ ...row, customer_email: "redacted@example.invalid" }, false);
      return {
        orderId: row.id,
        orderNumber: row.order_number,
        projectId: row.project_id,
        proofRevisionId: row.proof_revision_id,
        sku: reservation.sku,
        format: reservation.format,
        pageCount: reservation.pageCount,
        quantity: reservation.quantity,
        destinationCountry: reservation.destinationCountry,
        amounts: reservation.amounts,
        deliveryEstimate: reservation.deliveryEstimate,
        termsVersion: reservation.termsVersion,
        status: row.status,
        paymentStatus: row.payment_status,
        refundedMinor: numberValue(row.refunded_minor),
        fulfilmentStatus: row.fulfilment_status,
        trackingUrl: row.tracking_url,
        createdAt: iso(row.created_at),
        paidAt: row.paid_at === null ? null : iso(row.paid_at),
      };
    });
  }
}

import { sql } from "drizzle-orm";
import { z } from "zod";
import type {
  CustomerOrderListItem,
  PhotobookOrderDetail,
  PhotobookOrderHistoryEntry,
} from "../../shared/contracts/orders.js";
import { photobookOrderAmountSchema } from "../../shared/contracts/orders.js";
import type { BuildyDatabase } from "../db/client.js";
import { OrderError } from "./errors.js";
import type {
  CancelExpiredCheckoutReservationCommand,
  CheckoutProofContext,
  CheckoutReservation,
  CustomerOrderListResult,
  OrderRepository,
  RecordCheckoutSessionCommand,
  ReserveCheckoutCommand,
} from "./types.js";
import type { CustomerOrderCursor } from "./cursor.js";

type TransactionCallback = Parameters<BuildyDatabase["transaction"]>[0];
type DatabaseTransaction = Parameters<TransactionCallback>[0];

const checkoutSnapshotOrderFactsSchema = z.object({
  sku: z.literal("a4-landscape-hardcover-v1"),
  format: z.literal("a4-landscape-hardcover-v1"),
  projectTitle: z.string().min(1).max(120),
  pageCount: z.number().int().min(24).max(400),
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  pdfSha256: z.string().regex(/^[0-9a-f]{64}$/),
  unitAmountMinor: z.number().int().nonnegative(),
  quoteReference: z.string().min(1).max(200),
  commercialApprovalId: z.string().min(1).max(160),
  taxTreatment: z.enum(["vat_included", "vat_exclusive", "vat_exempt"]),
  quoteExpiresAt: z.string().datetime(),
  personalisedProduct: z.literal(true),
});

const activeRequestHashSchema = {
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
};
const redactedRequestHashSchema = {
  requestHashRedacted: z.literal(true),
  requestHashRedactionReason: z.literal("ACCOUNT_ERASURE"),
};
const legacyProductReferenceSchema = {
  offeringId: z.string().min(1).max(120),
};
const currentProductReferenceSchema = {
  productReference: z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/),
  priceVersion: z.string().min(1).max(160),
};

const checkoutSnapshotSchema = z.union([
  checkoutSnapshotOrderFactsSchema.extend({
    schemaVersion: z.literal(1),
    ...activeRequestHashSchema,
    ...legacyProductReferenceSchema,
  }).strict(),
  checkoutSnapshotOrderFactsSchema.extend({
    schemaVersion: z.literal(2),
    ...activeRequestHashSchema,
    ...legacyProductReferenceSchema,
    termsAccepted: z.literal(true),
  }).strict(),
  checkoutSnapshotOrderFactsSchema.extend({
    schemaVersion: z.literal(3),
    ...activeRequestHashSchema,
    ...currentProductReferenceSchema,
    termsAccepted: z.literal(true),
  }).strict(),
  checkoutSnapshotOrderFactsSchema.extend({
    schemaVersion: z.literal(1),
    ...redactedRequestHashSchema,
    ...legacyProductReferenceSchema,
  }).strict(),
  checkoutSnapshotOrderFactsSchema.extend({
    schemaVersion: z.literal(2),
    ...redactedRequestHashSchema,
    ...legacyProductReferenceSchema,
    termsAccepted: z.literal(true),
  }).strict(),
  checkoutSnapshotOrderFactsSchema.extend({
    schemaVersion: z.literal(3),
    ...redactedRequestHashSchema,
    ...currentProductReferenceSchema,
    termsAccepted: z.literal(true),
  }).strict(),
]);

/** Parses immutable order facts, including non-replayable erasure markers. */
export function parsePersistedCheckoutSnapshot(value: unknown) {
  return checkoutSnapshotSchema.parse(objectValue(value));
}

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
  status: PhotobookOrderDetail["status"];
};

type OrderDetailRow = Omit<ReservationRow, "customer_email"> & {
  payment_status: PhotobookOrderDetail["paymentStatus"];
  refunded_minor: number | string;
  fulfilment_status: PhotobookOrderDetail["fulfilmentStatus"];
  tracking_url: string | null;
  created_at: Date | string;
  paid_at: Date | string | null;
};

type OrderHistoryRow = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  occurred_at: Date | string;
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
  const snapshot = parsePersistedCheckoutSnapshot(row.checkout_snapshot);
  const requestHashRedacted = "requestHashRedacted" in snapshot;
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
    requestHash: requestHashRedacted ? null : snapshot.requestHash,
    requestHashScheme: requestHashRedacted
      ? "redacted"
      : snapshot.schemaVersion === 3
        ? "blind-v2"
        : snapshot.schemaVersion === 2
          ? "legacy-v2"
          : "legacy-v1",
    idempotencyKey: row.idempotency_key,
    quoteReference: snapshot.quoteReference,
    productReference: "productReference" in snapshot
      ? snapshot.productReference
      : snapshot.offeringId,
    priceVersion: "priceVersion" in snapshot
      ? snapshot.priceVersion
      : snapshot.commercialApprovalId,
    commercialApprovalId: snapshot.commercialApprovalId,
    taxTreatment: snapshot.taxTreatment,
    quoteExpiresAt: new Date(snapshot.quoteExpiresAt),
    status: row.status,
    replayed,
  };
}

function historyFromRow(row: OrderHistoryRow): PhotobookOrderHistoryEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    occurredAt: iso(row.occurred_at),
  };
}

function detailFromRow(
  row: OrderDetailRow,
  statusHistory: PhotobookOrderHistoryEntry[],
): PhotobookOrderDetail {
  const reservation = reservationFromRow({ ...row, customer_email: "redacted@example.invalid" }, false);
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    projectId: row.project_id,
    projectTitle: reservation.projectTitle,
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
    statusHistory,
  };
}

function listItemFromRow(row: OrderDetailRow): CustomerOrderListItem {
  const detail = detailFromRow(row, []);
  return {
    orderId: detail.orderId,
    orderNumber: detail.orderNumber,
    projectId: detail.projectId,
    projectTitle: detail.projectTitle,
    pageCount: detail.pageCount,
    quantity: detail.quantity,
    amounts: detail.amounts,
    status: detail.status,
    paymentStatus: detail.paymentStatus,
    fulfilmentStatus: detail.fulfilmentStatus,
    createdAt: detail.createdAt,
    paidAt: detail.paidAt,
  };
}

const orderDetailColumns = sql.raw(`
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
  orders.manual_fulfilment_status as fulfilment_status,
  orders.manual_tracking_url as tracking_url,
  orders.created_at,
  orders.paid_at
`);

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
    orders.status,
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

  async findCheckoutReservation(
    actorId: string,
    proofRevisionId: string,
    idempotencyKey: string,
  ) {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const byKey = await transaction.execute<ReservationRow>(sql`
        ${reservationSelect}
        where orders.owner_id = ${actorId}::uuid
          and orders.idempotency_key = ${idempotencyKey}
        limit 1
      `);
      if (byKey.rows[0]) {
        return reservationFromRow(byKey.rows[0], true);
      }

      const byProof = await transaction.execute<ReservationRow>(sql`
        ${reservationSelect}
        where orders.owner_id = ${actorId}::uuid
          and orders.proof_revision_id = ${proofRevisionId}::uuid
          and orders.status not in ('payment_failed', 'expired', 'cancelled', 'manual_review')
        limit 1
      `);
      if (!byProof.rows[0]) return null;
      return reservationFromRow(byProof.rows[0], true);
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
        await transaction.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`checkout-proof:${command.actorId}:${command.proofRevisionId}`}, 0)
          )
        `);

        const existing = await transaction.execute<ReservationRow>(sql`
          ${reservationSelect}
          where orders.owner_id = ${command.actorId}::uuid
            and orders.idempotency_key = ${command.idempotencyKey}
          limit 1
        `);
        if (existing.rows[0]) {
          const reservation = reservationFromRow(existing.rows[0], true);
          if (
            reservation.requestHashScheme !== "blind-v2"
            || reservation.requestHash !== command.requestHash
          ) {
            throw new OrderError("IDEMPOTENCY_CONFLICT");
          }
          return reservation;
        }

        const existingForProof = await transaction.execute<ReservationRow>(sql`
          ${reservationSelect}
          where orders.owner_id = ${command.actorId}::uuid
            and orders.proof_revision_id = ${command.proofRevisionId}::uuid
            and orders.status not in ('payment_failed', 'expired', 'cancelled', 'manual_review')
          limit 1
        `);
        if (existingForProof.rows[0]) {
          const reservation = reservationFromRow(existingForProof.rows[0], true);
          if (
            reservation.requestHashScheme !== "blind-v2"
            || reservation.requestHash !== command.requestHash
          ) {
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

        const checkoutSnapshot = {
          schemaVersion: 3,
          requestHash: command.requestHash,
          sku: command.sku,
          format: command.format,
          projectTitle: command.projectTitle,
          pageCount: command.pageCount,
          documentSha256: command.documentSha256,
          pdfSha256: command.pdfSha256,
          unitAmountMinor: command.unitAmountMinor,
          quoteReference: command.quoteReference,
          productReference: command.productReference,
          priceVersion: command.priceVersion,
          commercialApprovalId: command.commercialApprovalId,
          taxTreatment: command.taxTreatment,
          quoteExpiresAt: command.quoteExpiresAt.toISOString(),
          termsAccepted: command.termsAccepted,
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
            status,
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

  async cancelExpiredCheckoutReservation(
    command: CancelExpiredCheckoutReservationCommand,
  ): Promise<boolean> {
    try {
      return await this.database.transaction(async (transaction) => {
        await setActor(transaction, command.actorId);
        const current = await transaction.execute<{
          status: string;
          payment_status: string;
          stripe_checkout_session_id: string | null;
          checkout_snapshot: unknown;
        }>(sql`
          select
            status,
            payment_status,
            stripe_checkout_session_id,
            checkout_snapshot
          from public.photobook_orders
          where id = ${command.orderId}::uuid
            and owner_id = ${command.actorId}::uuid
          for update
        `);
        const row = current.rows[0];
        if (!row) return false;
        const snapshot = parsePersistedCheckoutSnapshot(row.checkout_snapshot);
        if (
          row.status !== "awaiting_payment"
          || row.payment_status !== "unpaid"
          || row.stripe_checkout_session_id !== null
          || new Date(snapshot.quoteExpiresAt).getTime() > command.now.getTime()
        ) return false;

        const cancelled = await transaction.execute(sql`
          update public.photobook_orders
          set
            status = 'cancelled',
            last_error_code = 'checkout_quote_expired',
            version = version + 1,
            updated_at = ${command.now}
          where id = ${command.orderId}::uuid
            and owner_id = ${command.actorId}::uuid
            and status = 'awaiting_payment'
            and payment_status = 'unpaid'
            and stripe_checkout_session_id is null
        `);
        if (cancelled.rowCount !== 1) return false;

        await transaction.execute(sql`
          insert into public.photobook_order_events (
            order_id, source, event_type, idempotency_key, actor_user_id,
            from_status, to_status, payload_summary, occurred_at
          ) values (
            ${command.orderId}::uuid,
            'user',
            'order.checkout_reservation_expired.v1',
            ${`order:${command.orderId}:checkout-reservation-expired:v1`},
            ${command.actorId}::uuid,
            'awaiting_payment',
            'cancelled',
            ${JSON.stringify({ schemaVersion: 1 })}::jsonb,
            ${command.now}
          )
          on conflict (idempotency_key) do nothing
        `);
        return true;
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
          payment_status: string;
          stripe_checkout_session_id: string | null;
          project_id: string;
          proof_revision_id: string;
          checkout_snapshot: unknown;
        }>(sql`
          select
            status,
            payment_status,
            stripe_checkout_session_id,
            project_id,
            proof_revision_id,
            checkout_snapshot
          from public.photobook_orders
          where id = ${command.orderId}::uuid
            and owner_id = ${command.actorId}::uuid
          for update
        `);
        const row = current.rows[0];
        if (!row) throw new OrderError("ORDER_NOT_FOUND");
        const replay = row.status === "checkout_open"
          && row.stripe_checkout_session_id === command.sessionId;
        if (
          !replay
          && (
            row.status !== "awaiting_payment"
            || row.payment_status !== "unpaid"
            || row.stripe_checkout_session_id !== null
          )
        ) {
          throw new OrderError("ORDER_STATE_CONFLICT");
        }

        const snapshot = parsePersistedCheckoutSnapshot(row.checkout_snapshot);
        if (!replay && new Date(snapshot.quoteExpiresAt).getTime() <= command.now.getTime()) {
          throw new OrderError("QUOTE_EXPIRED");
        }
        const proof = await transaction.execute<{ status: "approved" | "locked" }>(sql`
          select revision.status
          from public.photobook_revisions revision
          where revision.id = ${row.proof_revision_id}::uuid
            and revision.project_id = ${row.project_id}::uuid
            and revision.owner_id = ${command.actorId}::uuid
            and revision.status in ('approved', 'locked')
            and revision.document_sha256 = ${snapshot.documentSha256}
            and revision.pdf_sha256 = ${snapshot.pdfSha256}
            and revision.page_count = ${snapshot.pageCount}
            and revision.document ->> 'selectedFormat' = ${snapshot.format}
          for update
        `);
        const proofRow = proof.rows[0];
        if (!proofRow) throw new OrderError("PROOF_NOT_APPROVED");
        // A new v3 reservation may only consume an approved proof. A v3 lock
        // can represent an out-of-order paid/manual-review webhook and must
        // stop the URL from being exposed. Legacy v1/v2 reservations were
        // intentionally locked before provider creation and remain replayable.
        if (!replay && proofRow.status !== "approved" && snapshot.schemaVersion === 3) {
          throw new OrderError("PROOF_NOT_APPROVED");
        }
        if (proofRow.status === "approved") {
          const locked = await transaction.execute(sql`
            update public.photobook_revisions
            set status = 'locked', locked_at = ${command.now}, updated_at = ${command.now}
            where id = ${row.proof_revision_id}::uuid
              and owner_id = ${command.actorId}::uuid
              and status = 'approved'
          `);
          if (locked.rowCount !== 1) throw new OrderError("PROOF_NOT_APPROVED");
        }
        if (replay) return;

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

  async listOrders(
    actorId: string,
    cursor: CustomerOrderCursor | undefined,
    limit: number,
  ): Promise<CustomerOrderListResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new OrderError("ORDER_STATE_CONFLICT");
    }
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const cursorFilter = cursor
        ? sql`and (orders.created_at, orders.id) < (${cursor.createdAt}::timestamptz, ${cursor.orderId}::uuid)`
        : sql``;
      const result = await transaction.execute<OrderDetailRow>(sql`
        select ${orderDetailColumns}
        from public.photobook_orders orders
        where orders.owner_id = ${actorId}::uuid
          ${cursorFilter}
        order by orders.created_at desc, orders.id desc
        limit ${limit + 1}
      `);
      const hasMore = result.rows.length > limit;
      return {
        items: result.rows.slice(0, limit).map(listItemFromRow),
        hasMore,
      };
    });
  }

  async getOrder(actorId: string, orderId: string): Promise<PhotobookOrderDetail | null> {
    return this.database.transaction(async (transaction) => {
      await setActor(transaction, actorId);
      const result = await transaction.execute<OrderDetailRow>(sql`
        select ${orderDetailColumns}
        from public.photobook_orders orders
        where orders.id = ${orderId}::uuid
          and orders.owner_id = ${actorId}::uuid
        limit 1
      `);
      const row = result.rows[0];
      if (!row) return null;
      const eventResult = await transaction.execute<OrderHistoryRow>(sql`
        select
          event.id,
          event.event_type,
          event.from_status,
          event.to_status,
          event.occurred_at
        from public.photobook_order_events event
        join public.photobook_orders orders
          on orders.id = event.order_id
         and orders.owner_id = ${actorId}::uuid
        where event.order_id = ${orderId}::uuid
        order by event.occurred_at asc, event.id asc
      `);
      return detailFromRow(row, eventResult.rows.map(historyFromRow));
    });
  }
}

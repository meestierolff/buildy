import { createHash } from "node:crypto";
import {
  adminOrderActionInputSchema,
  adminOrderDetailSchema,
  adminOrderQueueQuerySchema,
  sellerSnapshotSchema,
  shippingAddressSchema,
  type AdminOrderActionResult,
  type AdminOrderDetail,
  type AdminOrderQueuePage,
} from "../../shared/contracts/orders.js";
import type { ModerationAdminActor } from "../moderation/adminActor.js";
import { canonicalJson } from "../security/canonicalJson.js";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";
import {
  decodeOrderAdminCursor,
  encodeOrderAdminCursor,
} from "./adminCursor.js";
import { OrderAdminError } from "./adminErrors.js";
import type { OrderAdminRepository, OrderAdminServiceContract } from "./adminTypes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validatedOrderId(value: string): string {
  if (!UUID.test(value)) throw new OrderAdminError("ORDER_NOT_FOUND");
  return value.toLowerCase();
}

function assertAdmin(actor: ModerationAdminActor): void {
  if (actor.role !== "admin") throw new OrderAdminError("FORBIDDEN");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new OrderAdminError("INVALID_ACTION", { cause: error });
  }
}

export class OrderAdminService implements OrderAdminServiceContract {
  constructor(
    private readonly repository: OrderAdminRepository,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
  ) {}

  async queue(actor: ModerationAdminActor, rawQuery: unknown): Promise<AdminOrderQueuePage> {
    assertAdmin(actor);
    const query = adminOrderQueueQuerySchema.parse(rawQuery);
    const cursor = query.cursor
      ? decodeOrderAdminCursor(query.cursor, query)
      : null;
    const page = await this.repository.list({ actor, query, cursor });
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor: page.hasMore && last
        ? encodeOrderAdminCursor({
            kind: "manual-order-queue",
            version: 1,
            status: query.status,
            paidAt: last.paidAt,
            orderId: last.orderId,
          })
        : null,
    };
  }

  async detail(actor: ModerationAdminActor, rawOrderId: string): Promise<AdminOrderDetail> {
    assertAdmin(actor);
    const orderId = validatedOrderId(rawOrderId);
    const encrypted = await this.repository.load(actor, orderId);
    if (!encrypted) throw new OrderAdminError("ORDER_NOT_FOUND");

    const customerEmail = this.keyring.decrypt(
      encrypted.customerEmailCiphertext,
      `photobook-order:${orderId}:customer-email`,
    );
    const shippingAddress = shippingAddressSchema.parse(parseJson(this.keyring.decrypt(
      encrypted.shippingDetailsCiphertext,
      `photobook-order:${orderId}:shipping-address`,
    )));
    const fulfilmentNotes = encrypted.fulfilmentNotesCiphertext
      ? this.keyring.decrypt(
          encrypted.fulfilmentNotesCiphertext,
          `photobook-order:${orderId}:fulfilment-notes`,
        )
      : null;
    const {
      customerEmailCiphertext: _customerEmailCiphertext,
      shippingDetailsCiphertext: _shippingDetailsCiphertext,
      fulfilmentNotesCiphertext: _fulfilmentNotesCiphertext,
      pdfObjectKey: _pdfObjectKey,
      pdfSizeBytes: _pdfSizeBytes,
      ...safeOrder
    } = encrypted;

    return adminOrderDetailSchema.parse({
      ...safeOrder,
      customerEmail,
      shippingAddress,
      fulfilmentNotes,
      seller: sellerSnapshotSchema.parse(encrypted.seller),
      pdfPath: `/api/admin/orders/${orderId}/pdf`,
    });
  }

  async action(
    actor: ModerationAdminActor,
    rawOrderId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<AdminOrderActionResult> {
    assertAdmin(actor);
    const orderId = validatedOrderId(rawOrderId);
    const input = adminOrderActionInputSchema.parse(rawInput);
    const externalReference = input.externalReference ?? null;
    const trackingUrl = input.trackingUrl ?? null;
    const normalizedNotes = input.notes?.trim() || null;
    const notesCiphertext = normalizedNotes
      ? this.keyring.encrypt(
          normalizedNotes,
          `photobook-order:${orderId}:fulfilment-notes`,
        )
      : null;
    const idempotencyHash = this.blindIndex.create(
      "manual-fulfilment-idempotency",
      `${actor.appUserId}\0${input.idempotencyKey}`,
    );
    const requestHash = this.blindIndex.create(
      "manual-fulfilment-request",
      createHash("sha256").update(canonicalJson({
        orderId,
        action: input.action,
        expectedVersion: input.expectedVersion,
        externalReference,
        trackingUrl,
        notes: normalizedNotes,
      })).digest("hex"),
    );

    return this.repository.apply({
      actor,
      orderId,
      action: input.action,
      expectedVersion: input.expectedVersion,
      externalReference,
      trackingUrl,
      notesCiphertext,
      idempotencyKey: `manual-fulfilment:v1:${idempotencyHash}`,
      requestHash,
      requestId,
    });
  }

  async proofObject(actor: ModerationAdminActor, rawOrderId: string) {
    assertAdmin(actor);
    const orderId = validatedOrderId(rawOrderId);
    const encrypted = await this.repository.load(actor, orderId);
    if (!encrypted) throw new OrderAdminError("ORDER_NOT_FOUND");
    return {
      orderNumber: encrypted.orderNumber,
      objectKey: encrypted.pdfObjectKey,
      sizeBytes: encrypted.pdfSizeBytes,
      sha256: encrypted.pdfSha256,
    };
  }
}

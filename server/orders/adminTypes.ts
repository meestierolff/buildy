import type {
  AdminOrderActionResult,
  AdminOrderDetail,
  AdminOrderQueueItem,
  AdminOrderQueuePage,
  AdminOrderQueueQuery,
  ManualFulfilmentAction,
} from "../../shared/contracts/orders.js";
import type { ModerationAdminActor } from "../moderation/adminActor.js";
import type { OrderAdminCursor } from "./adminCursor.js";

export type EncryptedAdminOrder = Omit<
  AdminOrderDetail,
  "customerEmail" | "shippingAddress" | "fulfilmentNotes" | "pdfPath" | "events"
> & {
  customerEmailCiphertext: string;
  shippingDetailsCiphertext: string;
  fulfilmentNotesCiphertext: string | null;
  pdfObjectKey: string;
  pdfSizeBytes: number;
  events: AdminOrderDetail["events"];
};

export type AdminOrderQueueCommand = {
  actor: ModerationAdminActor;
  cursor: OrderAdminCursor | null;
  query: AdminOrderQueueQuery;
};

export type AdminOrderActionCommand = {
  actor: ModerationAdminActor;
  orderId: string;
  action: ManualFulfilmentAction;
  expectedVersion: number;
  externalReference: string | null;
  trackingUrl: string | null;
  notesCiphertext: string | null;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
};

export interface OrderAdminRepository {
  list(command: AdminOrderQueueCommand): Promise<{
    items: AdminOrderQueueItem[];
    hasMore: boolean;
  }>;
  load(actor: ModerationAdminActor, orderId: string): Promise<EncryptedAdminOrder | null>;
  apply(command: AdminOrderActionCommand): Promise<AdminOrderActionResult>;
}

export interface OrderAdminServiceContract {
  queue(actor: ModerationAdminActor, rawQuery: unknown): Promise<AdminOrderQueuePage>;
  detail(actor: ModerationAdminActor, orderId: string): Promise<AdminOrderDetail>;
  action(
    actor: ModerationAdminActor,
    orderId: string,
    rawInput: unknown,
    requestId: string,
  ): Promise<AdminOrderActionResult>;
  proofObject(actor: ModerationAdminActor, orderId: string): Promise<{
    orderNumber: string;
    objectKey: string;
    sizeBytes: number;
    sha256: string;
  }>;
}

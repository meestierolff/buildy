import type {
  CustomerOrderListItem,
  PhotobookOrderAmount,
  PhotobookOrderDetail,
  SellerSnapshot,
  ShippingAddress,
} from "../../shared/contracts/orders.js";
import type { CustomerOrderCursor } from "./cursor.js";

export type LaunchPhotobookSku = "a4-landscape-hardcover-v1";

export interface CheckoutProofContext {
  projectId: string;
  projectTitle: string;
  revisionId: string;
  status: "approved" | "locked";
  documentSha256: string;
  pdfSha256: string;
  pageCount: number;
  format: LaunchPhotobookSku;
  customerEmail: string;
}

export interface OrderQuoteRequest {
  sku: LaunchPhotobookSku;
  pageCount: number;
  quantity: number;
  shippingAddress: ShippingAddress;
  /** Server-provided expiry when an earlier quote is being revalidated. */
  quoteExpiresAt?: Date;
}

export interface OrderQuote {
  quoteReference: string;
  productReference: string;
  sku: LaunchPhotobookSku;
  pageCount: number;
  quantity: number;
  destinationCountry: string;
  /** Net product amount per copy represented in the reconciled order breakdown. */
  unitAmountMinor: number;
  amounts: PhotobookOrderAmount;
  deliveryEstimate: string;
  taxTreatment: "vat_included" | "vat_exclusive" | "vat_exempt";
  commercialApprovalId: string;
  expiresAt: Date;
}

export interface OrderQuoteProvider {
  quote(input: OrderQuoteRequest): Promise<OrderQuote | null>;
}

export type { SellerSnapshot };

export interface ProtectedOrderPii {
  customerEmailCiphertext: string;
  shippingDetailsCiphertext: string;
  encryptionKeyVersion: number;
}

export interface OrderPiiProtector {
  protect(input: {
    orderId: string;
    customerEmail: string;
    shippingAddress: ShippingAddress;
  }): ProtectedOrderPii;
}

export interface CheckoutReservation {
  orderId: string;
  orderNumber: string;
  merchantReference: string;
  actorId: string;
  projectId: string;
  projectTitle: string;
  proofRevisionId: string;
  documentSha256: string;
  pdfSha256: string;
  sku: LaunchPhotobookSku;
  format: LaunchPhotobookSku;
  pageCount: number;
  quantity: number;
  destinationCountry: string;
  unitAmountMinor: number;
  amounts: PhotobookOrderAmount;
  deliveryEstimate: string;
  termsVersion: string;
  customerEmail: string;
  requestHash: string | null;
  /**
   * Legacy snapshots used an unkeyed digest of the full request. New
   * reservations use a keyed, semantic blind index so a renewed transport
   * idempotency key can safely recover the same proof reservation.
   */
  requestHashScheme: "legacy-v1" | "legacy-v2" | "blind-v2" | "redacted";
  idempotencyKey: string;
  quoteReference: string;
  /** Provider-neutral internal product/price references captured at quote time. */
  productReference: string;
  priceVersion: string;
  commercialApprovalId: string;
  taxTreatment: OrderQuote["taxTreatment"];
  quoteExpiresAt: Date;
  status: PhotobookOrderDetail["status"];
  replayed: boolean;
}

export interface ReserveCheckoutCommand extends Omit<
  CheckoutReservation,
  "replayed" | "requestHashScheme" | "status"
> {
  termsAccepted: true;
  pii: ProtectedOrderPii;
  sellerSnapshot: SellerSnapshot;
  shippingAddress: ShippingAddress;
  reservedAt: Date;
}

export interface RecordCheckoutSessionCommand {
  actorId: string;
  orderId: string;
  sessionId: string;
  expiresAt: Date;
  now: Date;
}

export interface CancelExpiredCheckoutReservationCommand {
  actorId: string;
  orderId: string;
  now: Date;
}

export interface CustomerOrderListResult {
  items: CustomerOrderListItem[];
  hasMore: boolean;
}

export interface OrderRepository {
  findCheckoutReservation(
    actorId: string,
    proofRevisionId: string,
    idempotencyKey: string,
  ): Promise<CheckoutReservation | null>;
  loadCheckoutProof(actorId: string, revisionId: string): Promise<CheckoutProofContext | null>;
  reserveCheckout(command: ReserveCheckoutCommand): Promise<CheckoutReservation>;
  cancelExpiredCheckoutReservation(
    command: CancelExpiredCheckoutReservationCommand,
  ): Promise<boolean>;
  recordCheckoutSession(command: RecordCheckoutSessionCommand): Promise<void>;
  listOrders(
    actorId: string,
    cursor: CustomerOrderCursor | undefined,
    limit: number,
  ): Promise<CustomerOrderListResult>;
  getOrder(actorId: string, orderId: string): Promise<PhotobookOrderDetail | null>;
}

export type OrderClock = () => Date;
export type OrderIdFactory = () => string;

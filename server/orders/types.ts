import type {
  PhotobookOrderAmount,
  PhotobookOrderDetail,
  SellerSnapshot,
  ShippingAddress,
} from "../../shared/contracts/orders.js";

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
}

export interface OrderQuote {
  quoteReference: string;
  offeringId: string;
  sku: LaunchPhotobookSku;
  pageCount: number;
  quantity: number;
  destinationCountry: string;
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
  requestHash: string;
  idempotencyKey: string;
  quoteReference: string;
  offeringId: string;
  commercialApprovalId: string;
  taxTreatment: OrderQuote["taxTreatment"];
  replayed: boolean;
}

export interface ReserveCheckoutCommand extends Omit<CheckoutReservation, "replayed"> {
  pii: ProtectedOrderPii;
  sellerSnapshot: SellerSnapshot;
  shippingAddress: ShippingAddress;
  reservedAt: Date;
  quoteExpiresAt: Date;
}

export interface RecordCheckoutSessionCommand {
  actorId: string;
  orderId: string;
  sessionId: string;
  expiresAt: Date;
  now: Date;
}

export interface OrderRepository {
  findCheckoutReservation(
    actorId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CheckoutReservation | null>;
  loadCheckoutProof(actorId: string, revisionId: string): Promise<CheckoutProofContext | null>;
  reserveCheckout(command: ReserveCheckoutCommand): Promise<CheckoutReservation>;
  recordCheckoutSession(command: RecordCheckoutSessionCommand): Promise<void>;
  getOrder(actorId: string, orderId: string): Promise<PhotobookOrderDetail | null>;
}

export type OrderClock = () => Date;
export type OrderIdFactory = () => string;

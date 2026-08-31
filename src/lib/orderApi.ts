import { z } from "zod";
import {
  createPhotobookCheckoutInputSchema,
  customerOrderListQuerySchema,
  customerOrderListResponseSchema,
  photobookCheckoutResponseSchema,
  photobookOrderResponseSchema,
  photobookQuoteResponseSchema,
  requestPhotobookQuoteInputSchema,
} from "../../shared/contracts/orders";
import { apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();
const checkoutRecoverySchema = z.object({
  idempotencyKey: uuidSchema,
}).strict();
const CHECKOUT_RECOVERY_PREFIX = "buildy:photobook-checkout-recovery:v1:";

export type PhotobookQuote = z.infer<typeof photobookQuoteResponseSchema>["data"];
export type PhotobookCheckout = z.infer<typeof photobookCheckoutResponseSchema>["data"];
export type PhotobookOrder = z.infer<typeof photobookOrderResponseSchema>["data"];
export type CustomerOrderListPage = z.infer<typeof customerOrderListResponseSchema>["data"];
export type RequestPhotobookQuoteInput = z.input<typeof requestPhotobookQuoteInputSchema>;
export type CreatePhotobookCheckoutInput = z.input<typeof createPhotobookCheckoutInputSchema>;

function encodedUuid(value: string): string {
  return encodeURIComponent(uuidSchema.parse(value));
}

export async function requestPhotobookQuote(
  revisionId: string,
  input: RequestPhotobookQuoteInput,
): Promise<PhotobookQuote> {
  const body = requestPhotobookQuoteInputSchema.parse(input);
  return (await apiRequest(
    `/api/photobooks/proofs/${encodedUuid(revisionId)}/quote`,
    photobookQuoteResponseSchema,
    { method: "POST", body },
  )).data;
}

export async function createPhotobookCheckout(
  revisionId: string,
  input: CreatePhotobookCheckoutInput,
): Promise<PhotobookCheckout> {
  const body = createPhotobookCheckoutInputSchema.parse(input);
  return (await apiRequest(
    `/api/photobooks/proofs/${encodedUuid(revisionId)}/checkout`,
    photobookCheckoutResponseSchema,
    { method: "POST", body },
  )).data;
}

export async function getPhotobookOrder(
  orderId: string,
  signal?: AbortSignal,
): Promise<PhotobookOrder> {
  return (await apiRequest(
    `/api/orders/${encodedUuid(orderId)}`,
    photobookOrderResponseSchema,
    { signal },
  )).data;
}

export async function getCustomerOrders(
  input: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<CustomerOrderListPage> {
  const parsed = customerOrderListQuerySchema.parse(input);
  const query = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) query.set("cursor", parsed.cursor);
  return (await apiRequest(
    `/api/orders?${query.toString()}`,
    customerOrderListResponseSchema,
    { signal },
  )).data;
}

export function createOrderIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Deze browser kan geen veilige bestelopdracht maken.");
  }
  return uuidSchema.parse(globalThis.crypto.randomUUID());
}

function checkoutRecoveryStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined"
      ? null
      : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function checkoutRecoveryStorageKey(revisionId: string): string {
  return `${CHECKOUT_RECOVERY_PREFIX}${uuidSchema.parse(revisionId)}`;
}

/**
 * Keeps only an opaque UUID scoped by a non-PII proof revision. No address,
 * customer name, quote payload, or address-derived equality fingerprint is
 * written to browser storage.
 */
export function getOrCreateCheckoutIdempotencyKey(revisionId: string): string {
  const storage = checkoutRecoveryStorage();
  const storageKey = checkoutRecoveryStorageKey(revisionId);
  if (storage) {
    try {
      const stored = storage.getItem(storageKey);
      if (stored) {
        const parsed = checkoutRecoverySchema.safeParse(JSON.parse(stored));
        if (parsed.success) return parsed.data.idempotencyKey;
        storage.removeItem(storageKey);
      }
    } catch {
      // Storage is a best-effort recovery aid; checkout remains server-safe.
    }
  }

  const idempotencyKey = createOrderIdempotencyKey();
  if (storage) {
    try {
      storage.setItem(storageKey, JSON.stringify({ idempotencyKey }));
    } catch {
      // A restricted/full sessionStorage must not make checkout unavailable.
    }
  }
  return idempotencyKey;
}

export function clearCheckoutIdempotencyKey(revisionId: string): void {
  const storage = checkoutRecoveryStorage();
  if (!storage) return;
  try {
    storage.removeItem(checkoutRecoveryStorageKey(revisionId));
  } catch {
    // The confirmed checkout response remains valid if storage is unavailable.
  }
}

export function stripeCheckoutUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.hostname !== "checkout.stripe.com"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
  ) {
    throw new Error("De betaalprovider gaf geen veilige Stripe Checkout-link terug.");
  }
  return url.toString();
}

export function safeTrackingUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

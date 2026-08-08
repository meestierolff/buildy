import { z } from "zod";
import {
  createPhotobookCheckoutInputSchema,
  photobookCheckoutResponseSchema,
  photobookOrderResponseSchema,
  photobookQuoteResponseSchema,
  requestPhotobookQuoteInputSchema,
} from "../../shared/contracts/orders";
import { apiRequest } from "./apiClient";

const uuidSchema = z.string().uuid();

export type PhotobookQuote = z.infer<typeof photobookQuoteResponseSchema>["data"];
export type PhotobookCheckout = z.infer<typeof photobookCheckoutResponseSchema>["data"];
export type PhotobookOrder = z.infer<typeof photobookOrderResponseSchema>["data"];
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

export function createOrderIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Deze browser kan geen veilige bestelopdracht maken.");
  }
  return uuidSchema.parse(globalThis.crypto.randomUUID());
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

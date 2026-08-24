import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  createPhotobookCheckout,
  getCustomerOrders,
  getPhotobookOrder,
  requestPhotobookQuote,
  type CreatePhotobookCheckoutInput,
  type RequestPhotobookQuoteInput,
} from "@/lib/orderApi";

export const orderQueryKeys = {
  all: ["orders"] as const,
  list: ["orders", "list"] as const,
  detail: (orderId: string) => ["orders", "detail", orderId] as const,
};

export function useCustomerOrders(enabled = true) {
  return useInfiniteQuery({
    queryKey: orderQueryKeys.list,
    queryFn: ({ pageParam, signal }) => getCustomerOrders({
      ...(pageParam ? { cursor: pageParam } : {}),
      limit: 20,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });
}

export function useRequestPhotobookQuote(revisionId: string) {
  return useMutation({
    mutationFn: (input: RequestPhotobookQuoteInput) =>
      requestPhotobookQuote(revisionId, input),
  });
}

export function useCreatePhotobookCheckout(revisionId: string) {
  return useMutation({
    mutationFn: (input: CreatePhotobookCheckoutInput) =>
      createPhotobookCheckout(revisionId, input),
  });
}

function orderNeedsPolling(order: Awaited<ReturnType<typeof getPhotobookOrder>> | undefined): boolean {
  if (!order) return false;
  return (
    ["unpaid", "processing"].includes(order.paymentStatus)
    && !["payment_failed", "expired", "cancelled", "manual_review"].includes(order.status)
  );
}

export function usePhotobookOrder(orderId: string, enabled = true) {
  return useQuery({
    queryKey: orderQueryKeys.detail(orderId),
    queryFn: ({ signal }) => getPhotobookOrder(orderId, signal),
    enabled: enabled && Boolean(orderId),
    refetchInterval: (query) => orderNeedsPolling(query.state.data) ? 4_000 : false,
    refetchIntervalInBackground: false,
  });
}

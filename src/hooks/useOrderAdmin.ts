import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminOrderActionInput,
  AdminOrderQueueQuery,
} from "../../shared/contracts/orders";
import {
  applyAdminOrderAction,
  getAdminOrder,
  getAdminOrderQueue,
} from "@/lib/orderAdminApi";

export const orderAdminQueryKeys = {
  root: ["order-admin"] as const,
  queues: ["order-admin", "queue"] as const,
  queue: (filters: Omit<AdminOrderQueueQuery, "cursor">) => [
    "order-admin",
    "queue",
    filters,
  ] as const,
  detail: (orderId: string) => ["order-admin", "detail", orderId] as const,
};

export function useInfiniteAdminOrderQueue(
  filters: Omit<AdminOrderQueueQuery, "cursor">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: orderAdminQueryKeys.queue(filters),
    queryFn: ({ pageParam, signal }) => getAdminOrderQueue({
      ...filters,
      cursor: pageParam,
    }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: false,
  });
}

export function useAdminOrder(orderId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: orderAdminQueryKeys.detail(orderId ?? ""),
    queryFn: ({ signal }) => getAdminOrder(orderId!, signal),
    enabled: enabled && Boolean(orderId),
    retry: false,
  });
}

export function useAdminOrderActionMutation(orderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminOrderActionInput) => applyAdminOrderAction(orderId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orderAdminQueryKeys.detail(orderId) }),
        queryClient.invalidateQueries({ queryKey: orderAdminQueryKeys.queues }),
      ]);
    },
  });
}

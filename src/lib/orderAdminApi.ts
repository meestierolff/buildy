import type {
  AdminOrderActionInput,
  AdminOrderActionResult,
  AdminOrderDetail,
  AdminOrderQueuePage,
  AdminOrderQueueQuery,
} from "../../shared/contracts/orders";
import {
  adminOrderActionResponseSchema,
  adminOrderDetailResponseSchema,
  adminOrderQueueResponseSchema,
} from "../../shared/contracts/orders";
import { apiRequest } from "@/lib/apiClient";

export async function getAdminOrderQueue(
  query: AdminOrderQueueQuery,
  signal?: AbortSignal,
): Promise<AdminOrderQueuePage> {
  const search = new URLSearchParams({
    status: query.status,
    limit: String(query.limit),
  });
  if (query.cursor) search.set("cursor", query.cursor);
  return (await apiRequest(
    `/api/admin/orders?${search.toString()}`,
    adminOrderQueueResponseSchema,
    { signal },
  )).data;
}

export async function getAdminOrder(
  orderId: string,
  signal?: AbortSignal,
): Promise<AdminOrderDetail> {
  return (await apiRequest(
    `/api/admin/orders/${encodeURIComponent(orderId)}`,
    adminOrderDetailResponseSchema,
    { signal },
  )).data;
}

export async function applyAdminOrderAction(
  orderId: string,
  input: AdminOrderActionInput,
): Promise<AdminOrderActionResult> {
  return (await apiRequest(
    `/api/admin/orders/${encodeURIComponent(orderId)}/actions`,
    adminOrderActionResponseSchema,
    { method: "POST", body: input },
  )).data;
}

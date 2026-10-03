import { adminBookOrderListResponseSchema, bookOrderListResponseSchema, bookOrderResponseSchema, createBookOrderInputSchema, updateBookOrderInputSchema, type CreateBookOrderInput, type UpdateBookOrderInput } from "../../shared/contracts/bookOrders";
import { apiRequest, ApiClientError } from "./apiClient";
import { z } from "zod";
const id = (value: string) => encodeURIComponent(z.string().uuid().parse(value));
export async function listBookOrders(projectId: string) {
  return (await apiRequest(`/api/projects/${id(projectId)}/photobook/orders`, bookOrderListResponseSchema)).data;
}
export async function createBookOrder(projectId: string, input: CreateBookOrderInput) {
  return (await apiRequest(`/api/projects/${id(projectId)}/photobook/orders`, bookOrderResponseSchema,
    { method: "POST", body: createBookOrderInputSchema.parse(input) })).data;
}
export async function listAdminBookOrders(cursor?: string) {
  return (await apiRequest(`/api/admin/book-orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, adminBookOrderListResponseSchema)).data;
}
export async function updateAdminBookOrder(orderId: string, input: UpdateBookOrderInput) {
  return (await apiRequest(`/api/admin/book-orders/${id(orderId)}`, bookOrderResponseSchema,
    { method: "PATCH", body: updateBookOrderInputSchema.parse(input) })).data;
}
export async function downloadAdminBookPdf(orderId: string, expectedDocumentSha256: string) {
  const response = await fetch(`/api/admin/book-orders/${id(orderId)}/pdf`, { method: "POST", credentials: "include", headers: { accept: "application/pdf" } });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiClientError({ status: response.status, code: "INTERNAL_ERROR", message: body?.error?.message ?? "De PDF kon niet worden gemaakt." });
  }
  const bytes = await response.arrayBuffer();
  const checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  if (response.headers.get("content-type") !== "application/pdf" || response.headers.get("x-buildy-document-sha256") !== expectedDocumentSha256 || response.headers.get("x-buildy-pdf-sha256") !== checksum) throw new Error("De PDF-controle is mislukt.");
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `Bouwboek-${orderId.slice(0, 8)}.pdf`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

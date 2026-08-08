import {
  accountExportsResponseSchema,
  accountSessionsResponseSchema,
  createAccountExportInputSchema,
  createAccountExportResponseSchema,
  requestAccountDeletionInputSchema,
  requestAccountDeletionResponseSchema,
  revokeAccountSessionResponseSchema,
  type AccountExport,
  type AccountSession,
  type CreateAccountExportInput,
  type RequestAccountDeletionInput,
} from "../../shared/contracts/account";
import { apiRequest } from "./apiClient";

export async function getAccountSessions(signal?: AbortSignal): Promise<AccountSession[]> {
  return (await apiRequest(
    "/api/account/sessions",
    accountSessionsResponseSchema,
    { signal },
  )).data.sessions;
}

export async function revokeAccountSession(sessionId: string) {
  return (await apiRequest(
    `/api/account/sessions/${encodeURIComponent(sessionId)}`,
    revokeAccountSessionResponseSchema,
    { method: "DELETE" },
  )).data;
}

export async function getAccountExports(signal?: AbortSignal): Promise<AccountExport[]> {
  return (await apiRequest(
    "/api/account/exports",
    accountExportsResponseSchema,
    { signal },
  )).data.exports;
}

export async function createAccountExport(inputValue: CreateAccountExportInput) {
  const input = createAccountExportInputSchema.parse(inputValue);
  return (await apiRequest(
    "/api/account/exports",
    createAccountExportResponseSchema,
    { method: "POST", body: input },
  )).data;
}

export async function requestAccountDeletion(inputValue: RequestAccountDeletionInput) {
  const input = requestAccountDeletionInputSchema.parse(inputValue);
  return (await apiRequest(
    "/api/account/deletion",
    requestAccountDeletionResponseSchema,
    { method: "POST", body: input },
  )).data;
}

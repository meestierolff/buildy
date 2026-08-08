import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateAccountExportInput,
  RequestAccountDeletionInput,
} from "../../shared/contracts/account";
import {
  createAccountExport,
  getAccountExports,
  getAccountSessions,
  requestAccountDeletion,
  revokeAccountSession,
} from "@/lib/accountApi";

export const accountQueryKeys = {
  all: ["account"] as const,
  sessions: ["account", "sessions"] as const,
  exports: ["account", "exports"] as const,
};

export function useAccountSessions(enabled = true) {
  return useQuery({
    queryKey: accountQueryKeys.sessions,
    queryFn: ({ signal }) => getAccountSessions(signal),
    enabled,
  });
}

export function useRevokeAccountSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAccountSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountQueryKeys.sessions }),
  });
}

export function useAccountExports(enabled = true) {
  return useQuery({
    queryKey: accountQueryKeys.exports,
    queryFn: ({ signal }) => getAccountExports(signal),
    enabled,
    refetchInterval: (query) => query.state.data?.some((item) =>
      ["requested", "processing", "retry_scheduled"].includes(item.status)) ? 5_000 : false,
  });
}

export function useCreateAccountExportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountExportInput) => createAccountExport(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountQueryKeys.exports }),
  });
}

export function useRequestAccountDeletionMutation() {
  return useMutation({
    mutationFn: (input: RequestAccountDeletionInput) => requestAccountDeletion(input),
  });
}

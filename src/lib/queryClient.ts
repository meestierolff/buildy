import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "./apiClient";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false;
        if (error instanceof ApiClientError) return error.status >= 500;
        return true;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

const isPublicProductProfileQuery = (queryKey: readonly unknown[]): boolean => (
  queryKey.length === 2
  && queryKey[0] === "product"
  && queryKey[1] === "profile"
);

/**
 * Remove every identity-scoped query and mutation while retaining the public,
 * server-owned product profile that composes the application shell.
 */
export function clearIdentityScopedQueryData(): void {
  queryClient.removeQueries({
    predicate: (query) => !isPublicProductProfileQuery(query.queryKey),
  });
  queryClient.getMutationCache().clear();
}

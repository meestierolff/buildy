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

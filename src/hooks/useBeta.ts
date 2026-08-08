import { useQuery } from "@tanstack/react-query";
import { getBetaStatus } from "@/lib/betaApi";

export function useBetaStatus() {
  return useQuery({
    queryKey: ["beta", "status"],
    queryFn: getBetaStatus,
    retry: 1,
    staleTime: 10 * 60 * 1_000,
  });
}

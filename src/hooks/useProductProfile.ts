import { useQuery } from "@tanstack/react-query";
import { getProductProfile } from "@/lib/productProfileApi";
import { queryClient } from "@/lib/queryClient";

export function useProductProfile() {
  return useQuery({
    queryKey: ["product", "profile"],
    queryFn: getProductProfile,
    retry: 1,
    staleTime: 10 * 60 * 1_000,
  }, queryClient);
}
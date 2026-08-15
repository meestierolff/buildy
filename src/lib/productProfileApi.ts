import { productProfileResponseSchema } from "../../shared/contracts/productProfile";
import { apiRequest } from "./apiClient";

export async function getProductProfile() {
  return (await apiRequest("/api/product-profile", productProfileResponseSchema)).data;
}
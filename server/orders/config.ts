import { sellerSnapshotSchema, type SellerSnapshot } from "../../shared/contracts/orders.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { OrderError } from "./errors.js";

export type ConfiguredOrderRuntime = RuntimeConfig & Required<Pick<
  RuntimeConfig,
  | "DATABASE_URL"
  | "DATABASE_PAYMENT_WORKER_URL"
  | "PII_ENCRYPTION_KEYS"
  | "PII_ENCRYPTION_CURRENT_VERSION"
  | "PII_BLIND_INDEX_KEY"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_EXPECTED_ACCOUNT_ID"
  | "STRIPE_ENVIRONMENT"
  | "ORDER_PRICE_MATRIX_JSON"
  | "ORDER_SELLER_JSON"
  | "ORDER_TERMS_VERSION"
>>;

export function hasCompleteOrderRuntime(config: RuntimeConfig): config is ConfiguredOrderRuntime {
  return Boolean(
    config.DATABASE_URL
    && config.DATABASE_PAYMENT_WORKER_URL
    && config.PII_ENCRYPTION_KEYS
    && config.PII_ENCRYPTION_CURRENT_VERSION
    && config.PII_BLIND_INDEX_KEY
    && config.STRIPE_SECRET_KEY
    && config.STRIPE_WEBHOOK_SECRET
    && config.STRIPE_EXPECTED_ACCOUNT_ID
    && config.STRIPE_ENVIRONMENT
    && config.ORDER_PRICE_MATRIX_JSON
    && config.ORDER_SELLER_JSON
    && config.ORDER_TERMS_VERSION
  );
}

export function parseSellerSnapshot(rawValue: string): SellerSnapshot {
  if (Buffer.byteLength(rawValue, "utf8") > 32 * 1024) throw new OrderError("PRICE_UNAVAILABLE");
  try {
    return sellerSnapshotSchema.parse(JSON.parse(rawValue) as unknown);
  } catch (error) {
    if (error instanceof OrderError) throw error;
    throw new OrderError("PRICE_UNAVAILABLE", { cause: error });
  }
}

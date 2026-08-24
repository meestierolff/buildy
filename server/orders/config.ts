import type { SellerSnapshot } from "../../shared/contracts/orders.js";
import type { RuntimeConfig } from "../config/runtime.js";
import {
  checkoutConfigurationReady,
  parseApprovedSellerConfiguration,
  parseApprovedSellerSnapshot,
  type ApprovedSellerConfiguration,
  type ActiveCheckoutMode,
} from "./checkoutConfiguration.js";

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
>> & {
  CHECKOUT_MODE: ActiveCheckoutMode;
  STRIPE_ENVIRONMENT: ActiveCheckoutMode;
};

export function hasCompleteOrderRuntime(config: RuntimeConfig): config is ConfiguredOrderRuntime {
  return checkoutConfigurationReady(config);
}

export function parseSellerSnapshot(
  rawValue: string,
  expectedEnvironment?: ActiveCheckoutMode,
  now: Date = new Date(),
): SellerSnapshot {
  return parseApprovedSellerSnapshot(rawValue, expectedEnvironment, now);
}

export function parseSellerConfiguration(
  rawValue: string,
  expectedEnvironment?: ActiveCheckoutMode,
  now: Date = new Date(),
): ApprovedSellerConfiguration {
  return parseApprovedSellerConfiguration(rawValue, expectedEnvironment, now);
}

import { z } from "zod";
import { sellerSnapshotSchema, type SellerSnapshot } from "../../shared/contracts/orders.js";
import { approvedPriceMatrixSchema } from "./approvedPriceMatrix.js";
import { OrderError } from "./errors.js";

export type ActiveCheckoutMode = "test" | "live";

export interface CheckoutRuntimeCandidate {
  APP_ENV?: "local" | "test" | "preview" | "staging" | "production";
  CHECKOUT_MODE?: "off" | ActiveCheckoutMode;
  DATABASE_URL?: string;
  DATABASE_PAYMENT_WORKER_URL?: string;
  PII_ENCRYPTION_KEYS?: string;
  PII_ENCRYPTION_CURRENT_VERSION?: number;
  PII_BLIND_INDEX_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_EXPECTED_ACCOUNT_ID?: string;
  STRIPE_ENVIRONMENT?: ActiveCheckoutMode;
  ORDER_PRICE_MATRIX_JSON?: string;
  ORDER_SELLER_JSON?: string;
  ORDER_TERMS_VERSION?: string;
}

export const approvedSellerConfigurationSchema = z.object({
  version: z.literal(1),
  environment: z.enum(["test", "live"]),
  approvalStatus: z.literal("approved"),
  approvalId: z.string().trim().min(8).max(120),
  approvedBy: z.string().trim().min(3).max(160),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  seller: sellerSnapshotSchema,
}).strict();

export type ApprovedSellerConfiguration = z.infer<typeof approvedSellerConfigurationSchema>;

function safeJson(value: string, maximumBytes: number): unknown {
  if (Buffer.byteLength(value, "utf8") > maximumBytes) throw new OrderError("PRICE_UNAVAILABLE");
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new OrderError("PRICE_UNAVAILABLE", { cause: error });
  }
}

function approvalIsCurrent(approvedAtValue: string, expiresAtValue: string, now: Date): boolean {
  const approvedAt = new Date(approvedAtValue);
  const expiresAt = new Date(expiresAtValue);
  return approvedAt.getTime() <= now.getTime() && expiresAt.getTime() > now.getTime();
}

export function approvedSellerConfigurationIsCurrent(
  configuration: ApprovedSellerConfiguration,
  now: Date = new Date(),
): boolean {
  return approvalIsCurrent(configuration.approvedAt, configuration.expiresAt, now);
}

export function parseApprovedSellerConfiguration(
  rawValue: string,
  expectedEnvironment?: ActiveCheckoutMode,
  now: Date = new Date(),
): ApprovedSellerConfiguration {
  try {
    const configuration = approvedSellerConfigurationSchema.parse(safeJson(rawValue, 32 * 1024));
    if (
      (expectedEnvironment && configuration.environment !== expectedEnvironment)
      || !approvalIsCurrent(configuration.approvedAt, configuration.expiresAt, now)
    ) throw new OrderError("PRICE_UNAVAILABLE");
    return configuration;
  } catch (error) {
    if (error instanceof OrderError) throw error;
    throw new OrderError("PRICE_UNAVAILABLE", { cause: error });
  }
}

export function parseApprovedSellerSnapshot(
  rawValue: string,
  expectedEnvironment?: ActiveCheckoutMode,
  now: Date = new Date(),
): SellerSnapshot {
  return parseApprovedSellerConfiguration(rawValue, expectedEnvironment, now).seller;
}

export function activeCheckoutMode(config: CheckoutRuntimeCandidate): ActiveCheckoutMode | null {
  return config.CHECKOUT_MODE === "test" || config.CHECKOUT_MODE === "live"
    ? config.CHECKOUT_MODE
    : null;
}

export function checkoutConfigurationIssues(
  config: CheckoutRuntimeCandidate,
  now: Date = new Date(),
): string[] {
  const mode = activeCheckoutMode(config);
  if (!mode) return ["checkout_mode_off"];

  const issues: string[] = [];
  const required: Array<[keyof CheckoutRuntimeCandidate, unknown]> = [
    ["APP_ENV", config.APP_ENV],
    ["DATABASE_URL", config.DATABASE_URL],
    ["DATABASE_PAYMENT_WORKER_URL", config.DATABASE_PAYMENT_WORKER_URL],
    ["PII_ENCRYPTION_KEYS", config.PII_ENCRYPTION_KEYS],
    ["PII_ENCRYPTION_CURRENT_VERSION", config.PII_ENCRYPTION_CURRENT_VERSION],
    ["PII_BLIND_INDEX_KEY", config.PII_BLIND_INDEX_KEY],
    ["STRIPE_SECRET_KEY", config.STRIPE_SECRET_KEY],
    ["STRIPE_WEBHOOK_SECRET", config.STRIPE_WEBHOOK_SECRET],
    ["STRIPE_EXPECTED_ACCOUNT_ID", config.STRIPE_EXPECTED_ACCOUNT_ID],
    ["STRIPE_ENVIRONMENT", config.STRIPE_ENVIRONMENT],
    ["ORDER_PRICE_MATRIX_JSON", config.ORDER_PRICE_MATRIX_JSON],
    ["ORDER_SELLER_JSON", config.ORDER_SELLER_JSON],
    ["ORDER_TERMS_VERSION", config.ORDER_TERMS_VERSION],
  ];
  for (const [key, value] of required) {
    if (value === undefined || value === null || value === "") issues.push(`missing_${String(key).toLowerCase()}`);
  }
  if (issues.length > 0) return issues;

  if (
    (mode === "live" && config.APP_ENV !== "production")
    || (mode === "test" && config.APP_ENV === "production")
  ) issues.push("checkout_application_environment_mismatch");
  if (config.STRIPE_ENVIRONMENT !== mode) issues.push("stripe_environment_mismatch");
  const expectedKeyPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  if (!config.STRIPE_SECRET_KEY?.startsWith(expectedKeyPrefix)) issues.push("stripe_key_mode_mismatch");
  if (!config.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) issues.push("stripe_webhook_secret_invalid");
  if (!/^acct_[A-Za-z0-9]+$/.test(config.STRIPE_EXPECTED_ACCOUNT_ID ?? "")) {
    issues.push("stripe_account_invalid");
  }
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(config.ORDER_TERMS_VERSION ?? "")) {
    issues.push("terms_version_invalid");
  }

  try {
    const matrix = approvedPriceMatrixSchema.parse(safeJson(config.ORDER_PRICE_MATRIX_JSON!, 128 * 1024));
    if (matrix.environment !== mode) issues.push("price_matrix_environment_mismatch");
    if (!approvalIsCurrent(matrix.approvedAt, matrix.expiresAt, now)) issues.push("price_matrix_approval_inactive");
  } catch {
    issues.push("price_matrix_invalid");
  }
  try {
    parseApprovedSellerConfiguration(config.ORDER_SELLER_JSON!, mode, now);
  } catch {
    issues.push("seller_configuration_invalid");
  }
  return issues;
}

export function checkoutConfigurationReady(
  config: CheckoutRuntimeCandidate,
  now: Date = new Date(),
): boolean {
  return checkoutConfigurationIssues(config, now).length === 0;
}

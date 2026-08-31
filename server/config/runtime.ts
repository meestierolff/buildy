import { z } from "zod";
import type { HealthResponse } from "../../shared/contracts/api.js";
import type {
  ProductProfile,
  ProductProfileName,
} from "../../shared/contracts/productProfile.js";
import {
  activeCheckoutMode,
  checkoutConfigurationReady,
} from "../orders/checkoutConfiguration.js";

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalSecret = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());
const optionalAuthSecret = z.preprocess(emptyStringToUndefined, z.string().min(32).optional());
const optionalPositiveInteger = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional(),
);
const optionalPaymentEnvironment = z.preprocess(
  emptyStringToUndefined,
  z.enum(["test", "live"]).optional(),
);
const optionalIsoDateTime = z.preprocess(
  emptyStringToUndefined,
  z.string().datetime({ offset: true }).optional(),
);
const betaModeFlag = z.preprocess(
  emptyStringToUndefined,
  z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
);
const productProfileFlag = z.preprocess(
  emptyStringToUndefined,
  z.enum(["feedback_beta", "public_demo"]).default("feedback_beta"),
);
const checkoutModeFlag = z.preprocess(
  emptyStringToUndefined,
  z.enum(["off", "test", "live"]).default("off"),
);

const runtimeSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "preview", "staging", "production"]).default("local"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:8080"),
  PRODUCT_PROFILE: productProfileFlag,
  CHECKOUT_MODE: checkoutModeFlag,
  PRIMARY_DOMAIN: optionalSecret,
  TRUSTED_ORIGINS: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  DATABASE_URL: optionalSecret,
  DATABASE_DIRECT_URL: optionalSecret,
  DATABASE_ACCOUNT_WORKER_URL: optionalSecret,
  DATABASE_MEDIA_WORKER_URL: optionalSecret,
  DATABASE_PHOTOBOOK_WORKER_URL: optionalSecret,
  DATABASE_PAYMENT_WORKER_URL: optionalSecret,
  ACCOUNT_RETENTION_POLICY_VERSION: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional(),
  ),
  ACCOUNT_RETENTION_POLICY_APPROVED_AT: optionalIsoDateTime,
  PII_ENCRYPTION_KEYS: optionalSecret,
  PII_ENCRYPTION_CURRENT_VERSION: optionalPositiveInteger,
  PII_BLIND_INDEX_KEY: optionalSecret,
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  BLOB_READ_WRITE_TOKEN: optionalSecret,
  CRON_SECRET: optionalAuthSecret,
  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_EXPECTED_ACCOUNT_ID: optionalSecret,
  STRIPE_ENVIRONMENT: optionalPaymentEnvironment,
  ORDER_PRICE_MATRIX_JSON: optionalSecret,
  ORDER_SELLER_JSON: optionalSecret,
  ORDER_TERMS_VERSION: optionalSecret,
  BETA_MODE: betaModeFlag,
});

type ParsedRuntimeConfig = z.infer<typeof runtimeSchema>;
// Hand-built test fixtures may omit conservative feature flags; parsed process
// configuration always receives explicit defaults from zod.
export type RuntimeConfig = Omit<ParsedRuntimeConfig, "BETA_MODE" | "PRODUCT_PROFILE" | "CHECKOUT_MODE"> & {
  BETA_MODE?: boolean;
  PRODUCT_PROFILE?: ProductProfileName;
  CHECKOUT_MODE?: "off" | "test" | "live";
};

let cachedRuntime: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  cachedRuntime ??= runtimeSchema.parse(process.env);
  return cachedRuntime;
}

export function resetRuntimeConfigForTests(): void {
  cachedRuntime = undefined;
}

function readyWhen(...values: Array<string | undefined>): "ready" | "unconfigured" {
  return values.every(Boolean) ? "ready" : "unconfigured";
}

function optionalCapability(
  enabled: boolean,
  ...values: Array<string | undefined>
): "ready" | "unconfigured" | "disabled" {
  return enabled ? readyWhen(...values) : "disabled";
}

function productProfile(config: RuntimeConfig): ProductProfileName {
  return config.PRODUCT_PROFILE ?? "feedback_beta";
}

function checkoutMode(config: RuntimeConfig): "off" | "test" | "live" {
  return config.CHECKOUT_MODE ?? "off";
}

export function publicDemoSupportConfigured(config = getRuntimeConfig()): boolean {
  return productProfile(config) === "public_demo" && Boolean(
    config.DATABASE_URL
    && config.PII_ENCRYPTION_KEYS
    && config.PII_ENCRYPTION_CURRENT_VERSION
    && config.PII_BLIND_INDEX_KEY,
  );
}

export function getCapabilities(config = getRuntimeConfig()): HealthResponse["data"]["capabilities"] {
  const activeProfile = productProfile(config);
  const publicDemo = activeProfile === "public_demo";
  const enableAuthenticatedProduct = !publicDemo;
  const requestedCheckoutMode = activeCheckoutMode(config);
  const checkoutReady = checkoutConfigurationReady(config);
  return {
    database: readyWhen(config.DATABASE_URL),
    authentication: publicDemo
      ? "disabled"
      : readyWhen(
        config.DATABASE_URL,
        config.APP_ENV === "production" ? config.PRIMARY_DOMAIN : "non-production",
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
        config.PII_ENCRYPTION_KEYS,
        config.PII_ENCRYPTION_CURRENT_VERSION ? String(config.PII_ENCRYPTION_CURRENT_VERSION) : undefined,
        config.PII_BLIND_INDEX_KEY,
      ),
    accountLifecycle: optionalCapability(
      enableAuthenticatedProduct,
      config.DATABASE_URL,
      config.DATABASE_ACCOUNT_WORKER_URL,
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.PII_ENCRYPTION_KEYS,
      config.PII_ENCRYPTION_CURRENT_VERSION ? String(config.PII_ENCRYPTION_CURRENT_VERSION) : undefined,
      config.PII_BLIND_INDEX_KEY,
      config.ACCOUNT_RETENTION_POLICY_VERSION,
      config.ACCOUNT_RETENTION_POLICY_APPROVED_AT,
      config.CRON_SECRET,
      config.BLOB_READ_WRITE_TOKEN,
    ),
    media: optionalCapability(
      enableAuthenticatedProduct,
      config.DATABASE_MEDIA_WORKER_URL,
      config.BLOB_READ_WRITE_TOKEN,
    ),
    photobooks: optionalCapability(
      enableAuthenticatedProduct,
      config.DATABASE_URL,
      config.BLOB_READ_WRITE_TOKEN,
    ),
    email: "disabled",
    payments: publicDemo || !requestedCheckoutMode
      ? "disabled"
      : checkoutReady ? "ready" : "unconfigured",
    // Betaalde bestellingen worden uitsluitend handmatig afgehandeld.
    printFulfilment: "disabled",
    privateBeta: optionalCapability(
      enableAuthenticatedProduct && config.BETA_MODE !== false,
      config.DATABASE_URL,
      config.PII_BLIND_INDEX_KEY,
    ),
  };
}

export function getProductProfile(config = getRuntimeConfig()): ProductProfile {
  const activeProfile = productProfile(config);
  const publicDemo = activeProfile === "public_demo";
  const capabilities = getCapabilities(config);
  const databaseReady = capabilities.database === "ready";
  const googleConfigured = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);

  return {
    profile: activeProfile,
    checkoutMode: publicDemo ? "off" : checkoutMode(config),
    betaMode: publicDemo ? false : config.BETA_MODE !== false,
    inviteRequiredForNewAccounts: publicDemo ? false : config.BETA_MODE !== false,
    capabilities: {
      googleSignIn: !publicDemo && capabilities.authentication === "ready" && googleConfigured,
      emailAuth: false,
      renovations: !publicDemo && databaseReady,
      updates: !publicDemo && databaseReady,
      story: !publicDemo && databaseReady,
      media: !publicDemo && capabilities.media === "ready",
      photobookPreview: publicDemo || capabilities.photobooks === "ready",
      sharing: !publicDemo && databaseReady,
      // Authenticated product feedback stays dormant; public_demo reuses only
      // the existing encrypted, rate-limited anonymous support path.
      feedback: publicDemo ? publicDemoSupportConfigured(config) : databaseReady,
      accountDeletion: !publicDemo && capabilities.accountLifecycle === "ready",
      checkout: !publicDemo && capabilities.payments === "ready",
    },
  };
}

export function getTrustedOrigins(config = getRuntimeConfig()): Set<string> {
  const configured = config.TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  const vercelOrigin = config.VERCEL_URL ? `https://${config.VERCEL_URL}` : undefined;

  return new Set([
    config.APP_ORIGIN,
    config.PRIMARY_DOMAIN,
    vercelOrigin,
    ...configured,
  ].filter((origin): origin is string => Boolean(origin)));
}

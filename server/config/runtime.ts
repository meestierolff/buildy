import { z } from "zod";
import type { HealthResponse } from "../../shared/contracts/api.js";

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalSecret = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());
const optionalEmail = z.preprocess(emptyStringToUndefined, z.string().email().optional());
const optionalAuthSecret = z.preprocess(emptyStringToUndefined, z.string().min(32).optional());
const optionalPositiveInteger = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().positive().optional(),
);
const optionalPaymentEnvironment = z.preprocess(
  emptyStringToUndefined,
  z.enum(["test", "live"]).optional(),
);
const optionalPeechoSignedUrlTtl = z.preprocess(
  emptyStringToUndefined,
  z.coerce.number().int().min(300).max(604_800).optional(),
);
const optionalIsoDateTime = z.preprocess(
  emptyStringToUndefined,
  z.string().datetime({ offset: true }).optional(),
);
const booleanFlag = z.preprocess(
  emptyStringToUndefined,
  z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
);
const betaModeFlag = z.preprocess(
  emptyStringToUndefined,
  z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
);

const runtimeSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "preview", "staging", "production"]).default("local"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:8080"),
  PRIMARY_DOMAIN: optionalSecret,
  TRUSTED_ORIGINS: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  DATABASE_URL: optionalSecret,
  DATABASE_DIRECT_URL: optionalSecret,
  DATABASE_EMAIL_WORKER_URL: optionalSecret,
  DATABASE_ACCOUNT_WORKER_URL: optionalSecret,
  DATABASE_MEDIA_WORKER_URL: optionalSecret,
  DATABASE_PHOTOBOOK_WORKER_URL: optionalSecret,
  DATABASE_PAYMENT_WORKER_URL: optionalSecret,
  DATABASE_FULFILMENT_WORKER_URL: optionalSecret,
  ACCOUNT_RETENTION_POLICY_VERSION: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional(),
  ),
  ACCOUNT_RETENTION_POLICY_APPROVED_AT: optionalIsoDateTime,
  BETTER_AUTH_SECRET: optionalAuthSecret,
  PII_ENCRYPTION_KEYS: optionalSecret,
  PII_ENCRYPTION_CURRENT_VERSION: optionalPositiveInteger,
  PII_BLIND_INDEX_KEY: optionalSecret,
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  R2_ACCOUNT_ID: optionalSecret,
  R2_BUCKET_NAME: optionalSecret,
  R2_WEB_ACCESS_KEY_ID: optionalSecret,
  R2_WEB_SECRET_ACCESS_KEY: optionalSecret,
  R2_ACCOUNT_WORKER_ACCESS_KEY_ID: optionalSecret,
  R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY: optionalSecret,
  R2_MEDIA_WORKER_ACCESS_KEY_ID: optionalSecret,
  R2_MEDIA_WORKER_SECRET_ACCESS_KEY: optionalSecret,
  R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID: optionalSecret,
  R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY: optionalSecret,
  R2_FULFILMENT_WORKER_ACCESS_KEY_ID: optionalSecret,
  R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY: optionalSecret,
  BREVO_API_KEY: optionalSecret,
  BREVO_SENDER_EMAIL: optionalEmail,
  BREVO_SENDER_NAME: optionalSecret,
  BREVO_TEMPLATE_IDS: optionalSecret,
  BREVO_WEBHOOK_SECRET: optionalAuthSecret,
  CRON_SECRET: optionalAuthSecret,
  STRIPE_SECRET_KEY: optionalSecret,
  STRIPE_WEBHOOK_SECRET: optionalSecret,
  STRIPE_EXPECTED_ACCOUNT_ID: optionalSecret,
  STRIPE_ENVIRONMENT: optionalPaymentEnvironment,
  ORDER_PRICE_MATRIX_JSON: optionalSecret,
  ORDER_SELLER_JSON: optionalSecret,
  ORDER_TERMS_VERSION: optionalSecret,
  CHECKOUT_ENABLED: booleanFlag,
  BETA_MODE: betaModeFlag,
  PEECHO_ENVIRONMENT: optionalPaymentEnvironment,
  PEECHO_MERCHANT_API_KEY: optionalSecret,
  PEECHO_SECRET_KEY: optionalSecret,
  PEECHO_OFFERING_ID_A4_LANDSCAPE: optionalSecret,
  PEECHO_TIMEOUT_MS: optionalPositiveInteger,
  PEECHO_PDF_SIGNED_URL_TTL_SECONDS: optionalPeechoSignedUrlTtl,
});

type ParsedRuntimeConfig = z.infer<typeof runtimeSchema>;
// Hand-built test fixtures created before private beta may omit this flag;
// parsed process configuration always receives the conservative `true` default.
export type RuntimeConfig = Omit<ParsedRuntimeConfig, "BETA_MODE"> & {
  BETA_MODE?: boolean;
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

export function getCapabilities(config = getRuntimeConfig()): HealthResponse["data"]["capabilities"] {
  return {
    database: readyWhen(config.DATABASE_URL),
    authentication: readyWhen(
      config.DATABASE_URL,
      config.APP_ENV === "production" ? config.PRIMARY_DOMAIN : "non-production",
      config.BETTER_AUTH_SECRET,
      config.PII_ENCRYPTION_KEYS,
      config.PII_ENCRYPTION_CURRENT_VERSION ? String(config.PII_ENCRYPTION_CURRENT_VERSION) : undefined,
      config.PII_BLIND_INDEX_KEY,
    ),
    accountLifecycle: readyWhen(
      config.DATABASE_URL,
      config.DATABASE_ACCOUNT_WORKER_URL,
      config.BETTER_AUTH_SECRET,
      config.PII_ENCRYPTION_KEYS,
      config.PII_ENCRYPTION_CURRENT_VERSION ? String(config.PII_ENCRYPTION_CURRENT_VERSION) : undefined,
      config.PII_BLIND_INDEX_KEY,
      config.ACCOUNT_RETENTION_POLICY_VERSION,
      config.ACCOUNT_RETENTION_POLICY_APPROVED_AT,
      config.CRON_SECRET,
      config.R2_ACCOUNT_ID,
      config.R2_BUCKET_NAME,
      config.R2_WEB_ACCESS_KEY_ID,
      config.R2_WEB_SECRET_ACCESS_KEY,
      config.R2_ACCOUNT_WORKER_ACCESS_KEY_ID,
      config.R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY,
    ),
    media: readyWhen(
      config.DATABASE_MEDIA_WORKER_URL,
      config.CRON_SECRET,
      config.R2_ACCOUNT_ID,
      config.R2_BUCKET_NAME,
      config.R2_WEB_ACCESS_KEY_ID,
      config.R2_WEB_SECRET_ACCESS_KEY,
      config.R2_MEDIA_WORKER_ACCESS_KEY_ID,
      config.R2_MEDIA_WORKER_SECRET_ACCESS_KEY,
    ),
    photobooks: readyWhen(
      config.DATABASE_PHOTOBOOK_WORKER_URL,
      config.CRON_SECRET,
      config.R2_ACCOUNT_ID,
      config.R2_BUCKET_NAME,
      config.R2_WEB_ACCESS_KEY_ID,
      config.R2_WEB_SECRET_ACCESS_KEY,
      config.R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID,
      config.R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY,
    ),
    email: readyWhen(
      config.DATABASE_EMAIL_WORKER_URL,
      config.BREVO_API_KEY,
      config.BREVO_SENDER_EMAIL,
      config.BREVO_SENDER_NAME,
      config.BREVO_TEMPLATE_IDS,
      config.BREVO_WEBHOOK_SECRET,
      config.CRON_SECRET,
    ),
    payments: readyWhen(
      config.CHECKOUT_ENABLED ? "enabled" : undefined,
      config.DATABASE_URL,
      config.DATABASE_PAYMENT_WORKER_URL,
      config.PII_ENCRYPTION_KEYS,
      config.PII_ENCRYPTION_CURRENT_VERSION ? String(config.PII_ENCRYPTION_CURRENT_VERSION) : undefined,
      config.STRIPE_SECRET_KEY,
      config.STRIPE_WEBHOOK_SECRET,
      config.STRIPE_EXPECTED_ACCOUNT_ID,
      config.STRIPE_ENVIRONMENT,
      config.ORDER_PRICE_MATRIX_JSON,
      config.ORDER_SELLER_JSON,
      config.ORDER_TERMS_VERSION,
    ),
    printFulfilment: readyWhen(
      config.DATABASE_FULFILMENT_WORKER_URL,
      config.CRON_SECRET,
      config.PII_ENCRYPTION_KEYS,
      config.PII_ENCRYPTION_CURRENT_VERSION ? String(config.PII_ENCRYPTION_CURRENT_VERSION) : undefined,
      config.R2_ACCOUNT_ID,
      config.R2_BUCKET_NAME,
      config.R2_FULFILMENT_WORKER_ACCESS_KEY_ID,
      config.R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY,
      config.PEECHO_ENVIRONMENT,
      config.PEECHO_MERCHANT_API_KEY,
      config.PEECHO_SECRET_KEY,
      config.PEECHO_OFFERING_ID_A4_LANDSCAPE,
      config.PEECHO_PDF_SIGNED_URL_TTL_SECONDS
        ? String(config.PEECHO_PDF_SIGNED_URL_TTL_SECONDS)
        : undefined,
    ),
    privateBeta: readyWhen(
      config.DATABASE_URL,
      config.PII_BLIND_INDEX_KEY,
    ),
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

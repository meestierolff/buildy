import { z } from "zod";
import type { HealthResponse } from "../../shared/contracts/api.js";
import type { ProductProfile } from "../../shared/contracts/productProfile.js";

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalSecret = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());

const runtimeSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "test", "preview", "staging", "production"]).default("local"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:8080"),
  PRIMARY_DOMAIN: optionalSecret,
  TRUSTED_ORIGINS: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  DATABASE_URL: optionalSecret,
  DATABASE_ACCOUNT_WORKER_URL: optionalSecret,
  DATABASE_MEDIA_WORKER_URL: optionalSecret,
  DATABASE_PHOTOBOOK_WORKER_URL: optionalSecret,
  ACCOUNT_RETENTION_POLICY_VERSION: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional(),
  ),
  ACCOUNT_RETENTION_POLICY_APPROVED_AT: z.preprocess(
    emptyStringToUndefined,
    z.string().datetime({ offset: true }).optional(),
  ),
  PII_ENCRYPTION_KEYS: optionalSecret,
  PII_ENCRYPTION_CURRENT_VERSION: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  PII_BLIND_INDEX_KEY: optionalSecret,
  BLOB_READ_WRITE_TOKEN: optionalSecret,
  CRON_SECRET: z.preprocess(emptyStringToUndefined, z.string().min(32).optional()),
});

export type RuntimeConfig = z.infer<typeof runtimeSchema>;
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
  const protectionVersion = config.PII_ENCRYPTION_CURRENT_VERSION
    ? String(config.PII_ENCRYPTION_CURRENT_VERSION)
    : undefined;
  return {
    database: readyWhen(config.DATABASE_URL),
    authentication: readyWhen(
      config.DATABASE_URL,
      config.APP_ENV === "production" ? config.PRIMARY_DOMAIN : "non-production",
      config.PII_ENCRYPTION_KEYS,
      protectionVersion,
      config.PII_BLIND_INDEX_KEY,
    ),
    accountLifecycle: readyWhen(
      config.DATABASE_URL,
      config.DATABASE_ACCOUNT_WORKER_URL,
      config.PII_ENCRYPTION_KEYS,
      protectionVersion,
      config.PII_BLIND_INDEX_KEY,
      config.ACCOUNT_RETENTION_POLICY_VERSION,
      config.ACCOUNT_RETENTION_POLICY_APPROVED_AT,
      config.CRON_SECRET,
      config.BLOB_READ_WRITE_TOKEN,
    ),
    media: readyWhen(config.DATABASE_MEDIA_WORKER_URL, config.BLOB_READ_WRITE_TOKEN),
    photobooks: readyWhen(config.DATABASE_URL, config.BLOB_READ_WRITE_TOKEN),
    // Retained response fields let existing browser sessions update cleanly.
    email: "disabled",
    payments: "disabled",
    printFulfilment: "disabled",
    privateBeta: "disabled",
  };
}

export function getProductProfile(config = getRuntimeConfig()): ProductProfile {
  const capabilities = getCapabilities(config);
  const databaseReady = capabilities.database === "ready";
  return {
    profile: "feedback_beta",
    checkoutMode: "off",
    betaMode: false,
    inviteRequiredForNewAccounts: false,
    capabilities: {
      passwordSignIn: capabilities.authentication === "ready",
      emailAuth: false,
      renovations: databaseReady,
      updates: databaseReady,
      story: databaseReady,
      media: capabilities.media === "ready",
      photobookPreview: capabilities.photobooks === "ready",
      sharing: databaseReady,
      feedback: databaseReady,
      accountDeletion: capabilities.accountLifecycle === "ready",
      checkout: false,
    },
  };
}

export function getTrustedOrigins(config = getRuntimeConfig()): Set<string> {
  const configured = config.TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  return new Set([
    config.APP_ORIGIN,
    config.PRIMARY_DOMAIN,
    config.VERCEL_URL ? `https://${config.VERCEL_URL}` : undefined,
    ...configured,
  ].filter((origin): origin is string => Boolean(origin)));
}

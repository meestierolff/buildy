#!/usr/bin/env node

import { head as headBlob, list as listBlobs } from "@vercel/blob";
import pg from "pg";
import Stripe from "stripe";

import { resolveAuthConfiguration } from "../../server/auth/config";
import { getCapabilities, getRuntimeConfig } from "../../server/config/runtime";
import {
  activeCheckoutMode,
  checkoutConfigurationIssues,
} from "../../server/orders/checkoutConfiguration";
import { resolveRuntimeDataProtection } from "../../server/security/runtimeDataProtection";
import {
  requireCheckoutModeForTarget,
  requireListedBlobProbe,
  verifyInspectedPrivateBlob,
  verifyStripeAccount,
} from "./provider-gates";

type TargetEnvironment = "staging" | "production";
type ResultStatus = "pass" | "fail" | "manual";

interface CheckResult {
  check: string;
  detail: string;
  status: ResultStatus;
}

const argv = new Set(process.argv.slice(2));
const unknown = [...argv].filter((argument) => !["--check", "--staging", "--production"].includes(argument));
if (unknown.length > 0 || argv.has("--staging") === argv.has("--production")) {
  process.stderr.write("Gebruik: bun run setup:providers -- --staging|--production [--check]\n");
  process.exit(2);
}

const target: TargetEnvironment = argv.has("--production") ? "production" : "staging";
const remote = argv.has("--check");
const results: CheckResult[] = [];

function record(status: ResultStatus, check: string, detail: string): void {
  results.push({ status, check, detail });
}

function safeFailure(error: unknown): string {
  if (!(error instanceof Error)) return "onbekende fout";
  const candidate = error as Error & { code?: unknown; name: string };
  if (
    candidate.name === "Error"
    && candidate.message.length <= 160
    && !candidate.message.includes("://")
    && !candidate.message.includes("@")
  ) return candidate.message;
  const code = typeof candidate.code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate.code)
    ? candidate.code
    : undefined;
  return code ? `${candidate.name} (${code})` : candidate.name;
}

async function check(name: string, action: () => string | Promise<string>): Promise<void> {
  try {
    record("pass", name, await action());
  } catch (error) {
    record("fail", name, safeFailure(error));
  }
}

function requireValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ontbreekt`);
  return value;
}

function exactHttpsOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || value !== url.origin
    || url.pathname !== "/"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) throw new Error("origin ongeldig");
  return url;
}

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

let runtime: ReturnType<typeof getRuntimeConfig> | undefined;
await check("Runtimeconfig", () => {
  runtime = getRuntimeConfig();
  if (runtime.APP_ENV !== target) throw new Error("APP_ENV komt niet overeen");
  const origin = exactHttpsOrigin(runtime.APP_ORIGIN);
  if (target === "production") {
    const primary = exactHttpsOrigin(requireValue("PRIMARY_DOMAIN"));
    if (origin.origin !== primary.origin) throw new Error("PRIMARY_DOMAIN mismatch");
  }
  return `${target}; exacte HTTPS-origin; secrets niet getoond`;
});

await check("Google OpenID Connect", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  const auth = resolveAuthConfiguration(runtime);
  if (!auth.google.clientId || !auth.google.clientSecret) throw new Error("Google-client ontbreekt");
  const callback = new URL("/api/auth/callback/google", auth.appOrigin);
  if (callback.origin !== new URL(auth.appOrigin).origin) throw new Error("Google-callbackorigin wijkt af");
  return `Google OIDC geconfigureerd; callback ${callback.pathname}`;
});

await check("Database- en workercredentials", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  const names = [
    "DATABASE_URL",
    "DATABASE_DIRECT_URL",
    "DATABASE_ACCOUNT_WORKER_URL",
    "DATABASE_MEDIA_WORKER_URL",
    "DATABASE_PHOTOBOOK_WORKER_URL",
    ...(activeCheckoutMode(runtime) ? ["DATABASE_PAYMENT_WORKER_URL"] : []),
  ];
  const urls = names.map((name) => new URL(requireValue(name)));
  if (urls.some((url) => !["postgres:", "postgresql:"].includes(url.protocol))) {
    throw new Error("niet-PostgreSQL URL");
  }
  if (new Set(urls.map((url) => url.username)).size !== urls.length) {
    throw new Error("rollen delen dezelfde login");
  }
  if (urls.some((url) => !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? ""))) {
    throw new Error("TLS ontbreekt");
  }
  return `${urls.length} unieke Neon TLS-loginrollen`;
});

await check("Encryptie, retentie en private Blob", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  resolveRuntimeDataProtection(runtime);
  requireValue("BLOB_READ_WRITE_TOKEN");
  requireValue("ACCOUNT_RETENTION_POLICY_VERSION");
  const approvedAt = new Date(requireValue("ACCOUNT_RETENTION_POLICY_APPROVED_AT"));
  if (!Number.isFinite(approvedAt.getTime())) throw new Error("retentiedatum ongeldig");
  if (requireValue("CRON_SECRET").length < 32) throw new Error("cronsecret te kort");
  return "keyring, blind index, retentieversie, cronsecret en Blob-token aanwezig";
});

await check("Checkoutgrens", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  const mode = requireCheckoutModeForTarget(target, activeCheckoutMode(runtime));
  const issues = checkoutConfigurationIssues(runtime);
  if (issues.length > 0) throw new Error(`checkoutconfig ongeldig: ${issues.join(",")}`);
  return `${mode}-checkout; goedgekeurde prijs- en verkoperconfig geldig`;
});

await check("Capabilityconfig", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  const capabilities = getCapabilities(runtime);
  const required = ["database", "authentication", "accountLifecycle", "media", "photobooks"] as const;
  const notReady = required.filter((name) => capabilities[name] !== "ready");
  if (notReady.length > 0) throw new Error(`kerncapabilities niet ready: ${notReady.join(",")}`);
  if (capabilities.email !== "disabled" || capabilities.printFulfilment !== "disabled") {
    throw new Error("retired capabilities zijn niet disabled");
  }
  const expectedPayments = activeCheckoutMode(runtime) ? "ready" : "disabled";
  if (capabilities.payments !== expectedPayments) throw new Error("paymentcapability wijkt af");
  return `kern ready; e-mail en automatische fulfilment uit; payments ${expectedPayments}`;
});

if (remote) {
  await check("Neon connectiviteit", async () => {
    const client = new pg.Client({ connectionString: requireValue("DATABASE_DIRECT_URL") });
    try {
      await client.connect();
      const result = await client.query<{ migration_count: string }>(
        "select count(*)::text as migration_count from buildy_meta.schema_migrations",
      );
      return `${result.rows[0]?.migration_count ?? "0"} migrationledgerregels bereikbaar`;
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  await check("Google discovery", async () => {
    const response = await fetchWithTimeout(new URL("https://accounts.google.com/.well-known/openid-configuration"));
    if (response.status !== 200) throw new Error(`Google discovery HTTP ${response.status}`);
    const body = await response.json() as { issuer?: unknown };
    if (body.issuer !== "https://accounts.google.com") throw new Error("Google issuer wijkt af");
    return "Google issuer en discovery bereikbaar";
  });

  await check("Private Vercel Blob", async () => {
    const token = requireValue("BLOB_READ_WRITE_TOKEN");
    const page = await listBlobs({
      token,
      limit: 1,
      mode: "expanded",
    });
    const listed = requireListedBlobProbe(page.blobs);
    const inspected = await headBlob(listed.pathname, { token });
    verifyInspectedPrivateBlob(listed, inspected);
    return "bestaand private Blob-object read-only geïnspecteerd";
  });

  if (runtime && activeCheckoutMode(runtime)) {
    await check("Stripe account", async () => {
      const stripe = new Stripe(requireValue("STRIPE_SECRET_KEY"), { telemetry: false });
      await verifyStripeAccount(stripe, requireValue("STRIPE_EXPECTED_ACCOUNT_ID"), target);
      return "verwacht Stripe-account en mode bevestigd";
    });
  }

  await check("Vercel runtime readiness", async () => {
    if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
    const health = await fetchWithTimeout(new URL("/api/health", runtime.APP_ORIGIN));
    const readiness = await fetchWithTimeout(new URL("/api/readiness", runtime.APP_ORIGIN));
    if (health.status !== 200 || readiness.status !== 200) {
      throw new Error(`health/readiness HTTP ${health.status}/${readiness.status}`);
    }
    return "health en least-privilege readiness HTTP 200";
  });
}

record("manual", "Dashboard- en contractchecks", [
  "DNS/HTTPS en apex-www redirect",
  "Neon plan/regio/DPA/backupretentie",
  "Google consent/origins/callback",
  "Vercel Blob-store PRIVATE, regio/DPA en tokenrotatie",
  "Stripe webhook/tax/businessdetails indien checkout aan staat",
  "betaalde Bouwboeken handmatig controleren, drukken, verzenden en bijwerken in /beheer/bestellingen",
  "supportprocedure en proefdruk",
  "Vercel cron, alerts en budgetlimieten",
].join("; "));

for (const result of results) {
  const icon = result.status === "pass" ? "✓" : result.status === "manual" ? "!" : "✗";
  process.stdout.write(`${icon} [${result.status}] ${result.check}: ${result.detail}\n`);
}

const automatic = results.filter((result) => result.status !== "manual");
const failures = automatic.filter((result) => result.status === "fail");
process.stdout.write(`\n${automatic.length - failures.length}/${automatic.length} automatische checks zonder fout.`);
process.stdout.write(remote ? " Read-only providerprobes uitgevoerd.\n" : " Gebruik --check voor read-only providerprobes.\n");
if (failures.length > 0) process.exitCode = 1;

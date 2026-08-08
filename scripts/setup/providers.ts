#!/usr/bin/env node

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import Stripe from "stripe";

import { getCapabilities, getRuntimeConfig } from "../../server/config/runtime";
import { parseEmailTemplateCatalog, EMAIL_TEMPLATE_KEYS } from "../../server/email/templates";
import { parseApprovedPriceMatrix } from "../../server/orders/approvedPriceMatrix";
import { parseSellerSnapshot } from "../../server/orders/config";
import { resolveRuntimeDataProtection } from "../../server/security/runtimeDataProtection";
import { createPeechoProvider } from "../peecho/_shared";

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
const R2_CREDENTIAL_BOUNDARIES = [
  {
    name: "web",
    accessKeyEnvironmentName: "R2_WEB_ACCESS_KEY_ID",
    secretEnvironmentName: "R2_WEB_SECRET_ACCESS_KEY",
  },
  {
    name: "account-worker",
    accessKeyEnvironmentName: "R2_ACCOUNT_WORKER_ACCESS_KEY_ID",
    secretEnvironmentName: "R2_ACCOUNT_WORKER_SECRET_ACCESS_KEY",
  },
  {
    name: "media-worker",
    accessKeyEnvironmentName: "R2_MEDIA_WORKER_ACCESS_KEY_ID",
    secretEnvironmentName: "R2_MEDIA_WORKER_SECRET_ACCESS_KEY",
  },
  {
    name: "photobook-worker",
    accessKeyEnvironmentName: "R2_PHOTOBOOK_WORKER_ACCESS_KEY_ID",
    secretEnvironmentName: "R2_PHOTOBOOK_WORKER_SECRET_ACCESS_KEY",
  },
  {
    name: "fulfilment-worker",
    accessKeyEnvironmentName: "R2_FULFILMENT_WORKER_ACCESS_KEY_ID",
    secretEnvironmentName: "R2_FULFILMENT_WORKER_SECRET_ACCESS_KEY",
  },
] as const;

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

async function fetchWithTimeout(url: URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
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

await check("Environmentisolatie", () => {
  const expectedProviderEnvironment = target === "production" ? "live" : "test";
  if (requireValue("STRIPE_ENVIRONMENT") !== expectedProviderEnvironment) {
    throw new Error("Stripe environment mismatch");
  }
  if (requireValue("PEECHO_ENVIRONMENT") !== expectedProviderEnvironment) {
    throw new Error("Peecho environment mismatch");
  }
  const stripeKey = requireValue("STRIPE_SECRET_KEY");
  if (target === "production" ? !stripeKey.startsWith("sk_live_") : !stripeKey.startsWith("sk_test_")) {
    throw new Error("Stripe key mode mismatch");
  }
  return `${expectedProviderEnvironment}-providers passen bij ${target}`;
});

await check("Database- en workercredentials", () => {
  const names = [
    "DATABASE_URL",
    "DATABASE_DIRECT_URL",
    "DATABASE_ACCOUNT_WORKER_URL",
    "DATABASE_EMAIL_WORKER_URL",
    "DATABASE_FULFILMENT_WORKER_URL",
    "DATABASE_MEDIA_WORKER_URL",
    "DATABASE_PAYMENT_WORKER_URL",
    "DATABASE_PHOTOBOOK_WORKER_URL",
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
  return `${urls.length} unieke TLS-loginrollen`;
});

await check("Encryptie en retentiebeleid", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  resolveRuntimeDataProtection(runtime);
  requireValue("ACCOUNT_RETENTION_POLICY_VERSION");
  const approvedAt = new Date(requireValue("ACCOUNT_RETENTION_POLICY_APPROVED_AT"));
  if (!Number.isFinite(approvedAt.getTime())) throw new Error("retentiedatum ongeldig");
  if (requireValue("CRON_SECRET").length < 32) throw new Error("cronsecret te kort");
  return "keyring, blind index, retentieversie en cronsecret geldig";
});

await check("R2 credentialisolatie", () => {
  requireValue("R2_ACCOUNT_ID");
  requireValue("R2_BUCKET_NAME");
  const credentials = R2_CREDENTIAL_BOUNDARIES.map((boundary) => ({
    accessKeyId: requireValue(boundary.accessKeyEnvironmentName),
    secretAccessKey: requireValue(boundary.secretEnvironmentName),
  }));
  if (new Set(credentials.map((credential) => credential.accessKeyId)).size !== credentials.length) {
    throw new Error("R2-boundaries delen een access key");
  }
  if (new Set(credentials.map((credential) => credential.secretAccessKey)).size !== credentials.length) {
    throw new Error("R2-boundaries delen een secret key");
  }
  return `${credentials.length} afzonderlijke bucket-scoped credentialparen`;
});

await check("Order- en e-mailconfig", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  const matrix = parseApprovedPriceMatrix(requireValue("ORDER_PRICE_MATRIX_JSON"));
  parseSellerSnapshot(requireValue("ORDER_SELLER_JSON"));
  requireValue("ORDER_TERMS_VERSION");
  const offeringId = requireValue("PEECHO_OFFERING_ID_A4_LANDSCAPE");
  if (matrix.environment !== (target === "production" ? "live" : "test")) {
    throw new Error("prijsmatrix environment mismatch");
  }
  if (!matrix.entries.every((entry) => entry.offeringId === offeringId)) {
    throw new Error("offering mismatch in prijsmatrix");
  }
  const templates = parseEmailTemplateCatalog(requireValue("BREVO_TEMPLATE_IDS"));
  if (!templates.hasAll(EMAIL_TEMPLATE_KEYS)) throw new Error("e-mailtemplates incompleet");
  return `${matrix.entries.length} prijsregel(s), ${EMAIL_TEMPLATE_KEYS.length} templateversies`;
});

await check("Capabilityconfig", () => {
  if (!runtime) throw new Error("runtimeconfig niet beschikbaar");
  const capabilities = getCapabilities(runtime);
  const notReady = Object.entries(capabilities)
    .filter(([, status]) => status !== "ready")
    .map(([name]) => name);
  if (notReady.length > 0) throw new Error(`capabilities niet actief: ${notReady.join(",")}`);
  return `${Object.keys(capabilities).length} capabilities ready`;
});

if (remote) {
  await check("Neon connectiviteit", async () => {
    const client = new pg.Client({ connectionString: requireValue("DATABASE_DIRECT_URL") });
    try {
      await client.connect();
      const result = await client.query<{ migration_count: string }>(
        "select count(*)::text as migration_count from public.buildy_migrations",
      );
      return `${result.rows[0]?.migration_count ?? "0"} migrationledgerregels bereikbaar`;
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  await check("R2 private bucket", async () => {
    const accountId = requireValue("R2_ACCOUNT_ID");
    const bucket = requireValue("R2_BUCKET_NAME");
    for (const boundary of R2_CREDENTIAL_BOUNDARIES) {
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: requireValue(boundary.accessKeyEnvironmentName),
          secretAccessKey: requireValue(boundary.secretEnvironmentName),
        },
      });
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } finally {
        client.destroy();
      }
    }
    const anonymous = await fetchWithTimeout(new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}`));
    if (anonymous.status >= 200 && anonymous.status < 300) throw new Error("bucket anoniem bereikbaar");
    return `${R2_CREDENTIAL_BOUNDARIES.length} authenticated boundaries; anonymous request niet succesvol`;
  });

  await check("Stripe account", async () => {
    const stripe = new Stripe(requireValue("STRIPE_SECRET_KEY"), { telemetry: false });
    const account = await stripe.accounts.retrieve();
    if (account.id !== requireValue("STRIPE_EXPECTED_ACCOUNT_ID")) throw new Error("account-ID mismatch");
    if (account.livemode !== (target === "production")) throw new Error("accountmode mismatch");
    return "verwacht account-ID en mode bevestigd";
  });

  await check("Brevo account", async () => {
    const response = await fetchWithTimeout(new URL("https://api.brevo.com/v3/account"), {
      headers: { accept: "application/json", "api-key": requireValue("BREVO_API_KEY") },
    });
    if (response.status !== 200) throw new Error(`Brevo HTTP ${response.status}`);
    return "read-only accountprobe geslaagd";
  });

  await check("Peecho offering", async () => {
    const offerings = await createPeechoProvider().getOfferings();
    const expected = requireValue("PEECHO_OFFERING_ID_A4_LANDSCAPE");
    if (!offerings.some((offering) => String(offering.id) === expected)) throw new Error("offering niet gevonden");
    return `verwachte offering gevonden in ${offerings.length} offering(s)`;
  });

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
  "R2 CORS/lifecycle/DPA",
  "Brevo SPF/DKIM/DMARC/webhook",
  "Google consent/origins/callback",
  "Stripe webhook/tax/businessdetails",
  "Peecho credits/invoicing/callback/contract/proefdruk",
  "Vercel plan/cron/alerts",
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

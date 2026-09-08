#!/usr/bin/env node

import { head as headBlob, list as listBlobs } from "@vercel/blob";
import pg from "pg";

import { resolveAuthConfiguration } from "../../server/auth/config";
import { getCapabilities, getProductProfile, getRuntimeConfig } from "../../server/config/runtime";
import { checkoutConfigurationIssues } from "../../server/orders/checkoutConfiguration";
import { resolveRuntimeDataProtection } from "../../server/security/runtimeDataProtection";
import {
  releaseContractFor,
  targetReadinessFailures,
  verifyTargetCapabilities,
  verifyTargetProductProfile,
} from "../release-gates.mjs";
import {
  requireListedBlobProbe,
  verifyInspectedPrivateBlob,
} from "./provider-gates";

type TargetEnvironment = "preview" | "staging" | "production";
type ResultStatus = "pass" | "fail" | "manual";

interface CheckResult {
  check: string;
  detail: string;
  status: ResultStatus;
}

const databaseRoleNames = [
  "DATABASE_URL",
  "DATABASE_ACCOUNT_WORKER_URL",
  "DATABASE_MEDIA_WORKER_URL",
  "DATABASE_PHOTOBOOK_WORKER_URL",
  "DATABASE_PAYMENT_WORKER_URL",
] as const;

class SafeCheckError extends Error {}

const argv = new Set(process.argv.slice(2));
const targetFlags = ["--preview", "--staging", "--production"] as const;
const unknown = [...argv].filter((argument) => !["--check", ...targetFlags].includes(argument));
const selectedTargets = targetFlags.filter((flag) => argv.has(flag));
if (unknown.length > 0 || selectedTargets.length !== 1) {
  process.stderr.write("Gebruik: bun run setup:providers -- --preview|--staging|--production [--check]\n");
  process.exit(2);
}

const target: TargetEnvironment = selectedTargets[0].slice(2) as TargetEnvironment;
const remote = argv.has("--check");
const results: CheckResult[] = [];

function record(status: ResultStatus, check: string, detail: string): void {
  results.push({ status, check, detail });
}

function safeFailure(error: unknown): string {
  if (!(error instanceof Error)) return "onbekende fout";
  const candidate = error as Error & { code?: unknown; name: string };
  if (
    candidate instanceof SafeCheckError
    && candidate.message.length <= 160
    && !candidate.message.includes("://")
    && !candidate.message.includes("@")
  ) return candidate.message;
  const code = typeof candidate.code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate.code)
    ? candidate.code
    : undefined;
  return code ? `${candidate.name} (${code})` : candidate.name;
}

function runSafeGate<T>(action: () => T, fallback: string): T {
  try {
    return action();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message && message.length <= 160 && !message.includes("://") && !message.includes("@")) {
      throw new SafeCheckError(message);
    }
    throw new SafeCheckError(fallback);
  }
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
  if (!value) throw new SafeCheckError(`${name} ontbreekt`);
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
  ) throw new SafeCheckError("origin ongeldig");
  return url;
}

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new SafeCheckError(`HTTP ${response.status} gaf geen geldig JSON-object`);
  }
}

function configuredDatabaseRoles(): Array<{ name: typeof databaseRoleNames[number]; url: URL }> {
  const roles = databaseRoleNames.map((name) => ({ name, url: new URL(requireValue(name)) }));
  if (roles.some(({ url }) => !["postgres:", "postgresql:"].includes(url.protocol))) {
    throw new SafeCheckError("niet-PostgreSQL URL");
  }
  if (roles.some(({ url }) => !url.username)) throw new SafeCheckError("databaserol mist een login");
  if (new Set(roles.map(({ url }) => url.username)).size !== roles.length) {
    throw new SafeCheckError("rollen delen dezelfde login");
  }
  if (roles.some(({ url }) => !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? ""))) {
    throw new SafeCheckError("TLS ontbreekt");
  }
  return roles;
}

let runtime: ReturnType<typeof getRuntimeConfig> | undefined;
let releaseContract: ReturnType<typeof releaseContractFor> | undefined;
await check("Runtimeconfig", () => {
  runtime = getRuntimeConfig();
  releaseContract = runSafeGate(() => releaseContractFor(target), "releasecontract ongeldig");
  if (runtime.APP_ENV !== target) throw new SafeCheckError("APP_ENV komt niet overeen");
  const origin = exactHttpsOrigin(runtime.APP_ORIGIN);
  if (target === "production") {
    const primary = exactHttpsOrigin(requireValue("PRIMARY_DOMAIN"));
    if (origin.origin !== primary.origin) throw new SafeCheckError("PRIMARY_DOMAIN mismatch");
  }
  return `${target}; verwacht ${releaseContract.profile}/${releaseContract.checkoutMode}; exacte HTTPS-origin; secrets niet getoond`;
});

await check("Google OpenID Connect", () => {
  if (!runtime) throw new SafeCheckError("runtimeconfig niet beschikbaar");
  const auth = resolveAuthConfiguration(runtime);
  if (!auth.google.clientId || !auth.google.clientSecret) throw new SafeCheckError("Google-client ontbreekt");
  const callback = new URL("/api/auth/callback/google", auth.appOrigin);
  if (callback.origin !== new URL(auth.appOrigin).origin) {
    throw new SafeCheckError("Google-callbackorigin wijkt af");
  }
  return `Google OIDC geconfigureerd; callback ${callback.pathname}`;
});

await check("Database- en workercredentials", () => {
  if (!runtime) throw new SafeCheckError("runtimeconfig niet beschikbaar");
  const roles = configuredDatabaseRoles();
  return `${roles.length} unieke Neon TLS-loginrollen voor web, account, media, Bouwboek en betaling`;
});

await check("Encryptie, retentie en private Blob", () => {
  if (!runtime) throw new SafeCheckError("runtimeconfig niet beschikbaar");
  resolveRuntimeDataProtection(runtime);
  requireValue("BLOB_READ_WRITE_TOKEN");
  requireValue("ACCOUNT_RETENTION_POLICY_VERSION");
  const approvedAt = new Date(requireValue("ACCOUNT_RETENTION_POLICY_APPROVED_AT"));
  if (!Number.isFinite(approvedAt.getTime())) throw new SafeCheckError("retentiedatum ongeldig");
  if (requireValue("CRON_SECRET").length < 32) throw new SafeCheckError("cronsecret te kort");
  return "keyring, blind index, retentieversie, cronsecret en Blob-token aanwezig";
});

await check("Productprofiel en checkoutconfig", () => {
  if (!runtime || !releaseContract) throw new SafeCheckError("runtimeconfig niet beschikbaar");
  const issues = checkoutConfigurationIssues(runtime);
  if (issues.length > 0) {
    throw new SafeCheckError(`checkoutconfig faalt gesloten: ${issues.join(", ")}`);
  }
  runSafeGate(
    () => verifyTargetProductProfile(getProductProfile(runtime!), releaseContract!),
    "productprofiel ongeldig",
  );
  return `${releaseContract.profile}; checkout ${releaseContract.checkoutMode}; Stripe-, prijs-, seller- en termsconfig actueel`;
});

await check("Capabilityconfig", () => {
  if (!runtime) throw new SafeCheckError("runtimeconfig niet beschikbaar");
  const capabilities = getCapabilities(runtime);
  runSafeGate(() => verifyTargetCapabilities(capabilities), "capabilityconfig ongeldig");
  return "auth, media, Bouwboek en betalingen ready; invite, e-mail en automatische fulfilment uit";
});

if (remote) {
  await check("Neon connectiviteit", async () => {
    const roles = configuredDatabaseRoles();
    for (const { name, url } of roles) {
      let client: pg.Client | undefined;
      try {
        client = new pg.Client({ connectionString: url.toString() });
        await client.connect();
        await client.query("select 1");
      } catch {
        throw new SafeCheckError(`${name} niet read-only bereikbaar`);
      } finally {
        await client?.end().catch(() => undefined);
      }
    }
    return `${roles.length} runtime- en workerrollen read-only bereikbaar`;
  });

  await check("Google discovery", async () => {
    let response: Response;
    try {
      response = await fetchWithTimeout(new URL("https://accounts.google.com/.well-known/openid-configuration"));
    } catch {
      throw new SafeCheckError("Google discovery niet bereikbaar");
    }
    if (response.status !== 200) throw new SafeCheckError(`Google discovery HTTP ${response.status}`);
    const body = await response.json() as { issuer?: unknown };
    if (body.issuer !== "https://accounts.google.com") {
      throw new SafeCheckError("Google issuer wijkt af");
    }
    return "Google issuer en discovery bereikbaar";
  });

  await check("Private Vercel Blob", async () => {
    const token = requireValue("BLOB_READ_WRITE_TOKEN");
    let page: Awaited<ReturnType<typeof listBlobs>>;
    try {
      page = await listBlobs({ token, limit: 1, mode: "expanded" });
    } catch {
      throw new SafeCheckError("private Blob-listprobe mislukt");
    }
    const listed = runSafeGate(
      () => requireListedBlobProbe(page.blobs),
      "private Blob-listbewijs ongeldig",
    );
    let inspected: Awaited<ReturnType<typeof headBlob>>;
    try {
      inspected = await headBlob(listed.pathname, { token });
    } catch {
      throw new SafeCheckError("private Blob-metadataprobe mislukt");
    }
    runSafeGate(
      () => verifyInspectedPrivateBlob(listed, inspected),
      "private Blob-metadatabewijs ongeldig",
    );
    return "bestaand private Blob-object read-only geïnspecteerd";
  });

  await check("Vercel runtime readiness", async () => {
    if (!runtime || !releaseContract) throw new SafeCheckError("runtimeconfig niet beschikbaar");
    let health: Response;
    let profile: Response;
    let readiness: Response;
    try {
      [health, profile, readiness] = await Promise.all([
        fetchWithTimeout(new URL("/api/health", runtime.APP_ORIGIN)),
        fetchWithTimeout(new URL("/api/product-profile", runtime.APP_ORIGIN)),
        fetchWithTimeout(new URL("/api/readiness", runtime.APP_ORIGIN)),
      ]);
    } catch {
      throw new SafeCheckError("Vercel runtimeprobes niet bereikbaar");
    }
    if (health.status !== 200 || profile.status !== 200 || readiness.status !== 200) {
      throw new SafeCheckError(`health/profile/readiness HTTP ${health.status}/${profile.status}/${readiness.status}`);
    }
    const healthBody = await responseJson(health);
    const profileBody = await responseJson(profile);
    const readinessBody = await responseJson(readiness);
    const healthData = healthBody.data as Record<string, unknown> | undefined;
    const profileData = profileBody.data;
    const readinessData = readinessBody.data as Record<string, unknown> | undefined;
    if (healthData?.environment !== target) throw new SafeCheckError("remote APP_ENV komt niet overeen");
    runSafeGate(
      () => verifyTargetCapabilities(healthData?.capabilities),
      "remote capabilities ongeldig",
    );
    runSafeGate(
      () => verifyTargetProductProfile(profileData, releaseContract!),
      "remote productprofiel ongeldig",
    );
    if (readinessData?.ready !== true) throw new SafeCheckError("remote readiness is niet ready");
    const failures = targetReadinessFailures(readinessData.checks);
    if (failures.length > 0) {
      throw new SafeCheckError(`remote readiness faalt gesloten: ${failures.join(", ")}`);
    }
    return "health, doelprofiel en zes least-privilege readinesschecks pass";
  });
}

record("manual", "Dashboard- en contractchecks", [
  "DNS/HTTPS en apex-www redirect",
  "Neon plan/regio/DPA/backupretentie",
  "Google consent/origins/callback",
  "Stripe-account, webhookendpoint en eventdelivery",
  "actuele price-, seller- en termsapprovals",
  "Vercel Blob-store PRIVATE, regio/DPA en tokenrotatie",
  "juridische identiteit, vestigingsadres en rechtstreeks privacy-/supportcontact",
  "retentie-, support- en herstelprocedure",
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

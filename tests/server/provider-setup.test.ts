// @vitest-environment node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type TargetEnvironment = "preview" | "staging" | "production";

const root = process.cwd();
const providerScript = resolve(root, "scripts/setup/providers.ts");

function priceMatrix(environment: "test" | "live"): string {
  return JSON.stringify({
    version: 1,
    environment,
    currency: "EUR",
    approvalStatus: "approved",
    commercialApprovalId: `provider-check-${environment}-matrix`,
    approvedBy: "Test commerce owner",
    approvedAt: "2020-01-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    entries: [{
      sku: "a4-landscape-hardcover-v1",
      countryCode: "NL",
      minimumPages: 24,
      maximumPages: 400,
      minimumQuantity: 1,
      maximumQuantity: 5,
      unitBaseMinor: 4_000,
      unitAdditionalPageMinor: 25,
      shippingBaseMinor: 800,
      shippingAdditionalCopyMinor: 200,
      taxRateBasisPoints: 2_100,
      taxTreatment: "vat_included",
      deliveryEstimate: "Testlevering na handmatige drukopdracht",
      productReference: "buildy-a4-landscape-hardcover-v1",
    }],
  });
}

function sellerConfiguration(environment: "test" | "live"): string {
  return JSON.stringify({
    version: 1,
    environment,
    approvalStatus: "approved",
    approvalId: `provider-check-${environment}-seller`,
    approvedBy: "Test legal owner",
    approvedAt: "2020-01-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    seller: {
      legalName: "Buildy Test B.V.",
      tradeName: "Buildy",
      registrationNumber: "TEST-ONLY",
      vatNumber: null,
      address: "Testadres 1, Utrecht",
      countryCode: "NL",
      supportEmail: "support@example.test",
    },
  });
}

function environmentFor(
  target: TargetEnvironment,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const checkoutMode = target === "production" ? "live" : "test";
  const origin = `https://${target}.buildy.test`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: target,
    APP_ORIGIN: origin,
    PRIMARY_DOMAIN: target === "production" ? origin : "",
    TRUSTED_ORIGINS: "",
    VERCEL_URL: "",
    PRODUCT_PROFILE: "feedback_beta",
    BETA_MODE: "false",
    CHECKOUT_MODE: checkoutMode,
    DATABASE_URL: "postgresql://web:database-password-value@db.buildy.test/buildy?sslmode=require",
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:account-secret@db.buildy.test/buildy?sslmode=require",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:media-secret@db.buildy.test/buildy?sslmode=require",
    DATABASE_PHOTOBOOK_WORKER_URL: "postgresql://photobook:photobook-secret@db.buildy.test/buildy?sslmode=require",
    DATABASE_PAYMENT_WORKER_URL: "postgresql://payment:payment-secret@db.buildy.test/buildy?sslmode=require",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: "1",
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    GOOGLE_CLIENT_ID: "provider-check-google-client",
    GOOGLE_CLIENT_SECRET: "provider-check-google-secret",
    BLOB_READ_WRITE_TOKEN: "provider-check-blob-secret",
    CRON_SECRET: "provider-check-cron-secret-at-least-32-characters",
    ACCOUNT_RETENTION_POLICY_VERSION: "provider-check-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-01-01T00:00:00.000Z",
    STRIPE_ENVIRONMENT: checkoutMode,
    STRIPE_SECRET_KEY: `sk_${checkoutMode}_stripe-secret-value`,
    STRIPE_WEBHOOK_SECRET: "whsec_provider-check-secret",
    STRIPE_EXPECTED_ACCOUNT_ID: "acct_PROVIDERTEST",
    ORDER_PRICE_MATRIX_JSON: priceMatrix(checkoutMode),
    ORDER_SELLER_JSON: sellerConfiguration(checkoutMode),
    ORDER_TERMS_VERSION: "provider-check-terms-v1",
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
  return environment;
}

function runProviderCheck(
  target: TargetEnvironment,
  overrides: Record<string, string | undefined> = {},
) {
  return spawnSync(process.execPath, ["--import", "tsx", providerScript, `--${target}`], {
    cwd: root,
    encoding: "utf8",
    env: environmentFor(target, overrides),
    timeout: 15_000,
  });
}

describe("provider setup release contract", () => {
  it.each([
    ["preview", "test"],
    ["staging", "test"],
    ["production", "live"],
  ] as const)("enforces %s with feedback_beta/%s-ready configuration", (target, checkoutMode) => {
    const result = runProviderCheck(target);

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(`verwacht feedback_beta/${checkoutMode}`);
    expect(result.stdout).toContain("5 unieke Neon TLS-loginrollen");
    expect(result.stdout).toContain(`feedback_beta; checkout ${checkoutMode}`);
    expect(result.stdout).toContain("Stripe-, prijs-, seller- en termsconfig actueel");
    expect(result.stdout).toContain("6/6 automatische checks zonder fout");
  });

  it("fails closed on a target mode, profile or beta mismatch", () => {
    const wrongMode = runProviderCheck("production", {
      CHECKOUT_MODE: "test",
      STRIPE_ENVIRONMENT: "test",
      STRIPE_SECRET_KEY: "sk_test_stripe-secret-value",
      ORDER_PRICE_MATRIX_JSON: priceMatrix("test"),
      ORDER_SELLER_JSON: sellerConfiguration("test"),
    });
    const wrongProfile = runProviderCheck("preview", { PRODUCT_PROFILE: "public_demo" });
    const privateBeta = runProviderCheck("preview", { BETA_MODE: "true" });

    expect(wrongMode.status).toBe(1);
    expect(wrongMode.stdout).toContain("checkout_application_environment_mismatch");
    expect(wrongProfile.status).toBe(1);
    expect(wrongProfile.stdout).toContain("PRODUCT_PROFILE moet feedback_beta zijn");
    expect(privateBeta.status).toBe(1);
    expect(privateBeta.stdout).toContain("BETA_MODE moet false zijn");
  });

  it("requires five distinct TLS database roles", () => {
    const missingPhotobook = runProviderCheck("preview", {
      DATABASE_PHOTOBOOK_WORKER_URL: undefined,
    });
    const sharedLogin = runProviderCheck("preview", {
      DATABASE_PAYMENT_WORKER_URL: "postgresql://media:other-secret@db.buildy.test/buildy?sslmode=require",
    });

    expect(missingPhotobook.status).toBe(1);
    expect(missingPhotobook.stdout).toContain("DATABASE_PHOTOBOOK_WORKER_URL ontbreekt");
    expect(sharedLogin.status).toBe(1);
    expect(sharedLogin.stdout).toContain("rollen delen dezelfde login");
  });

  it("uses the runtime checkout resolver and never prints configured values", () => {
    const expiredMatrix = JSON.parse(priceMatrix("test")) as Record<string, unknown>;
    expiredMatrix.expiresAt = "2021-01-01T00:00:00.000Z";
    const result = runProviderCheck("preview", {
      ORDER_PRICE_MATRIX_JSON: JSON.stringify(expiredMatrix),
    });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("price_matrix_approval_inactive");
    for (const secret of [
      "database-password-value",
      "provider-check-google-secret",
      "provider-check-blob-secret",
      "stripe-secret-value",
      "whsec_provider-check-secret",
    ]) expect(combinedOutput).not.toContain(secret);
  });

  it("keeps every optional remote probe read-only", () => {
    const source = readFileSync(providerScript, "utf8");

    expect(source).toContain('method: "GET"');
    expect(source.match(/client\.query\(/g)).toHaveLength(1);
    expect(source).toContain('client.query("select 1")');
    expect(source).toContain("listBlobs");
    expect(source).toContain("headBlob");
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  });
});

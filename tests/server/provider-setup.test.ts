// @vitest-environment node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type TargetEnvironment = "preview" | "staging" | "production";

const root = process.cwd();
const providerScript = resolve(root, "scripts/setup/providers.ts");

function environmentFor(
  target: TargetEnvironment,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
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
    CHECKOUT_MODE: "off",
    DATABASE_URL: "postgresql://web:database-password-value@db.buildy.test/buildy?sslmode=require",
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:account-secret@db.buildy.test/buildy?sslmode=require",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:media-secret@db.buildy.test/buildy?sslmode=require",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: "1",
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    BLOB_READ_WRITE_TOKEN: "provider-check-blob-secret",
    CRON_SECRET: "provider-check-cron-secret-at-least-32-characters",
    ACCOUNT_RETENTION_POLICY_VERSION: "provider-check-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-01-01T00:00:00.000Z",
  };
  delete environment.GOOGLE_CLIENT_ID;
  delete environment.GOOGLE_CLIENT_SECRET;
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
  it.each(["preview", "staging", "production"] as const)(
    "accepts %s with core configuration and no OAuth or commerce credentials",
    (target) => {
      const result = runProviderCheck(target);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("verwacht feedback_beta/off");
      expect(result.stdout).toContain("3 unieke Neon TLS-loginrollen");
      expect(result.stdout).toContain("geen betaal- of printconfig vereist");
      expect(result.stdout).toContain("geen OAuth-provider nodig");
      expect(result.stdout).toContain("6/6 automatische checks zonder fout");
    },
  );

  it("rejects active checkout, the public demo and invite-only configuration", () => {
    for (const mode of ["test", "live"]) {
      const result = runProviderCheck("production", { CHECKOUT_MODE: mode });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("CHECKOUT_MODE moet off zijn");
    }
    const wrongProfile = runProviderCheck("preview", { PRODUCT_PROFILE: "public_demo" });
    const privateBeta = runProviderCheck("preview", { BETA_MODE: "true" });
    expect(wrongProfile.status).toBe(1);
    expect(wrongProfile.stdout).toContain("PRODUCT_PROFILE moet feedback_beta zijn");
    expect(privateBeta.status).toBe(1);
    expect(privateBeta.stdout).toContain("BETA_MODE moet false zijn");
  });

  it("requires distinct core TLS database roles", () => {
    const missingMedia = runProviderCheck("preview", { DATABASE_MEDIA_WORKER_URL: undefined });
    const sharedLogin = runProviderCheck("preview", {
      DATABASE_ACCOUNT_WORKER_URL: "postgresql://media:other-secret@db.buildy.test/buildy?sslmode=require",
    });
    const noTls = runProviderCheck("preview", {
      DATABASE_URL: "postgresql://web:test-password@db.buildy.test/buildy?sslmode=disable",
    });
    expect(missingMedia.status).toBe(1);
    expect(missingMedia.stdout).toContain("DATABASE_MEDIA_WORKER_URL ontbreekt");
    expect(sharedLogin.status).toBe(1);
    expect(sharedLogin.stdout).toContain("rollen delen dezelfde login");
    expect(noTls.status).toBe(1);
    expect(noTls.stdout).toContain("TLS ontbreekt");
  });

  it("fails closed without database, data protection or Blob and never prints configured secrets", () => {
    for (const name of ["DATABASE_URL", "PII_BLIND_INDEX_KEY", "BLOB_READ_WRITE_TOKEN"]) {
      const result = runProviderCheck("preview", { [name]: undefined });
      expect(result.status).toBe(1);
      const output = `${result.stdout}\n${result.stderr}`;
      for (const secret of [
        "database-password-value",
        "provider-check-blob-secret",
      ]) expect(output).not.toContain(secret);
    }
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

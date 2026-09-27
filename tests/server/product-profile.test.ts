// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import {
  getCapabilities,
  getProductProfile,
  getRuntimeConfig,
  resetRuntimeConfigForTests,
} from "../../server/config/runtime";

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    DATABASE_URL: "postgresql://web:secret@127.0.0.1:5432/buildy_test",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    DATABASE_ACCOUNT_WORKER_URL: "postgresql://account:secret@127.0.0.1:5432/buildy_test",
    DATABASE_MEDIA_WORKER_URL: "postgresql://media:secret@127.0.0.1:5432/buildy_test",
    DATABASE_PHOTOBOOK_WORKER_URL: "postgresql://photobook:secret@127.0.0.1:5432/buildy_test",
    ACCOUNT_RETENTION_POLICY_VERSION: "policy-v1",
    ACCOUNT_RETENTION_POLICY_APPROVED_AT: "2026-08-14T10:00:00.000Z",
    CRON_SECRET: "b".repeat(32),
    BLOB_READ_WRITE_TOKEN: `vercel_blob_rw_${"b".repeat(48)}`,
    ...overrides,
  };
}

describe("core product configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTests();
  });

  it("publishes one account app through the compatible product response", () => {
    expect(getProductProfile(configured())).toEqual({
      profile: "feedback_beta",
      checkoutMode: "off",
      betaMode: false,
      inviteRequiredForNewAccounts: false,
      capabilities: {
        passwordSignIn: true,
        emailAuth: false,
        renovations: true,
        updates: true,
        story: true,
        media: true,
        photobookPreview: true,
        sharing: true,
        feedback: true,
        accountDeletion: true,
        checkout: false,
      },
    });
    expect(getCapabilities(configured())).toMatchObject({
      email: "disabled",
      payments: "disabled",
      printFulfilment: "disabled",
      privateBeta: "disabled",
    });
  });

  it("ignores retired profile, beta, OAuth and commerce environment inputs", () => {
    const retired = {
      PRODUCT_PROFILE: "public_demo",
      CHECKOUT_MODE: "live",
      BETA_MODE: "true",
      GOOGLE_CLIENT_ID: "retired-client",
      GOOGLE_CLIENT_SECRET: "retired-secret",
      STRIPE_SECRET_KEY: "retired-secret",
      ORDER_PRICE_MATRIX_JSON: "retired-matrix",
    };
    for (const [key, value] of Object.entries(retired)) vi.stubEnv(key, value);
    resetRuntimeConfigForTests();
    const runtime = getRuntimeConfig();

    for (const key of Object.keys(retired)) expect(runtime).not.toHaveProperty(key);
    expect(getProductProfile(runtime)).toMatchObject({
      profile: "feedback_beta",
      checkoutMode: "off",
      betaMode: false,
      inviteRequiredForNewAccounts: false,
      capabilities: { emailAuth: false, checkout: false },
    });
  });

  it("keeps the digital preview available independently of processing workers", () => {
    const profile = getProductProfile(configured({
      DATABASE_MEDIA_WORKER_URL: undefined,
      DATABASE_PHOTOBOOK_WORKER_URL: undefined,
    }));

    expect(profile.capabilities.media).toBe(false);
    expect(profile.capabilities.photobookPreview).toBe(true);
  });

  it("keeps account and content capabilities unavailable without their providers", () => {
    const runtime = configured({
      DATABASE_URL: undefined,
      DATABASE_ACCOUNT_WORKER_URL: undefined,
      DATABASE_MEDIA_WORKER_URL: undefined,
      DATABASE_PHOTOBOOK_WORKER_URL: undefined,
      BLOB_READ_WRITE_TOKEN: undefined,
    });

    expect(getCapabilities(runtime)).toMatchObject({
      database: "unconfigured",
      authentication: "unconfigured",
      accountLifecycle: "unconfigured",
      media: "unconfigured",
      photobooks: "unconfigured",
    });
    expect(getProductProfile(runtime).capabilities).toMatchObject({
      passwordSignIn: false,
      renovations: false,
      updates: false,
      story: false,
      media: false,
      photobookPreview: false,
      sharing: false,
      feedback: false,
      accountDeletion: false,
      checkout: false,
    });
  });
});

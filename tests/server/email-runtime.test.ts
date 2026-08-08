// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { createEmailWorker } from "../../server/email/runtime";

function configured(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    CHECKOUT_ENABLED: false,
    DATABASE_EMAIL_WORKER_URL: "postgresql://worker:secret@127.0.0.1:5432/buildy",
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 1).toString("base64") }),
    PII_ENCRYPTION_CURRENT_VERSION: 1,
    PII_BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString("base64"),
    BREVO_API_KEY: "brevo-secret",
    BREVO_SENDER_EMAIL: "berichten@buildy.test",
    BREVO_SENDER_NAME: "Buildy",
    BREVO_TEMPLATE_IDS: JSON.stringify({
      "auth.verify_email": { id: 1, version: "test-v1" },
      "auth.magic_link": { id: 2, version: "test-v1" },
      "auth.reset_password": { id: 3, version: "test-v1" },
      "order.confirmation": { id: 4, version: "test-v1" },
      "order.payment_failed": { id: 5, version: "test-v1" },
      "order.in_production": { id: 6, version: "test-v1" },
      "order.shipped": { id: 7, version: "test-v1" },
      "order.refund_review": { id: 8, version: "test-v1" },
      "support.confirmation": { id: 9, version: "test-v1" },
      "moderation.report_received": { id: 10, version: "test-v1" },
      "lifecycle.welcome": { id: 11, version: "test-v1" },
      "social.access_requested": { id: 12, version: "test-v1" },
      "social.access_accepted": { id: 13, version: "test-v1" },
      "security.account_alert": { id: 14, version: "test-v1" },
      "migration.account": { id: 15, version: "test-v1" },
    }),
    CRON_SECRET: "c".repeat(32),
    ...overrides,
  };
}

describe("e-mail worker composition", () => {
  it("fails closed when a required auth template is absent", () => {
    let error: unknown;
    try {
      createEmailWorker(configured({
        BREVO_TEMPLATE_IDS: JSON.stringify({
          "auth.verify_email": { id: 1, version: "test-v1" },
        }),
      }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ reason: "invalid_configuration" });
  });

  it("fails closed when a required community receipt version is absent", () => {
    const templateIds = JSON.parse(configured().BREVO_TEMPLATE_IDS ?? "{}") as Record<string, unknown>;
    delete templateIds["support.confirmation"];

    let error: unknown;
    try {
      createEmailWorker(configured({ BREVO_TEMPLATE_IDS: JSON.stringify(templateIds) }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ reason: "invalid_configuration" });
  });

  it("fails closed when the worker-only database credential is absent", () => {
    let error: unknown;
    try {
      createEmailWorker(configured({ DATABASE_EMAIL_WORKER_URL: undefined }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ reason: "unconfigured" });
  });

  it("fails closed when an account lifecycle template version is absent", () => {
    const templateIds = JSON.parse(configured().BREVO_TEMPLATE_IDS ?? "{}") as Record<string, unknown>;
    delete templateIds["security.account_alert"];
    expect(() => createEmailWorker(configured({
      BREVO_TEMPLATE_IDS: JSON.stringify(templateIds),
    }))).toThrow();
  });
});

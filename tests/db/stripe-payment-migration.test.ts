// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/0015_stripe_payment_webhook.sql", import.meta.url);
const configureRolesUrl = new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url);
const verifyRolesUrl = new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url);

describe("Stripe payment webhook migration", () => {
  it("keeps the normalized webhook mutation behind one fixed-path SECURITY DEFINER function", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toMatch(
      /FUNCTION public\.app_apply_stripe_payment_event\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public/,
    );
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.app_apply_stripe_payment_event\(/);
    expect(migration).toContain("ON CONFLICT (provider, environment, provider_event_id) DO NOTHING");
    expect(migration).toContain("Stripe provider event identity collision");
  });

  it("reconciles immutable order identity, exact commercial totals and Stripe object IDs", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("selected_order.order_number IS DISTINCT FROM requested_order_number");
    expect(migration).toContain("selected_order.merchant_reference IS DISTINCT FROM requested_merchant_reference");
    expect(migration).toContain("selected_order.currency IS DISTINCT FROM requested_currency");
    expect(migration).toContain("selected_order.total_minor IS DISTINCT FROM requested_amount_total_minor");
    expect(migration).toContain("selected_order.stripe_checkout_session_id IS DISTINCT FROM requested_checkout_session_id");
    expect(migration).toContain("selected_order.stripe_payment_intent_id IS DISTINCT FROM requested_payment_intent_id");
  });

  it("records monotonic refunds and forces physical fulfilment into review without pretending Peecho is cancelled", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("refunded_minor >= 0");
    expect(migration).toContain("IF NEW.refunded_minor < OLD.refunded_minor");
    expect(migration).toContain("next_fulfilment_status := 'manual_review'");
    expect(migration).toContain("order.refund_recorded.v1");
    expect(migration).not.toContain("peecho.cancel");
  });

  it("is granted only to the dedicated payment-webhook role", async () => {
    const [configure, verify] = await Promise.all([
      readFile(configureRolesUrl, "utf8"),
      readFile(verifyRolesUrl, "utf8"),
    ]);

    expect(configure).toContain("buildy_payment_worker_role");
    expect(configure).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.app_apply_stripe_payment_event\([^\n]+\)[\s\S]{0,120}buildy_payment_worker_role/,
    );
    expect(verify).toContain("public.app_apply_stripe_payment_event(");
  });
});

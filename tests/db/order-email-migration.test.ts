// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0017_order_transactional_email.sql",
  import.meta.url,
);

describe("order transactional e-mail database boundary", () => {
  it("keeps each new privileged function fixed-path and revoked from PUBLIC", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of [
      "app_email_worker_claim",
      "app_email_worker_load_order",
      "app_email_worker_prepare",
      "app_email_worker_acknowledge",
      "app_email_worker_complete",
      "app_email_worker_fail",
      "app_enqueue_order_transactional_email",
    ]) {
      expect(migration).toMatch(new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?SET search_path = pg_catalog, public`,
      ));
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("claims only allowlisted email events under a bounded, recoverable lease", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const claim = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.app_email_worker_claim"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.app_email_worker_load_order"),
    );

    expect(claim).toContain("queued.aggregate_type = 'auth_email'");
    expect(claim).toContain("queued.aggregate_type = 'photobook_order'");
    expect(claim).toContain("'order.email.confirmation.requested.v1'");
    expect(claim).toContain("'order.email.shipped.requested.v1'");
    expect(claim).not.toContain("'photobook_order.paid.v1'");
    expect(claim).toContain("requested_lease_seconds NOT BETWEEN 30 AND 300");
    expect(claim).toContain("queued.lease_expires_at <= clock_timestamp()");
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("releases encrypted order context only for the exact active lease", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const load = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.app_email_worker_load_order"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.app_email_worker_prepare"),
    );

    expect(load).toContain("orders.customer_email_ciphertext");
    expect(load).toContain("orders.shipping_details_ciphertext");
    expect(load).toContain("queued.id = requested_event_id");
    expect(load).toContain("queued.aggregate_id");
    expect(load).toContain("queued.lease_owner = requested_lease_owner");
    expect(load).toContain("queued.lease_expires_at > clock_timestamp()");
    expect(load).not.toMatch(/decrypt|customer_email\b|address_line/i);
  });

  it("binds delivery metadata and refund mail to immutable order facts without PII", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain("selected_event.idempotency_key IS DISTINCT FROM expected_idempotency_key");
    expect(migration).toContain("selected_delivery.recipient_user_id IS DISTINCT FROM selected_recipient_user_id");
    expect(migration).toContain("NEW.source = 'stripe'");
    expect(migration).toContain("NEW.event_type = 'order.refund_recorded.v1'");
    expect(migration).toContain("'order.email.refund_review.requested.v1'");

    const trigger = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.app_enqueue_order_transactional_email"),
      migration.indexOf("CREATE TRIGGER photobook_order_events_enqueue_transactional_email"),
    );
    expect(trigger).not.toMatch(/customer_email|shipping_details|recipient|ciphertext/i);
  });
});

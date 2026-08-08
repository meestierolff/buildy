// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0016_peecho_fulfilment_worker.sql",
  import.meta.url,
);
const configureRolesUrl = new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url);
const verifyRolesUrl = new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url);

const workerFunctions = [
  "app_peecho_worker_claim",
  "app_begin_peecho_fulfilment",
  "app_begin_peecho_order_create",
  "app_persist_peecho_order_created",
  "app_begin_peecho_order_payment",
  "app_finalize_peecho_order_status",
  "app_retry_peecho_fulfilment",
  "app_mark_peecho_manual_review",
  "app_record_peecho_callback",
] as const;

describe("Peecho fulfilment migration", () => {
  it("keeps every mutation behind a fixed-path revoked SECURITY DEFINER function", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of workerFunctions) {
      expect(migration).toMatch(new RegExp(
        `FUNCTION public\\.${name}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog, public`,
      ));
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("claims only paid work under a recoverable bounded lease and preserves provider identity", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("orders.status = 'paid'");
    expect(migration).toContain("orders.payment_status = 'paid'");
    expect(migration).toContain("FOR UPDATE OF orders SKIP LOCKED");
    expect(migration).toContain("lease_seconds NOT BETWEEN 30 AND 900");
    expect(migration).toContain("Peecho order identity is immutable once recorded");
    expect(migration).toContain("orders.peecho_order_id IS NULL");
    expect(migration).toContain("peecho_create_started_at = statement_timestamp()");
  });

  it("binds create to the locked proof, private PDF metadata and immutable checkout snapshot", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("revision.status = 'locked'");
    expect(migration).toContain("pdf.detected_content_type = 'application/pdf'");
    expect(migration).toContain("pdf.sha256 = revision.pdf_sha256");
    expect(migration).toContain("revision.document_sha256 = selected_order.checkout_snapshot ->> 'documentSha256'");
    expect(migration).toContain("selected_order.checkout_snapshot ->> 'offeringId' ~ '^[1-9][0-9]{0,15}$'");
    expect(migration).toContain("selected_order.merchant_reference = 'buildy:' || selected_order.id::text");
  });

  it("separates create and pay, reconciles retries, and dead-letters ambiguous work", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("'reconcile_create'");
    expect(migration).toContain("'reconcile_payment'");
    expect(migration).toContain("peecho_payment_started_at = coalesce");
    expect(migration).toContain("fulfilment_dead_lettered_at");
    expect(migration).toContain("THEN 'manual_review'::public.fulfilment_status");
  });

  it("deduplicates signed callbacks and applies only exact, monotonic references", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("ON CONFLICT (provider, environment, provider_event_id) DO NOTHING");
    expect(migration).toContain("selected_order.peecho_order_id IS DISTINCT FROM requested_provider_order_id");
    expect(migration).toContain("selected_order.peecho_environment IS DISTINCT FROM requested_provider_environment");
    expect(migration).toContain("new_rank < current_rank");
    expect(migration).toContain("'ignored_out_of_order'");
    expect(migration).toContain("'reference_rejected'");
    expect(migration).toContain("'manual_review'");
  });

  it("emits production, shipment, and refund-review e-mail events transactionally", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("'order.email.in_production.requested.v1'");
    expect(migration).toContain("'order:' || target_order_id::text || ':email:in-production:v1'");
    expect(migration).toContain("'order.email.shipped.requested.v1'");
    expect(migration).toContain("'order.email.refund_review.requested.v1'");
  });

  it("grants only the dedicated no-table-DML role", async () => {
    const [configure, verify] = await Promise.all([
      readFile(configureRolesUrl, "utf8"),
      readFile(verifyRolesUrl, "utf8"),
    ]);

    expect(configure).toContain("buildy_fulfilment_worker_role");
    expect(configure).toContain("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public");
    for (const name of workerFunctions) {
      expect(configure).toContain(`public.${name}(`);
      expect(verify).toContain(`public.${name}(`);
    }
    expect(verify).toContain("Peecho fulfilment role can execute an out-of-bound SECURITY DEFINER function");
  });
});

// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0034_manual_print_fulfilment.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("manual print fulfilment migration", () => {
  it("introduces a provider-neutral founder queue and permanently disables claiming", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const retiredClaim = functionDefinition(migration, "app_peecho_worker_claim");

    expect(migration).toContain("CREATE TYPE public.manual_fulfilment_status AS ENUM");
    expect(migration).toContain("'ordered_manually'");
    expect(migration).toContain("DROP INDEX IF EXISTS public.photobook_orders_peecho_paid_queue_idx");
    expect(retiredClaim).toContain("automated Peecho fulfilment is retired");
    expect(retiredClaim).not.toMatch(/FOR UPDATE SKIP LOCKED|UPDATE public\.photobook_orders/);
  });

  it("keeps privileged reads and mutations behind fixed-path admin functions", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const names = [
      "app_admin_list_paid_orders",
      "app_admin_load_paid_order",
      "app_admin_list_order_events",
      "app_admin_apply_manual_fulfilment",
    ];

    for (const name of names) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(definition).toContain("admin role required");
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("binds actions to optimistic versions, idempotency and a PII-free audit summary", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const action = functionDefinition(migration, "app_admin_apply_manual_fulfilment");

    expect(action).toContain("selected_order.version <> expected_order_version");
    expect(action).toContain("manual fulfilment idempotency collision");
    expect(action).toContain("existing_event.payload_summary ->> 'requestHash'");
    expect(action).toContain("manual_tracking_url = coalesce");
    expect(action).toContain("INSERT INTO public.audit_events");
    expect(action).toContain("'hasInternalNotes'");
    expect(action).not.toMatch(/'notes'\s*,|'customerEmail'\s*,|'shippingAddress'\s*,/);
  });

  it("guards manual state and sends verified refunds to founder review", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const guard = functionDefinition(migration, "guard_manual_photobook_fulfilment");

    expect(guard).toContain("public.app_actor_moderation_role()");
    expect(guard).toContain("NEW.manual_fulfilment_status := 'refund_review'");
    expect(guard).toContain("manual fulfilment state is admin owned");
    expect(guard).toContain("invalid manual fulfilment transition");
    expect(migration).toContain("CREATE TRIGGER photobook_orders_guard_manual_fulfilment");
  });

  it("grants only the manual admin boundary and leaves the retired worker empty", async () => {
    const [configure, verify] = await Promise.all([
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
    ]);

    expect(configure).toContain(
      "public.app_admin_apply_manual_fulfilment(uuid, integer, text, text, text, text, text, text, text)",
    );
    expect(configure).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.app_(?:peecho|begin_peecho|persist_peecho|retry_peecho|mark_peecho|record_peecho)/);
    expect(verify).toContain("retired Peecho-fulfilment function remains executable");
    expect(verify).toContain("public.app_admin_list_paid_orders(text,timestamptz,uuid,integer)");
  });
});

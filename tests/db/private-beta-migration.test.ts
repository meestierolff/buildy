// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { productEventNames } from "../../shared/contracts/beta";

const migrationUrl = new URL(
  "../../db/migrations/0021_private_beta_product_events.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("private beta and product event migration", () => {
  it("stores only hashes, locks invite usage and completes signup atomically", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const reserve = functionDefinition(migration, "app_reserve_beta_invite");
    const complete = functionDefinition(migration, "app_complete_beta_signup");

    expect(migration).toContain("code_hash");
    expect(migration).toContain("reservation_token_hash");
    expect(migration).not.toMatch(/ADD COLUMN (invite_code|reservation_token)\b/);
    expect(reserve).toContain("pg_advisory_xact_lock");
    expect(reserve).toContain("FOR UPDATE");
    expect(complete).toContain("FOR UPDATE");
    expect(complete).toContain("invite.use_count + 1");
    expect(complete).toContain("auth_identity_mappings");
    expect(complete).toContain("beta.invite_redeemed");
  });

  it("defines all 18 exact events with an append-only RLS table", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const eventName of productEventNames) expect(migration).toContain(`'${eventName}'`);
    expect(productEventNames).toHaveLength(18);
    expect(migration).toContain("CREATE TABLE public.product_events");
    expect(migration).toContain("ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE TRIGGER product_events_append_only");
    expect(migration).not.toMatch(/CREATE POLICY .*product_events/i);
  });

  it("allows browsers to submit only four exact, privacy-minimal shapes", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const record = functionDefinition(migration, "app_record_client_product_event");
    const properties = functionDefinition(migration, "app_product_event_properties_valid");
    expect(record).toContain(
      "'signup_started', 'project_shared', 'photobook_opened', 'error_encountered'",
    );
    expect(properties).not.toMatch(/address|caption|photo_url|signed_url|display_name|comment_content|access_token|pdf_path/i);
    expect(record).not.toMatch(/address|caption|photo_url|signed_url|display_name|comment_content|access_token|pdf_path/i);
  });

  it("revokes every SECURITY DEFINER helper from PUBLIC", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const signature of [
      "app_create_beta_invite(uuid, text, text, integer, timestamptz, text, text)",
      "app_revoke_beta_invite(text, text)",
      "app_reserve_beta_invite(text, text, text, text, text, text)",
      "app_complete_beta_signup(text, text, text, text)",
      "app_record_client_product_event(uuid, text, text, jsonb)",
      "app_capture_product_event()",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC`);
    }
  });

  it("wires signup and product events to web-only grants while invite management stays owner-only", async () => {
    const [router, configure, verify] = await Promise.all([
      readFile(new URL("../../server/http/router.ts", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
    ]);

    expect(router).toContain('registerRoute("POST", "/api/beta/reservations"');
    expect(router).toContain('registerRoute("POST", "/api/product-events"');
    expect(configure).toContain("public.app_reserve_beta_invite(text, text, text, text, text, text)");
    expect(configure).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.app_create_beta_invite/);
    expect(verify).toContain("public.app_create_beta_invite(uuid,text,text,integer,timestamptz,text,text)");
    expect(verify).toContain("public.app_product_event_properties_valid(text,jsonb)");
  });
});

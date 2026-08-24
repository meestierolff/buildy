// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0042_active_worker_retry_enum_casts.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Functie ${name} ontbreekt in migratie 0042.`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe("active worker retry enum repair migration", () => {
  it("types every active retry and dead-letter CASE branch explicitly", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(functionDefinition(migration, "app_account_worker_fail_export"))
      .toMatch(/'dead_letter'::public\.export_job_status[\s\S]*'retry_scheduled'::public\.export_job_status/);
    expect(functionDefinition(migration, "app_account_worker_fail_export_cleanup"))
      .toMatch(/'dead_letter'::public\.export_job_status[\s\S]*'expired'::public\.export_job_status/);
    expect(functionDefinition(migration, "app_fail_photobook_render"))
      .toMatch(/'failed'::public\.photobook_proof_status[\s\S]*'rendering'::public\.photobook_proof_status[\s\S]*'dead_letter'::public\.outbox_status[\s\S]*'retry'::public\.outbox_status/);
    expect(functionDefinition(migration, "app_account_worker_fail_deletion"))
      .toMatch(/'failed'::public\.deletion_asset_status[\s\S]*'retry'::public\.deletion_asset_status[\s\S]*'manual_review'::public\.deletion_status[\s\S]*'dead_letter'::public\.deletion_status[\s\S]*'retry_scheduled'::public\.deletion_status/);
  });

  it("keeps every repaired SECURITY DEFINER boundary off PUBLIC", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of [
      "app_account_worker_fail_export",
      "app_account_worker_fail_export_cleanup",
      "app_fail_photobook_render",
      "app_account_worker_fail_deletion",
    ]) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });
});

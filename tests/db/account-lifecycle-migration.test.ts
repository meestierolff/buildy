// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/0014_account_lifecycle_jobs.sql", import.meta.url);
const configureRolesUrl = new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url);
const verifyRolesUrl = new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url);

const webFunctions = [
  "app_request_account_export",
  "app_request_account_deletion",
] as const;

const workerFunctions = [
  "app_account_worker_claim_export",
  "app_account_worker_begin_export",
  "app_account_worker_finalize_export",
  "app_account_worker_fail_export",
  "app_account_worker_claim_expired_export",
  "app_account_worker_finalize_export_cleanup",
  "app_account_worker_fail_export_cleanup",
  "app_account_worker_claim_deletion",
  "app_account_worker_begin_deletion",
  "app_account_worker_verify_deletion_asset",
  "app_account_worker_fail_deletion",
  "app_account_worker_finalize_deletion",
] as const;

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Functie ${name} ontbreekt in de migratie.`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
}

describe("account lifecycle migration", () => {
  it("fixeert search_path en verwijdert PUBLIC execute voor iedere privileged boundary", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of [...webFunctions, ...workerFunctions]) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("bindt browseraanvragen aan app_actor_id, idempotency en actieve accounts", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of webFunctions) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("actor uuid := public.app_actor_id()");
      expect(definition).toContain("account.status = 'active'");
      expect(definition).toContain("account.deleted_at IS NULL");
      expect(definition).toContain("scoped_idempotency_key !~ '^[0-9a-f]{64}$'");
    }
    expect(functionDefinition(migration, "app_request_account_export"))
      .toContain("job.user_id = actor");
    expect(functionDefinition(migration, "app_request_account_export"))
      .toContain("'account.export_requested'");
    expect(functionDefinition(migration, "app_request_account_deletion"))
      .toContain("job.requested_by_id = actor");
  });

  it("maakt accountverwijdering uitsluitend pending en voert geen hard delete in het request uit", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const request = functionDefinition(migration, "app_request_account_deletion");

    expect(request).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(request).toContain("lifecycle_status = 'deletion_pending'");
    expect(request).toContain("status = 'deletion_pending'");
    expect(request).toContain("INSERT INTO public.deletion_assets");
    expect(request).toContain("asset_manifest_sha256 = manifest_hash");
    expect(request).toContain("status = 'deleted'");
    expect(request).toContain("failure_code = 'ACCOUNT_DELETION'");
    expect(request).toContain("'account.deletion_requested'");
  });

  it("blokkeert fail-closed op actieve orders, zowel bij aanvraag als bij finale redactie", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const classifier = functionDefinition(migration, "app_account_order_is_active");
    const request = functionDefinition(migration, "app_request_account_deletion");
    const finalize = functionDefinition(migration, "app_account_worker_finalize_deletion");

    expect(classifier).toContain("SELECT NOT (");
    expect(classifier).toContain("fulfilment_status = 'delivered'");
    expect(request).toContain("public.app_account_order_is_active(orders)");
    expect(request).toContain("'blocked_active_order'");
    expect(request).toContain("'account.deletion_blocked'");
    expect(finalize).toContain("public.app_account_order_is_active(orders)");
    expect(finalize).toContain("RETURN 'blocked_active_order'");
  });

  it("claimt werk met leases en SKIP LOCKED en ondersteunt retry/dead-letter en exportexpiry", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of [
      "app_account_worker_claim_export",
      "app_account_worker_claim_expired_export",
      "app_account_worker_claim_deletion",
    ]) {
      const claim = functionDefinition(migration, name);
      expect(claim).toContain("SKIP LOCKED");
      expect(claim).toContain("lease_expires_at");
      expect(claim).toContain("lease_seconds NOT BETWEEN 30 AND 900");
    }
    expect(migration).toContain("'retry_scheduled'");
    expect(migration).toContain("'dead_letter'");
    expect(functionDefinition(migration, "app_account_worker_finalize_export"))
      .toContain("expires_at = statement_timestamp() + interval '7 days'");
    expect(functionDefinition(migration, "app_account_worker_finalize_export_cleanup"))
      .toContain("status = 'deleted'");
  });

  it("bouwt exports uit checksummed private objectmetadata en publiceert een manifestchecksum", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const begin = functionDefinition(migration, "app_account_worker_begin_export");
    const finalize = functionDefinition(migration, "app_account_worker_finalize_export");

    expect(begin).toContain("'storageProvider', asset.storage_provider");
    expect(begin).toContain("'objectKey', asset.object_key");
    expect(begin).toContain("'sizeBytes', asset.size_bytes");
    expect(begin).toContain("'sha256', asset.sha256");
    expect(begin).toContain("asset.status = 'ready'");
    expect(finalize).toContain("archive_sha256 !~ '^[0-9a-f]{64}$'");
    expect(finalize).toContain("archive_manifest_sha256 !~ '^[0-9a-f]{64}$'");
    expect(finalize).toContain("manifest_sha256 = archive_manifest_sha256");
  });

  it("geeft web en accountworker alleen hun eigen functies en geen tabel-DML", async () => {
    const [configure, verify] = await Promise.all([
      readFile(configureRolesUrl, "utf8"),
      readFile(verifyRolesUrl, "utf8"),
    ]);

    expect(configure).toContain("buildy_account_worker_role");
    for (const name of webFunctions) {
      expect(configure).toContain(`public.${name}(`);
      expect(verify).toContain(`public.${name}(`);
    }
    for (const name of workerFunctions) {
      expect(configure).toContain(`public.${name}(`);
      expect(verify).toContain(`public.${name}(`);
    }
    expect(verify).toContain("a worker role has direct table privileges");
    expect(verify).toContain("account-worker function grant is incomplete or cross-exposed");
  });
});

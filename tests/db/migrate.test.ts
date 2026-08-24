// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  MigrationValidationError,
  discoverMigrations,
  parseMigrationArguments,
  parseMigrationFilename,
  planMigrations,
  requireMigrationDatabaseUrl,
  validateMigrationDatabaseUrl,
  validateMigrationSql,
  type MigrationFile,
} from "../../db/migrate.ts";
import {
  EXPECTED_PUBLIC_TABLES,
  EXPECTED_RLS_TABLES,
  compareExpectedNames,
} from "../../db/verify.ts";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "buildy-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}

function makeMigration(
  filename: string,
  sequence: number,
  sha256 = createHash("sha256").update(filename).digest("hex"),
): MigrationFile {
  return {
    filename,
    path: `/migrations/${filename}`,
    sequence,
    sha256,
    byteLength: 9,
    sql: "SELECT 1;",
  };
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("migration discovery", () => {
  it("accepts canonical prefixes and rejects ambiguous leading zeroes", () => {
    expect(parseMigrationFilename("0001_initial.sql")).toEqual({ sequence: 1, name: "initial" });
    expect(parseMigrationFilename("10000_next.sql")).toEqual({ sequence: 10_000, name: "next" });
    expect(() => parseMigrationFilename("00001_ambiguous.sql")).toThrow(/geldige positieve volgorde/);
  });

  it("validates the checked-in production migrations", async () => {
    const migrations = await discoverMigrations(DEFAULT_MIGRATIONS_DIRECTORY);

    expect(migrations.map((migration) => migration.filename)).toEqual([
      "0001_production_foundation.sql",
      "0002_auth_rate_limits.sql",
      "0003_auth_identity_boundary.sql",
      "0004_media_processing_boundary.sql",
      "0005_email_delivery_worker.sql",
      "0006_engagement_visibility_hardening.sql",
      "0007_planning_privacy_hardening.sql",
      "0008_security_definer_public_boundary.sql",
      "0009_photobook_proof_worker.sql",
      "0010_profile_account_hardening.sql",
      "0011_comment_tombstone_rls.sql",
      "0012_media_object_key_traversal_guard.sql",
      "0013_photobook_checkout_boundary.sql",
      "0014_account_lifecycle_jobs.sql",
      "0015_stripe_payment_webhook.sql",
      "0016_peecho_fulfilment_worker.sql",
      "0017_order_transactional_email.sql",
      "0018_moderation_support_feedback.sql",
      "0019_account_social_transactional_email.sql",
      "0020_project_deletion_saga.sql",
      "0021_private_beta_product_events.sql",
      "0022_moderation_admin_rbac.sql",
      "0023_profile_onboarding_completion.sql",
      "0024_update_deletion_saga.sql",
      "0025_lifecycle_function_repairs.sql",
      "0026_lifecycle_constraint_and_export_fix.sql",
      "0027_auth_and_account_email_repairs.sql",
      "0028_account_email_prepare_fix.sql",
      "0029_onboarding_event_properties_fix.sql",
      "0030_product_event_and_reaction_visibility_fix.sql",
      "0031_project_deletion_asset_scope_fix.sql",
      "0032_audit_event_clock_timestamp.sql",
      "0033_google_oidc_sessions.sql",
      "0034_manual_print_fulfilment.sql",
      "0035_canonical_social_connections.sql",
      "0036_project_visibility_modes.sql",
      "0037_vercel_blob_storage_default.sql",
      "0038_retire_automated_email.sql",
      "0039_profile_follow_event_status_fix.sql",
      "0040_request_driven_media_processing.sql",
      "0041_request_driven_photobook_processing.sql",
      "0042_active_worker_retry_enum_casts.sql",
      "0043_vercel_blob_account_exports.sql",
      "0044_bounded_media_orphan_maintenance.sql",
      "0045_request_hash_privacy.sql",
      "0046_checkout_reservation_recovery.sql",
      "0047_project_share_links.sql",
      "0048_feedback_admin_review.sql",
      "0049_product_notifications.sql",
    ]);
    expect(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.sha256))).toBe(true);
  });

  it("orders numeric prefixes correctly across four and five digits", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "10000_later.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "9999_earlier.sql"), "SELECT 1;\n");

    const migrations = await discoverMigrations(directory);

    expect(migrations.map((migration) => migration.filename)).toEqual([
      "9999_earlier.sql",
      "10000_later.sql",
    ]);
  });

  it("hashes the exact migration bytes", async () => {
    const directory = await createTemporaryDirectory();
    const sql = "SELECT 'bouwboek';\n";
    await writeFile(join(directory, "0001_exact_bytes.sql"), sql);

    const [migration] = await discoverMigrations(directory);

    expect(migration?.sha256).toBe(createHash("sha256").update(Buffer.from(sql)).digest("hex"));
    expect(migration?.byteLength).toBe(Buffer.byteLength(sql));
  });

  it("rejects duplicate sequences", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;");
    await writeFile(join(directory, "0001_second.sql"), "SELECT 2;");

    await expect(discoverMigrations(directory)).rejects.toThrow(/meer dan eenmaal/);
  });

  it("rejects symlinked migrations", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "0001_real.sql"), "SELECT 1;");
    await symlink("0001_real.sql", join(directory, "0002_link.sql"));

    await expect(discoverMigrations(directory)).rejects.toThrow(/regulier bestand/);
  });

  it.each([
    ["1_too_short.sql", "SELECT 1;"],
    ["0001_BAD.sql", "SELECT 1;"],
    ["0001_empty.sql", "   \n"],
  ])("rejects invalid migration file %s", async (filename, sql) => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, filename), sql);

    await expect(discoverMigrations(directory)).rejects.toBeInstanceOf(MigrationValidationError);
  });
});

describe("SQL validation", () => {
  it("allows procedural transaction words inside dollar quotes", () => {
    const sql = `
      -- COMMIT and ALTER SYSTEM are comments here.
      CREATE FUNCTION public.example_trigger()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        NEW.note := 'BEGIN; COMMIT; ALTER SYSTEM';
        RETURN NEW;
      END;
      $function$;
    `;

    expect(() => validateMigrationSql("0001_function.sql", sql)).not.toThrow();
  });

  it.each([
    "BEGIN; CREATE TABLE example(id integer); COMMIT;",
    "CREATE DATABASE forbidden;",
    "ALTER SYSTEM SET statement_timeout = 0;",
    "SET statement_timeout = 0;",
    "CREATE INDEX CONCURRENTLY example_idx ON example(id);",
    "VACUUM example;",
    "TRUNCATE example;",
    "SELECT pg_advisory_xact_lock(1);",
    "DELETE FROM buildy_meta.schema_migrations;",
  ])("rejects forbidden top-level SQL: %s", (sql) => {
    expect(() => validateMigrationSql("0001_forbidden.sql", sql)).toThrow(/verboden|runnerledger|advisory/);
  });

  it("rejects psql meta commands", () => {
    expect(() => validateMigrationSql("0001_psql.sql", "\\set ON_ERROR_STOP on\nSELECT 1;"))
      .toThrow(/psql-metacommand/);
  });

  it("requires a fixed search_path for SECURITY DEFINER", () => {
    expect(() =>
      validateMigrationSql(
        "0001_unsafe_function.sql",
        "CREATE FUNCTION public.unsafe() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;",
      ),
    ).toThrow(/search_path/);

    expect(() =>
      validateMigrationSql(
        "0001_safe_function.sql",
        "CREATE FUNCTION public.safe() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT 1 $$;",
      ),
    ).not.toThrow();
  });
});

describe("migration ledger reconciliation", () => {
  const first = makeMigration("0001_first.sql", 1);
  const second = makeMigration("0002_second.sql", 2);

  it("is an idempotent no-op for matching ledger hashes", () => {
    const plan = planMigrations(
      [first, second],
      [
        { filename: first.filename, sequence: first.sequence, sha256: first.sha256 },
        { filename: second.filename, sequence: String(second.sequence), sha256: second.sha256 },
      ],
    );

    expect(plan.applied).toEqual([first, second]);
    expect(plan.pending).toEqual([]);
  });

  it("refuses a changed applied hash", () => {
    expect(() =>
      planMigrations(
        [first],
        [{ filename: first.filename, sequence: first.sequence, sha256: "f".repeat(64) }],
      ),
    ).toThrow(/Hash.*gewijzigd/);
  });

  it("refuses missing or renamed applied files", () => {
    expect(() =>
      planMigrations(
        [first],
        [{ filename: "0002_removed.sql", sequence: 2, sha256: "a".repeat(64) }],
      ),
    ).toThrow(/ontbreekt lokaal/);
  });

  it("refuses a pending migration below applied history", () => {
    expect(() =>
      planMigrations(
        [first, second],
        [{ filename: second.filename, sequence: second.sequence, sha256: second.sha256 }],
      ),
    ).toThrow(/staat vóór/);
  });

  it("refuses unsorted or duplicate local input defensively", () => {
    expect(() => planMigrations([second, first], [])).toThrow(/unieke, oplopende/);
    expect(() =>
      planMigrations([first, { ...first, filename: "0001_duplicate.sql" }], []),
    ).toThrow(/unieke, oplopende/);
  });
});

describe("migration URL and CLI boundaries", () => {
  it("never falls back to DATABASE_URL", () => {
    expect(() =>
      requireMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://runtime:secret@localhost/buildy",
      }),
    ).toThrow(/DATABASE_MIGRATION_URL is verplicht/);
  });

  it("allows local development without TLS but requires TLS remotely", () => {
    expect(
      validateMigrationDatabaseUrl("postgresql://migrator:secret@127.0.0.1/buildy"),
    ).toContain("127.0.0.1");
    expect(() =>
      validateMigrationDatabaseUrl("postgresql://migrator:secret@db.example.com/buildy"),
    ).toThrow(/sslmode/);
    expect(
      validateMigrationDatabaseUrl(
        "postgresql://migrator:secret@db.example.com/buildy?sslmode=verify-full",
      ),
    ).toContain("verify-full");
  });

  it("rejects pooled endpoints", () => {
    expect(() =>
      validateMigrationDatabaseUrl(
        "postgresql://migrator:secret@ep-pooler.example.com/buildy?sslmode=require",
      ),
    ).toThrow(/pooled endpoint/);
  });

  it("parses exactly one execution mode and bounded timeouts", () => {
    expect(parseMigrationArguments(["--dry-run", "--lock-timeout-ms", "2500"])).toEqual({
      mode: "dry-run",
      lockTimeoutMs: 2500,
    });
    expect(() => parseMigrationArguments(["--check", "--dry-run"])).toThrow(/één runner mode/);
    expect(() => parseMigrationArguments(["--statement-timeout-ms", "0"])).toThrow(/tussen 1/);
  });

  it("keeps the schema contract at 53 public and 45 RLS tables", () => {
    expect(EXPECTED_PUBLIC_TABLES).toHaveLength(53);
    expect(EXPECTED_RLS_TABLES).toHaveLength(45);
    expect(() => compareExpectedNames("test", ["one"], ["one"])).not.toThrow();
    expect(() => compareExpectedNames("test", ["one"], ["two"])).toThrow(/ontbreekt.*onverwacht/);
  });
});

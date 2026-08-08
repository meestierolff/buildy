// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL("../../db/migrations/0005_email_delivery_worker.sql", import.meta.url);

describe("e-mail delivery worker database boundary", () => {
  it("keeps every privileged function on a fixed search path and revoked from PUBLIC", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const functions = [
      "app_email_worker_claim",
      "app_email_worker_prepare",
      "app_email_worker_acknowledge",
      "app_email_worker_complete",
      "app_email_worker_fail",
      "app_apply_brevo_delivery_event",
      "app_ingest_brevo_delivery_event",
      "app_reconcile_brevo_delivery_events",
    ];

    for (const name of functions) {
      const definition = new RegExp(
        `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog, public`,
      );
      expect(migration).toMatch(definition);
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${name}\\(`));
    }
  });

  it("claims only protected auth e-mail events and bounds every lease input", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("queued.aggregate_type = 'auth_email'");
    expect(migration).toContain("requested_lease_seconds NOT BETWEEN 30 AND 300");
    expect(migration).toContain("requested_batch_size NOT BETWEEN 1 AND 25");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("stores a PII-free Brevo summary and applies provider events idempotently", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const ingestStart = migration.indexOf("CREATE OR REPLACE FUNCTION app_ingest_brevo_delivery_event");
    const ingestEnd = migration.indexOf("CREATE OR REPLACE FUNCTION app_reconcile_brevo_delivery_events");
    const ingest = migration.slice(ingestStart, ingestEnd);

    expect(ingest).toContain("ON CONFLICT (provider, environment, provider_event_id) DO NOTHING");
    expect(ingest).toContain("'schemaVersion', 1");
    expect(ingest).toContain("'eventAt', requested_event_at");
    expect(ingest).toContain("'eventStatus', requested_event_type");
    expect(ingest).not.toMatch(/requested_(recipient|email|subject)/);
  });
});

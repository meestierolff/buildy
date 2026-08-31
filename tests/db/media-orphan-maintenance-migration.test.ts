// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0044_bounded_media_orphan_maintenance.sql",
  import.meta.url,
);

describe("bounded media orphan maintenance migration", () => {
  it("seeds only privacy-free purpose checkpoints in the existing outbox", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("media.orphan_cleanup.maintenance.v1");
    expect(migration).toContain("media-orphan-cleanup:v1:temporary");
    expect(migration).toContain("media-orphan-cleanup:v1:originals");
    expect(migration).toContain("media-orphan-cleanup:v1:display");
    expect(migration).not.toMatch(/email|address|owner_id|user_id/i);
  });

  it("claims with an exact purpose, lease and SKIP LOCKED boundary", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("app_media_worker_claim_orphan_cleanup(");
    expect(migration).toContain("requested_purpose NOT IN ('temporary', 'originals', 'display')");
    expect(migration).toContain("event.lease_expires_at <= clock_timestamp()");
    expect(migration).toContain("FOR UPDATE OF event SKIP LOCKED");
    expect(migration).toContain("char_length(event.payload ->> 'cursor') BETWEEN 1 AND 2048");
  });

  it("persists resumable cursors and typed retry/dead-letter outcomes lease-safely", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("app_media_worker_finalize_orphan_cleanup(");
    expect(migration).toContain("'cursor', CASE");
    expect(migration).toContain("event.lease_owner = worker_identifier");
    expect(migration).toContain("event.lease_expires_at > clock_timestamp()");
    expect(migration).toContain("'dead_letter'::public.outbox_status");
    expect(migration).toContain("'retry'::public.outbox_status");
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(3);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(3);
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(3);
  });
});

// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/0009_photobook_proof_worker.sql", import.meta.url);
const configureRolesUrl = new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url);
const verifyRolesUrl = new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url);

const workerFunctions = [
  "app_photobook_worker_claim",
  "app_begin_photobook_render",
  "app_finalize_photobook_render",
  "app_fail_photobook_render",
] as const;

describe("photobook proof worker migration", () => {
  it("uses fixed-search-path SECURITY DEFINER functions with no PUBLIC execute grant", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const name of workerFunctions) {
      expect(migration).toMatch(new RegExp(
        `FUNCTION public\\.${name}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog, public`,
      ));
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("claims only current canonical render events with a bounded lease", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain("event.aggregate_type = 'photobook_proof'");
    expect(migration).toContain("event.event_type = 'photobook.proof.requested.v1'");
    expect(migration).toContain("revision.status = 'rendering'");
    expect(migration).toContain("draft.document_sha256 = revision.document_sha256");
    expect(migration).toContain("FOR UPDATE OF event SKIP LOCKED");
    expect(migration).toContain("lease_seconds NOT BETWEEN 30 AND 900");
  });

  it("exposes only immutable original source objects and finalizes asset, revision and outbox atomically", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).toContain("asset.object_key LIKE 'originals/%'");
    expect(migration).toContain("asset.sha256 = selected_revision.document #>>");
    expect(migration).toContain("asset.original_asset_id IS NULL");
    expect(migration).toContain("asset.status = 'ready'");
    expect(migration).toContain("status = 'ready'");
    expect(migration).toContain("font_set_sha256 = rendered_font_set_sha256");
    expect(migration).toContain("status = 'delivered'");
    expect(migration).toContain("photobook worker lease lost");
  });

  it("grants the functions only to the dedicated no-table-DML worker role", async () => {
    const [configure, verify] = await Promise.all([
      readFile(configureRolesUrl, "utf8"),
      readFile(verifyRolesUrl, "utf8"),
    ]);
    expect(configure).toContain("buildy_photobook_worker_role");
    for (const name of workerFunctions) {
      expect(configure).toMatch(new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\([^\\n]+buildy_photobook_worker_role`,
      ));
      expect(verify).toContain(`public.${name}(`);
    }
    expect(verify).toContain("a worker role has direct table privileges");
  });
});

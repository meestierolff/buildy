// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("avatar worker migration", () => {
  it("extends both claim paths only for account-scoped avatars and preserves leased restricted workers", async () => {
    const migration = await readFile(new URL("../../db/migrations/0057_avatar_upload_processing.sql", import.meta.url), "utf8");
    expect(migration.match(/asset.project_id IS NULL AND asset.purpose = 'avatar'/g)).toHaveLength(2);
    expect(migration.match(/asset.project_id IS NOT NULL AND asset.purpose IN \('project_media', 'project_cover', 'floorplan'\)/g)).toHaveLength(2);
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(3);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(3);
    expect(migration).toContain("AND media_assets.project_id IS NOT DISTINCT FROM excluded.project_id");
    expect(migration).toContain("AND event.lease_owner = worker_identifier");
    expect(migration).toContain("AND event.lease_expires_at > clock_timestamp()");
    expect(migration).toContain("AND asset.original_asset_id IS NULL");
    expect(migration).not.toMatch(/\b(?:GRANT|DROP|ALTER TABLE)\b/);
  });
});

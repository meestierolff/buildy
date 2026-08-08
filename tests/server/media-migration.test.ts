// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/0004_media_processing_boundary.sql", import.meta.url);

describe("least-privilege media processing database boundary", () => {
  it("keeps every worker helper SECURITY DEFINER, fixed-search-path and non-public", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const functions = [
      "app_claim_outbox_event(text, text, integer)",
      "app_ack_outbox_event(text, uuid)",
      "app_retry_outbox_event(text, uuid, text, integer, boolean)",
      "app_begin_media_processing_job(text, uuid)",
      "app_media_protected_object_keys(text[])",
      "app_finalize_media_processing_job(text, uuid, uuid, text, text, bigint, text, integer, integer, jsonb)",
      "app_fail_media_processing_job(text, uuid, uuid, text, integer, boolean)",
    ];

    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(functions.length);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(functions.length);
    for (const signature of functions) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    }
  });

  it("cannot claim, acknowledge or dead-letter another domain's outbox events", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain(
      "requested_event_type IS DISTINCT FROM 'media.processing.requested.v1'",
    );
    expect(migration.match(/event\.aggregate_type = 'media'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration.match(/event\.event_type = 'media\.processing\.requested\.v1'/g)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(migration).not.toMatch(/auth\.email\.|social\.|provider\./);
  });

  it("rejects nullable leases and incomplete derivative manifests before publishing", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("OR lease_seconds IS NULL");
    expect(migration.match(/OR retry_delay_seconds IS NULL/g)).toHaveLength(2);
    expect(migration).toContain("OR derivative_records IS NULL");
    expect(migration).toContain("OR NOT (derivative ?& ARRAY[");
    expect(migration).toContain("OR derivative ->> 'widthPixels' IS NULL");
    expect(migration).toContain("OR derivative ->> 'heightPixels' IS NULL");
  });

  it("hides draft attachments from non-owners in both attachment and asset policies", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("DROP POLICY media_select_visible ON media_assets;");
    expect(migration).toContain("DROP POLICY update_media_select_visible ON update_media;");
    expect(migration.match(/project_update\.status = 'published'/g)).toHaveLength(2);
    expect(migration).toContain(
      "attachment.media_asset_id = coalesce(media_assets.original_asset_id, media_assets.id)",
    );
  });
});

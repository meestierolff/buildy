// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/0004_media_processing_boundary.sql", import.meta.url);
const requestDrivenMigrationUrl = new URL(
  "../../db/migrations/0040_request_driven_media_processing.sql",
  import.meta.url,
);

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

  it("adds a non-public exact-asset claim without granting table access", async () => {
    const migration = await readFile(requestDrivenMigrationUrl, "utf8");

    expect(migration).toContain("app_claim_media_processing_asset(");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public");
    expect(migration).toContain("event.aggregate_id = target_asset_id");
    expect(migration).toContain("event.event_type = 'media.processing.requested.v1'");
    expect(migration).toContain("asset.status = 'uploaded'");
    expect(migration).toContain("asset.status = 'processing'");
    expect(migration).toContain("event.available_at <= clock_timestamp()");
    expect(migration).toContain("event.lease_expires_at <= clock_timestamp()");
    expect(migration).toContain("'failed'::public.media_status");
    expect(migration).toContain("'uploaded'::public.media_status");
    expect(migration).toContain("'dead_letter'::public.outbox_status");
    expect(migration).toContain("'retry'::public.outbox_status");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.app_claim_media_processing_asset(text, uuid, integer) FROM PUBLIC;",
    );
    expect(migration).not.toMatch(/GRANT\s+[^;]*\s+ON\s+(?:ALL\s+)?TABLES?/i);
  });
});

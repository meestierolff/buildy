// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0041_request_driven_photobook_processing.sql",
  import.meta.url,
);

describe("request-driven Bouwboek proof migration", () => {
  it("adds one fixed-search-path SECURITY DEFINER claim with no PUBLIC access", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toMatch(
      /FUNCTION public\.app_photobook_worker_claim_revision\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public/,
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.app_photobook_worker_claim_revision(text, uuid, integer) FROM PUBLIC;",
    );
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)/i);
  });

  it("binds the claim to the exact canonical rendering revision and event payload", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("revision.id = target_revision_id");
    expect(migration).toContain("event.aggregate_id = target_revision_id");
    expect(migration).toContain("event.payload ->> 'revisionId' = target_revision_id::text");
    expect(migration).toContain("revision.status = 'rendering'");
    expect(migration).toContain("draft.document_sha256 = revision.document_sha256");
    expect(migration).toContain("draft.status = 'rendering'");
    expect(migration).toContain("project.lifecycle_status = 'active'");
    expect(migration).toContain("project.deleted_at IS NULL");
  });

  it("keeps due-time, bounded-lease and concurrent-claim guards intact", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("lease_seconds NOT BETWEEN 30 AND 900");
    expect(migration).toContain("event.available_at <= clock_timestamp()");
    expect(migration).toContain("event.lease_expires_at <= clock_timestamp()");
    expect(migration).toContain("FOR UPDATE OF event SKIP LOCKED");
    expect(migration).toContain("event.attempt_count + 1");
  });
});

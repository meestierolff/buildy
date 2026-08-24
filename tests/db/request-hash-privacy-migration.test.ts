// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../db/migrations/0045_request_hash_privacy.sql", import.meta.url),
  "utf8",
);

describe("0045 request-hash privacy migration", () => {
  it("redacts only pre-v2 fingerprints for every content-bearing event family", () => {
    for (const eventType of [
      "project.created.v1",
      "project.update.created.v1",
      "profile.updated.v1",
      "engagement.comment.created.v1",
      "floorplan.pin.updated.v1",
      "budget.item.updated.v1",
      "media.upload.intent.created.v1",
      "photobook.proof.requested.v1",
      "photobook.proof.approved.v1",
    ]) expect(migration).toContain(`'${eventType}'`);

    expect(migration).toContain("event.payload ->> 'requestHashVersion' IS DISTINCT FROM '2'");
    expect(migration).toContain("event.payload - ARRAY['requestHash', 'requestHashVersion']::text[]");
    expect(migration).toContain("'LEGACY_UNKEYED_FINGERPRINT'");
  });

  it("scrubs keyed hashes on account and project erasure through owner-only fixed-path triggers", () => {
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = pg_catalog, public");
    expect(migration).toContain("app_redact_request_hashes_on_account_erasure");
    expect(migration).toContain("app_redact_request_hashes_on_project_erasure");
    expect(migration).toContain("app_users_redact_request_hashes_on_erasure");
    expect(migration).toContain("projects_redact_request_hashes_on_erasure");
    expect(migration).toContain("'ACCOUNT_ERASURE'");
    expect(migration).toContain("'PROJECT_ERASURE'");
    expect(migration.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(2);
  });

  it("redacts only the checkout request fingerprint during nested account erasure", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.guard_photobook_order_transition()");
    expect(migration).toContain("pg_trigger_depth() > 1");
    expect(migration).toContain("account.status = 'deleted'");
    expect(migration).toContain("account.deleted_at IS NOT NULL");
    expect(migration).toContain(
      "OLD.checkout_snapshot - ARRAY['requestHash', 'requestHashScheme']::text[]",
    );
    expect(migration).toContain("'requestHashRedacted', true");
    expect(migration).toContain("'requestHashRedactionReason', 'ACCOUNT_ERASURE'");
    expect(migration).toContain(
      "REVOKE EXECUTE ON FUNCTION public.guard_photobook_order_transition() FROM PUBLIC",
    );

    const orderUpdate = migration.match(
      /UPDATE public\.photobook_orders orders\s+SET ([\s\S]+?)\s+WHERE orders\.owner_id = NEW\.id/,
    )?.[1];
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate).toContain("checkout_snapshot =");
    expect(orderUpdate).toContain("version = orders.version + 1");
    expect(orderUpdate).toContain("updated_at = statement_timestamp()");
    for (const immutableColumn of [
      "owner_id",
      "project_id",
      "proof_revision_id",
      "status",
      "payment_status",
      "seller_snapshot",
      "terms_version",
      "legal_accepted_at",
      "total_minor",
    ]) {
      expect(orderUpdate).not.toMatch(new RegExp(`\\b${immutableColumn}\\s*=`));
    }
  });

  it("requires v2 markers in the narrow engagement and profile insert policies", () => {
    expect(migration).toContain("payload ->> 'requestHashVersion' = '2'");
    expect(migration).toContain("outbox_events_insert_engagement_comment");
    expect(migration).toContain("outbox_events_insert_profile_mutation");
  });
});

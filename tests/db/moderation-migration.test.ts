// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../../db/migrations/0018_moderation_support_feedback.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("moderation/support/feedback migration", () => {
  it("keeps every privileged operation fixed-path and revoked from PUBLIC", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const functions = [
      "app_moderation_target_visible",
      "app_replay_moderation_report",
      "app_submit_moderation_report",
      "app_replay_feedback_submission",
      "app_submit_feedback_submission",
      "app_email_worker_load_community_receipt",
    ];

    for (const name of functions) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("removes direct browser inserts and stores new free text/contact only as ciphertext", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("DROP POLICY IF EXISTS moderation_reports_insert_self");
    expect(migration).toContain("DROP POLICY IF EXISTS feedback_insert_self");
    expect(migration).toContain("details_ciphertext text");
    expect(migration).toContain("target_snapshot_ciphertext text");
    expect(migration).toContain("message_ciphertext text");
    expect(migration).toContain("contact_ciphertext text");
    expect(migration).toContain("reporter_contact_ciphertext");
    expect(migration).toContain("requested_reason, NULL");
    expect(migration).toContain("NULL, requested_message_ciphertext");
    expect(migration).toContain("LIKE 'v1.%'");
  });

  it("uses PII-free, versioned, exact receipt events", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const reportSubmit = functionDefinition(migration, "app_submit_moderation_report");
    const feedbackSubmit = functionDefinition(migration, "app_submit_feedback_submission");

    expect(reportSubmit).toContain("'moderation.report.received.requested.v1'");
    expect(reportSubmit).toContain("'reportId', selected_report.id");
    expect(reportSubmit).toContain("'receiptCode', selected_report.receipt_code");
    expect(feedbackSubmit).toContain("'support.confirmation.requested.v1'");
    expect(feedbackSubmit).toContain("'submissionId', selected_submission.id");
    expect(feedbackSubmit).toContain("'kind', selected_submission.kind");
    expect(feedbackSubmit).toContain("'receiptCode', selected_submission.receipt_code");
    for (const definition of [reportSubmit, feedbackSubmit]) {
      const outboxSection = definition.slice(definition.indexOf("INSERT INTO public.outbox_events"));
      expect(outboxSection).not.toMatch(/contactEmail|messageCiphertext|contactCiphertext|detailsCiphertext/);
    }
  });

  it("loads receipt recipients only through an exact, unexpired worker lease", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const loader = functionDefinition(migration, "app_email_worker_load_community_receipt");

    expect(loader).toContain("aggregate_type text");
    expect(loader).toContain("aggregate_id uuid");
    expect(loader).toContain("recipient_ciphertext text");
    expect(loader).toContain("contact_hash text");
    expect(loader).toContain("kind text");
    expect(loader).toContain("created_at timestamptz");
    expect(loader).toContain("target_type text");
    expect(loader).toContain("category text");
    expect(loader).toContain("queued.status = 'claimed'");
    expect(loader).toContain("queued.lease_owner = requested_lease_owner");
    expect(loader).toContain("queued.lease_expires_at > clock_timestamp()");
    expect(loader).toContain("queued.payload = jsonb_build_object(");
    expect(loader).toContain("submission.kind IN ('support', 'third_party_request', 'appeal')");
  });

  it("exposes only the role-gated moderation admin boundary", async () => {
    const router = await readFile(new URL("../../server/http/router.ts", import.meta.url), "utf8");

    expect(router).not.toContain("/api/moderation/actions");
    expect(router).toContain("/api/moderation/admin");
  });
});

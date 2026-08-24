// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0048_feedback_admin_review.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("feedback admin review migration", () => {
  it("keeps the queue metadata-only and confines ciphertext to the detail function", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const queue = functionDefinition(migration, "app_admin_list_feedback_submissions");
    const detail = functionDefinition(migration, "app_admin_load_feedback_submission");

    expect(queue).toContain("receipt_code text");
    expect(queue).toContain("has_contact boolean");
    expect(queue).toContain("(submission.created_at, submission.id) < (cursor_created_at, cursor_id)");
    expect(queue).toContain("ELSE 'other'");
    expect(queue).not.toMatch(/message_ciphertext text|contact_ciphertext text|contact_hash|request_hash|route text|submitted_by_id uuid/);
    expect(detail).toContain("message_ciphertext text");
    expect(detail).toContain("contact_ciphertext text");
    expect(detail).not.toMatch(/contact_hash|request_hash|source_fingerprint_hash|idempotency_key/);
  });

  it("requires an exact admin role in every SECURITY DEFINER feedback boundary", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const functions = [
      "app_admin_list_feedback_submissions",
      "app_admin_load_feedback_submission",
      "app_admin_list_feedback_reviews",
      "app_admin_update_feedback_status",
    ];
    for (const name of functions) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(definition).toContain("IS DISTINCT FROM 'admin'::public.app_role_kind");
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("uses optimistic idempotent transitions with PII-free append-only audit metadata", async () => {
    const [migration, schema] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(new URL("../../db/schema/operations.ts", import.meta.url), "utf8"),
    ]);
    const update = functionDefinition(migration, "app_admin_update_feedback_status");

    expect(update).toContain("pg_advisory_xact_lock");
    expect(update).toContain("feedback review idempotency collision");
    expect(update).toContain("selected_submission.version <> requested_expected_version");
    expect(update).toContain("replay_review.actor_id IS DISTINCT FROM actor_user_id");
    expect(update).toContain("selected_submission.status = 'new' AND next_status = 'triaged'");
    expect(update).toContain("INSERT INTO public.feedback_submission_reviews");
    expect(update).toContain("INSERT INTO public.audit_events");
    expect(update).toContain("'feedback.review.status_changed'");
    expect(update).not.toMatch(/jsonb_build_object\([\s\S]*(message|contact|email|ciphertext|receipt_code)/i);
    expect(migration).toContain("feedback_submission_reviews_append_only");
    expect(migration).toContain(
      "ON public.feedback_submission_reviews (submission_id, created_at, id)",
    );
    expect(schema).toMatch(
      /feedback_submission_reviews_submission_idx[\s\S]{0,180}table\.submissionId,[\s\S]{0,80}table\.createdAt,[\s\S]{0,80}table\.id/,
    );
    expect(migration).toContain("ALTER TABLE public.feedback_submission_reviews ENABLE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/CREATE POLICY[^;]+feedback_submission_reviews/i);
  });

  it("scrubs only subject-linked feedback when account deletion removes its owner", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const erasure = functionDefinition(migration, "guard_feedback_submission_account_erasure");

    expect(erasure).toContain("OLD.submitted_by_id IS NULL");
    expect(erasure).toContain("public.app_actor_id() IS DISTINCT FROM OLD.submitted_by_id");
    expect(erasure).toContain("account.status IN ('deletion_pending', 'deleted')");
    expect(erasure).toContain("NEW.message := '[verwijderd na accountverwijdering]'");
    for (const field of [
      "message_ciphertext",
      "contact_ciphertext",
      "contact_hash",
      "idempotency_key",
      "request_hash",
      "source_fingerprint_hash",
      "screenshot_asset_id",
    ]) {
      expect(erasure).toContain(`NEW.${field} := NULL`);
    }
    expect(migration).toContain("BEFORE UPDATE OF submitted_by_id ON public.feedback_submissions");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.guard_feedback_submission_account_erasure()");
  });

  it("wires the admin API into composition, least-privilege grants and schema verification", async () => {
    const [composition, router, configure, verifyRoles, verifyDatabase] = await Promise.all([
      readFile(new URL("../../server/composition.ts", import.meta.url), "utf8"),
      readFile(new URL("../../server/http/router.ts", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../db/verify.ts", import.meta.url), "utf8"),
    ]);

    expect(composition).toContain("configureDefaultFeedbackAdminRuntime");
    expect(router).toContain('registerPrefixRoute("/api/admin/feedback"');
    expect(configure).toContain("public.app_admin_update_feedback_status(uuid, uuid, text, integer, text, text, text)");
    expect(verifyRoles).toContain("public.app_admin_update_feedback_status(uuid,uuid,text,integer,text,text,text)");
    expect(verifyRoles).toContain("public.guard_feedback_submission_account_erasure()");
    expect(verifyDatabase).toContain('"feedback_submission_reviews"');
    expect(verifyDatabase).toContain('"feedback_submissions_guard_account_erasure"');
  });
});

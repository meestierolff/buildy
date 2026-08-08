// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const orderEmailMigrationUrl = new URL(
  "../../db/migrations/0017_order_transactional_email.sql",
  import.meta.url,
);
const configureRolesUrl = new URL(
  "../../scripts/setup/configure-database-roles.sql",
  import.meta.url,
);
const verifyRolesUrl = new URL(
  "../../scripts/setup/verify-database-roles.sql",
  import.meta.url,
);
const routerUrl = new URL("../../server/http/router.ts", import.meta.url);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("community transactional e-mail boundary", () => {
  it("claims, prepares and finalizes only the two allowlisted receipt intents", async () => {
    const migration = await readFile(orderEmailMigrationUrl, "utf8");
    const claim = functionDefinition(migration, "app_email_worker_claim");
    const prepare = functionDefinition(migration, "app_email_worker_prepare");

    for (const definition of [
      claim,
      functionDefinition(migration, "app_email_worker_acknowledge"),
      functionDefinition(migration, "app_email_worker_complete"),
      functionDefinition(migration, "app_email_worker_fail"),
    ]) {
      expect(definition).toContain("queued.aggregate_type = 'moderation_report'");
      expect(definition).toContain("queued.event_type = 'moderation.report.received.requested.v1'");
      expect(definition).toContain("queued.aggregate_type = 'feedback_submission'");
      expect(definition).toContain("queued.event_type = 'support.confirmation.requested.v1'");
    }

    expect(prepare).toContain("'moderation.report_received'");
    expect(prepare).toContain("'support.confirmation'");
    expect(prepare).toContain("selected_event.payload = jsonb_build_object(");
    expect(prepare).toContain("submission.kind IN ('support', 'third_party_request', 'appeal')");
  });

  it("grants the leased PII loader only to the isolated e-mail worker", async () => {
    const [configure, verify, router] = await Promise.all([
      readFile(configureRolesUrl, "utf8"),
      readFile(verifyRolesUrl, "utf8"),
      readFile(routerUrl, "utf8"),
    ]);
    const signature = "public.app_email_worker_load_community_receipt(uuid, text)";

    expect(configure).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO %I`);
    expect(configure).toContain(`REVOKE EXECUTE ON FUNCTION ${signature} FROM %I, %I, %I, %I, %I, %I`);
    expect(verify).toContain("public.app_email_worker_load_community_receipt(uuid,text)");
    expect(router).toContain("and has_function_privilege(current_user, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')");
    expect(router.match(/not has_function_privilege\(current_user, 'public\.app_email_worker_load_community_receipt\(uuid,text\)'/g))
      .toHaveLength(6);
  });
});

// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../db/migrations/0047_project_share_links.sql", import.meta.url);
const roleConfigUrl = new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url);
const roleVerifyUrl = new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url);

function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  const end = sql.indexOf("--> statement-breakpoint", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("project share-link database boundary", () => {
  it("stores only keyed hashes and enables owner-scoped RLS without breaking definer mutations", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const table = migration.slice(
      migration.indexOf("CREATE TABLE public.project_share_links"),
      migration.indexOf("CREATE UNIQUE INDEX project_share_links_token_hash_uq"),
    );

    expect(table).toContain("token_hash text NOT NULL");
    expect(table).not.toMatch(/\braw_token\b|\bshare_token\b|\btoken\s+text\b/);
    expect(table).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("ALTER TABLE public.project_share_links ENABLE ROW LEVEL SECURITY");
    expect(migration).not.toContain("ALTER TABLE public.project_share_links FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("USING (owner_id = public.app_actor_id())");
  });

  it("makes a project UUID insufficient and revalidates the exact current grant per statement", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const canView = functionBody(
      migration,
      "CREATE OR REPLACE FUNCTION public.app_can_view_project",
    );

    expect(canView).toContain("share_link.id = public.app_share_link_id()");
    expect(canView).toContain("share_link.project_id = project.id");
    expect(canView).toContain("share_link.owner_id = project.owner_id");
    expect(canView).toContain("share_link.revoked_at IS NULL");
    expect(canView).toContain("share_link.expires_at > statement_timestamp()");
    expect(canView).toContain("owner_account.status = 'active'");
    expect(canView).toContain("project.lifecycle_status = 'active'");
    expect(canView).toContain("NOT public.app_users_are_blocked(public.app_actor_id(), project.owner_id)");
  });

  it("invalidates immediately on project/account state and never audits secret material", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const issue = functionBody(migration, "CREATE FUNCTION public.app_issue_project_share_link(");
    const revoke = functionBody(migration, "CREATE FUNCTION public.app_revoke_project_share_link(");

    expect(migration).toContain("CREATE TRIGGER projects_invalidate_share_links");
    expect(migration).toContain("AFTER UPDATE OF visibility, lifecycle_status ON public.projects");
    expect(migration).toContain("CREATE TRIGGER app_users_invalidate_project_share_links");
    expect(migration).toContain("DELETE FROM public.project_share_links link WHERE link.owner_id = NEW.id");
    expect(issue).toContain("'project.share_link_created'");
    expect(issue).not.toMatch(/jsonb_build_object\([^)]*(?:token|hash|idempotency)/is);
    expect(revoke).not.toMatch(/jsonb_build_object\([^)]*(?:token|hash|idempotency)/is);
  });

  it("rechecks create/rotate and revoke idempotency after the project lock", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const issue = functionBody(migration, "CREATE FUNCTION public.app_issue_project_share_link(");
    const revoke = functionBody(migration, "CREATE FUNCTION public.app_revoke_project_share_link(");

    const issueLock = issue.indexOf("PERFORM pg_advisory_xact_lock");
    const issueReplayReads = [...issue.matchAll(/issue_idempotency_hash = requested_idempotency_hash/g)]
      .map((match) => match.index ?? -1);
    expect(issueReplayReads).toHaveLength(2);
    expect(issueReplayReads[0]).toBeLessThan(issueLock);
    expect(issueReplayReads[1]).toBeGreaterThan(issueLock);

    const revokeLock = revoke.indexOf("PERFORM pg_advisory_xact_lock");
    const revokeReplayReads = [...revoke.matchAll(/AND link\.revoke_idempotency_hash = requested_idempotency_hash/g)]
      .map((match) => match.index ?? -1);
    expect(revokeReplayReads).toHaveLength(2);
    expect(revokeReplayReads[0]).toBeLessThan(revokeLock);
    expect(revokeReplayReads[1]).toBeGreaterThan(revokeLock);

    const revokeActiveAccountCheck = revoke.indexOf("account.status = 'active'");
    expect(revokeActiveAccountCheck).toBeGreaterThanOrEqual(0);
    expect(revokeActiveAccountCheck).toBeLessThan(revokeReplayReads[0]);
  });

  it("grants only the typed mutation/redeem functions to web and keeps context helpers owner-internal", async () => {
    const [migration, roles, verification] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(roleConfigUrl, "utf8"),
      readFile(roleVerifyUrl, "utf8"),
    ]);
    const signatures = [
      "public.app_issue_project_share_link(uuid,uuid,text,timestamptz,integer,text,text,text,text)",
      "public.app_revoke_project_share_link(uuid,integer,text,text,text)",
      "public.app_redeem_project_share_link(text)",
    ];

    for (const signature of signatures) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      expect(roles.replaceAll(" ", "")).toContain(`('${signature}')`);
      expect(verification).toContain(`('${signature}', 'web')`);
    }
    expect(roles).not.toContain("('public.app_share_link_id()')");
    expect(verification).toContain("('public.app_share_link_id()')");
  });
});

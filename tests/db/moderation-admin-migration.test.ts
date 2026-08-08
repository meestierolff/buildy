// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0022_moderation_admin_rbac.sql",
  import.meta.url,
);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("moderation admin RBAC migration", () => {
  it("uses expiring app-role grants without hardcoded identities", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const resolver = functionDefinition(migration, "app_resolve_moderation_actor");

    expect(migration).toContain("CREATE TYPE public.app_role_kind AS ENUM ('moderator', 'admin')");
    expect(migration).toContain("CREATE TABLE public.app_role_grants");
    expect(resolver).toContain("mapping.auth_user_id = subject_auth_user_id");
    expect(resolver).toContain("app_user.status = 'active'");
    expect(resolver).toContain("role_grant.revoked_at IS NULL");
    expect(resolver).toContain("role_grant.expires_at > statement_timestamp()");
    expect(migration).not.toMatch(/@[A-Za-z0-9.-]+|hardcoded|allowlist_email/i);
  });

  it("keeps every privileged function fixed-path and revoked from PUBLIC", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const functions = [
      "app_moderation_target_hidden",
      "app_moderation_media_hidden",
      "app_actor_moderation_role",
      "app_resolve_moderation_actor",
      "app_moderation_target_owner",
      "app_admin_list_moderation_reports",
      "app_admin_load_moderation_report",
      "app_admin_list_moderation_actions",
      "app_admin_apply_moderation_action",
      "app_migration_grant_role",
      "app_migration_revoke_role",
    ];

    for (const name of functions) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("keeps queue rows PII-free and ciphertext on the explicit detail boundary", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const queue = functionDefinition(migration, "app_admin_list_moderation_reports");
    const detail = functionDefinition(migration, "app_admin_load_moderation_report");

    expect(queue).toContain("receipt_code text");
    expect(queue).toContain("target_hidden boolean");
    expect(queue).toContain("(report.created_at, report.id) < (cursor_created_at, cursor_id)");
    expect(queue).not.toMatch(/reporter_contact|contact_hash|details_ciphertext|target_snapshot_ciphertext|route/);
    expect(detail).toContain("details_ciphertext text");
    expect(detail).toContain("target_snapshot_ciphertext text");
    expect(detail).not.toContain("reporter_contact_ciphertext");
  });

  it("applies optimistic idempotent actions with audit events and exact reversals", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const action = functionDefinition(migration, "app_admin_apply_moderation_action");

    expect(action).toContain("pg_advisory_xact_lock");
    expect(action).toContain("moderation action idempotency collision");
    expect(action).toContain("selected_report.version <> requested_expected_report_version");
    expect(action).toContain("replay_action.actor_id IS DISTINCT FROM actor_user_id");
    expect(action).toContain("original_action.reversed_by_action_id IS NOT NULL");
    expect(action).toContain("SET reversed_by_action_id = requested_action_id");
    expect(action).toContain("INSERT INTO public.audit_events");
    expect(action).toContain("'moderation.action.' || requested_kind");
    expect(action).not.toMatch(/jsonb_build_object\([\s\S]*requested_reason_ciphertext/);
  });

  it("removes hidden content from owner, grant and derivative read paths and restores state explicitly", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("NOT public.app_moderation_target_hidden('profile', target.id)");
    expect(migration).toContain("NOT public.app_moderation_target_hidden('project', project.id)");
    expect(migration).toContain("NOT public.app_moderation_target_hidden('update', item.id)");
    expect(migration).toContain("NOT app_moderation_target_hidden('comment', id)");
    expect(migration).toContain("NOT app_moderation_media_hidden(id)");
    expect(migration).toContain("target_state.target_type = 'update'");
    expect(migration).toContain("project_private_owner_all");
    expect(migration).toContain("app_owns_project(project_id)");
    expect(migration).toContain("SET state = 'visible'");
  });

  it("revokes sessions and write identity on suspension/block while retaining a reversible account state", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const action = functionDefinition(migration, "app_admin_apply_moderation_action");

    expect(action).toContain("requested_kind IN ('suspend', 'block') AND actor_role <> 'admin'");
    expect(action).toContain("SET status = 'suspended'");
    expect(action).toContain("authz_version = authz_version + 1");
    expect(action).toContain("DELETE FROM public.auth_sessions session");
    expect(action).toContain("INSERT INTO public.moderation_account_restrictions");
    expect(action).toContain("SET status = 'active'");
  });

  it("keeps grant/revoke migration-owner functions idempotent and audited", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const grant = functionDefinition(migration, "app_migration_grant_role");
    const revoke = functionDefinition(migration, "app_migration_revoke_role");

    expect(grant).toContain("role grant idempotency collision");
    expect(grant).toContain("'app_role.granted'");
    expect(revoke).toContain("revocation_operation_id IS DISTINCT FROM requested_revocation_operation_id");
    expect(revoke).toContain("cannot revoke last active admin");
    expect(revoke).toContain("'app_role.revoked'");
  });

  it("wires the admin API to web-only grants while role mutation stays owner-only", async () => {
    const [router, configure, verify] = await Promise.all([
      readFile(new URL("../../server/http/router.ts", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
    ]);

    expect(router).toContain('registerPrefixRoute("/api/moderation/admin"');
    expect(configure).toContain("public.app_admin_apply_moderation_action(uuid, uuid, text, text, text, text, integer, uuid, text)");
    expect(configure).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.app_migration_(grant|revoke)_role/);
    expect(verify).toContain("public.app_migration_grant_role(uuid,uuid,text,text,text,timestamptz,timestamptz)");
    expect(verify).toContain("public.app_migration_revoke_role(uuid,uuid,text,text)");
  });
});

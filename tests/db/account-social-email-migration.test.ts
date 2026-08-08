// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0019_account_social_transactional_email.sql",
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
const migrationCliUrl = new URL("../../scripts/migration/buildy-migrate.ts", import.meta.url);

function functionDefinition(migration: string, name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = migration.indexOf("--> statement-breakpoint", start);
  return migration.slice(start, end < 0 ? migration.length : end);
}

describe("account and social transactional e-mail migration", () => {
  it("keeps every privileged producer and loader fixed-path and non-public", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const functions = [
      "app_register_auth_email_recipient",
      "app_set_social_access_email_preference",
      "app_require_email_recipient_before_first_auth",
      "app_enqueue_welcome_email",
      "app_enqueue_project_access_email",
      "app_enqueue_account_security_email",
      "app_enqueue_migration_account_email",
      "app_email_worker_claim",
      "app_email_worker_load_account_event",
      "app_email_worker_prepare_account",
      "app_email_worker_acknowledge",
      "app_email_worker_complete",
      "app_email_worker_fail",
    ];
    for (const name of functions) {
      const definition = functionDefinition(migration, name);
      expect(definition).toContain("SECURITY DEFINER");
      expect(definition).toContain("SET search_path = pg_catalog, public");
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    }
  });

  it("emits all five PII-free, idempotent lifecycle intents", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    for (const value of [
      "lifecycle.welcome.requested.v1",
      "social.access_requested.requested.v1",
      "social.access_accepted.requested.v1",
      "security.account_alert.requested.v1",
      "migration.account.requested.v1",
    ]) expect(migration).toContain(`'${value}'`);

    expect(migration).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
    expect(migration).toContain("mapping.legacy_provider = 'legacy_auth'");
    expect(migration).toContain("OLD.last_authenticated_at IS NULL");
    expect(migration).toContain("app_users_require_email_recipient_before_first_auth");
    expect(migration).toContain("project_access_requests_enqueue_email");
    expect(migration).toContain("deletion_jobs_enqueue_security_email");
    expect(migration).toContain("current_setting('app.migration_mode', true) = 'on'");
    expect(migration).toContain("pg_catalog.pg_has_role(");
    expect(migration).toContain("session_user");
    expect(migration).not.toContain("'recipientEmail'");
    expect(migration).not.toContain("'recipientCiphertext'");
    expect(migration).not.toContain("'recipientHash'");
  });

  it("releases protected context only for the exact unexpired worker lease", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const loader = functionDefinition(migration, "app_email_worker_load_account_event");
    const prepare = functionDefinition(migration, "app_email_worker_prepare_account");
    expect(loader).toContain("lease_owner");
    expect(loader).toContain("lease_expires_at > clock_timestamp()");
    expect(prepare).toContain("lease_owner");
    expect(prepare).toContain("lease_expires_at <= clock_timestamp()");
    expect(loader).toContain("recipient.recipient_ciphertext");
    expect(loader).toContain("recipient.social_access_enabled");
    expect(prepare).toContain("requested_recipient_hash IS DISTINCT FROM selected_recipient_hash");
  });

  it("grants only registration/preferences to web and loaders to the e-mail role", async () => {
    const [configure, verify, router] = await Promise.all([
      readFile(configureRolesUrl, "utf8"),
      readFile(verifyRolesUrl, "utf8"),
      readFile(routerUrl, "utf8"),
    ]);
    const loader = "public.app_email_worker_load_account_event(uuid, text)";
    const prepare = "public.app_email_worker_prepare_account(uuid, text, text, text, text, text)";

    expect(configure).toContain(`GRANT EXECUTE ON FUNCTION ${loader} TO %I`);
    expect(configure).toContain(`GRANT EXECUTE ON FUNCTION ${prepare} TO %I`);
    expect(configure).toContain("GRANT EXECUTE ON FUNCTION public.app_register_auth_email_recipient(text, text, text) TO %I");
    expect(configure).not.toContain("GRANT EXECUTE ON FUNCTION public.app_enqueue_migration_account_email");
    expect(verify).toContain("public.app_enqueue_migration_account_email(uuid,text,text)");
    expect(router).toContain("and has_function_privilege(current_user, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')");
    expect(router.match(/not has_function_privilege\(current_user, 'public\.app_email_worker_load_account_event\(uuid,text\)'/g))
      .toHaveLength(6);
  });

  it("keeps migration account production gated and address-free in CLI output", async () => {
    const migrationCli = await readFile(migrationCliUrl, "utf8");
    expect(migrationCli).toContain('case "enqueue-migration-account-mails"');
    expect(migrationCli).toContain("assertTargetWriteAuthorized");
    expect(migrationCli).toContain("recipientAddressesLogged: false");
    expect(migrationCli).toContain("record.email");
    expect(migrationCli).not.toMatch(/log\([^)]*record\.email/s);
  });
});

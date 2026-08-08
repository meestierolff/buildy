// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0006_engagement_visibility_hardening.sql",
  import.meta.url,
);
const globalHardeningUrl = new URL(
  "../../db/migrations/0008_security_definer_public_boundary.sql",
  import.meta.url,
);
const engagementRepositoryUrl = new URL(
  "../../server/engagement/repository.ts",
  import.meta.url,
);
const socialRepositoryUrl = new URL(
  "../../server/social/repository.ts",
  import.meta.url,
);

describe("engagement database boundary", () => {
  it("fixes every definer search path and removes implicit PUBLIC execution", async () => {
    const [migration, globalHardening] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(globalHardeningUrl, "utf8"),
    ]);
    const definers = [
      "app_can_view_profile",
      "app_can_view_update",
      "app_can_manage_comment",
      "app_can_view_notification_target",
      "app_lock_social_user_pair",
      "app_follow_state_allowed",
      "app_social_project_context",
      "app_resolve_engagement_mentions",
      "app_enqueue_social_notification",
      "app_enqueue_engagement_notification",
    ];

    for (const name of definers) {
      expect(migration).toMatch(new RegExp(
        `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog, public`,
      ));
    }

    expect(globalHardening).toContain("procedure.prosecdef");
    expect(globalHardening).toContain("REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC");
    for (const name of definers) {
      expect(migration).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${name}\\(`));
    }
    for (const trigger of [
      "guard_comment_identity()",
      "guard_notification_recipient_update()",
      "guard_project_follower_identity()",
    ]) {
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION ${trigger} FROM PUBLIC;`);
    }
  });

  it("keeps app_users self-only while public-profile reads use the lifecycle-aware helper", async () => {
    const [migration, engagementRepository, socialRepository] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(engagementRepositoryUrl, "utf8"),
      readFile(socialRepositoryUrl, "utf8"),
    ]);

    const profileBoundary = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app_can_view_profile"),
      migration.indexOf("CREATE OR REPLACE FUNCTION app_can_view_update"),
    );
    expect(profileBoundary).toContain("target.status = 'active'");
    expect(profileBoundary).toContain("target.deleted_at IS NULL");
    expect(profileBoundary).toContain("profile.is_private = false");
    expect(profileBoundary).toContain("relationship.status = 'active'");
    expect(engagementRepository).not.toMatch(/\b(?:from|join)\s+app_users\b/i);
    expect(socialRepository).not.toMatch(/\b(?:from|join)\s+app_users\b/i);
  });

  it("gates comments and reactions on update publication and permits only one-way deletion", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const updateBoundary = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app_can_view_update"),
      migration.indexOf("CREATE OR REPLACE FUNCTION app_can_manage_comment"),
    );
    const commentGuard = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION guard_comment_identity"),
      migration.indexOf("DROP TRIGGER IF EXISTS comments_guard_identity"),
    );

    expect(updateBoundary).toContain("project.owner_id = public.app_actor_id()");
    expect(updateBoundary).toContain("item.status = 'published'");
    expect(migration).toContain("CREATE POLICY updates_select_visible");
    expect(migration).toContain("app_can_view_update(update_id, project_id)");
    expect(commentGuard).toContain("comments may only transition once to deleted");
    expect(commentGuard).toContain("comment author deletion must redact the body");
    expect(commentGuard).toContain("project owner may moderate but not rewrite a comment");
    expect(migration).toContain("CREATE POLICY reactions_insert_self");
  });

  it("derives notification identity, target and PII-free outbox data inside the database", async () => {
    const [migration, repository] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(engagementRepositoryUrl, "utf8"),
    ]);
    const notificationBoundary = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION app_enqueue_engagement_notification"),
      migration.indexOf("-- Direct notification/outbox inserts remain denied"),
    );

    expect(migration).not.toMatch(/CREATE POLICY\s+\w+\s+ON notifications\s+FOR INSERT/i);
    expect(notificationBoundary).toContain("actor_user uuid := public.app_actor_id()");
    expect(notificationBoundary).toContain("expected_recipient IS DISTINCT FROM notification_recipient");
    expect(notificationBoundary).toContain("unsupported engagement notification type");
    expect(notificationBoundary).toContain("jsonb_build_object('schemaVersion', 1)");
    expect(notificationBoundary).not.toMatch(/jsonb_build_object\([^)]*(?:email|display_name|body|slug)/i);
    expect(repository).toContain("select app_enqueue_engagement_notification(");
    expect(repository).not.toMatch(/\.insert\(notifications\)/);
  });

  it("binds notification state changes to the recipient and prevents unread resurrection", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const notificationGuard = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION guard_notification_recipient_update"),
      migration.indexOf("CREATE OR REPLACE FUNCTION app_can_view_notification_target"),
    );

    expect(migration).toContain("recipient_id = app_actor_id()");
    expect(migration).toContain("app_can_view_notification_target(actor_id, project_id, update_id, comment_id)");
    expect(notificationGuard).toContain("OLD.status = 'archived'");
    expect(notificationGuard).toContain("NEW.status NOT IN ('read', 'archived')");
    expect(notificationGuard).toContain("NEW.read_at IS NULL");
  });
});

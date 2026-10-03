// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("accepted user-follow publication notifications", () => {
  it("extends subscriptions without extending visibility or function grants", async () => {
    const migration = await readFile(new URL("../../db/migrations/0055_user_follow_publication_notifications.sql", import.meta.url), "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.app_enqueue_first_update_publication_notifications()");
    expect(migration).toContain("SET search_path = pg_catalog, public");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).not.toContain("GRANT ");
    expect(migration).not.toContain("CREATE POLICY");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.app_can_view_project");
    expect(migration).toContain("profile_follow.kind = 'follow'");
    expect(migration).toContain("profile_follow.status = 'active'");
    expect(migration).toContain("project.visibility = 'public'");
    expect(migration).toContain("project.visibility = 'followers'");
    expect(migration).not.toContain("project.visibility = 'private'");
    expect(migration).not.toContain("project.visibility = 'unlisted'");
    for (const guard of [
      "recipient.status = 'active'", "recipient.deleted_at IS NULL",
      "app_users_are_blocked(recipient.id, project.owner_id)",
      "app_users_are_blocked(recipient.id, NEW.author_id)",
      "app_moderation_target_hidden('profile', recipient.id)",
      "app_moderation_target_hidden('project', NEW.project_id)",
      "app_moderation_target_hidden('update', NEW.id)",
    ]) expect(migration).toContain(guard);
  });

  it("deduplicates both subscription paths, respects mutes and does not replay edits", async () => {
    const migration = await readFile(new URL("../../db/migrations/0055_user_follow_publication_notifications.sql", import.meta.url), "utf8");
    expect(migration).toContain("\n      UNION\n");
    expect(migration).not.toContain("UNION ALL");
    expect(migration).toContain("project_mute.follower_id = recipient.id");
    expect(migration).toContain("project_mute.status = 'muted'");
    expect(migration).toContain("AND NOT EXISTS (");
    expect(migration).toContain("OLD.status = 'published'::public.update_status");
    expect(migration).toContain("ON CONFLICT DO NOTHING");
    expect(migration).toContain("ON CONFLICT (idempotency_key) DO NOTHING");
  });
});

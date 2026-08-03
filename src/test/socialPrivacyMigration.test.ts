import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715120000_social_privacy_hardening.sql"),
  "utf8",
);

const securityFixMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260724130000_fix_social_security_and_notifications.sql"),
  "utf8",
);

const friendAccessMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260803154500_fix_private_profile_friend_access.sql"),
  "utf8",
);

describe("social privacy migration contract", () => {
  it("enforces status = pending on INSERT for follows and user_follows", () => {
    expect(securityFixMigration).toContain("WITH CHECK (auth.uid() = user_id AND status = 'pending')");
    expect(securityFixMigration).toContain("WITH CHECK (auth.uid() = follower_id AND status = 'pending')");
  });

  it("allows accepted friends in either direction to view private profiles", () => {
    expect(friendAccessMigration).toContain("(uf.following_id = p.user_id AND uf.follower_id = auth.uid())");
    expect(friendAccessMigration).toContain("(uf.follower_id = p.user_id AND uf.following_id = auth.uid())");
    expect(friendAccessMigration).toContain("AND uf.status = 'accepted'");
  });


  it("does not let a profile follow grant access to a private project", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.user_can_view_trip");
    const end = migration.indexOf("REVOKE ALL ON FUNCTION public.user_can_view_trip", start);
    const functionSql = migration.slice(start, end);

    expect(functionSql).toContain("public.follows");
    expect(functionSql).not.toContain("user_follows");
    expect(functionSql).toContain("f.status = 'accepted'");
  });

  it("routes follow writes through scoped RPCs", () => {
    expect(migration).toContain("REVOKE INSERT, UPDATE ON public.follows FROM authenticated");
    expect(migration).toContain("REVOKE INSERT, UPDATE ON public.user_follows FROM authenticated");
    expect(migration).toContain("public.respond_to_project_follow");
    expect(migration).toContain("public.respond_to_user_follow");
    expect(migration).toContain("CREATE TRIGGER trg_accept_project_follows_when_public");
  });

  it("does not expose pending project requests to other accepted viewers", () => {
    const start = migration.indexOf('CREATE POLICY "Project follows visible to participants and viewers"');
    const end = migration.indexOf("-- ---------------------------------------------------------------------------", start);
    const policySql = migration.slice(start, end);

    expect(policySql).toContain("auth.uid() = user_id");
    expect(policySql).toContain("t.user_id = auth.uid()");
    expect(policySql).toContain("status = 'accepted' AND public.can_view_trip(project_id)");
  });

  it("does not enumerate a private profile through a public follow endpoint", () => {
    const start = migration.indexOf('CREATE POLICY "Visible accepted user follows"');
    const end = migration.indexOf('DROP POLICY IF EXISTS "Follows readable', start);
    const policySql = migration.slice(start, end);

    expect(policySql).toContain("public.can_view_profile(follower_id)\n      AND public.can_view_profile(following_id)");
    expect(policySql).not.toContain("public.can_view_profile(follower_id)\n      OR public.can_view_profile(following_id)");
  });

  it("protects step and trip visual assets in the private bucket", () => {
    expect(migration).toContain("VALUES (\n  'trip-private'");
    expect(migration).toContain("(storage.foldername(name))[2] = 'trip-assets'");
    expect(migration).toContain('CREATE POLICY "trip-private: owner can delete"');
    expect(migration).toContain("THEN public.can_view_trip(((storage.foldername(name))[3])::uuid)");
    expect(migration).toContain("EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid())");
    expect(migration).toContain("'avatars',\n  'avatars',\n  true,\n  10485760");
    expect(migration).toContain("storage.filename(name) ~* '^avatar-[ab]\\.(jpg|jpeg|png|webp|gif)$'");
    expect(migration).not.toContain('CREATE POLICY "Users upload avatars in trip-media"');
  });

  it("keeps the production media inventory recursive and read-only", () => {
    const inventory = readFileSync(
      resolve(process.cwd(), "scripts/inventory-private-assets.mjs"),
      "utf8",
    );

    expect(inventory).toContain('collectBucketObjects("trip-media")');
    expect(inventory).toContain('collectBucketObjects("avatars")');
    expect(inventory).toContain('select("id, user_id, avatar_url")');
    expect(inventory).toContain('for (const trip of trips)');
    expect(inventory).not.toContain("privateTripIds");
    expect(inventory).toContain("orphanObjects");
    expect(inventory).toContain("missingReferences");
    expect(inventory).toContain("orphanAvatarObjects");
    expect(inventory).toContain("invalidAvatarReferences");
    expect(inventory).not.toContain(".remove(");
    expect(inventory).not.toContain(".insert(");
    expect(inventory).not.toContain(".update(");
    expect(inventory).not.toContain(".delete(");
  });
});


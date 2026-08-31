// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateMigrationSql } from "../../db/migrate";

const migrationUrl = new URL(
  "../../db/migrations/0010_profile_account_hardening.sql",
  import.meta.url,
);
const lifecycleMigrationUrl = new URL(
  "../../db/migrations/0006_engagement_visibility_hardening.sql",
  import.meta.url,
);
const requestHashPrivacyMigrationUrl = new URL(
  "../../db/migrations/0045_request_hash_privacy.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../../server/profiles/repository.ts", import.meta.url);
const socialRepositoryUrl = new URL("../../server/social/repository.ts", import.meta.url);
const mediaRepositoryUrl = new URL("../../server/media/repository.ts", import.meta.url);

describe("profile database boundary", () => {
  it("houdt migratie 0010 runner-safe zonder nieuwe SECURITY DEFINER-oppervlakte", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(() => validateMigrationSql("0010_profile_account_hardening.sql", migration))
      .not.toThrow();
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration).toContain("SET search_path = pg_catalog, public");
    expect(migration).toMatch(/CREATE TRIGGER profiles_guard_privileges[\s\S]*BEFORE INSERT OR UPDATE/);
    expect(migration).toMatch(/NEW\.is_pro[\s\S]*NEW\.onboarded_at IS NOT NULL/);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.guard_profile_privileges()");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.guard_linked_avatar_asset()");
  });

  it("bindt één expliciete avatar aan dezelfde eigenaar en uitsluitend aan ready beeldmedia", async () => {
    const [migration, repository, socialRepository, mediaRepository] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(repositoryUrl, "utf8"),
      readFile(socialRepositoryUrl, "utf8"),
      readFile(mediaRepositoryUrl, "utf8"),
    ]);

    expect(migration).toMatch(/FOREIGN KEY \(avatar_asset_id, user_id\)[\s\S]*REFERENCES public\.media_assets\(id, owner_id\)/);
    expect(migration).toContain("asset.owner_id = NEW.user_id");
    expect(migration).toContain("asset.project_id IS NULL");
    expect(migration).toContain("asset.original_asset_id IS NULL");
    expect(migration).toContain("asset.purpose = 'avatar'");
    expect(migration).toContain("asset.status = 'ready'");
    expect(migration).toContain("asset.exif_stripped");
    expect(migration).toContain("asset.object_key LIKE 'originals/%'");
    expect(migration).toContain("linked avatar asset is immutable until unlinked");
    expect(repository).toContain("asset.owner_id = ${actorId}::uuid");
    expect(repository).toContain("for share of asset");
    // Profile detail resolves the explicitly linked avatar directly; search uses
    // the database helper and the retired project-access-request join is absent.
    expect(socialRepository.match(/avatar\.id = profile\.avatar_asset_id/g)).toHaveLength(1);
    expect(socialRepository).not.toMatch(/order by asset\.updated_at desc/);
    expect(mediaRepository).toContain("profile.avatar_asset_id = parent.id");
    expect(mediaRepository).toContain("profile.user_id = parent.owner_id");
    expect(mediaRepository).toContain("app_can_view_profile(profile.user_id)");
    expect(mediaRepository).toContain("profile.version::text as effective_privacy_version");
    expect(mediaRepository).toContain("and not profile.is_private");
    expect(mediaRepository).toContain("and parent.exif_stripped");
    expect(mediaRepository).toContain("and parent.object_key like 'originals/%'");
  });

  it("dwingt actorownership en optimistic versioning af bij iedere profielwrite", async () => {
    const [migration, repository] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(repositoryUrl, "utf8"),
    ]);

    expect(migration).toContain("profile identity is immutable");
    expect(migration).toContain("profile privilege fields are server-managed");
    expect(migration).toContain("NEW.version IS DISTINCT FROM OLD.version + 1");
    expect(repository).toContain("eq(profiles.userId, command.actorId)");
    expect(repository).toContain("eq(profiles.version, command.input.expectedVersion)");
    expect(repository).toContain("throw new ProfileError(\"VERSION_CONFLICT\")");
    expect(repository).toContain("profiles_slug_uq");
    expect(repository).toContain("throw new ProfileError(\"SLUG_CONFLICT\"");
  });

  it("laat openbare reads fail-closed op lifecycle, privacy en wederzijdse blokkades", async () => {
    const [lifecycleMigration, repository] = await Promise.all([
      readFile(lifecycleMigrationUrl, "utf8"),
      readFile(repositoryUrl, "utf8"),
    ]);
    const helper = lifecycleMigration.slice(
      lifecycleMigration.indexOf("CREATE OR REPLACE FUNCTION app_can_view_profile"),
      lifecycleMigration.indexOf("CREATE OR REPLACE FUNCTION app_can_view_update"),
    );
    const publicRead = repository.slice(
      repository.indexOf("async findPublicProfile"),
      repository.indexOf("async updateOwnProfile"),
    );

    expect(helper).toContain("target.status = 'active'");
    expect(helper).toContain("target.deleted_at IS NULL");
    expect(helper).toContain("NOT public.app_users_are_blocked");
    expect(helper).toContain("profile.is_private = false");
    expect(helper).toContain("relationship.status = 'active'");
    expect(publicRead).toContain("app_can_view_profile(profile.user_id)");
    expect(publicRead).not.toMatch(/join app_users/i);
  });

  it("houdt het idempotency-ledger minimaal en profiel-PII-vrij", async () => {
    const migration = await readFile(requestHashPrivacyMigrationUrl, "utf8");
    const policy = migration.slice(
      migration.indexOf("CREATE POLICY outbox_events_insert_profile_mutation"),
      migration.indexOf("REVOKE ALL ON FUNCTION"),
    );

    expect(policy).toContain("aggregate_id = public.app_actor_id()");
    expect(policy).toContain("event_type = 'profile.updated.v1'");
    expect(policy).toContain("'requestHashVersion'");
    expect(policy).toContain("'requestHash'");
    expect(policy).toContain("'profileVersion'");
    expect(policy).not.toMatch(/display_name|slug|bio|location|avatar_asset_id/);
  });
});

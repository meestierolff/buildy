// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0035_canonical_social_connections.sql",
  import.meta.url,
);

describe("canonical social connections migration", () => {
  it("exposes all actor-owned connection views through one fixed-path boundary", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.app_list_profile_connections");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public");
    for (const view of ["following", "followers", "incoming", "outgoing", "blocked"]) {
      expect(migration).toContain(`'${view}'`);
    }
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.app_list_profile_connections");
  });

  it("returns minimal identities while keeping private profile details hidden", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.app_search_profile_identities");
    expect(migration).toContain("CASE WHEN access.can_view_profile THEN profile.bio ELSE NULL END");
    expect(migration).toContain("viewer_id IS NOT NULL AND requested_query IS NOT NULL");
    expect(migration).toContain("profile.is_private = false OR viewer_follow.status = 'active'");
    expect(migration).toContain("count(*) OVER () AS total_count");
    expect(migration).toContain("relationship_at DESC, enriched.user_id DESC");
  });

  it("is granted to the web role and to no worker role", async () => {
    const [configure, verify] = await Promise.all([
      readFile(new URL("../../scripts/setup/configure-database-roles.sql", import.meta.url), "utf8"),
      readFile(new URL("../../scripts/setup/verify-database-roles.sql", import.meta.url), "utf8"),
    ]);
    const signature = "public.app_list_profile_connections(text,timestamptz,uuid,integer)";
    const searchSignature = "public.app_search_profile_identities(text,timestamptz,uuid,integer)";

    expect(configure.replaceAll(" ", "")).toContain(signature);
    expect(configure.replaceAll(" ", "")).toContain(searchSignature);
    expect(verify).toContain(signature);
    expect(verify).toContain(searchSignature);
    expect(verify).toContain("web-only function grant is incomplete or cross-exposed");
  });
});

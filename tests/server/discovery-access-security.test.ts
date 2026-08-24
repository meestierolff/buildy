// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("discovery, following and project-visibility boundaries", () => {
  it.each([
    ["home discovery", "../../src/pages/Index.tsx"],
    ["following feed", "../../src/pages/Favorites.tsx"],
  ])("keeps the active %s browser flow behind typed APIs", (_label, path) => {
    const contents = source(path);
    expect(contents).not.toContain("@/integrations/supabase");
    expect(contents).not.toContain("createSignedUrl");
    expect(contents).not.toContain(".storage.from(");
    expect(contents).not.toMatch(/\.from\(["'](?:trips|steps|follows|favorites)["']\)/);
  });

  it("keeps legacy settings and project-access-request UI outside the active detail route", () => {
    const app = source("../../src/App.tsx");
    const detail = source("../../src/pages/TripDetail.tsx");
    expect(app).not.toContain("ProjectSettingsSheet");
    expect(detail).not.toContain("ProjectSettingsSheet");
    expect(detail).not.toContain("ProjectAccessManager");
    expect(detail).not.toContain("RequestAccessCard");
  });

  it("feeds active profile followers only public and followers-only published work", () => {
    const repository = source("../../server/projects/repository.ts");
    const start = repository.indexOf("async listFollowingProjects");
    const end = repository.indexOf("async getOverview");
    const followingReads = repository.slice(start, end);

    expect(followingReads).toContain("builder_follow.source_user_id");
    expect(followingReads).toContain("project.visibility in ('followers', 'public')");
    expect(followingReads).toContain("item.status = 'published'");
    expect(followingReads).toContain("block.source_user_id");
    expect(followingReads).toContain("block.target_user_id");
    expect(followingReads).not.toContain("project_access_requests");
    expect(followingReads).not.toContain("project_followers");
    expect(followingReads).not.toContain("unlisted");
    expect(followingReads).not.toMatch(/address|postal|contractor|ciphertext|object_key|bucket_name/i);
  });

  it("keeps retired project-social APIs out of contracts, routing and readiness", () => {
    const contract = source("../../shared/contracts/social.ts");
    const http = source("../../server/social/http.ts");
    const repository = source("../../server/social/repository.ts");
    const router = source("../../server/http/router.ts");
    const service = source("../../server/social/service.ts");
    const types = source("../../server/social/types.ts");

    expect(contract).not.toContain("/api/social/projects");
    expect(http).not.toContain("/api/social/projects");
    expect(`${service}\n${types}`).not.toMatch(
      /(?:followProject|unfollowProject|ProjectSocialState|ProjectAccessList|ProjectAccessEntry|projectState|projectAccess)/,
    );
    expect(repository).not.toContain("app_social_project_context");
    expect(router).not.toContain("app_social_project_context");
  });

  it("keeps historical project relationship tables write-only for safe revocation", () => {
    const repository = source("../../server/social/repository.ts");

    expect(repository.match(/project_access_requests/g)).toHaveLength(1);
    expect(repository.match(/project_followers/g)).toHaveLength(1);
    expect(repository).toContain("update project_access_requests");
    expect(repository).toContain("update project_followers");
    expect(repository).not.toMatch(/from project_(?:access_requests|followers)/);
    expect(repository).not.toMatch(/insert(?:\s+into)? project_(?:access_requests|followers)/);
  });
});

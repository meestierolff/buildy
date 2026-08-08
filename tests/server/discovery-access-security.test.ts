// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("discovery, following and project-access boundaries", () => {
  it.each([
    ["home discovery", "../../src/pages/Index.tsx"],
    ["following feed", "../../src/pages/Favorites.tsx"],
    ["access manager", "../../src/components/ProjectAccessManager.tsx"],
    ["access request", "../../src/components/RequestAccessCard.tsx"],
    ["follow control", "../../src/components/FollowButton.tsx"],
  ])("keeps the active %s browser flow behind typed APIs", (_label, path) => {
    const contents = source(path);
    expect(contents).not.toContain("@/integrations/supabase");
    expect(contents).not.toContain("createSignedUrl");
    expect(contents).not.toContain(".storage.from(");
    expect(contents).not.toMatch(/\.from\(["'](?:trips|steps|follows|favorites)["']\)/);
  });

  it("keeps the unsupported legacy settings sheet outside active routes", () => {
    const app = source("../../src/App.tsx");
    const detail = source("../../src/pages/TripDetail.tsx");
    expect(app).not.toContain("ProjectSettingsSheet");
    expect(detail).not.toContain("ProjectSettingsSheet");
    expect(detail).toContain("ProjectAccessManager");
  });

  it("requires accepted private access, published updates and bilateral block exclusion in the feed", () => {
    const repository = source("../../server/projects/repository.ts");
    const start = repository.indexOf("async listFollowingProjects");
    const end = repository.indexOf("async getOverview");
    const followingReads = repository.slice(start, end);

    expect(followingReads).toContain("project_follow.follower_id");
    expect(followingReads).toContain("builder_follow.source_user_id");
    expect(followingReads).toContain("project.visibility = 'public'");
    expect(followingReads).toContain("accepted_access.status = 'accepted'");
    expect(followingReads).toContain("item.status = 'published'");
    expect(followingReads).toContain("block.source_user_id");
    expect(followingReads).toContain("block.target_user_id");
    expect(followingReads).not.toMatch(/address|postal|contractor|ciphertext|object_key|bucket_name/i);
  });

  it("checks project ownership before returning access-request identities", () => {
    const repository = source("../../server/social/repository.ts");
    const start = repository.indexOf("async listProjectAccess");
    const end = repository.indexOf("async searchProfiles", start);
    const accessRead = repository.slice(start, end);

    expect(accessRead).toContain("project.ownerId !== actorId");
    expect(accessRead).toContain("access.project_owner_id = ${actorId}::uuid");
    expect(accessRead).toContain("access.status in ('pending', 'accepted')");
    expect(accessRead).not.toMatch(/email|address|postal|contractor/i);
  });
});

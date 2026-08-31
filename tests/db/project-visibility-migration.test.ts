// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { projectVisibilityEnum } from "../../db/schema/common";
import {
  projectOverviewSchema,
  projectVisibilitySchema,
} from "../../shared/contracts/projects";

const migrationUrl = new URL("../../db/migrations/0036_project_visibility_modes.sql", import.meta.url);
const followEventFixUrl = new URL(
  "../../db/migrations/0039_profile_follow_event_status_fix.sql",
  import.meta.url,
);
const shareLinkMigrationUrl = new URL(
  "../../db/migrations/0047_project_share_links.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../../server/projects/repository.ts", import.meta.url);

function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  const end = sql.indexOf("--> statement-breakpoint", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("four-mode project visibility boundary", () => {
  it("keeps Drizzle and shared contracts on one ordered enum", () => {
    const values = ["private", "followers", "unlisted", "public"];
    expect(projectVisibilityEnum.enumValues).toEqual(values);
    expect(projectVisibilitySchema.options).toEqual(values);
    expect(projectOverviewSchema.shape.viewerAccess.options).toEqual([
      "owner",
      "follower",
      "link",
      "public",
    ]);
  });

  it("replaces accepted access requests with profile-follow and explicit share-grant semantics", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const historicalCanViewProject = functionBody(
      migration,
      "CREATE OR REPLACE FUNCTION public.app_can_view_project",
    );
    const shareMigration = await readFile(shareLinkMigrationUrl, "utf8");
    const activeCanViewProject = functionBody(
      shareMigration,
      "CREATE OR REPLACE FUNCTION public.app_can_view_project",
    );

    expect(historicalCanViewProject).toContain("project.visibility = 'followers'::public.project_visibility");
    expect(activeCanViewProject).toContain("profile_follow.source_user_id = public.app_actor_id()");
    expect(activeCanViewProject).toContain("project.visibility = 'unlisted'::public.project_visibility");
    expect(activeCanViewProject).toContain("share_link.id = public.app_share_link_id()");
    expect(activeCanViewProject).toContain("share_link.revoked_at IS NULL");
    expect(activeCanViewProject).toContain("share_link.expires_at > statement_timestamp()");
    expect(activeCanViewProject).not.toContain("project_access_requests");
    expect(migration).not.toContain("accepted_access");
  });

  it("keeps unlisted projects out of discovery and following feeds", async () => {
    const repository = await readFile(repositoryUrl, "utf8");

    expect(repository).toContain("where project.visibility = 'public'");
    expect(repository).toContain("and project.visibility in ('followers', 'public')");
    expect(repository).not.toMatch(/project\.visibility in \([^)]*unlisted[^)]*\)/);
    expect(repository).not.toContain("from project_access_requests accepted_access");
  });

  it("uses the canonical active status when a private profile follow is accepted", async () => {
    const migration = await readFile(followEventFixUrl, "utf8");

    expect(migration).toContain("OLD.status = 'pending' AND NEW.status = 'active'");
    expect(migration).not.toContain("NEW.status = 'accepted'");
    expect(migration).toContain("'follow_accepted'");
  });
});

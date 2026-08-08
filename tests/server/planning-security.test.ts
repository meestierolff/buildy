// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateMigrationSql } from "../../db/migrate";

const migrationUrl = new URL(
  "../../db/migrations/0007_planning_privacy_hardening.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../../server/planning/repository.ts", import.meta.url);

describe("planning database boundary", () => {
  it("keeps migration 0007 runner-safe and adds no new SECURITY DEFINER surface", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(() => validateMigrationSql("0007_planning_privacy_hardening.sql", migration))
      .not.toThrow();
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(4);
    expect(migration.match(/REVOKE ALL ON FUNCTION public\./g)).toHaveLength(4);
  });

  it("hardens owner-only budgets and removes the shared read path", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toMatch(/UPDATE public\.project_budgets[\s\S]*SET is_shared = false/);
    expect(migration).toMatch(/project_budgets_private_ck CHECK \(is_shared = false\)/);
    expect(migration).toMatch(/DROP POLICY budgets_select_visible/);
    expect(migration).toMatch(/CREATE POLICY budgets_select_owner[\s\S]*owner_id = app_actor_id\(\)/);
    expect(migration).toMatch(/CREATE POLICY budget_items_select_owner/);
    expect(migration).toMatch(/project budget server fields are immutable/);
  });

  it("enforces ready floorplan media, pin scope and optimistic pin versions", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const repository = await readFile(repositoryUrl, "utf8");
    const assetGuard = repository.slice(
      repository.indexOf("async function assertReadyFloorplanAsset"),
      repository.indexOf("async function assertReadyFloorplan("),
    );

    expect(migration).toMatch(/ADD COLUMN version integer DEFAULT 1 NOT NULL/);
    expect(migration).toMatch(/floorplan_pins_version_ck CHECK \(version > 0\)/);
    expect(migration).toMatch(/asset\.purpose = 'floorplan'/);
    expect(migration).toMatch(/asset\.status = 'ready'/);
    expect(migration).toMatch(/asset\.is_current/);
    expect(migration).toMatch(/project_update\.status IN \('draft', 'published'\)/);
    expect(migration).toMatch(/OR project_update\.status = 'published'/);
    expect(assetGuard).toMatch(/asset\.project_id = \$\{projectId\}::uuid/);
    expect(assetGuard).toMatch(/asset\.owner_id = \$\{actorId\}::uuid/);
    expect(assetGuard).toMatch(/asset\.purpose = 'floorplan'/);
    expect(assetGuard).toMatch(/asset\.status = 'ready'/);
    expect(assetGuard).toMatch(/asset\.ready_at is not null/);
    expect(assetGuard).toMatch(/asset\.detected_content_type like 'image\/%'/);
  });

  it("uses one set-based query per readmodel and a transactional project outbox", async () => {
    const repository = await readFile(repositoryUrl, "utf8");
    const floorplanRead = repository.slice(
      repository.indexOf("async listFloorplans"),
      repository.indexOf("async createFloorplan"),
    );
    const budgetRead = repository.slice(
      repository.indexOf("async getBudget"),
      repository.indexOf("async createBudget"),
    );

    expect(floorplanRead.match(/transaction\.execute/g)).toHaveLength(1);
    expect(floorplanRead).toMatch(/jsonb_agg/);
    expect(budgetRead.match(/transaction\.execute/g)).toHaveLength(1);
    expect(budgetRead).toMatch(/jsonb_agg/);
    expect(repository).toMatch(/await mutation\(transaction\)[\s\S]*await appendMutationEvent\(transaction/);
    expect(repository).toMatch(/aggregateType: "project" as const/);
    expect(repository).toMatch(/pg_advisory_xact_lock/);
  });
});

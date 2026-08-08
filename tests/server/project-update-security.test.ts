// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createUpdateInputSchema,
  deleteUpdateInputSchema,
  editUpdateInputSchema,
} from "../../shared/contracts/projects";

const ASSET_ONE = "11111111-1111-4111-8111-111111111111";
const ASSET_TWO = "22222222-2222-4222-8222-222222222222";
const KEY = "update-command:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("project update mutation security", () => {
  it("requires an explicit destructive confirmation and optimistic version", () => {
    expect(deleteUpdateInputSchema.safeParse({
      idempotencyKey: KEY,
      expectedVersion: 3,
    }).success).toBe(false);
    expect(deleteUpdateInputSchema.safeParse({
      idempotencyKey: KEY,
      expectedVersion: 3,
      confirmation: "delete-update",
    }).success).toBe(true);
  });

  it("accepts only a unique, contiguous media manifest with singular before/after roles", () => {
    const base = {
      idempotencyKey: KEY,
      expectedProjectVersion: 2,
      updateDate: "2026-08-04",
      media: [
        { assetId: ASSET_ONE, role: "before" as const, sortOrder: 0 },
        { assetId: ASSET_TWO, role: "gallery" as const, sortOrder: 1 },
      ],
    };
    expect(createUpdateInputSchema.safeParse(base).success).toBe(true);
    expect(createUpdateInputSchema.safeParse({
      ...base,
      media: [base.media[0], { ...base.media[1], sortOrder: 2 }],
    }).success).toBe(false);
    expect(editUpdateInputSchema.safeParse({
      idempotencyKey: KEY,
      expectedVersion: 2,
      media: [
        { assetId: ASSET_ONE, role: "before", sortOrder: 0 },
        { assetId: ASSET_TWO, role: "before", sortOrder: 1 },
      ],
    }).success).toBe(false);
    expect(editUpdateInputSchema.safeParse({
      idempotencyKey: KEY,
      expectedVersion: 2,
      media: [],
    }).success).toBe(true);
  });

  it("soft-deletes the update without deleting media links or assets", () => {
    const repository = readFileSync(
      new URL("../../server/projects/repository.ts", import.meta.url),
      "utf8",
    );
    const deleteBody = repository.slice(
      repository.indexOf("async deleteUpdate"),
      repository.indexOf("async createProjectPhase"),
    );
    const editBody = repository.slice(
      repository.indexOf("async editUpdate"),
      repository.indexOf("async deleteUpdate"),
    );

    expect(deleteBody).toContain(".update(updates)");
    expect(deleteBody).toContain('status: "deleted"');
    expect(deleteBody).toContain("deletedAt: command.now");
    expect(deleteBody).not.toContain(".delete(updateMedia)");
    expect(deleteBody).not.toContain(".delete(mediaAssets)");
    expect(editBody).toContain(".delete(updateMedia)");
    expect(editBody).not.toContain(".delete(mediaAssets)");
    const phaseBody = repository.slice(repository.indexOf("async createProjectPhase"));
    expect(phaseBody).toContain("aggregateId: command.projectId");
    expect(phaseBody).toContain("resultId: command.phaseId");
  });
});

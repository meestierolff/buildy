// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateMigrationSql } from "../../db/migrate";

const migrationUrl = new URL(
  "../../db/migrations/0023_profile_onboarding_completion.sql",
  import.meta.url,
);
const repositoryUrl = new URL("../../server/profiles/repository.ts", import.meta.url);

describe("profile onboarding completion boundary", () => {
  it("is runner-safe and preserves the privileged-field guard", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(() => validateMigrationSql("0023_profile_onboarding_completion.sql", migration))
      .not.toThrow();
    expect(migration).toContain("NEW.is_pro IS DISTINCT FROM OLD.is_pro");
    expect(migration).toContain("OLD.onboarded_at IS NULL");
    expect(migration).toContain("NEW.onboarded_at IS NOT NULL");
    expect(migration).toContain("profile onboarding can only be completed once");
    expect(migration).toContain("NEW.version IS DISTINCT FROM OLD.version + 1");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.guard_profile_privileges() FROM PUBLIC");
  });

  it("maps completion intent to a fresh server timestamp without accepting a client timestamp", async () => {
    const repository = await readFile(repositoryUrl, "utf8");

    expect(repository).toContain("command.input.onboardingCompleted");
    expect(repository).toContain("coalesce(${profiles.onboardedAt}, now())");
    expect(repository).not.toMatch(/command\.input\.onboardedAt/);
  });
});

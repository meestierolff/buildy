// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("private Vercel Blob storage default migration", () => {
  it("changes only the default and preserves historical provider rows", () => {
    const sql = readFileSync(
      new URL("../../db/migrations/0037_vercel_blob_storage_default.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("ALTER COLUMN storage_provider SET DEFAULT 'vercel_blob'");
    expect(sql).not.toMatch(/UPDATE\s+public\.media_assets/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});

// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/0043_vercel_blob_account_exports.sql",
  import.meta.url,
);

describe("Vercel Blob account export migration", () => {
  it("creates new export archives only in the active private provider namespace", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("'export_archive', 'processing', 'vercel_blob', export_bucket");
    expect(migration).not.toContain("'export_archive', 'processing', 'r2', export_bucket");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.app_request_account_export(text, boolean, text) FROM PUBLIC;",
    );
  });
});

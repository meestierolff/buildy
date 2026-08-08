// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("browser project write boundary", () => {
  it.each([
    ["new-project", "../../src/pages/NewTrip.tsx"],
    ["new-update", "../../src/components/AddStepDialog.tsx"],
    ["edit-update", "../../src/components/EditStepDialog.tsx"],
  ])("keeps %s writes behind typed same-origin APIs", (_name, path) => {
    const contents = source(path);

    expect(contents).not.toContain("@/integrations/");
    expect(contents).not.toMatch(/\buser_id\b/);
    expect(contents).not.toMatch(/\bstorage_path\b/);
    expect(contents).not.toContain("createSignedUrl");
    expect(contents).not.toContain(".storage.from(");
  });

  it("keeps edit, detach and soft-delete behind typed project mutations", () => {
    const contents = source("../../src/components/EditStepDialog.tsx");

    expect(contents).toContain("useEditProjectUpdateMutation");
    expect(contents).toContain("useDeleteProjectUpdateMutation");
    expect(contents).toContain("usePrivateMediaUpload");
    expect(contents).toContain("buildDeleteUpdateCommand");
    expect(contents).not.toContain("browser-side provider");
    expect(contents).not.toContain("storage.remove");
    expect(contents).not.toContain("deleteObject");
  });

  it("fails closed for update fields without a transactional server contract", () => {
    const contents = source("../../src/components/AddStepDialog.tsx");

    expect(contents).not.toContain("step_contractor_info");
    expect(contents).not.toContain("step_budget");
    expect(contents).toContain("there is deliberately no browser-side provider fallback");
    expect(contents).toContain("useCreateProjectUpdateMutation");
    expect(contents).toContain("usePrivateMediaUpload");
  });
});

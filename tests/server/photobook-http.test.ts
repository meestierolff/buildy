// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPhotobookHttpHandler, type PhotobookHttpService } from "../../server/photobooks/http";
import type { ObjectStorage } from "../../server/storage/objectStorage";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const REVISION_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
function dependencies() {
  const service = { editor: vi.fn(), preview: vi.fn(), updateSettings: vi.fn(), replaceExclusions: vi.fn(), requestProof: vi.fn(), proofObject: vi.fn() } satisfies PhotobookHttpService;
  const storage = { streamObject: vi.fn() } as unknown as ObjectStorage;
  return { service, storage, actors: { resolve: async () => ({ kind: "authenticated" as const, appUserId: ACTOR_ID }) } };
}
describe("customer photobook boundary", () => {
  it.each(["GET", "HEAD"])("denies %s of a known historical PDF even to its owner", async method => {
    const deps = dependencies();
    await expect(createPhotobookHttpHandler(deps)(new Request(`https://buildy.test/api/photobooks/proofs/${REVISION_ID}/pdf`, { method }), REQUEST_ID, { revisionId: REVISION_ID })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(deps.service.proofObject).not.toHaveBeenCalled();
    expect(deps.storage.streamObject).not.toHaveBeenCalled();
  });
  it("denies customer proof generation before queueing work", async () => {
    const deps = dependencies();
    await expect(createPhotobookHttpHandler(deps)(new Request(`https://buildy.test/api/projects/${PROJECT_ID}/photobook/proofs`, { method: "POST" }), REQUEST_ID, { projectId: PROJECT_ID })).rejects.toMatchObject({ status: 403 });
    expect(deps.service.requestProof).not.toHaveBeenCalled();
  });
  it("passes a preview through owner-scoped canonical generation", async () => {
    const deps = dependencies(); deps.service.preview.mockResolvedValue({ pageCount: 3 });
    const result = await createPhotobookHttpHandler(deps)(new Request(`https://buildy.test/api/projects/${PROJECT_ID}/photobook/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subtitle: "Test" }) }), REQUEST_ID, { projectId: PROJECT_ID });
    expect(result.status).toBe(200);
    expect(deps.service.preview).toHaveBeenCalledWith(ACTOR_ID, PROJECT_ID, { subtitle: "Test" });
    expect(deps.service.updateSettings).not.toHaveBeenCalled();
  });
  it("requires authentication for previews", async () => {
    const deps = dependencies();
    const handler = createPhotobookHttpHandler({ ...deps, actors: { resolve: async () => ({ kind: "anonymous" }) } });
    await expect(handler(new Request(`https://buildy.test/api/projects/${PROJECT_ID}/photobook`), REQUEST_ID, { projectId: PROJECT_ID })).rejects.toMatchObject({ status: 401 });
  });
});

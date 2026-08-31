// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProjectShareLink,
  getProjectShareLink,
  redeemProjectShareLink,
  revokeProjectShareLink,
  rotateProjectShareLink,
} from "@/lib/projectShareApi";
import {
  forgetPendingProjectShareToken,
  pendingProjectShareTokenValue,
  scrubProjectShareFragment,
} from "@/lib/projectShareFragment";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2026-08-30T10:00:00.000Z";
const RAW = "a".repeat(43);

const link = {
  id: LINK_ID,
  projectId: PROJECT_ID,
  expiresAt: EXPIRES_AT,
  createdAt: "2026-08-23T10:00:00.000Z",
  version: 1,
  state: "active",
};

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

describe("project share typed API", () => {
  afterEach(() => {
    forgetPendingProjectShareToken();
    vi.unstubAllGlobals();
  });

  it("uses only owner routes and POST-body redemption", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({ projectId: PROJECT_ID, link }))
      .mockResolvedValueOnce(success({ link, shareUrl: `https://buildy.example/delen#toegang=${RAW}`, replayed: false }))
      .mockResolvedValueOnce(success({ link: { ...link, version: 2 }, shareUrl: `https://buildy.example/delen#toegang=${"b".repeat(43)}`, replayed: false }))
      .mockResolvedValueOnce(success({ projectId: PROJECT_ID, linkId: LINK_ID, revoked: true, version: 2, replayed: false }))
      .mockResolvedValueOnce(success({ projectId: PROJECT_ID, cleanPath: `/project/${PROJECT_ID}`, expiresAt: EXPIRES_AT }));
    vi.stubGlobal("fetch", fetchMock);

    await getProjectShareLink(PROJECT_ID);
    await createProjectShareLink(PROJECT_ID, { expiresAt: EXPIRES_AT, idempotencyKey: "project-share-create:client-0001" });
    await rotateProjectShareLink(PROJECT_ID, { expiresAt: EXPIRES_AT, expectedVersion: 1, idempotencyKey: "project-share-rotate:client-0002" });
    await revokeProjectShareLink(PROJECT_ID, { expectedVersion: 2, idempotencyKey: "project-share-revoke:client-0003" });
    await redeemProjectShareLink(RAW);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/projects/${PROJECT_ID}/share-link`,
      `/api/projects/${PROJECT_ID}/share-link`,
      `/api/projects/${PROJECT_ID}/share-link/rotate`,
      `/api/projects/${PROJECT_ID}/share-link`,
      "/api/project-share-links/redeem",
    ]);
    const redeemCall = fetchMock.mock.calls[4];
    expect(redeemCall?.[0]).not.toContain(RAW);
    expect(JSON.parse(String(redeemCall?.[1]?.body))).toEqual({ token: RAW });
    expect(redeemCall?.[1]).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("scrubs the fragment before application requests and keeps the bearer only in memory", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState(null, "", `/delen#toegang=${RAW}`);

    scrubProjectShareFragment();

    expect(window.location.pathname).toBe("/delen");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(pendingProjectShareTokenValue()).toBe(RAW);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("fails closed for malformed or ambiguous fragments while still cleaning the URL", () => {
    for (const fragment of [
      "toegang=te-kort",
      `toegang=${RAW}&bron=bericht`,
      `toegang=${RAW}&toegang=${"b".repeat(43)}`,
    ]) {
      window.history.replaceState(null, "", `/delen/#${fragment}`);
      scrubProjectShareFragment();

      expect(window.location.pathname).toBe("/delen");
      expect(window.location.hash).toBe("");
      expect(pendingProjectShareTokenValue()).toBeNull();
    }
  });
});

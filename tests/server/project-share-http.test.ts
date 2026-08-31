// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRuntimeConfigForTests } from "../../server/config/runtime";
import { handleApiRequest } from "../../server/http/router";
import { HmacProjectShareTokens } from "../../server/projectShares/crypto";
import { ProjectShareError } from "../../server/projectShares/errors";
import {
  configureDefaultProjectShareRuntime,
  resetDefaultProjectShareRuntimeForTests,
} from "../../server/projectShares/runtime";
import type { ProjectShareService } from "../../server/projectShares/service";
import type { ProjectActorResolver } from "../../server/projects/actor";

const ORIGIN = "https://buildy.example";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const LINK_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2026-08-30T10:00:00.000Z";
const KEY = Buffer.alloc(32, 73).toString("base64");

function configure(service: Partial<ProjectShareService>, authenticated = true) {
  const actors: ProjectActorResolver = {
    resolve: vi.fn(async () => authenticated
      ? { kind: "authenticated" as const, appUserId: OWNER_ID }
      : { kind: "anonymous" as const }),
  };
  configureDefaultProjectShareRuntime({
    actors,
    secureCookies: true,
    tokens: new HmacProjectShareTokens(KEY),
    service: service as Pick<ProjectShareService, "ownerState" | "create" | "rotate" | "revoke" | "redeem">,
  });
  return actors;
}

describe("project share HTTP routes", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    vi.stubEnv("DATABASE_URL", "");
    resetRuntimeConfigForTests();
    resetDefaultProjectShareRuntimeForTests();
  });

  afterEach(() => {
    resetDefaultProjectShareRuntimeForTests();
    resetRuntimeConfigForTests();
    vi.unstubAllEnvs();
  });

  it("exchanges a POST-body token for a distinct HttpOnly grant and strips internal link data", async () => {
    const tokens = new HmacProjectShareTokens(KEY);
    const raw = tokens.issueToken({
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      operation: "create",
      idempotencyKey: "project-share-create:http-0001",
    });
    const redeem = vi.fn(async () => ({
      projectId: PROJECT_ID,
      cleanPath: `/project/${PROJECT_ID}`,
      expiresAt: EXPIRES_AT,
      linkId: LINK_ID,
    }));
    configure({ redeem }, false);

    const response = await handleApiRequest(new Request(`${ORIGIN}/api/project-share-links/redeem`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ token: raw }),
    }));
    const payload = await response.json();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ data: { projectId: PROJECT_ID, cleanPath: `/project/${PROJECT_ID}` } });
    expect(JSON.stringify(payload)).not.toContain(LINK_ID);
    expect(cookie).toContain("buildy_project_share=v1.");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain(raw);
    expect(cookie).not.toContain(tokens.tokenHash(raw));
    expect(redeem).toHaveBeenCalledWith({ kind: "anonymous" }, { token: raw });
  });

  it("never accepts the bearer in a querystring and clears stale grants on expiry", async () => {
    const raw = new HmacProjectShareTokens(KEY).issueToken({
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      operation: "create",
      idempotencyKey: "project-share-create:http-0002",
    });
    const redeem = vi.fn(async () => {
      throw new ProjectShareError("LINK_EXPIRED");
    });
    configure({ redeem }, false);

    const queryResponse = await handleApiRequest(new Request(
      `${ORIGIN}/api/project-share-links/redeem?toegang=${raw}`,
      {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      },
    ));
    expect(queryResponse.status).toBe(400);
    expect(redeem).not.toHaveBeenCalled();

    const expiredResponse = await handleApiRequest(new Request(`${ORIGIN}/api/project-share-links/redeem`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ token: raw }),
    }));
    expect(expiredResponse.status).toBe(410);
    expect(expiredResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("routes owner create, rotate, inspect and revoke without trusting body identity", async () => {
    const link = {
      id: LINK_ID,
      projectId: PROJECT_ID,
      expiresAt: EXPIRES_AT,
      createdAt: "2026-08-23T10:00:00.000Z",
      version: 1,
      state: "active" as const,
    };
    const create = vi.fn(async () => ({ link, shareUrl: `${ORIGIN}/delen#toegang=${"a".repeat(43)}`, replayed: false }));
    const rotate = vi.fn(async () => ({ link: { ...link, version: 2 }, shareUrl: `${ORIGIN}/delen#toegang=${"b".repeat(43)}`, replayed: false }));
    const ownerState = vi.fn(async () => ({ projectId: PROJECT_ID, link }));
    const revoke = vi.fn(async () => ({ projectId: PROJECT_ID, linkId: LINK_ID, revoked: true as const, version: 2, replayed: false }));
    configure({ create, rotate, ownerState, revoke });
    const mutationHeaders = { origin: ORIGIN, "content-type": "application/json" };

    const inspected = await handleApiRequest(new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/share-link`));
    const created = await handleApiRequest(new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/share-link`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ expiresAt: EXPIRES_AT, idempotencyKey: "project-share-create:http-0003" }),
    }));
    const rotated = await handleApiRequest(new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/share-link/rotate`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ expiresAt: EXPIRES_AT, expectedVersion: 1, idempotencyKey: "project-share-rotate:http-0004" }),
    }));
    const revoked = await handleApiRequest(new Request(`${ORIGIN}/api/projects/${PROJECT_ID}/share-link`, {
      method: "DELETE",
      headers: mutationHeaders,
      body: JSON.stringify({ expectedVersion: 1, idempotencyKey: "project-share-revoke:http-0005" }),
    }));

    expect([inspected.status, created.status, rotated.status, revoked.status]).toEqual([200, 201, 201, 200]);
    expect(ownerState).toHaveBeenCalledWith({ kind: "authenticated", appUserId: OWNER_ID }, PROJECT_ID);
    expect(create).toHaveBeenCalledOnce();
    expect(rotate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
});

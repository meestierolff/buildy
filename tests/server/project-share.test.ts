// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  parseProjectShareCookie,
  projectShareCookie,
} from "../../server/projectShares/cookie";
import { HmacProjectShareTokens } from "../../server/projectShares/crypto";
import { ProjectShareService } from "../../server/projectShares/service";
import type {
  IssueShareLinkCommand,
  ProjectShareRepository,
  RevokeShareLinkCommand,
  StoredProjectShareLink,
} from "../../server/projectShares/types";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const LINK_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-23T10:00:00.000Z");
const EXPIRES_AT = "2026-08-30T10:00:00.000Z";
const KEY = Buffer.alloc(32, 73).toString("base64");

function storedLink(overrides: Partial<StoredProjectShareLink> = {}): StoredProjectShareLink {
  return {
    id: LINK_ID,
    projectId: PROJECT_ID,
    expiresAt: EXPIRES_AT,
    createdAt: NOW.toISOString(),
    revokedAt: null,
    version: 1,
    ...overrides,
  };
}

function repository(overrides: Partial<ProjectShareRepository> = {}): ProjectShareRepository {
  return {
    getOwnerLink: vi.fn(async () => storedLink()),
    issue: vi.fn(async () => ({ link: storedLink(), replayed: false })),
    revoke: vi.fn(async () => ({
      projectId: PROJECT_ID,
      linkId: LINK_ID,
      version: 2,
      replayed: false,
    })),
    redeem: vi.fn(async () => ({
      status: "active" as const,
      linkId: LINK_ID,
      projectId: PROJECT_ID,
      expiresAt: EXPIRES_AT,
    })),
    ...overrides,
  };
}

describe("project share cryptographic boundary", () => {
  it("issues an unpredictable-width token and keeps every hash domain-separated", () => {
    const tokens = new HmacProjectShareTokens(KEY);
    const input = {
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      operation: "create" as const,
      idempotencyKey: "project-share-create:test-0001",
    };
    const raw = tokens.issueToken(input);

    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    expect(tokens.issueToken(input)).toBe(raw);
    expect(tokens.issueToken({ ...input, operation: "rotate" })).not.toBe(raw);
    expect(tokens.tokenHash(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.tokenHash(raw)).not.toBe(tokens.mutationHash(input));
    expect(tokens.matches(raw, tokens.tokenHash(raw))).toBe(true);
  });

  it("sets a distinct signed grant cookie and rejects raw, expired or tampered values", () => {
    const tokens = new HmacProjectShareTokens(KEY);
    const raw = tokens.issueToken({
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      operation: "create",
      idempotencyKey: "project-share-create:test-0002",
    });
    const tokenHash = tokens.tokenHash(raw);
    const header = projectShareCookie(LINK_ID, new Date(EXPIRES_AT), true, tokens, NOW);

    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(header).not.toContain(raw);
    expect(header).not.toContain(tokenHash);

    const cookiePair = header.split(";", 1)[0];
    const request = new Request("https://buildy.example/api/projects", {
      headers: { cookie: cookiePair },
    });
    expect(parseProjectShareCookie(request, tokens, NOW)).toEqual({
      linkId: LINK_ID,
      expiresAt: new Date(EXPIRES_AT),
    });

    const tampered = `${cookiePair.slice(0, -1)}${cookiePair.endsWith("A") ? "B" : "A"}`;
    expect(parseProjectShareCookie(new Request("https://buildy.example", {
      headers: { cookie: tampered },
    }), tokens, NOW)).toBeNull();
    expect(parseProjectShareCookie(new Request("https://buildy.example", {
      headers: { cookie: `buildy_project_share=${raw}` },
    }), tokens, NOW)).toBeNull();
    expect(parseProjectShareCookie(request, tokens, new Date(EXPIRES_AT))).toBeNull();
  });
});

describe("project share service", () => {
  it("returns a fragment link while passing only hashes into persistence", async () => {
    let storedCommand: IssueShareLinkCommand | undefined;
    const repo = repository({
      issue: async (command) => {
        storedCommand = command;
        return { link: storedLink(), replayed: false };
      },
    });
    const tokens = new HmacProjectShareTokens(KEY);
    const service = new ProjectShareService(
      repo,
      tokens,
      "https://buildy.example",
      () => NOW,
      () => LINK_ID,
    );

    const result = await service.create(
      { kind: "authenticated", appUserId: OWNER_ID },
      PROJECT_ID,
      { expiresAt: EXPIRES_AT, idempotencyKey: "project-share-create:test-0003" },
      "44444444-4444-4444-8444-444444444444",
    );
    const raw = new URL(result.shareUrl).hash.slice("#toegang=".length);

    expect(result.shareUrl).toBe(`https://buildy.example/delen#toegang=${raw}`);
    expect(new URL(result.shareUrl).search).toBe("");
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storedCommand?.tokenHash).toBe(tokens.tokenHash(raw));
    expect(JSON.stringify(storedCommand)).not.toContain(raw);
    expect(JSON.stringify(storedCommand)).not.toContain("project-share-create:test-0003");
  });

  it("redeems only by a keyed token hash and never returns that bearer in the clean route", async () => {
    const tokens = new HmacProjectShareTokens(KEY);
    const raw = tokens.issueToken({
      actorId: OWNER_ID,
      projectId: PROJECT_ID,
      operation: "create",
      idempotencyKey: "project-share-create:test-0004",
    });
    const redeem = vi.fn<ProjectShareRepository["redeem"]>(async () => ({
      status: "active",
      linkId: LINK_ID,
      projectId: PROJECT_ID,
      expiresAt: EXPIRES_AT,
    }));
    const service = new ProjectShareService(repository({ redeem }), tokens, "https://buildy.example", () => NOW);

    const result = await service.redeem({ kind: "anonymous" }, { token: raw });

    expect(redeem).toHaveBeenCalledWith({ kind: "anonymous" }, tokens.tokenHash(raw));
    expect(result.cleanPath).toBe(`/project/${PROJECT_ID}`);
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(JSON.stringify(result)).not.toContain(tokens.tokenHash(raw));
  });

  it("fails closed for anonymous management, unsafe expiry and stale revocation", async () => {
    const service = new ProjectShareService(
      repository(),
      new HmacProjectShareTokens(KEY),
      "https://buildy.example",
      () => NOW,
      () => LINK_ID,
    );

    await expect(service.ownerState({ kind: "anonymous" }, PROJECT_ID)).rejects.toMatchObject({
      reason: "ACTOR_REQUIRED",
    });
    await expect(service.create(
      { kind: "authenticated", appUserId: OWNER_ID },
      PROJECT_ID,
      {
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        idempotencyKey: "project-share-create:test-0005",
      },
      "55555555-5555-4555-8555-555555555555",
    )).rejects.toMatchObject({ reason: "EXPIRY_INVALID" });

    let revokeCommand: RevokeShareLinkCommand | undefined;
    const revokeService = new ProjectShareService(repository({
      revoke: async (command) => {
        revokeCommand = command;
        return { projectId: PROJECT_ID, linkId: LINK_ID, version: 2, replayed: false };
      },
    }), new HmacProjectShareTokens(KEY), "https://buildy.example", () => NOW);
    await revokeService.revoke(
      { kind: "authenticated", appUserId: OWNER_ID },
      PROJECT_ID,
      { expectedVersion: 1, idempotencyKey: "project-share-revoke:test-0006" },
      "66666666-6666-4666-8666-666666666666",
    );
    expect(JSON.stringify(revokeCommand)).not.toContain("project-share-revoke:test-0006");
  });
});

// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addEngagementReaction,
  createEngagementComment,
  extractMentionSlugs,
  getEngagementReactions,
  updateEngagementNotification,
} from "@/lib/engagementApi";
import {
  followSocialProfile,
  getSocialProjectAccess,
  getSocialProjectState,
  getSocialProfile,
  resolveVisibleMentionSlugs,
  searchSocialProfiles,
} from "@/lib/socialApi";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const NOTIFICATION_ID = "44444444-4444-4444-8444-444444444444";
const COMMENT_ID = "55555555-5555-4555-8555-555555555555";
const REACTION_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";

function successResponse(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    displayName: "Noor Bouwt",
    slug: "noor-bouwt",
    bio: null,
    location: "Utrecht",
    isPrivate: false,
    isPro: false,
    followerCount: 3,
    followingCount: 2,
    followsViewer: false,
    viewerAccess: "public",
    viewerFollowStatus: "none",
    avatar: null,
    ...overrides,
  };
}

describe("social API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leest uitsluitend het getypeerde sociale profiel via de cookie-API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(profile()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSocialProfile(PROFILE_ID);

    expect(result.slug).toBe("noor-bouwt");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/social/profiles/${PROFILE_ID}`,
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("bouwt zoeken en volgen zonder provider-token of client-side user-id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successResponse({ items: [profile()], nextCursor: null }))
      .mockResolvedValueOnce(successResponse({ replayed: false, state: "following" }));
    vi.stubGlobal("fetch", fetchMock);

    await searchSocialProfiles({ q: "Noor", limit: 10 });
    await followSocialProfile(PROFILE_ID);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/social/profiles?limit=10&q=Noor");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/social/profiles/${PROFILE_ID}/follow`);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "PUT" }));
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).not.toEqual(
      expect.objectContaining({ authorization: expect.anything() }),
    );
  });

  it("resolveert mentions alleen op een exacte zichtbare slug", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse({
      items: [profile(), profile({ id: PROJECT_ID, slug: "noor-bouwt-extra" })],
      nextCursor: null,
    })));

    const resolved = await resolveVisibleMentionSlugs(["Noor-Bouwt"]);

    expect(resolved.get("noor-bouwt")).toBe(PROFILE_ID);
    expect(resolved.has("noor-bouwt-extra")).toBe(false);
  });

  it("leest projectrelatie en owner-toegang zonder client-identiteit", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successResponse({
        projectId: PROJECT_ID,
        viewerRole: "viewer",
        followStatus: "none",
        accessStatus: "pending",
      }))
      .mockResolvedValueOnce(successResponse({ projectId: PROJECT_ID, items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getSocialProjectState(PROJECT_ID);
    await getSocialProjectAccess(PROJECT_ID);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/social/projects/${PROJECT_ID}/state`,
      `/api/social/projects/${PROJECT_ID}/access-requests`,
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      credentials: "include",
      method: "GET",
    }));
  });
});

describe("engagement API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stuurt een contractgeldige comment zonder profiel- of providergegevens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse({
      commentId: COMMENT_ID,
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      idempotencyKey: "comment-create:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      body: "Mooi werk @noor-bouwt",
      mentionUserIds: [PROFILE_ID],
    };

    await createEngagementComment(PROJECT_ID, UPDATE_ID, input);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/projects/${PROJECT_ID}/updates/${UPDATE_ID}/comments`,
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(input);
  });

  it("gebruikt alleen ondersteunde emoji en valideert de samenvatting", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successResponse({
        projectId: PROJECT_ID,
        updateId: UPDATE_ID,
        target: "update",
        commentId: null,
        items: [{ emoji: "🔨", count: 2, viewerReacted: true }],
      }))
      .mockResolvedValueOnce(successResponse({
        reactionId: REACTION_ID,
        state: "active",
        replayed: false,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await getEngagementReactions(PROJECT_ID, UPDATE_ID);
    await addEngagementReaction(PROJECT_ID, UPDATE_ID, { target: "update", emoji: "🔨" });

    expect(summary.items[0]).toEqual({ emoji: "🔨", count: 2, viewerReacted: true });
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("PUT");
  });

  it("patcht meldingen per opaque notificatie-id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse({
      notificationId: NOTIFICATION_ID,
      status: "read",
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await updateEngagementNotification(NOTIFICATION_ID, "read");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/notifications/${NOTIFICATION_ID}`);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ action: "read" });
  });

  it("extraheert unieke, genormaliseerde mention-slugs", () => {
    expect(extractMentionSlugs("Hoi @Noor-Bouwt en @sam. Nogmaals @noor-bouwt")).toEqual([
      "noor-bouwt",
      "sam",
    ]);
  });
});

describe("sociale browsermigratie", () => {
  const migratedFiles = [
    "src/pages/Friends.tsx",
    "src/pages/Profile.tsx",
    "src/components/FollowButton.tsx",
    "src/components/RequestAccessCard.tsx",
    "src/components/CommentsSheet.tsx",
    "src/components/ReactionBar.tsx",
    "src/components/NotificationBell.tsx",
  ];

  it.each(migratedFiles)("bevat geen Supabase-clientfallback: %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    expect(source.toLocaleLowerCase("nl-NL")).not.toContain("supabase");
  });

  it("baseert commentverwijdering op serverautoriteit en beperkt reactie-emoji", () => {
    const comments = readFileSync(resolve(process.cwd(), "src/components/CommentsSheet.tsx"), "utf8");
    const reactions = readFileSync(resolve(process.cwd(), "src/components/ReactionBar.tsx"), "utf8");
    expect(comments).toContain("comment.canDelete");
    expect(comments).not.toMatch(/user\.id\s*===|===\s*user\.id/);
    expect(reactions).not.toContain("🎉");
    expect(reactions).not.toContain("😍");
    expect(reactions).toContain("🔨");
  });
});

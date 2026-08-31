// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOwnProfile,
  getPublicProfile,
  updateOwnProfile,
} from "@/lib/profileApi";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    displayName: "Ada Bouwer",
    slug: "ada-bouwer",
    bio: null,
    location: "Utrecht",
    isPrivate: true,
    isPro: false,
    avatar: null,
    ...overrides,
  };
}

function success(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

describe("typed profile API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leest het eigen profiel cookie-authenticated zonder provider-id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success(profile({
      onboardedAt: null,
      version: 3,
      updatedAt: "2026-08-04T12:00:00.000Z",
    })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getOwnProfile();

    expect(result.id).toBe(PROFILE_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/profile",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("normaliseert een profielslug vóór de openbare profielread", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success(profile({
      isPrivate: false,
      viewerAccess: "public",
    })));
    vi.stubGlobal("fetch", fetchMock);

    await getPublicProfile(" Ada-Bouwer ");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/profiles/ada-bouwer");
  });

  it("stuurt alleen contractvelden en de serverversie bij een profielwrite", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      id: PROFILE_ID,
      version: 4,
      replayed: false,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      idempotencyKey: "profile-update:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expectedVersion: 3,
      displayName: "Ada Renovatie",
      isPrivate: false,
    };

    await updateOwnProfile(input);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("PATCH");
    expect(JSON.parse(String(request.body))).toEqual(input);
    expect(String(request.body)).not.toMatch(/userId|ownerId|isPro/);
  });

  it("weigert ongeldige of traversal-achtige slugs vóór een netwerkrequest", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublicProfile("../ander-account")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("profielbrowsermigratie", () => {
  it.each([
    "src/pages/AccountSettings.tsx",
    "src/pages/Profile.tsx",
    "src/components/Header.tsx",
  ])("bevat geen Supabase-profiel- of accountfallback: %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    expect(source.toLocaleLowerCase("nl-NL")).not.toContain("supabase");
  });

  it("gebruikt voor eigen profielnavigatie nooit het externe provider-id", () => {
    const header = readFileSync(resolve(process.cwd(), "src/components/Header.tsx"), "utf8");
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(header).toContain("PRODUCT_ROUTES.ownProfile");
    expect(header).not.toContain("profile.slug");
    expect(header).not.toMatch(/profile\/\$\{user\.id\}/);
    expect(header).not.toContain("OnboardingDialog");
    expect(app).toContain("profileHref: PRODUCT_ROUTES.ownProfile");
    expect(app).not.toMatch(/profile\/\$\{user\.id\}/);
  });

  it("gebruikt voor de geleverde account-lifecycleflow alleen de getypeerde serverboundary", () => {
    const account = readFileSync(resolve(process.cwd(), "src/pages/AccountSettings.tsx"), "utf8");
    expect(account).toContain("useAccountSessions");
    expect(account).toContain("useCreateAccountExportMutation");
    expect(account).toContain("useRequestAccountDeletionMutation");
    expect(account).toContain('deletionConfirmation !== "VERWIJDEREN"');
    expect(account).not.toMatch(/deleteUser|photobook_orders|\.from\(/);
  });
});

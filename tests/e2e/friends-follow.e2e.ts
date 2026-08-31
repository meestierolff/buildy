import { BASE, expect, test } from "./helpers";
import {
  FIXED_NOW,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

const followerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const incomingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const outgoingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const blockedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function socialProfile(overrides: Record<string, unknown> = {}) {
  return {
    avatar: null,
    bio: "Een volledig synthetische bouwer.",
    displayName: "Synthetische bouwer",
    followerCount: 8,
    followingCount: 4,
    followsViewer: false,
    id: SYNTHETIC_IDS.publicProfile,
    isPrivate: false,
    isPro: false,
    location: "Rotterdam",
    slug: "synthetische-bouwer",
    viewerAccess: "public",
    viewerFollowStatus: "none",
    ...overrides,
  };
}

function connection(
  id: string,
  displayName: string,
  viewerFollowStatus: "none" | "pending" | "following",
  overrides: Record<string, unknown> = {},
) {
  return {
    avatar: null,
    displayName,
    followsViewer: false,
    id,
    isPrivate: false,
    relationshipAt: FIXED_NOW,
    slug: displayName.toLocaleLowerCase("nl-NL").replaceAll(" ", "-"),
    viewerFollowStatus,
    ...overrides,
  };
}

const connectionByView = {
  following: connection(SYNTHETIC_IDS.publicProfile, "Synthetische bouwer", "following"),
  followers: connection(followerId, "Trouwe volger", "none", { followsViewer: true }),
  incoming: connection(incomingId, "Wachtende volger", "none", { followsViewer: true, isPrivate: true }),
  outgoing: connection(outgoingId, "Besloten bouwer", "pending", { isPrivate: true }),
  blocked: connection(blockedId, "Geblokkeerde bouwer", "none"),
} as const;

async function installSocialFixture(page: Parameters<typeof installSyntheticApi>[0]) {
  return installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === "/api/social/profiles") {
        const searching = url.searchParams.get("q") === "besloten";
        await fulfillJson(route, success({
          items: searching
            ? [socialProfile({
              id: SYNTHETIC_IDS.privateProfile,
              displayName: "Besloten zoeker",
              slug: "besloten-zoeker",
              isPrivate: true,
              viewerAccess: "requestable",
              bio: null,
              location: null,
              followerCount: 0,
              followingCount: 0,
            })]
            : [socialProfile()],
          nextCursor: null,
        }));
        return true;
      }
      if (request.method() === "GET" && url.pathname === "/api/social/connections") {
        const view = url.searchParams.get("view") as keyof typeof connectionByView;
        const item = connectionByView[view];
        await fulfillJson(route, success({
          items: item ? [item] : [],
          nextCursor: null,
          total: item ? 1 : 0,
          view,
        }));
        return true;
      }
      if (request.method() === "GET" && url.pathname === "/api/profiles/synthetische-bouwer") {
        await fulfillJson(route, success({
          id: SYNTHETIC_IDS.publicProfile,
          displayName: "Synthetische bouwer",
          slug: "synthetische-bouwer",
          bio: "Een volledig synthetische bouwer.",
          location: "Rotterdam",
          isPrivate: false,
          isPro: false,
          avatar: null,
          viewerAccess: "public",
        }));
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/social/profiles/${SYNTHETIC_IDS.publicProfile}`
      ) {
        await fulfillJson(route, success(socialProfile()));
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/social/profiles/${SYNTHETIC_IDS.privateProfile}`
      ) {
        // A schema-invalid success body models a restricted profile without
        // turning the browser's expected 404 into a noisy console diagnostic.
        await fulfillJson(route, success(null));
        return true;
      }
      if (url.pathname.endsWith("/follow") && ["PUT", "DELETE"].includes(request.method())) {
        await fulfillJson(route, success({
          replayed: false,
          state: request.method() === "PUT" && url.pathname.includes(SYNTHETIC_IDS.privateProfile)
            ? "pending"
            : request.method() === "PUT"
              ? "following"
              : "cancelled",
        }));
        return true;
      }
      if (/\/api\/social\/follow-requests\/[0-9a-f-]+\/(accept|reject)$/.test(url.pathname)) {
        await fulfillJson(route, success({
          replayed: false,
          state: url.pathname.endsWith("/accept") ? "following" : "rejected",
        }));
        return true;
      }
      if (request.method() === "DELETE" && /^\/api\/social\/followers\/[0-9a-f-]+$/.test(url.pathname)) {
        await fulfillJson(route, success({ replayed: false, state: "none" }));
        return true;
      }
      if (url.pathname.endsWith("/block") && ["PUT", "DELETE"].includes(request.method())) {
        await fulfillJson(route, success({
          replayed: false,
          state: request.method() === "PUT" ? "blocked" : "unblocked",
        }));
        return true;
      }
      if (request.method() === "GET" && url.pathname === "/api/following") {
        const project = {
          id: SYNTHETIC_IDS.project,
          slug: "synthetische-verbouwing",
          title: "Synthetische verbouwing",
          description: "Een afgeschermde feedfixture.",
          projectType: "Volledige renovatie",
          visibility: "followers",
          progressPercentage: 42,
          version: 4,
          updatedAt: FIXED_NOW,
          publishedAt: FIXED_NOW,
          updateCount: 1,
          lastUpdateAt: FIXED_NOW,
          owner: {
            id: SYNTHETIC_IDS.publicProfile,
            displayName: "Synthetische bouwer",
            slug: "synthetische-bouwer",
          },
          cover: null,
        };
        await fulfillJson(route, success({
          projects: [project],
          activity: [{
            project: { id: project.id, title: project.title },
            update: {
              id: SYNTHETIC_IDS.update,
              projectId: project.id,
              phase: null,
              title: "Eerste Bouwmoment uit de feed",
              room: "Keuken",
              description: "Dit Bouwmoment komt alleen uit de same-origin fixture.",
              updateDate: "2026-08-22",
              status: "published",
              isMilestone: true,
              sortOrder: 0,
              contentRevision: 1,
              version: 1,
              publishedAt: FIXED_NOW,
              updatedAt: FIXED_NOW,
              media: [],
            },
          }],
        }));
        return true;
      }
      return false;
    },
  });
}

test.describe("Connecties", () => {
  test("toont de vijf canonieke lijsten, server-owned aantallen en afgeschermde zoekidentiteit", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/connecties`);

    await expect(page.getByRole("heading", { name: "Bouw samen, op jouw voorwaarden." })).toBeVisible();
    for (const label of ["Volgend", "Volgers", "Inkomend", "Uitgaand", "Geblokkeerd"]) {
      await expect(page.getByRole("tab", { name: `${label} (1)` })).toBeVisible();
    }

    await page.getByLabel("Zoek bouwers op naam of gebruikersnaam").fill("besloten");
    await expect(page.getByText("Besloten zoeker", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Besloten zoeker/ })).toHaveCount(0);
    expect(fixture.requests.some((request) => (
      request.pathname === "/api/social/profiles" && request.search.includes("q=besloten")
    ))).toBe(true);
    expect(fixture.unhandled).toEqual([]);
  });

  test("volgt één gevonden openbaar profiel via PUT", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/connecties`);

    await page.getByRole("button", { name: "Volgen" }).first().click();
    await expect(page.getByText("Je volgt deze bouwer nu")).toBeVisible();

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "PUT",
      pathname: `/api/social/profiles/${SYNTHETIC_IDS.publicProfile}/follow`,
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("accepteert, trekt in en geeft vrij vanuit de canonieke tabbladen", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/connecties`);

    await page.getByRole("tab", { name: "Inkomend (1)" }).click();
    await page.getByRole("button", { name: "Accepteren" }).click();
    await expect(page.getByText("Volgverzoek geaccepteerd")).toBeVisible();

    await page.getByRole("tab", { name: "Uitgaand (1)" }).click();
    await page.getByRole("button", { name: "Intrekken" }).click();
    await expect(page.getByText("Verzoek ingetrokken")).toBeVisible();

    await page.getByRole("tab", { name: "Geblokkeerd (1)" }).click();
    await page.getByRole("button", { name: "Vrijgeven" }).click();
    await expect(page.getByText("Account vrijgegeven")).toBeVisible();

    expect(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "POST",
        pathname: `/api/social/follow-requests/${incomingId}/accept`,
      }),
      expect.objectContaining({
        method: "DELETE",
        pathname: `/api/social/profiles/${outgoingId}/follow`,
      }),
      expect.objectContaining({
        method: "DELETE",
        pathname: `/api/social/profiles/${blockedId}/block`,
      }),
    ]));
    expect(fixture.unhandled).toEqual([]);
  });

  test("wijst een verzoek af en verwijdert een bestaande volger", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/connecties`);

    await page.getByRole("tab", { name: "Inkomend (1)" }).click();
    await page.getByRole("button", { name: "Afwijzen" }).click();
    await expect(page.getByText("Volgverzoek afgewezen")).toBeVisible();

    await page.getByRole("tab", { name: "Volgers (1)" }).click();
    await page.getByRole("button", { name: "Verwijderen" }).click();
    await expect(page.getByText("Volger verwijderd")).toBeVisible();

    expect(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "POST",
        pathname: `/api/social/follow-requests/${incomingId}/reject`,
      }),
      expect.objectContaining({
        method: "DELETE",
        pathname: `/api/social/followers/${followerId}`,
      }),
    ]));
    expect(fixture.unhandled).toEqual([]);
  });
});

test.describe("Profiel en gevolgde Bouwmomenten", () => {
  test("volgt een profiel zonder tweede project-volgmodel", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/profiel/synthetische-bouwer`);

    await expect(page.getByRole("heading", { level: 1, name: "Synthetische bouwer" })).toBeVisible();
    await page.getByRole("button", { name: "Volgen", exact: true }).click();
    await expect(page.getByText("Je volgt deze bouwer nu")).toBeVisible();
    expect(fixture.requests.filter((request) => request.pathname.endsWith("/follow"))).toEqual([
      expect.objectContaining({
        method: "PUT",
        pathname: `/api/social/profiles/${SYNTHETIC_IDS.publicProfile}/follow`,
      }),
    ]);
    expect(fixture.requests.some((request) => request.pathname.includes("/social/projects/"))).toBe(false);
    expect(fixture.unhandled).toEqual([]);
  });

  test("toont de gevolgde feed als verbouwingen en Bouwmomenten", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/volgend`);

    await expect(page.getByRole("heading", { level: 1, name: "Volgend" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Verbouwingen (1)" })).toBeVisible();
    await expect(page.getByText("Eerste Bouwmoment uit de feed", { exact: true })).toBeVisible();
    await expect(page.getByText(/projecten die je volgt/i)).toHaveCount(0);
    expect(fixture.unhandled).toEqual([]);
  });

  test("verstuurt, annuleert en herhaalt een verzoek voor een afgeschermd privéprofiel", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/profiel/${SYNTHETIC_IDS.privateProfile}`);

    await expect(page.getByRole("heading", { name: "Profiel niet beschikbaar" })).toBeVisible();
    await page.getByRole("button", { name: "Volgverzoek versturen" }).click();
    await expect(page.getByText("Volgverzoek verstuurd")).toBeVisible();
    await page.getByRole("button", { name: "Verzoek intrekken" }).click();
    await expect(page.getByText("Verzoek ingetrokken")).toBeVisible();
    await page.getByRole("button", { name: "Volgverzoek versturen" }).click();
    await expect(page.getByText("Volgverzoek verstuurd")).toBeVisible();

    expect(fixture.requests.filter((captured) => (
      captured.pathname === `/api/social/profiles/${SYNTHETIC_IDS.privateProfile}/follow`
    ))).toEqual([
      expect.objectContaining({ method: "PUT" }),
      expect.objectContaining({ method: "DELETE" }),
      expect.objectContaining({ method: "PUT" }),
    ]);
    expect(fixture.unhandled).toEqual([]);
  });

  test("verbergt profieldata direct na blokkeren en herstelt geen volgrelatie bij deblokkeren", async ({ page }) => {
    const fixture = await installSocialFixture(page);
    await page.goto(`${BASE}/profiel/synthetische-bouwer`);

    await expect(page.getByText("Een volledig synthetische bouwer.")).toBeVisible();
    await page.getByRole("button", { name: "Blokkeren" }).click();
    const blockDialog = page.getByRole("alertdialog");
    await expect(blockDialog.getByRole("heading", { name: "Deze bouwer blokkeren?" })).toBeVisible();
    await blockDialog.getByRole("button", { name: "Blokkeren" }).click();
    await expect(page.getByRole("heading", { name: "Bouwer geblokkeerd" })).toBeVisible();
    await expect(page.getByText("Een volledig synthetische bouwer.")).toHaveCount(0);

    await page.getByRole("button", { name: "Deblokkeren" }).click();
    const unblockDialog = page.getByRole("alertdialog");
    await unblockDialog.getByRole("button", { name: "Deblokkeren" }).click();
    await expect(page.getByText("Bouwer gedeblokkeerd")).toBeVisible();
    await expect(page.getByRole("button", { name: "Volgen", exact: true })).toBeVisible();

    expect(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "PUT",
        pathname: `/api/social/profiles/${SYNTHETIC_IDS.publicProfile}/block`,
      }),
      expect.objectContaining({
        method: "DELETE",
        pathname: `/api/social/profiles/${SYNTHETIC_IDS.publicProfile}/block`,
      }),
    ]));
    expect(fixture.unhandled).toEqual([]);
  });
});

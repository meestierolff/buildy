import type { Page } from "@playwright/test";

import { BASE, expect, test } from "./helpers";
import {
  ONE_PIXEL_PNG,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
  syntheticProjectOverview,
  syntheticProjectUpdate,
} from "./syntheticApi";
import type { ProjectVisibility } from "../../shared/contracts/projects";

const COMMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REACTION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function installProjectFixture(page: Page) {
  let visibility: ProjectVisibility = "private";
  let commentBody: string | null = null;
  let reactionActive = false;
  return installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (url.pathname === "/api/projects" && request.method() === "GET") {
        await fulfillJson(route, success({ items: [], nextCursor: null }));
        return true;
      }
      if (url.pathname === `/api/media/${SYNTHETIC_IDS.media}`) {
        if (request.method() === "HEAD") {
          await route.fulfill({ status: 200, headers: { "content-type": "image/png" } });
          return true;
        }
        if (request.method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "image/png",
            headers: { "cache-control": "private, no-store" },
            body: ONE_PIXEL_PNG,
          });
          return true;
        }
      }
      if (url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`) {
        if (request.method() === "GET") {
          await fulfillJson(route, success(syntheticProjectOverview(visibility)));
          return true;
        }
        if (request.method() === "PATCH") {
          const body = request.postDataJSON() as { visibility?: ProjectVisibility };
          visibility = body.visibility ?? visibility;
          await fulfillJson(route, success({
            project: {
              ...syntheticProjectOverview(visibility),
              version: 8,
            },
            replayed: false,
          }));
          return true;
        }
        if (request.method() === "DELETE") {
          await fulfillJson(route, success({
            deletion: {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              projectId: SYNTHETIC_IDS.project,
              status: "deletion_pending",
              activeOrderCount: 0,
            },
            replayed: false,
          }), 202);
          return true;
        }
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates`
      ) {
        await fulfillJson(route, success({
          projectId: SYNTHETIC_IDS.project,
          items: [syntheticProjectUpdate()],
          nextCursor: null,
        }));
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/floorplans`
      ) {
        await fulfillJson(route, success({
          projectId: SYNTHETIC_IDS.project,
          viewerAccess: "owner",
          canEdit: true,
          floorplans: [],
        }));
        return true;
      }
      if (url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/reactions`) {
        if (request.method() === "GET") {
          await fulfillJson(route, success({
            projectId: SYNTHETIC_IDS.project,
            updateId: SYNTHETIC_IDS.update,
            target: "update",
            commentId: null,
            items: reactionActive ? [{ emoji: "👍", count: 1, viewerReacted: true }] : [],
          }));
          return true;
        }
        if (request.method() === "PUT" || request.method() === "DELETE") {
          reactionActive = request.method() === "PUT";
          await fulfillJson(route, success({
            reactionId: reactionActive ? REACTION_ID : null,
            state: reactionActive ? "active" : "removed",
            replayed: false,
          }));
          return true;
        }
      }
      if (
        url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/comments`
      ) {
        if (request.method() === "GET") {
          await fulfillJson(route, success({
            projectId: SYNTHETIC_IDS.project,
            updateId: SYNTHETIC_IDS.update,
            items: commentBody ? [{
              id: COMMENT_ID,
              projectId: SYNTHETIC_IDS.project,
              updateId: SYNTHETIC_IDS.update,
              parentCommentId: null,
              author: {
                id: SYNTHETIC_IDS.owner,
                displayName: "Synthetische eigenaar",
                slug: "synthetische-eigenaar",
                avatar: null,
              },
              body: commentBody,
              mentionCount: 0,
              version: 1,
              canDelete: true,
              createdAt: "2026-08-23T10:00:00.000Z",
              updatedAt: "2026-08-23T10:00:00.000Z",
            }] : [],
            nextCursor: null,
          }));
          return true;
        }
        if (request.method() === "POST") {
          const body = request.postDataJSON() as { body?: string };
          commentBody = body.body ?? null;
          await fulfillJson(route, success({ commentId: COMMENT_ID, replayed: false }), 201);
          return true;
        }
      }
      if (
        request.method() === "DELETE"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/comments/${COMMENT_ID}`
      ) {
        commentBody = null;
        await fulfillJson(route, success({ commentId: COMMENT_ID, replayed: false }));
        return true;
      }
      return false;
    },
  });
}

test.describe("Verbouwing detail", () => {
  test("toont Bouwmomenten en de vier expliciete zichtbaarheidstanden", async ({ page }) => {
    const fixture = await installProjectFixture(page);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);

    await expect(page.getByRole("heading", { level: 1, name: "Synthetische verbouwing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bouwmoment toevoegen", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Verhaal" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Plattegrond" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Alle foto's" })).toBeVisible();

    await page.getByLabel("Zichtbaarheid van de verbouwing").click();
    for (const option of ["Alleen ik", "Mijn volgers", "Alleen via deellink", "Openbaar"]) {
      await expect(page.getByRole("option", { name: option })).toBeVisible();
    }
    await page.getByRole("option", { name: "Openbaar" }).click();
    await expect(page.getByText("Zichtbaarheid ingesteld op Openbaar")).toBeVisible();

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      body: { expectedVersion: 7, visibility: "public" },
      method: "PATCH",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}`,
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("wisselt tijdlijn, plattegrond en alle foto's zonder data buiten de API", async ({ page }) => {
    const fixture = await installProjectFixture(page);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);

    await page.getByRole("button", { name: "Mijlpalen" }).click();
    await expect(page.getByText("Alleen mijlpalen worden getoond")).toBeVisible();

    await page.getByRole("tab", { name: "Plattegrond" }).click();
    await expect(page.getByText("Nog geen plattegrond")).toBeVisible();

    await page.getByRole("tab", { name: "Alle foto's" }).click();
    await page.getByRole("button", { name: "Open media van De eerste muur is open" }).click();
    await expect(page.getByTestId("media-lightbox")).toBeVisible();
    await page.getByRole("button", { name: "Lightbox sluiten" }).click();
    await expect(page.getByTestId("media-lightbox")).toHaveCount(0);

    expect(fixture.unhandled).toEqual([]);
  });

  test("laadt privémedia uitsluitend via de Buildy-proxy en doet geen HEAD N+1", async ({ page }) => {
    const network: Array<{ method: string; url: string }> = [];
    page.on("request", (request) => network.push({ method: request.method(), url: request.url() }));
    const fixture = await installProjectFixture(page);

    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);
    await expect(page.getByAltText("Omslagfoto van Synthetische verbouwing")).toBeVisible();

    const proxyRequests = network.filter(({ url }) => (
      new URL(url).pathname === `/api/media/${SYNTHETIC_IDS.media}`
    ));
    expect(proxyRequests.some(({ method }) => method === "GET")).toBe(true);
    expect(network.some(({ url }) => /\.blob\.vercel-storage\.com/i.test(url))).toBe(false);
    expect(network.filter(({ method, url }) => (
      method === "HEAD" && /\/(comments|reactions)(?:\?|$)/.test(url)
    ))).toEqual([]);
    expect(fixture.unhandled).toEqual([]);
  });

  test("verwijdert een verbouwing pas na de exacte destructieve bevestiging", async ({ page }) => {
    const fixture = await installProjectFixture(page);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);

    await page.getByRole("button", { name: "Verwijderen" }).click();
    const dialog = page.getByRole("alertdialog");
    const submit = dialog.getByRole("button", { name: "Verbouwing verwijderen" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Typ VERWIJDER VERBOUWING om te bevestigen").fill("VERWIJDER VERBOUWING");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page).toHaveURL(`${BASE}/projecten`);
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "DELETE",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}`,
      body: expect.objectContaining({
        confirmation: "VERWIJDER VERBOUWING",
        expectedVersion: 7,
      }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("plaatst en verwijdert reacties en een eigen comment via serverwrites", async ({ page }) => {
    const fixture = await installProjectFixture(page);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);

    await page.getByRole("button", { name: "De eerste muur is open uitklappen" }).click();
    await page.getByRole("button", { name: "Reactie kiezen" }).click();
    await page.getByRole("button", { name: "Reageer met 👍" }).click();
    const activeReaction = page.getByRole("button", { name: "Verwijder reactie 👍, 1" });
    await expect(activeReaction).toBeVisible();
    await activeReaction.click();
    await expect(activeReaction).toHaveCount(0);

    await page.getByRole("button", { name: "Reacties openen" }).click();
    await page.getByLabel("Nieuwe reactie").fill("Wat een mooi Bouwmoment!");
    await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
    await expect(page.getByText("Wat een mooi Bouwmoment!", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reactie van Synthetische eigenaar verwijderen" }).click();
    await expect(page.getByText("Wees de eerste die reageert.")).toBeVisible();

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "PUT",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/reactions`,
      body: { target: "update", emoji: "👍" },
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "DELETE",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/reactions`,
      body: { target: "update", emoji: "👍" },
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/comments`,
      body: expect.objectContaining({ body: "Wat een mooi Bouwmoment!", mentionUserIds: [] }),
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "DELETE",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/comments/${COMMENT_ID}`,
      body: expect.objectContaining({ expectedVersion: 1 }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });
});

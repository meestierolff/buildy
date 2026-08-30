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

test("maakt met minimale invoer een privéverbouwing en opent het eerste Bouwmoment", async ({ page }) => {
  let projectCreated = false;
  const fixture = await installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (url.pathname === "/api/projects" && request.method() === "GET") {
        await fulfillJson(route, success({
          items: projectCreated ? [syntheticProjectOverview("private")] : [],
          nextCursor: null,
        }));
        return true;
      }
      if (url.pathname === "/api/projects" && request.method() === "POST") {
        projectCreated = true;
        await fulfillJson(route, success({
          project: syntheticProjectOverview("private"),
          replayed: false,
        }), 201);
        return true;
      }
      if (url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`) {
        if (request.method() === "GET") {
          await fulfillJson(route, success(syntheticProjectOverview("private")));
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
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates/${SYNTHETIC_IDS.update}/reactions`
      ) {
        await fulfillJson(route, success({
          projectId: SYNTHETIC_IDS.project,
          updateId: SYNTHETIC_IDS.update,
          target: "update",
          commentId: null,
          items: [],
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
      if (url.pathname === `/api/media/${SYNTHETIC_IDS.media}` && request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "cache-control": "private, no-store" },
          body: ONE_PIXEL_PNG,
        });
        return true;
      }
      return false;
    },
  });

  await page.goto(`${BASE}/project/nieuw`);
  await expect(page.getByRole("heading", { name: "Hoe heet je verbouwing?" })).toBeVisible();
  await expect(page.getByText(/Je begint privé/i)).toBeVisible();
  await page.getByLabel("Hoe heet je verbouwing?").fill("Ons warme familiehuis");
  await page.getByLabel("Wat verbouw je?").click();
  await page.getByRole("option", { name: "Volledige renovatie" }).click();
  await expect(page.getByLabel(/beschrijving|startdatum|einddatum|adres|zichtbaarheid/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Verbouwing starten" }).click();

  await expect(page).toHaveURL(`${BASE}/project/${SYNTHETIC_IDS.project}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wat is er veranderd?" })).toBeVisible();
  await page.getByRole("button", { name: "Annuleren" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Synthetische verbouwing" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Zichtbaarheid van de verbouwing/ }))
    .toHaveText("Alleen ik");

  const create = fixture.requests.find((request) => (
    request.method === "POST" && request.pathname === "/api/projects"
  ));
  expect(create?.body).toMatchObject({
    title: "Ons warme familiehuis",
    projectType: "Volledige renovatie",
  });
  expect(create?.body).not.toHaveProperty("description");
  expect(create?.body).not.toHaveProperty("startDate");
  expect(create?.body).not.toHaveProperty("expectedEndDate");
  expect(create?.body).not.toHaveProperty("privateDetails");
  expect(create?.body).not.toHaveProperty("ownerId");
  expect(create?.body).not.toHaveProperty("visibility");
  expect(fixture.requests.some((request) => request.method === "PATCH")).toBe(false);
  expect(fixture.unhandled).toEqual([]);
});

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

test("maakt een verbouwing en bevestigt gedeelde zichtbaarheid met een afzonderlijke serverwrite", async ({ page }) => {
  let visibility: ProjectVisibility = "private";
  const fixture = await installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (url.pathname === "/api/projects" && request.method() === "POST") {
        await fulfillJson(route, success({
          project: syntheticProjectOverview("private"),
          replayed: false,
        }), 201);
        return true;
      }
      if (url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`) {
        if (request.method() === "PATCH") {
          const body = request.postDataJSON() as { visibility?: ProjectVisibility };
          visibility = body.visibility ?? visibility;
          await fulfillJson(route, success({
            project: { ...syntheticProjectOverview(visibility), version: 8 },
            replayed: false,
          }));
          return true;
        }
        if (request.method() === "GET") {
          await fulfillJson(route, success({
            ...syntheticProjectOverview(visibility),
            version: visibility === "private" ? 7 : 8,
          }));
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
  await page.getByLabel("Naam van je verbouwing").fill("Ons warme familiehuis");
  await page.getByLabel("Type verbouwing").click();
  await page.getByRole("option", { name: "Volledige renovatie" }).click();
  await page.getByLabel("Korte beschrijving").fill("Van losse foto's naar één rustig Verhaal.");
  await page.getByLabel("Startdatum").fill("2026-08-01");
  await page.getByLabel("Verwachte einddatum").fill("2026-12-20");
  await page.getByLabel(/Adres/).fill("Voorbeeldstraat 1, Utrecht");
  await page.locator("#visibility").click();
  await page.getByRole("option", { name: "Mijn volgers" }).click();
  await page.getByRole("button", { name: "Verbouwing starten" }).click();

  await expect(page).toHaveURL(`${BASE}/project/${SYNTHETIC_IDS.project}?update=${SYNTHETIC_IDS.update}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wat is er veranderd?" })).toBeVisible();
  await page.getByRole("button", { name: "Annuleren" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Synthetische verbouwing" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Zichtbaarheid van de verbouwing/ }))
    .toHaveText("Mijn volgers");

  const create = fixture.requests.find((request) => (
    request.method === "POST" && request.pathname === "/api/projects"
  ));
  expect(create?.body).toMatchObject({
    title: "Ons warme familiehuis",
    description: "Van losse foto's naar één rustig Verhaal.",
    projectType: "Volledige renovatie",
    startDate: "2026-08-01",
    expectedEndDate: "2026-12-20",
    privateDetails: { addressLine1: "Voorbeeldstraat 1, Utrecht" },
  });
  expect(create?.body).not.toHaveProperty("ownerId");
  expect(create?.body).not.toHaveProperty("visibility");
  expect(fixture.requests).toContainEqual(expect.objectContaining({
    method: "PATCH",
    pathname: `/api/projects/${SYNTHETIC_IDS.project}`,
    body: { expectedVersion: 7, visibility: "followers" },
  }));
  expect(fixture.unhandled).toEqual([]);
});

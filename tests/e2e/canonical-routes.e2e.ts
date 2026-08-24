import { BASE, expect, test } from "./helpers";
import {
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
  syntheticProjectOverview,
} from "./syntheticApi";

test("een oude projectlink behoudt query en fragment op de canonieke route", async ({ page }) => {
  const projectId = SYNTHETIC_IDS.project;
  const fixture = await installSyntheticApi(page, {
    authenticated: false,
    handle: async ({ request, route, url }) => {
      if (request.method() !== "GET") return false;
      if (url.pathname === `/api/projects/${projectId}`) {
        await fulfillJson(route, success({
          ...syntheticProjectOverview("public"),
          canEdit: false,
          viewerAccess: "public",
        }));
        return true;
      }
      if (url.pathname === `/api/projects/${projectId}/updates`) {
        await fulfillJson(route, success({ projectId, items: [], nextCursor: null }));
        return true;
      }
      return false;
    },
  });
  await page.goto(
    `${BASE}/trip/${projectId}?tab=fotos&filter=voor%20en%20na#update-bestaand`,
    { waitUntil: "domcontentloaded" },
  );

  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}${url.hash}`;
  }).toBe(`/project/${projectId}?tab=fotos&filter=voor%20en%20na#update-bestaand`);
  expect(fixture.unhandled).toEqual([]);
});

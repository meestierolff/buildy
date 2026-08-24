import { BASE, expect, test } from "./helpers";
import {
  ONE_PIXEL_PNG,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
  syntheticProjectOverview,
} from "./syntheticApi";

test("bewaart een concept en plaatst exact één Bouwmoment via private Vercel Blob", async ({ page }) => {
  let updateRequests = 0;
  let providerUploads = 0;
  let updatePayload: Record<string, unknown> | null = null;
  let preparedSize = 0;
  const pathname = `temporary/${SYNTHETIC_IDS.media.slice(0, 2)}/${SYNTHETIC_IDS.media}`;

  const fixture = await installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`
      ) {
        await fulfillJson(route, success(syntheticProjectOverview()));
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates`
      ) {
        await fulfillJson(route, success({
          projectId: SYNTHETIC_IDS.project,
          items: [],
          nextCursor: null,
        }));
        return true;
      }
      if (request.method() === "POST" && url.pathname === "/api/media/upload-intents") {
        const body = request.postDataJSON() as { sizeBytes: number };
        preparedSize = body.sizeBytes;
        await fulfillJson(route, success({
          asset: {
            id: SYNTHETIC_IDS.media,
            projectId: SYNTHETIC_IDS.project,
            purpose: "project_media",
            status: "pending_upload",
          },
          upload: {
            provider: "vercel_blob",
            method: "POST",
            pathname,
            handleUploadPath: `/api/media/${SYNTHETIC_IDS.media}/blob-upload`,
            exactSizeBytes: body.sizeBytes,
          },
          replayed: false,
        }), 201);
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/media/${SYNTHETIC_IDS.media}/blob-upload`
      ) {
        await fulfillJson(route, {
          clientToken: "vercel_blob_client_synthetic_not-a-real-token",
        });
        return true;
      }
      if (url.origin === "https://vercel.com" && url.pathname === "/api/blob/") {
        const cors = {
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "PUT, OPTIONS",
          "access-control-allow-origin": "*",
        };
        if (request.method() === "OPTIONS") {
          await route.fulfill({ status: 204, headers: cors });
          return true;
        }
        providerUploads += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({
            url: `https://synthetic.private.blob.vercel-storage.com/${pathname}`,
            downloadUrl: `https://synthetic.private.blob.vercel-storage.com/${pathname}?download=1`,
            pathname,
            contentType: "image/png",
            contentDisposition: "inline",
            etag: "synthetic-etag",
          }),
        });
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/media/${SYNTHETIC_IDS.media}/complete`
      ) {
        await fulfillJson(route, success({
          asset: {
            id: SYNTHETIC_IDS.media,
            projectId: SYNTHETIC_IDS.project,
            purpose: "project_media",
            status: "ready",
          },
          replayed: false,
        }));
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates`
      ) {
        updateRequests += 1;
        updatePayload = request.postDataJSON() as Record<string, unknown>;
        await new Promise((resolve) => setTimeout(resolve, 150));
        await fulfillJson(route, success({
          update: {
            id: SYNTHETIC_IDS.update,
            projectId: SYNTHETIC_IDS.project,
            phase: null,
            title: "De eerste muur is open",
            room: null,
            description: null,
            updateDate: "2026-08-23",
            status: "published",
            isMilestone: false,
            sortOrder: 0,
            contentRevision: 1,
            version: 1,
            publishedAt: "2026-08-23T10:00:00.000Z",
            updatedAt: "2026-08-23T10:00:00.000Z",
            media: [{
              id: SYNTHETIC_IDS.media,
              contentType: "image/png",
              width: 1,
              height: 1,
              proxyPath: `/api/media/${SYNTHETIC_IDS.media}`,
              role: "gallery",
              sortOrder: 0,
              caption: null,
            }],
          },
          replayed: false,
        }), 201);
        return true;
      }
      return false;
    },
  });

  await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);
  await page.getByRole("button", { name: "Bouwmoment toevoegen", exact: true }).click();
  const title = page.getByLabel("Korte titel of bijschrift (optioneel)");
  await title.fill("De eerste muur is open");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toContainText("Concept bewaren?");
  await page.getByRole("button", { name: "Verder met Bouwmoment" }).click();
  await expect(title).toHaveValue("De eerste muur is open");

  await page.getByLabel("Kies foto's uit je bibliotheek").setInputFiles({
    name: "synthetische-bouwfoto.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await expect(page.getByAltText("Voorvertoning 1")).toBeVisible();

  const refreshedOverview = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`;
  });
  const refreshedTimeline = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates`;
  });
  await page.getByRole("button", { name: "Bouwmoment plaatsen" }).evaluate((button) => {
    button.click();
    button.click();
  });

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await Promise.all([refreshedOverview, refreshedTimeline]);
  await page.waitForLoadState("networkidle");
  expect(updateRequests).toBe(1);
  expect(providerUploads).toBe(1);
  expect(preparedSize).toBe(ONE_PIXEL_PNG.byteLength);
  expect(updatePayload).toMatchObject({
    expectedProjectVersion: 7,
    title: "De eerste muur is open",
    publish: true,
    media: [{
      assetId: SYNTHETIC_IDS.media,
      role: "gallery",
      sortOrder: 0,
    }],
  });
  expect(updatePayload).not.toHaveProperty("userId");
  expect(updatePayload).not.toHaveProperty("storagePath");
  expect(updatePayload).not.toHaveProperty("blobUrl");

  const intent = fixture.requests.find((request) => request.pathname === "/api/media/upload-intents");
  expect(intent?.body).toMatchObject({
    projectId: SYNTHETIC_IDS.project,
    purpose: "project_media",
    contentType: "image/png",
    sizeBytes: ONE_PIXEL_PNG.byteLength,
  });
  expect(intent?.body).not.toHaveProperty("providerUrl");

  const tokenRequest = fixture.requests.find((request) => (
    request.pathname === `/api/media/${SYNTHETIC_IDS.media}/blob-upload`
  ));
  expect(tokenRequest?.body).toEqual({
    type: "blob.generate-client-token",
    payload: {
      pathname,
      clientPayload: null,
      multipart: false,
    },
  });
  expect(fixture.unhandled).toEqual([]);
});

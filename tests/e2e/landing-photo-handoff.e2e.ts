import { BASE, expect, test } from "./helpers";
import {
  ONE_PIXEL_PNG,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
  syntheticAuthSession,
  syntheticOwnProfile,
  syntheticProjectOverview,
} from "./syntheticApi";

test("draagt een landingfoto lokaal door Google-login naar het eerste Bouwmoment", async ({ page }) => {
  let authenticated = false;
  let googleStartBody: unknown = null;
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));

  const fixture = await installSyntheticApi(page, {
    authenticated: false,
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === "/api/auth/session") {
        await fulfillJson(route, syntheticAuthSession(authenticated));
        return true;
      }
      if (request.method() === "GET" && url.pathname === "/api/discovery") {
        await fulfillJson(route, success({ items: [], nextCursor: null }));
        return true;
      }
      if (authenticated && request.method() === "GET" && url.pathname === "/api/account/profile") {
        await fulfillJson(route, syntheticOwnProfile());
        return true;
      }
      if (authenticated && request.method() === "GET" && url.pathname === "/api/notifications") {
        await fulfillJson(route, success({ items: [], nextCursor: null, unreadCount: 0 }));
        return true;
      }
      if (request.method() === "POST" && url.pathname === "/api/auth/sign-in/google") {
        googleStartBody = request.postDataJSON();
        await fulfillJson(route, success({
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic",
        }));
        return true;
      }
      if (url.origin === "https://accounts.google.com") {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!doctype html><title>Synthetische Google-toestemming</title>",
        });
        return true;
      }
      if (request.method() === "POST" && url.pathname === "/api/projects") {
        await fulfillJson(route, success({
          project: { ...syntheticProjectOverview("private"), updateCount: 0 },
          replayed: false,
        }), 201);
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`
      ) {
        await fulfillJson(route, success({
          ...syntheticProjectOverview("private"),
          updateCount: 0,
        }));
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
      return false;
    },
  });

  await page.goto(`${BASE}/#probeer-buildy`);
  await page.getByLabel("Kies een verbouwfoto van dit apparaat").setInputFiles({
    name: "keuken-met-privenaam.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await page.getByRole("link", { name: "Bewaar dit bouwmoment" }).click();

  await expect(page).toHaveURL(
    /\/auth\?mode=register&provider=google&next=%2Fproject%2Fnieuw%3Fintent%3Deerste-bouwmoment$/,
  );
  const localRecord = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("buildy-local-photo-handoff", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ fields: string[]; byteLength: number } | null>((resolve, reject) => {
        const request = database.transaction("handoff", "readonly").objectStore("handoff").get("first-moment-photo");
        request.onsuccess = () => {
          const photo = request.result?.photo as Record<string, unknown> | undefined;
          resolve(photo ? {
            fields: Object.keys(photo).sort(),
            byteLength: photo.bytes instanceof ArrayBuffer ? photo.bytes.byteLength : -1,
          } : null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(localRecord).toEqual({
    fields: ["bytes", "contentType", "id", "savedAt", "version"],
    byteLength: ONE_PIXEL_PNG.byteLength,
  });
  expect(fixture.requests.some((request) => request.pathname.startsWith("/api/media"))).toBe(false);
  expect(requestedUrls.some((url) => url.includes("blob.vercel-storage.com"))).toBe(false);

  await page.getByRole("button", { name: "Registreren met Google" }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  expect(googleStartBody).toEqual({ next: "/project/nieuw?intent=eerste-bouwmoment" });

  authenticated = true;
  await page.goto(`${BASE}/project/nieuw?intent=eerste-bouwmoment`);
  await page.getByLabel("Naam van je verbouwing").fill("Ons synthetische familiehuis");
  await page.getByRole("button", { name: "Verbouwing starten" }).click();

  await expect(page).toHaveURL(`${BASE}/project/${SYNTHETIC_IDS.project}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByAltText("Voorvertoning 1")).toBeVisible();
  await expect(page.getByText("eerste-bouwmoment.png")).toBeVisible();
  await expect(page.getByText(/alleen vanaf dit apparaat overgenomen/i)).toBeVisible();
  await expect(page.getByText("keuken-met-privenaam.png")).toHaveCount(0);

  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("buildy-local-photo-handoff", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const request = database.transaction("handoff", "readonly").objectStore("handoff").get("first-moment-photo");
        request.onsuccess = () => resolve(request.result === undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  })).toBe(true);

  expect(fixture.requests.some((request) => request.pathname.startsWith("/api/media"))).toBe(false);
  expect(requestedUrls.some((url) => url.includes("blob.vercel-storage.com"))).toBe(false);
  expect(requestedUrls.some((url) => url.includes("keuken-met-privenaam"))).toBe(false);
  expect(fixture.unhandled).toEqual([]);
});

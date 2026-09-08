import type { Page, Route } from "@playwright/test";

import { allowBrowserDiagnostics, BASE, expect, test } from "./helpers";
import {
  FIXED_NOW,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
  syntheticProjectCard,
} from "./syntheticApi";

function observeNavigatedPaths(page: Page): string[] {
  const paths: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) paths.push(new URL(frame.url()).pathname);
  });
  return paths;
}

async function waitForLandingReady(page: Page): Promise<void> {
  // Firefox can report an aborted superseded image request during the full-page
  // logout navigation. The assertions below still require the final images to
  // have decoded successfully before the test may finish.
  allowBrowserDiagnostics(
    page,
    /^requestfailed: GET .*\/images\/buildy-(?:renovation-complete|bouwboek-preview)\.webp \(NS_BINDING_ABORTED\)$/,
  );
  await expect(page.getByRole("heading", {
    level: 1,
    name: "Maak van je verbouwing een verhaal om te bewaren.",
  })).toBeVisible();
  for (const source of [
    "/images/buildy-renovation-complete.webp",
    "/images/buildy-bouwboek-preview.webp",
  ]) {
    const image = page.locator(`img[src="${source}"]`);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => (
      element.complete && element.naturalWidth > 0
    ))).toBe(true);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function accountRoutes(route: Route, pathname: string, method: string): Promise<boolean> {
  if (pathname === "/api/projects" && method === "GET") {
    await fulfillJson(route, success({
      items: [syntheticProjectCard("private")],
      nextCursor: null,
    }));
    return true;
  }
  if (pathname === "/api/account/sessions" && method === "GET") {
    await fulfillJson(route, success({
      sessions: [{
        id: SYNTHETIC_IDS.session,
        isCurrent: true,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: FIXED_NOW,
        expiresAt: "2099-08-23T10:00:00.000Z",
        ipAddress: null,
        userAgent: "Mozilla/5.0 Macintosh",
      }],
    }));
    return true;
  }
  if (pathname === "/api/account/exports" && method === "GET") {
    await fulfillJson(route, success({ exports: [] }));
    return true;
  }
  if (pathname === "/api/account/profile" && method === "PATCH") {
    await fulfillJson(route, success({
      id: SYNTHETIC_IDS.owner,
      version: 4,
      replayed: false,
    }));
    return true;
  }
  return false;
}

test.describe("Accountinstellingen", () => {
  test("laadt server-owned accountdata en toont uitsluitend Google-login", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      handle: ({ request, route, url }) => accountRoutes(route, url.pathname, request.method()),
    });

    await page.goto(`${BASE}/profiel`);

    await expect(page.getByRole("heading", { level: 1, name: "Jouw Buildy" })).toBeVisible();
    await expect(page.getByLabel("Weergavenaam")).toHaveValue("Synthetische eigenaar");
    await expect(page.getByText(/uitsluitend in met Google/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Actieve sessies" })).toBeVisible();
    await expect(page.getByText("Dit apparaat")).toBeVisible();
    await expect(page.getByRole("button", { name: "Account verwijderen" })).toBeVisible();
    await expect(page.getByLabel(/wachtwoord/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /wachtwoord/i })).toHaveCount(0);

    const desktopNavigation = (page.viewportSize()?.width ?? 1440) >= 1024;
    const primaryNavigation = page.getByRole("navigation", {
      name: desktopNavigation ? "Hoofdnavigatie" : "Mobiele navigatie",
    });
    for (const [desktopLabel, mobileLabel, href] of [
      ["Mijn verbouwing", "Verhaal", `/project/${SYNTHETIC_IDS.project}`],
      ["Bouwmoment toevoegen", "Toevoegen", `/project/${SYNTHETIC_IDS.project}?update=nieuw`],
      ["Bouwboek", "Bouwboek", `/project/${SYNTHETIC_IDS.project}/bouwboek`],
      ["Profiel", "Profiel", "/profiel"],
    ]) {
      const link = primaryNavigation.getByRole("link", { name: desktopNavigation ? desktopLabel : mobileLabel });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", href);
    }
    await expect(primaryNavigation.getByRole("link", { name: /budget|ontdek/i })).toHaveCount(0);
    expect(fixture.unhandled).toEqual([]);
  });

  test("stuurt een profielwijziging zonder identity- of providergegevens", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      handle: ({ request, route, url }) => accountRoutes(route, url.pathname, request.method()),
    });

    await page.goto(`${BASE}/account`);
    await expect(page).toHaveURL(`${BASE}/profiel`);
    await page.getByLabel("Weergavenaam").fill("Nieuwe synthetische naam");
    await page.getByRole("button", { name: "Profiel opslaan" }).click();
    await expect(page.getByText("Je profiel is bijgewerkt.")).toBeVisible();

    const mutation = fixture.requests.find((request) => (
      request.method === "PATCH" && request.pathname === "/api/account/profile"
    ));
    expect(mutation?.body).toMatchObject({
      displayName: "Nieuwe synthetische naam",
      expectedVersion: 3,
    });
    expect(mutation?.body).not.toHaveProperty("email");
    expect(mutation?.body).not.toHaveProperty("googleSubject");
    expect(fixture.unhandled).toEqual([]);
  });

  test("logt uit via de server en keert terug naar de publieke landing", async ({ page }) => {
    const navigatedPaths = observeNavigatedPaths(page);
    let signedOut = false;
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
          signedOut = true;
          await fulfillJson(route, success({ signedOut: true }));
          return true;
        }
        if (url.pathname === "/api/auth/session" && request.method() === "GET" && signedOut) {
          await fulfillJson(route, success({ session: null, user: null }));
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/profiel`);
    await page.getByRole("button", { name: "Uitloggen", exact: true }).click();

    await expect(page).toHaveURL(`${BASE}/`);
    await waitForLandingReady(page);
    expect(navigatedPaths, "uitloggen opent geen tussentijdse authroute").not.toContain("/auth");
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/auth/logout",
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("accepteert een verloren logoutresponse wanneer de sessie daarna anoniem is", async ({ page }) => {
    allowBrowserDiagnostics(
      page,
      /^http-503: POST .*\/api\/auth\/logout$/,
      /^console: Failed to load resource:.*503/,
      /^console: Sign-out failed /,
    );
    const navigatedPaths = observeNavigatedPaths(page);
    let logoutAttempted = false;
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
          logoutAttempted = true;
          await fulfillJson(route, { error: { code: "SERVICE_UNAVAILABLE" } }, 503);
          return true;
        }
        if (logoutAttempted && url.pathname === "/api/auth/session" && request.method() === "GET") {
          await fulfillJson(route, success({ session: null, user: null }));
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/profiel`);
    await page.getByRole("button", { name: "Uitloggen", exact: true }).click();

    await expect(page).toHaveURL(`${BASE}/`);
    await waitForLandingReady(page);
    expect(navigatedPaths, "verloren logoutresponse opent geen authroute").not.toContain("/auth");
    expect(fixture.unhandled).toEqual([]);
  });

  test("blijft bij een actieve sessie op het profiel wanneer uitloggen faalt", async ({ page }) => {
    allowBrowserDiagnostics(
      page,
      /^http-503: POST .*\/api\/auth\/logout$/,
      /^console: Failed to load resource:.*503/,
      /^console: Sign-out failed /,
    );
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
          await fulfillJson(route, {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Uitloggen is tijdelijk niet beschikbaar.",
              requestId: SYNTHETIC_IDS.request,
            },
          }, 503);
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/profiel`);
    await page.getByRole("button", { name: "Uitloggen", exact: true }).click();

    await expect(page).toHaveURL(`${BASE}/profiel`);
    await expect(page.getByRole("heading", { level: 1, name: "Jouw Buildy" })).toBeVisible();
    await expect(page.getByText("Uitloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.")).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("behoudt de bekende sessie wanneer logout en verificatie beide falen", async ({ page }) => {
    allowBrowserDiagnostics(
      page,
      /^http-503: (?:GET .*\/api\/auth\/session|POST .*\/api\/auth\/logout)$/,
      /^console: Failed to load resource:.*503/,
      /^console: Sign-out failed /,
    );
    let logoutAttempted = false;
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
          logoutAttempted = true;
          await fulfillJson(route, { error: { code: "SERVICE_UNAVAILABLE" } }, 503);
          return true;
        }
        if (logoutAttempted && url.pathname === "/api/auth/session" && request.method() === "GET") {
          await fulfillJson(route, { error: { code: "SERVICE_UNAVAILABLE" } }, 503);
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/profiel`);
    await page.getByRole("button", { name: "Uitloggen", exact: true }).click();

    await expect(page).toHaveURL(`${BASE}/profiel`);
    await expect(page.getByRole("heading", { level: 1, name: "Jouw Buildy" })).toBeVisible();
    await expect(page.getByText("Uitloggen is tijdelijk niet beschikbaar. Probeer het later opnieuw.")).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("trekt een andere sessie in en vraagt een private data-export aan", async ({ page }) => {
    const otherSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const exportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let sessions = [
      {
        id: SYNTHETIC_IDS.session,
        isCurrent: true,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: FIXED_NOW,
        expiresAt: "2099-08-23T10:00:00.000Z",
        ipAddress: null,
        userAgent: "Mozilla/5.0 Macintosh",
      },
      {
        id: otherSessionId,
        isCurrent: false,
        createdAt: "2026-08-02T12:00:00.000Z",
        updatedAt: FIXED_NOW,
        expiresAt: "2099-08-24T10:00:00.000Z",
        ipAddress: null,
        userAgent: "Mozilla/5.0 Android",
      },
    ];
    let exports: Array<Record<string, unknown>> = [];
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/account/sessions" && request.method() === "GET") {
          await fulfillJson(route, success({ sessions }));
          return true;
        }
        if (url.pathname === `/api/account/sessions/${otherSessionId}` && request.method() === "DELETE") {
          sessions = sessions.filter((session) => session.id !== otherSessionId);
          await fulfillJson(route, success({
            revokedSessionId: otherSessionId,
            revokedCurrentSession: false,
          }));
          return true;
        }
        if (url.pathname === "/api/account/exports" && request.method() === "GET") {
          await fulfillJson(route, success({ exports }));
          return true;
        }
        if (url.pathname === "/api/account/exports" && request.method() === "POST") {
          const item = {
            id: exportId,
            status: "requested",
            includeMedia: false,
            manifestSha256: null,
            createdAt: FIXED_NOW,
            completedAt: null,
            expiresAt: null,
            downloadPath: null,
            failureCode: null,
          };
          exports = [item];
          await fulfillJson(route, success({ export: item, replayed: false }), 202);
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/profiel`);
    await expect(page.getByText("Android-apparaat")).toBeVisible();
    await page.getByRole("button", { name: "Sessie intrekken" }).click();
    await expect(page.getByText("De sessie is ingetrokken.")).toBeVisible();
    await expect(page.getByText("Android-apparaat")).toHaveCount(0);

    await page.getByRole("switch", { name: "Foto's en bestanden toevoegen" }).click();
    await page.getByRole("button", { name: "Data-export aanvragen" }).click();
    await expect(page.getByText("Je data-export staat in de wachtrij.")).toBeVisible();
    await expect(page.getByText("In wachtrij")).toBeVisible();

    expect(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "DELETE", pathname: `/api/account/sessions/${otherSessionId}` }),
      expect.objectContaining({
        method: "POST",
        pathname: "/api/account/exports",
        body: expect.objectContaining({ includeMedia: false }),
      }),
    ]));
    expect(fixture.unhandled).toEqual([]);
  });

  test("vereist de exacte verwijderbevestiging en meldt de accountverwijdering server-side aan", async ({ page }) => {
    const navigatedPaths = observeNavigatedPaths(page);
    let signedOut = false;
    const deletionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/auth/session" && request.method() === "GET" && signedOut) {
          await fulfillJson(route, success({ session: null, user: null }));
          return true;
        }
        if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
          signedOut = true;
          await fulfillJson(route, success({ signedOut: true }));
          return true;
        }
        if (url.pathname === "/api/account/deletion" && request.method() === "POST") {
          await fulfillJson(route, success({
            deletion: {
              id: deletionId,
              status: "deletion_pending",
              activeOrderCount: 0,
            },
            replayed: false,
          }), 202);
          return true;
        }
        if (url.pathname === "/api/discovery" && request.method() === "GET") {
          await fulfillJson(route, success({ items: [], nextCursor: null }));
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/profiel`);
    await page.getByRole("button", { name: "Account verwijderen" }).click();
    const dialog = page.getByRole("alertdialog");
    const submit = dialog.getByRole("button", { name: "Definitief verwijderen" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Typ VERWIJDEREN").fill("VERWIJDEREN");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect.poll(() => fixture.requests.some((request) => (
      request.method === "POST" && request.pathname === "/api/account/deletion"
    ))).toBe(true);
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/account/deletion",
      body: expect.objectContaining({ confirmation: "VERWIJDEREN" }),
    }));
    await expect(page).toHaveURL(`${BASE}/`);
    await waitForLandingReady(page);
    expect(navigatedPaths, "accountverwijdering opent geen tussentijdse authroute").not.toContain("/auth");
    expect(fixture.unhandled).toEqual([]);
  });
});

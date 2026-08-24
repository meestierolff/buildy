import { BASE, expect, test } from "./helpers";
import { fulfillJson, installSyntheticApi, success } from "./syntheticApi";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function installPublicFixture(page: Parameters<typeof installSyntheticApi>[0]) {
  return installSyntheticApi(page, {
    authenticated: false,
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === "/api/discovery") {
        await fulfillJson(route, success({ items: [], nextCursor: null }));
        return true;
      }
      return false;
    },
  });
}

test.describe("Marketinglanding en openbare ontdekking", () => {
  test("communicates the founder-approved promise and complete product proof", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(BASE);

    await expect(page.getByRole("heading", {
      level: 1,
      name: "Maak van je verbouwing een verhaal om te bewaren.",
    })).toBeVisible();
    await expect(page.getByText(
      "Leg ieder bouwmoment vast, laat vrienden en familie meekijken en maak er later een persoonlijk Bouwboek van.",
    )).toBeVisible();
    await expect(page.getByRole("link", { name: "Voeg je eerste verbouwfoto toe" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Bekijk een voorbeeld" })).toBeVisible();
    await expect(page.getByText("Voorbeeldverbouwing").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Delen zonder steeds hetzelfde verhaal/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Jouw huis hoeft niet voor iedereen open/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Je Bouwboek groeit/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Eerst weten, dan bewaren/i })).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("keeps a demo photo local and shows the full photo-to-Bouwboek transformation", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.goto(`${BASE}/#probeer-buildy`);

    await expect(page.getByText(/Pas na Google-login en wanneer jij het Bouwmoment plaatst/i)).toBeVisible();
    await page.getByLabel("Kies een verbouwfoto van dit apparaat").setInputFiles({
      name: "keuken-met-privenaam.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });

    await expect(page.getByAltText("Jouw gekozen verbouwfoto in de lokale voorbeeldweergave").first()).toBeVisible();
    await expect(page.getByText("02 · Bouwmoment")).toBeVisible();
    await expect(page.getByText("03 · Verhaal")).toBeVisible();
    await expect(page.getByText("04 · Bouwboek")).toBeVisible();
    await expect(page.getByRole("link", { name: /Bewaar dit bouwmoment/i })).toBeVisible();
    expect(requestedUrls.some((url) => url.includes("keuken-met-privenaam"))).toBe(false);

    await page.getByRole("link", { name: /Bewaar dit bouwmoment/i }).click();
    await expect(page).toHaveURL(
      /\/auth\?mode=register&provider=google&next=%2Fproject%2Fnieuw%3Fintent%3Deerste-bouwmoment$/,
    );
    expect(fixture.unhandled).toEqual([]);
  });

  test("separates discovery from marketing with an explicit empty public response", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(`${BASE}/ontdekken`);

    await expect(page.getByRole("heading", {
      level: 1,
      name: "Openbare Verhalen, bewust gedeeld",
    })).toBeVisible();
    await expect(page.getByLabel("Zoek in openbare verbouwingen")).toBeVisible();
    await expect(page.getByLabel("Type verbouwing")).toBeVisible();
    await expect(page.getByText(
      /uitsluitend verbouwingen die hun maker openbaar heeft gezet/i,
    )).toBeVisible();
    await expect(page.getByText(
      /Nog geen openbare verbouwingen|Openbare verbouwingen zijn even niet bereikbaar/i,
    )).toBeVisible();
    await expect(page.getByRole("heading", {
      name: /Maak van je verbouwing een verhaal om te bewaren/i,
    })).toHaveCount(0);
    expect(fixture.unhandled).toEqual([]);
  });

  test("header navigation reaches discovery and the example anchors", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(BASE);
    const usesDesktopHeader = (page.viewportSize()?.width ?? 1440) >= 1024;
    const exampleLink = usesDesktopHeader
      ? page.getByRole("banner").getByRole("link", { name: "Bekijk voorbeeld" })
      : page.getByRole("main").getByRole("link", { name: "Bekijk een voorbeeld" });
    await exampleLink.click();
    await expect(page).toHaveURL(/\/#voorbeeld$/);
    await expect(page.getByRole("heading", { name: /Eén Bouwmoment, precies waar het thuishoort/i })).toBeVisible();

    const discoveryLink = usesDesktopHeader
      ? page.getByRole("banner").getByRole("link", { name: "Ontdek verbouwingen" })
      : page.getByRole("navigation", { name: "Mobiele navigatie" }).getByRole("link", { name: "Verhalen" });
    await discoveryLink.click();
    await expect(page).toHaveURL(/\/ontdekken$/);
    await expect(page.getByRole("heading", { name: "Openbare Verhalen, bewust gedeeld" })).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("keeps the anonymous mobile navigation pinned and the page overflow-free", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    const mobileNav = page.getByRole("navigation", { name: "Mobiele navigatie" });
    await expect(mobileNav).toBeVisible();
    const box = await mobileNav.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);

    const cta = page.getByRole("link", { name: "Voeg je eerste verbouwfoto toe" }).first();
    expect((await cta.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    expect(fixture.unhandled).toEqual([]);
  });

  test("renders a useful 404", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(`${BASE}/dit-bestaat-echt-niet-123`);
    await expect(page.getByText(/404|niet gevonden/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /terug|home|ontdek/i }).first()).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });
});

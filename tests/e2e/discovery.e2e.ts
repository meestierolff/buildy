import { allowBrowserDiagnostics, BASE, expect, test } from "./helpers";
import { fulfillJson, installSyntheticApi, success } from "./syntheticApi";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function installPublicFixture(page: Parameters<typeof installSyntheticApi>[0]) {
  allowBrowserDiagnostics(
    page,
    /^requestfailed: GET https?:\/\/[^/]+\/images\/buildy-(?:renovation-(?:progress|complete)|bouwboek-preview)\.webp \(NS_BINDING_ABORTED\)$/,
  );
  return installSyntheticApi(page, {
    authenticated: false,
    handle: async ({ request, route, url }) => {
      if (
        request.method() === "GET"
        && /^\/images\/buildy-(?:renovation-(?:progress|complete)|bouwboek-preview)\.webp$/.test(url.pathname)
      ) {
        await route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG });
        return true;
      }
      if (request.method() === "GET" && url.pathname === "/api/discovery") {
        await fulfillJson(route, success({ items: [], nextCursor: null }));
        return true;
      }
      return false;
    },
  });
}

async function waitForLandingImages(page: Parameters<typeof installSyntheticApi>[0]) {
  await page.waitForFunction(() => {
    const images = Array.from(document.images)
      .filter((image) => image.getAttribute("src")?.startsWith("/images/buildy-"));
    return images.length >= 3 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
}

test.describe("Marketinglanding en minimale openbare navigatie", () => {
  test("communicates the founder-approved promise and complete product proof", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(BASE);
    await waitForLandingImages(page);

    await expect(page.getByRole("heading", {
      level: 1,
      name: "Maak van je verbouwing een verhaal om te bewaren.",
    })).toBeVisible();
    await expect(page.getByText(
      "Leg foto’s en updates vast, laat vrienden en familie meekijken en maak er na afloop een persoonlijk Bouwboek van.",
    )).toBeVisible();
    await expect(page.getByRole("link", { name: "Start je verbouwverhaal" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Bekijk hoe het werkt" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Eén eenvoudige lijn door je hele verbouwing/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vastleggen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Samen beleven" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bewaren", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Delen zonder steeds hetzelfde verhaal/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Jouw huis hoeft niet voor iedereen open/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Je Bouwboek groeit met je verbouwing mee/i })).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("keeps a demo photo local and shows the full photo-to-Bouwboek transformation", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.goto(`${BASE}/#probeer-buildy`);
    await waitForLandingImages(page);

    await expect(page.getByText(/Pas na het inloggen en wanneer jij het Bouwmoment plaatst/i)).toBeVisible();
    await page.getByLabel("Kies een verbouwfoto van dit apparaat").setInputFiles({
      name: "keuken-met-privenaam.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });

    await expect(page.getByAltText("Jouw gekozen verbouwfoto in de lokale voorbeeldweergave").first()).toBeVisible();
    await expect(page.getByText("02 · Bouwmoment")).toBeVisible();
    await expect(page.getByText("03 · Verhaal")).toBeVisible();
    await expect(page.getByText("04 · Bouwboek")).toBeVisible();
    await expect(page.getByRole("link", { name: "Inloggen en bewaren" })).toBeVisible();
    expect(requestedUrls.some((url) => url.includes("keuken-met-privenaam"))).toBe(false);

    await page.getByRole("link", { name: "Inloggen en bewaren" }).click();
    await expect(page).toHaveURL(
      /\/auth\?next=%2Fproject%2Fnieuw%3Fintent%3Deerste-bouwmoment$/,
    );
    expect(fixture.unhandled).toEqual([]);
  });

  test("keeps discovery and budget out of the anonymous primary navigation", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(BASE);
    await waitForLandingImages(page);

    const navigation = page.getByRole("navigation", { name: "Hoofdnavigatie" });
    await expect(navigation.getByRole("link", { name: "Hoe werkt het" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Bekijk voorbeeld" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: /ontdek|budget|verhalen/i })).toHaveCount(0);
    expect(fixture.unhandled).toEqual([]);
  });

  test("header navigation reaches the two landing anchors", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.goto(BASE);
    await waitForLandingImages(page);
    const header = page.getByRole("banner");

    await header.getByRole("link", { name: "Hoe werkt het" }).click();
    await expect(page).toHaveURL(/\/#zo-werkt-het$/);
    await expect(page.getByRole("heading", { name: /Eén eenvoudige lijn door je hele verbouwing/i })).toBeVisible();

    await header.getByRole("link", { name: "Bekijk voorbeeld" }).click();
    await expect(page).toHaveURL(/\/#voorbeeld$/);
    await expect(page.getByRole("heading", { name: /Delen zonder steeds hetzelfde verhaal/i })).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("keeps the anonymous mobile header compact and the page overflow-free", async ({ page }) => {
    const fixture = await installPublicFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    await waitForLandingImages(page);
    await expect(page.getByRole("navigation", { name: "Mobiele navigatie" })).toHaveCount(0);

    const cta = page.getByRole("banner").getByRole("link", { name: "Start je verbouwverhaal" });
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

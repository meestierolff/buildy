import AxeBuilder from "@axe-core/playwright";
import type { Page, Request } from "@playwright/test";

import type { ProductProfile } from "../../shared/contracts/productProfile";
import { BASE, expect, test } from "./helpers";
import { ONE_PIXEL_PNG, fulfillJson, success } from "./syntheticApi";

const PROFILE_PATH = "/api/product-profile";
const LOCAL_PUBLIC_DEMO_PROFILE = success({
  profile: "public_demo",
  checkoutMode: "off",
  betaMode: false,
  inviteRequiredForNewAccounts: false,
  capabilities: {
    accountDeletion: false,
    checkout: false,
    emailAuth: false,
    feedback: true,
    passwordSignIn: false,
    media: false,
    photobookPreview: true,
    renovations: false,
    sharing: false,
    story: false,
    updates: false,
  },
});

type ObservedRequest = {
  method: string;
  pathname: string;
  postData: string;
  url: string;
};

const pageUrl = (path: string) => new URL(path, `${BASE.replace(/\/$/, "")}/`).toString();

function observeRequests(page: Page): ObservedRequest[] {
  const requests: ObservedRequest[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      pathname: url.pathname,
      postData: request.postData() ?? "",
      url: request.url(),
    });
  });
  return requests;
}

async function installLocalPublicDemoProfile(page: Page): Promise<void> {
  // A configured base URL is release evidence and must consume the deployed
  // server-owned profile. The default Vite-only test server has no API process,
  // so local tests supply exactly this one read contract and fail closed beyond it.
  if (process.env.PLAYWRIGHT_BASE_URL) return;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === PROFILE_PATH) {
      await fulfillJson(route, LOCAL_PUBLIC_DEMO_PROFILE);
      return;
    }

    await fulfillJson(route, {
      error: {
        code: "NOT_FOUND",
        message: `Geen openbare-demo-fixture voor ${request.method()} ${url.pathname}.`,
        requestId: "99999999-9999-4999-8999-999999999999",
      },
    }, 404);
  });
}

async function openPublicDemo(page: Page, path = "/"): Promise<ProductProfile> {
  const profileResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === PROFILE_PATH;
  });

  await page.goto(pageUrl(path), { waitUntil: "domcontentloaded" });
  const profileResponse = await profileResponsePromise;
  expect(profileResponse.status(), "server-owned productprofiel is bereikbaar").toBe(200);
  const response = await profileResponse.json() as { data: ProductProfile };
  expect(response.data).toMatchObject({
    profile: "public_demo",
    checkoutMode: "off",
    betaMode: false,
    inviteRequiredForNewAccounts: false,
    capabilities: {
      accountDeletion: false,
      checkout: false,
      emailAuth: false,
      passwordSignIn: false,
      media: false,
      photobookPreview: true,
      renovations: false,
      sharing: false,
      story: false,
      updates: false,
    },
  });
  await expect(page.locator("#root")).toBeVisible();
  return response.data;
}

function expectNoAccountOrUploadNetwork(requests: ObservedRequest[]): void {
  const authOrDiscovery = requests
    .filter(({ pathname }) => pathname.startsWith("/api/auth") || pathname === "/api/discovery")
    .map(({ method, pathname }) => `${method} ${pathname}`);
  expect(authOrDiscovery, "geen auth- of discoveryrequest in de openbare demo").toEqual([]);

  const writes = requests
    .filter(({ method }) => !["GET", "HEAD", "OPTIONS"].includes(method))
    .map(({ method, pathname }) => `${method} ${pathname}`);
  expect(writes, "de lokale fotoreis verstuurt geen netwerkmutaties").toEqual([]);

  const privatePhotoLeak = requests
    .filter(({ postData, url }) => (
      /(?:eerste|tweede)-lokale-verbouwfoto/i.test(`${url} ${postData}`)
      || /blob\.vercel-storage\.com/i.test(url)
      || /\/api\/(?:media|uploads?)(?:\/|$)/i.test(new URL(url).pathname)
    ))
    .map(({ method, pathname }) => `${method} ${pathname}`);
  expect(privatePhotoLeak, "bestandsnaam en lokale foto verlaten het apparaat niet").toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.document, "document heeft horizontale overflow").toBeLessThanOrEqual(1);
  expect(overflow.body, "body heeft horizontale overflow").toBeLessThanOrEqual(1);
}

async function expectEveryImageLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  const broken = await page.locator("img").evaluateAll((images) => images
    .filter((image) => (image as HTMLImageElement).naturalWidth === 0)
    .map((image) => (image as HTMLImageElement).getAttribute("src")));
  expect(broken, "alle openbare demo-assets laden").toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installLocalPublicDemoProfile(page);
});

test.describe("Openbare Buildy-demo", () => {
  test("toont de exacte belofte met alleen de bedoelde openbare navigatie", async ({ page }) => {
    const requests = observeRequests(page);
    await openPublicDemo(page);
    await expectEveryImageLoaded(page);

    const header = page.getByRole("banner");
    const navigation = header.getByRole("navigation", { name: "Hoofdnavigatie" });
    await expect(header.getByRole("link")).toHaveCount(4);
    await expect(header.getByRole("link", { name: "Buildy", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(2);
    await expect(navigation.getByRole("link", { name: "Hoe werkt het?", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Bekijk voorbeeld", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Probeer met je bouwfoto", exact: true })).toBeVisible();

    await expect(page.getByText("Het dagboek voor je verbouwing", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", {
      level: 1,
      name: "Maak van je verbouwing een verhaal om te bewaren.",
    })).toBeVisible();
    await expect(page.getByText(
      "Zie hoe losse bouwfoto’s veranderen in een rustig verbouwverhaal en een persoonlijk Bouwboek.",
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole("link", { name: "Bekijk een voorbeeld", exact: true })).toBeVisible();

    await navigation.getByRole("link", { name: "Hoe werkt het?", exact: true }).click();
    await expect(page).toHaveURL(/\/#zo-werkt-het$/);
    const howItWorks = page.getByRole("heading", { name: "Eén eenvoudige lijn door je hele verbouwing." });
    await expect(howItWorks).toBeVisible();
    await expect(howItWorks).toBeInViewport();
    await navigation.getByRole("link", { name: "Bekijk voorbeeld", exact: true }).click();
    await expect(page).toHaveURL(/\/#voorbeeld$/);
    const example = page.getByText("Voorbeeldverbouwing", { exact: true }).first();
    await expect(example).toBeVisible();
    await expect(example).toBeInViewport();
    await header.getByRole("link", { name: "Probeer met je bouwfoto", exact: true }).click();
    await expect(page).toHaveURL(/\/#probeer-buildy$/);
    const localPhotoDemo = page.getByRole("heading", { name: "Eén foto. Meteen een verhaal." });
    await expect(localPhotoDemo).toBeVisible();
    await expect(localPhotoDemo).toBeInViewport();
    await header.getByRole("link", { name: "Buildy", exact: true }).click();
    await expect(page).toHaveURL(pageUrl("/"));
    await expect(page.getByRole("heading", {
      level: 1,
      name: "Maak van je verbouwing een verhaal om te bewaren.",
    })).toBeInViewport();

    await expect(page.getByRole("link", { name: /inloggen|registreren|mijn verbouwing|connecties|volgend|meldingen/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /checkout|afrekenen|bestel|stripe|peecho/i })).toHaveCount(0);
    await expect(page.getByText(/stripe|peecho/i)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expectNoAccountOrUploadNetwork(requests);
  });

  test("houdt een gekozen en vervangen foto lokaal in Bouwmoment, Verhaal en Bouwboek", async ({ page }) => {
    const requests = observeRequests(page);
    await openPublicDemo(page, "/#probeer-buildy");

    await expect(page.getByText("Je foto blijft op dit apparaat en wordt niet geüpload.", { exact: true }).first()).toBeVisible();
    const firstChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Kies een verbouwfoto", exact: true }).click();
    await (await firstChooser).setFiles({
      name: "eerste-lokale-verbouwfoto.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });

    const transformedImages = page.getByAltText("Jouw gekozen verbouwfoto in de lokale voorbeeldweergave");
    await expect(transformedImages).toHaveCount(3);
    for (const image of await transformedImages.all()) {
      await expect(image).toBeVisible();
      expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await expect(page.getByText("02 · Bouwmoment", { exact: true })).toBeVisible();
    await expect(page.getByText("Een Bouwmoment om te bewaren", { exact: true })).toBeVisible();
    await expect(page.getByText("03 · Verhaal", { exact: true })).toBeVisible();
    await expect(page.getByText("Jouw Bouwmoment", { exact: true })).toBeVisible();
    await expect(page.getByText("Staat op zijn plek", { exact: true })).toBeVisible();
    await expect(page.getByText("04 · Bouwboek", { exact: true })).toBeVisible();
    await expect(page.getByText("Ons bouwverhaal", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /doorgaan met google|bewaar dit bouwmoment|inloggen/i })).toHaveCount(0);

    const firstObjectUrl = await transformedImages.first().getAttribute("src");
    expect(firstObjectUrl).toMatch(/^blob:/);
    const replacementChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Probeer een andere foto", exact: true }).click();
    await (await replacementChooser).setFiles({
      name: "tweede-lokale-verbouwfoto.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await expect.poll(() => transformedImages.first().getAttribute("src")).not.toBe(firstObjectUrl);
    await expect(transformedImages).toHaveCount(3);

    await page.getByRole("button", { name: "Verwijder foto", exact: true }).click();
    await expect(transformedImages).toHaveCount(0);
    await expect(page.getByText("Kies een foto van je apparaat", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Kies een verbouwfoto", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expectNoAccountOrUploadNetwork(requests);
  });

  test("opent de statische voorbeeldverbouwing en het volledige voorbeeld-Bouwboek", async ({ page }) => {
    const requests = observeRequests(page);
    await openPublicDemo(page);

    await page.getByRole("link", { name: "Bekijk de voorbeeldverbouwing", exact: true }).click();
    await expect(page).toHaveURL(/\/project\/voorbeeldverbouwing$/);
    await expect(page.getByText("Voorbeeldverbouwing", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "De benedenverdieping" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "De benedenverdieping" })).toBeInViewport();
    await expect(page.getByText(/volledig verzonnen en gebruikt alleen repository-eigen beeld/i)).toBeVisible();
    await expect(page.getByRole("list", { name: "Voorbeeld Bouwmomenten" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText("Voorbeeldreactie · demonstratie:", { exact: true })).toBeVisible();
    await expectEveryImageLoaded(page);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Bekijk het voorbeeld-Bouwboek", exact: true }).click();
    await expect(page).toHaveURL(/\/project\/voorbeeldverbouwing\/bouwboek$/);
    await expect(page.getByText("Voorbeeldweergave", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Ons bouwverhaal" })).toBeInViewport();
    await expect(page.getByText("Zo groeit je Bouwboek straks met je verbouwing mee.", { exact: true })).toBeVisible();
    await expect(page.getByText("Fysiek bestellen volgt na de bèta.", { exact: true })).toBeVisible();
    const pages = page.getByRole("region", { name: "Pagina’s in het voorbeeld-Bouwboek" });
    await expect(pages.getByText("Omslag", { exact: true })).toBeVisible();
    await expect(pages.getByText("Openingsspread", { exact: true })).toBeVisible();
    await expect(pages.getByText("Bouwmoment · 6 april", { exact: true })).toBeVisible();
    await expect(pages.getByText("Bouwmoment · 28 juni", { exact: true })).toBeVisible();
    await expect(pages.getByText("Slotpagina", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /checkout|afrekenen|bestel|order|stripe|peecho/i })).toHaveCount(0);
    await expect(page.getByText(/stripe|peecho|€\s*\d/i)).toHaveCount(0);
    await expectEveryImageLoaded(page);
    await expectNoHorizontalOverflow(page);
    expectNoAccountOrUploadNetwork(requests);
  });

  test("biedt echte demo-feedback, juridische informatie en intentionele beschermde routes", async ({ page }) => {
    const requests = observeRequests(page);
    const profile = await openPublicDemo(page);
    expect(profile.capabilities.feedback, "veilige publieke supportroute is server-side actief").toBe(true);

    await page.getByRole("contentinfo").getByRole("link", { name: "Geef feedback", exact: true }).click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByText("Buildy bètafeedback", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Wat vind je van de demo?" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Wat vind je van de demo?" })).toBeInViewport();
    await expect(page.getByRole("form", { name: "Contact met Buildy" })).toBeVisible();
    await expect(page.getByLabel("Onderwerp")).not.toContainText("Account of inloggen");

    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacyverklaring" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Privacyverklaring" })).toBeInViewport();
    await page.getByRole("contentinfo").getByRole("link", { name: "Voorwaarden", exact: true }).click();
    await expect(page).toHaveURL(/\/voorwaarden$/);
    await expect(page.getByRole("heading", { level: 1, name: "Algemene voorwaarden" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Algemene voorwaarden" })).toBeInViewport();

    for (const path of ["/auth", "/project/geen-voorbeeld"] as const) {
      await page.goto(pageUrl(path));
      await expect(page.getByRole("heading", {
        level: 1,
        name: "Persoonlijke accounts openen later in de bèta.",
      })).toBeVisible();
      await expect(page.getByRole("link", { name: "Terug naar de demo", exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    expectNoAccountOrUploadNetwork(requests);
  });

  test("heeft geen ernstige toegankelijkheidsproblemen", async ({ page }) => {
    await openPublicDemo(page);
    await expectEveryImageLoaded(page);
    const result = await new AxeBuilder({ page }).analyze();
    const blocking = result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.flatMap((node) => node.target.map(String)),
      }));
    expect(blocking).toEqual([]);
  });
});

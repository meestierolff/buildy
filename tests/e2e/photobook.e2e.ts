import {
  test,
  expect,
  BASE,
  PUBLIC_PROJECT_ID,
  OWNER_PROJECT_ID,
  waitForPhotobookImages,
  collectImageDiagnostics,
  isSignedIn,
  trackConsoleErrors,
} from "./helpers";

const PHOTOBOOK_PROJECT_ID = PUBLIC_PROJECT_ID;
const hasExplicitBackendBaseUrl = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe("Photobook — preview", () => {
  test.beforeEach(() => {
    test.skip(!hasExplicitBackendBaseUrl, "requires explicit backend-backed photobook data");
  });

  test("cover preview renders with navigation controls", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/project/${PHOTOBOOK_PROJECT_ID}/bouwboek`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Cover").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /volgende/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("desktop spreads stay print-safe (no broken imgs, no overlaps)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/project/${PHOTOBOOK_PROJECT_ID}/bouwboek`, { waitUntil: "networkidle" });
    await waitForPhotobookImages(page);

    for (let i = 0; i < 4; i += 1) {
      await waitForPhotobookImages(page);
      const diag = await collectImageDiagnostics(page);
      expect(diag.brokenImages).toBe(0);
      expect(diag.overlaps).toBe(0);

      const next = page.getByRole("button", { name: /volgende spread/i });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(250);
    }

    await page.getByRole("button", { name: /laatste pagina/i }).click();
    await expect(page.locator("main p:visible", { hasText: /gemaakt met buildy/i })).toBeVisible();
    await expect(page.getByText(/24\s*\/\s*24/).first()).toBeVisible();
  });

  test("mobile page-by-page preview stays print-safe", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/project/${PHOTOBOOK_PROJECT_ID}/bouwboek`, { waitUntil: "networkidle" });
    await expect(page.getByText(/opmaakvoorbeeld.*print-pdf.*apart opgebouwd en gecontroleerd/i)).toBeVisible();
    await waitForPhotobookImages(page);

    for (let i = 0; i < 4; i += 1) {
      await waitForPhotobookImages(page);
      const diag = await collectImageDiagnostics(page);
      expect(diag.brokenImages).toBe(0);
      expect(diag.overlaps).toBe(0);

      const next = page.getByRole("button", { name: /volgende pagina/i });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(200);
    }

    await page.getByRole("button", { name: /laatste pagina/i }).click();
    await expect(page.getByText(/24\s*\/\s*24/).first()).toBeVisible();
  });
});

test.describe("Photobook — owner controls", () => {
  test.beforeEach(() => {
    test.skip(!hasExplicitBackendBaseUrl, "requires explicit backend-backed photobook data");
  });

  test("bestel-dialog vraagt een server-owned prijs en levering op", async ({ page }) => {
    await page.goto(`${BASE}/project/${OWNER_PROJECT_ID}/bouwboek`);
    await page.waitForTimeout(2000);
    const orderButton = page.getByRole("button", { name: /bestel als boek/i });
    test.skip(await orderButton.count() === 0, "requires authenticated project owner session");
    await orderButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Bouwboek bestellen" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /prijs en levering opvragen/i })).toBeVisible();
  });

  test("orientation toggle switches between liggend and staand", async ({ page }) => {
    await page.goto(`${BASE}/project/${OWNER_PROJECT_ID}/bouwboek`);
    test.skip(!(await isSignedIn(page)), "requires authenticated owner");
    await page.waitForTimeout(1500);
    const liggend = page.getByRole("button", { name: /liggend/i });
    const staand = page.getByRole("button", { name: /staand/i });
    if ((await staand.count()) === 0 || (await liggend.count()) === 0) {
      test.skip(true, "orientation toggle not available on this project");
    }
    await staand.first().click();
    await page.waitForTimeout(400);
    await liggend.first().click();
    await page.waitForTimeout(400);
  });
});

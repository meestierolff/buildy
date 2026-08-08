import { test, expect, BASE, trackConsoleErrors } from "./helpers";

test.describe("Ontdekken (home)", () => {
  test("hero + explicit project state render without runtime errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(BASE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("navigation")).toBeVisible();
    // At least one project card OR a deliberate loading/empty/error state is visible.
    const card = page.locator("main a[href^='/project/']").first();
    const emptyState = page.getByText(/nog geen publieke projecten|projecten zijn even niet bereikbaar/i).first();
    const loadingState = page.getByRole("status", { name: /projecten laden/i }).first();
    await expect(card.or(emptyState).or(loadingState)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("visible project covers are not broken", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    const covers = page.locator("main a[href^='/project/'] img");
    const count = Math.min(await covers.count(), 8);
    for (let index = 0; index < count; index += 1) {
      const cover = covers.nth(index);
      await cover.scrollIntoViewIfNeeded();
      await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete)).toBe(true);
      expect(await cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    }
  });

  test("first-time visitor sees the complete Buildy proposition", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole("heading", { level: 1, name: /van eerste sleutel tot laatste plint/i })).toBeVisible();
    await expect(page.getByText(/leg je verbouwing stap voor stap vast.*bouwboek/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /start gratis je dagboek/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /drie stappen.*compleet bouwverhaal/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /jouw verbouwing als echt bouwboek/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /jouw huis hoeft niet voor iedereen open te staan/i })).toBeVisible();
    await expect(page.getByText(/privé als vertrekpunt/i)).toBeVisible();
  });

  test("mobile navigation remains pinned to the viewport bottom", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    const mobileNav = page.getByRole("navigation", { name: /mobiele navigatie/i });
    await expect(mobileNav).toBeVisible();
    const box = await mobileNav.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round((box?.y || 0) + (box?.height || 0))).toBe(844);

    const primaryCta = page.getByRole("link", { name: /start gratis je dagboek/i });
    const ctaBox = await primaryCta.boundingBox();
    expect(ctaBox?.height).toBeGreaterThanOrEqual(44);

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("header nav links route correctly", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("banner").getByRole("link", { name: /connecties/i }).click();
    await expect(page).toHaveURL(/\/connecties$/);
    await expect(page.getByRole("heading", { name: /ontdek andere bouwers/i })).toBeVisible();
  });

  test("404 route renders the not-found page", async ({ page }) => {
    await page.goto(`${BASE}/dit-bestaat-echt-niet-123`);
    await expect(page.getByText(/404|niet gevonden/i).first()).toBeVisible();
  });
});

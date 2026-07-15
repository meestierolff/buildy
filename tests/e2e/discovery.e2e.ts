import { test, expect, BASE, trackConsoleErrors } from "./helpers";

test.describe("Ontdekken (home)", () => {
  test("hero + projects grid render without runtime errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(BASE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("navigation")).toBeVisible();
    // At least one project card OR a deliberate empty/error state is visible.
    const card = page.locator("main a[href^='/trip/']").first();
    const emptyState = page.getByText(/nog geen publieke projecten|projecten zijn even niet bereikbaar/i).first();
    await expect(card.or(emptyState)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("visible project covers are not broken", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    const covers = page.locator("main a[href^='/trip/'] img");
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
    await expect(page.getByRole("heading", { level: 1, name: /je verbouwing.*verhaal dat blijft/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /start gratis je dagboek/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /klein beginnen.*mooi terugkijken/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /jouw verbouwing als echt boek/i })).toBeVisible();
    await expect(page.getByText(/privé of openbaar/i).first()).toBeVisible();
  });

  test("mobile navigation remains pinned to the viewport bottom", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    const mobileNav = page.getByRole("navigation", { name: /mobiele navigatie/i });
    await expect(mobileNav).toBeVisible();
    const box = await mobileNav.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round((box?.y || 0) + (box?.height || 0))).toBe(844);
  });

  test("header nav links route correctly", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("banner").getByRole("link", { name: /vrienden/i }).click();
    await expect(page).toHaveURL(/\/vrienden$/);
    await expect(page.getByRole("heading", { name: /ontdek andere bouwers/i })).toBeVisible();
  });

  test("404 route renders the not-found page", async ({ page }) => {
    await page.goto(`${BASE}/dit-bestaat-echt-niet-123`);
    await expect(page.getByText(/404|niet gevonden/i).first()).toBeVisible();
  });
});

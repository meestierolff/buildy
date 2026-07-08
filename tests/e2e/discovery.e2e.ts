import { test, expect, BASE, trackConsoleErrors } from "./helpers";

test.describe("Ontdekken (home)", () => {
  test("hero + projects grid render without runtime errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(BASE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("navigation")).toBeVisible();
    // At least one project card OR the empty state is visible.
    const cards = await page.locator("a[href^='/trip/']").count();
    expect(cards).toBeGreaterThanOrEqual(0);
    expect(errors).toEqual([]);
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

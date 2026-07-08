import { test, expect, BASE, OWNER_TRIP_ID, PUBLIC_TRIP_ID, trackConsoleErrors } from "./helpers";

test.describe("Project detail", () => {
  test("loads header, timeline and all three tabs", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/trip/${OWNER_TRIP_ID}`);
    await page.waitForSelector("h1", { timeout: 8000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tijdlijn" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Plattegrond" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Alle foto's" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("no failed HEAD requests for likes/comments (N+1 regression)", async ({ page }) => {
    const failed: string[] = [];
    page.on("requestfailed", (req) => {
      if (req.method() === "HEAD") failed.push(req.url());
    });
    await page.goto(`${BASE}/trip/${OWNER_TRIP_ID}`);
    await page.waitForTimeout(3000);
    const bad = failed.filter((u) => u.includes("/comments") || u.includes("/likes"));
    expect(bad).toHaveLength(0);
  });

  test("switching between timeline / floorplan / all photos tabs works", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PUBLIC_TRIP_ID}`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Alle foto's" }).click();
    await expect(page.getByRole("button", { name: /mijlpalen/i })).toBeVisible();
    await page.getByRole("tab", { name: "Plattegrond" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("tab", { name: "Tijdlijn" }).click();
    await expect(page.getByRole("tab", { name: "Tijdlijn", selected: true })).toBeVisible();
  });

  test("milestone filter toggles the timeline notice", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PUBLIC_TRIP_ID}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /mijlpalen/i }).click();
    await expect(page.getByText(/alleen mijlpalen worden getoond/i)).toBeVisible();
  });

  test("lightbox opens on photo click and closes via backdrop", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PUBLIC_TRIP_ID}`, { waitUntil: "networkidle" });
    const firstPhoto = page.locator("article button img").first();
    test.skip((await firstPhoto.count()) === 0, "no photos on this trip");
    await firstPhoto.click();
    const lightbox = page.locator("div.fixed.inset-0.z-\\[1200\\]");
    await expect(lightbox).toBeVisible();
    await page.mouse.click(20, 500);
    await expect(lightbox).toHaveCount(0);
  });
});

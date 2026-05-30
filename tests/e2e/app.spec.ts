import { test, expect } from "@playwright/test";

/**
 * Buildy E2E tests — requires dev server at http://localhost:8080
 * and a logged-in session (run after manual login or seed auth cookies).
 *
 * These tests document the happy-path for all major pages.
 * They are read-only — no data is mutated.
 */

const BASE = "http://localhost:8080";
const TEST_TRIP_ID = "373b3e31-fb84-45e4-9103-9de7beb43563";
const TEST_USER_ID = "af842993-4095-47f7-91e8-a05575ceb70b";

test.describe("Auth page", () => {
  test("renders login form", async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await expect(page.getByRole("heading", { name: /inloggen|aanmelden/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mail/i })).toBeVisible();
  });
});

test.describe("Index — ontdekken", () => {
  test("renders hero and projects grid", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Navigation tabs
    await expect(page.getByRole("navigation")).toBeVisible();
  });
});

test.describe("TripDetail", () => {
  test("loads project header and timeline", async ({ page }) => {
    await page.goto(`${BASE}/trip/${TEST_TRIP_ID}`);
    await page.waitForSelector("h1", { timeout: 8000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Tabs visible
    await expect(page.getByRole("tab", { name: "Tijdlijn" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Plattegrond" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Alle foto's" })).toBeVisible();
    // Budget link
    await expect(page.getByRole("link", { name: "Budget" })).toBeVisible();
  });

  test("no per-step N+1 HEAD requests for likes/comments", async ({ page }) => {
    const headRequests: string[] = [];
    page.on("requestfailed", (req) => {
      if (req.method() === "HEAD") headRequests.push(req.url());
    });
    await page.goto(`${BASE}/trip/${TEST_TRIP_ID}`);
    await page.waitForTimeout(3000);
    // Should be zero aborted HEAD requests for comments/likes
    const bad = headRequests.filter((u) => u.includes("/comments") || u.includes("/likes"));
    expect(bad).toHaveLength(0);
  });
});

test.describe("Photobook", () => {
  test("renders cover preview", async ({ page }) => {
    await page.goto(`${BASE}/trip/${TEST_TRIP_ID}/photobook`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("button", { name: /bestel als boek/i })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("bestel dialog shows Peecho / Pro upsell", async ({ page }) => {
    await page.goto(`${BASE}/trip/${TEST_TRIP_ID}/photobook`);
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /bestel als boek/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Either shows Peecho print widget (Pro) or the Pro upsell CTA
    const dialog = page.getByRole("dialog");
    const hasPeecho = await dialog.locator(".peecho-print-button").count();
    const hasProCta = await dialog.getByText(/buildy pro/i).count();
    expect(hasPeecho + hasProCta).toBeGreaterThan(0);
  });
});

test.describe("Budget", () => {
  test("renders budget overview", async ({ page }) => {
    await page.goto(`${BASE}/trip/${TEST_TRIP_ID}/budget`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { name: "Budget" })).toBeVisible();
    await expect(page.getByText(/besteed/i)).toBeVisible();
  });
});

test.describe("Profile", () => {
  test("renders user profile", async ({ page }) => {
    await page.goto(`${BASE}/profile/${TEST_USER_ID}`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Projecten" })).toBeVisible();
  });
});

test.describe("Vrienden", () => {
  test("renders discover page with search", async ({ page }) => {
    await page.goto(`${BASE}/vrienden`);
    await expect(page.getByRole("heading", { name: /ontdek bouwers/i })).toBeVisible();
    await expect(page.getByPlaceholder(/zoek op naam/i)).toBeVisible();
  });
});

test.describe("Gevolgd (feed)", () => {
  test("renders feed header", async ({ page }) => {
    await page.goto(`${BASE}/favorieten`);
    await expect(page.getByRole("heading", { name: "Gevolgd" })).toBeVisible();
  });
});

test.describe("Nieuw project", () => {
  test("renders new project form", async ({ page }) => {
    await page.goto(`${BASE}/trips/new`);
    await expect(page.getByRole("heading", { name: /nieuw verbouwingsproject/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /projectnaam/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /project starten/i })).toBeVisible();
  });
});

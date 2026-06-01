import { test, expect } from "@playwright/test";

/**
 * Buildy E2E tests — requires a dev server at PLAYWRIGHT_BASE_URL
 * or starts one at http://127.0.0.1:8090 via Playwright config.
 *
 * These tests document the happy-path for all major pages.
 * They are read-only — no data is mutated.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8090";
const TEST_TRIP_ID = "373b3e31-fb84-45e4-9103-9de7beb43563";
const PUBLIC_TRIP_ID = "08bab0ef-3afc-4a6a-81c3-640a071ac464";
const PHOTOBOOK_TRIP_ID = PUBLIC_TRIP_ID;
const TEST_USER_ID = "af842993-4095-47f7-91e8-a05575ceb70b";

test.describe("Auth page", () => {
  test("renders login form", async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await expect(page.getByRole("heading", { name: /welkom terug|start je dagboek/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toBeVisible();
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

  test("keeps public project actions tidy and milestone filtering reachable", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PUBLIC_TRIP_ID}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: /mijlpalen/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /delen/i })).toHaveCount(0);

    await page.getByRole("tab", { name: "Alle foto's" }).click();
    await expect(page.getByRole("button", { name: /mijlpalen/i })).toBeVisible();
    await page.getByRole("button", { name: /mijlpalen/i }).click();
    await expect(page.getByText(/alleen mijlpalen worden getoond/i)).toBeVisible();
  });

  test("closes the desktop media viewer by clicking the backdrop", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PUBLIC_TRIP_ID}`, { waitUntil: "networkidle" });
    await page.locator("article button img").first().click();

    const lightbox = page.locator("div.fixed.inset-0.z-\\[1200\\]");
    await expect(lightbox).toBeVisible();

    await page.mouse.click(20, 500);
    await expect(lightbox).toHaveCount(0);
  });
});

test.describe("Photobook", () => {
  const waitForPhotobookImages = async (page: import("@playwright/test").Page) => {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("[data-photobook-page] img"))
        .every((img) => (img as HTMLImageElement).complete),
      undefined,
      { timeout: 5000 },
    ).catch(() => undefined);
  };

  const visibleImageDiagnostics = async (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const imgs = Array.from(document.querySelectorAll("[data-photobook-page] img"))
        .map((img) => {
          const rect = img.getBoundingClientRect();
          const style = window.getComputedStyle(img);
          return {
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            visible:
              style.visibility !== "hidden"
              && style.display !== "none"
              && rect.width > 20
              && rect.height > 20
              && rect.bottom > 0
              && rect.right > 0
              && rect.left < viewportW
              && rect.top < viewportH,
          };
        })
        .filter((img) => img.visible);

      let overlaps = 0;
      for (let i = 0; i < imgs.length; i += 1) {
        for (let j = i + 1; j < imgs.length; j += 1) {
          const a = imgs[i];
          const b = imgs[j];
          const overlapW = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const overlapH = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (overlapW * overlapH > 4) overlaps += 1;
        }
      }

      return {
        visibleImages: imgs.length,
        brokenImages: imgs.filter((img) => img.naturalWidth === 0 || img.naturalHeight === 0).length,
        overlaps,
      };
    });

  test("renders cover preview", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PHOTOBOOK_TRIP_ID}/photobook`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Cover").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /volgende/i })).toBeVisible();
  });

  test("keeps preview spreads print-safe", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/trip/${PHOTOBOOK_TRIP_ID}/photobook`, { waitUntil: "networkidle" });
    await waitForPhotobookImages(page);

    for (let i = 0; i < 4; i += 1) {
      await waitForPhotobookImages(page);
      const diag = await visibleImageDiagnostics(page);
      expect(diag.brokenImages).toBe(0);
      expect(diag.overlaps).toBe(0);

      const next = page.getByRole("button", { name: /volgende spread/i });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(250);
      await waitForPhotobookImages(page);
    }

    await page.getByRole("button", { name: /laatste pagina/i }).click();
    await expect(page.locator("main p:visible", { hasText: /gemaakt met buildy/i })).toBeVisible();
    await expect(page.getByText(/24\s*\/\s*24/).first()).toBeVisible();
  });

  test("keeps mobile page preview print-safe", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/trip/${PHOTOBOOK_TRIP_ID}/photobook`, { waitUntil: "networkidle" });
    await expect(page.getByText(/elke pagina zoals hij gedrukt wordt/i)).toBeVisible();
    await waitForPhotobookImages(page);

    for (let i = 0; i < 4; i += 1) {
      await waitForPhotobookImages(page);
      const diag = await visibleImageDiagnostics(page);
      expect(diag.brokenImages).toBe(0);
      expect(diag.overlaps).toBe(0);

      const next = page.getByRole("button", { name: /volgende pagina/i });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(200);
      await waitForPhotobookImages(page);
    }

    await page.getByRole("button", { name: /laatste pagina/i }).click();
    await expect(page.getByText(/24\s*\/\s*24/).first()).toBeVisible();
  });

  test("bestel dialog shows Peecho ordering controls", async ({ page }) => {
    await page.goto(`${BASE}/trip/${PHOTOBOOK_TRIP_ID}/photobook`);
    await page.waitForTimeout(2000);
    const orderButton = page.getByRole("button", { name: /bestel als boek/i });
    test.skip(await orderButton.count() === 0, "Requires an authenticated trip owner session");
    await orderButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Owner sessions should be able to prepare the print order immediately.
    const dialog = page.getByRole("dialog");
    const hasPeecho = await dialog.locator(".peecho-print-button").count();
    const hasPrepareButton = await dialog.getByRole("button", { name: /boek klaarmaken/i }).count();
    expect(hasPeecho + hasPrepareButton).toBeGreaterThan(0);
  });
});

test.describe("Budget", () => {
  test("renders budget overview", async ({ page }) => {
    await page.goto(`${BASE}/trip/${TEST_TRIP_ID}/budget`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { name: /budget/i })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /ontdek andere bouwers/i })).toBeVisible();
    await expect(page.getByPlaceholder(/zoek op naam/i)).toBeVisible();
  });
});

test.describe("Gevolgd (feed)", () => {
  test("renders feed or redirects to auth", async ({ page }) => {
    await page.goto(`${BASE}/favorieten`);
    await expect(page.getByRole("heading", { name: /gevolgd|welkom terug/i })).toBeVisible();
  });
});

test.describe("Nieuw project", () => {
  test("renders new project form or redirects to auth", async ({ page }) => {
    await page.goto(`${BASE}/trips/new`);
    await expect(page.getByRole("heading", { name: /leg de basis|welkom terug/i })).toBeVisible();
    if (await page.getByRole("textbox", { name: /projectnaam/i }).count()) {
      await expect(page.getByRole("textbox", { name: /projectnaam/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /project starten/i })).toBeVisible();
    } else {
      await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toBeVisible();
    }
  });
});

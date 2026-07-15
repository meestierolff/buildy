import { test, expect, type Page } from "@playwright/test";

/**
 * Shared constants and helpers for the Buildy Playwright regression suite.
 *
 * Uses well-known project/user IDs that exist in the shared preview database.
 * Every helper is designed to work with OR without an authenticated
 * storageState so the suite can run against the deployed preview in CI.
 */

export const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8090";

/** Trip owned by the primary Buildy test account (Scandic Run 2026). */
export const OWNER_TRIP_ID = "373b3e31-fb84-45e4-9103-9de7beb43563";
/** Publicly visible trip used to test guest-facing views. */
export const PUBLIC_TRIP_ID = "08bab0ef-3afc-4a6a-81c3-640a071ac464";
/** The primary Buildy test user (owner of OWNER_TRIP_ID). */
export const TEST_USER_ID = "af842993-4095-47f7-91e8-a05575ceb70b";

export { expect, test };

/**
 * Skip the running test when there is no owner (authenticated) session,
 * which is required for CRUD flows like photobook upload, account settings,
 * and budget editing. In CI we point storageState at a signed-in state file
 * via PLAYWRIGHT_STORAGE_STATE.
 */
export const skipWithoutAuth = async (page: Page, reason = "requires authenticated owner session") => {
  await page.goto(`${BASE}/account`);
  test.skip(!(await isSignedIn(page)), reason);
};

/**
 * Supabase persists the browser session under an `sb-*-auth-token` key. Using
 * that signal is route-independent and avoids treating a public page as an
 * authenticated one while AuthProvider is still resolving its session.
 */
export const isSignedIn = async (page: Page) => {
  return page.evaluate(() =>
    Object.entries(window.localStorage).some(([key, value]) =>
      /^sb-.+-auth-token$/.test(key) && !!value && value !== "null",
    ),
  );
};

/** Wait until every image inside photobook pages has loaded (or timeout softly). */
export const waitForPhotobookImages = async (page: Page) => {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("[data-photobook-page] img"))
      .every((img) => (img as HTMLImageElement).complete),
    undefined,
    { timeout: 5000 },
  ).catch(() => undefined);
};

/**
 * Collect diagnostics about visible images: how many render, how many are broken,
 * and how many overlap. Used by photobook layout tests to catch print regressions.
 */
export const collectImageDiagnostics = (page: Page) =>
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
          naturalWidth: (img as HTMLImageElement).naturalWidth,
          naturalHeight: (img as HTMLImageElement).naturalHeight,
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

/**
 * Fail the current test if any unexpected uncaught page errors happen
 * during a scenario. Call after registering listeners early in a test.
 */
export const trackConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore expected auth 401s and third-party ResizeObserver noise.
      if (/401|ResizeObserver|Failed to load resource/i.test(text)) return;
      errors.push(`console: ${text}`);
    }
  });
  return errors;
};

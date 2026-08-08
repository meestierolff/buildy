import { test, expect, BASE, TEST_USER_ID, isSignedIn, trackConsoleErrors } from "./helpers";

const hasExplicitBackendBaseUrl = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.describe("Vrienden — ontdekken", () => {
  test("renders discover page with search input and tabs", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/connecties`);
    await expect(page.getByRole("heading", { name: /ontdek andere bouwers/i })).toBeVisible();
    await expect(page.getByPlaceholder(/zoek op naam/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("typing in the search field triggers a query without errors", async ({ page }) => {
    await page.goto(`${BASE}/connecties`);
    await page.getByPlaceholder(/zoek op naam/i).fill("mees");
    // Debounced (300ms) — wait, then assert we're not in a broken state.
    await page.waitForTimeout(600);
    // Either results appear or an empty-state — but never a runtime crash.
    await expect(page.getByRole("heading", { name: /ontdek andere bouwers/i })).toBeVisible();
  });

  test("follow/unfollow toggles on a discovered profile", async ({ page }) => {
    await page.goto(`${BASE}/connecties`);
    test.skip(!(await isSignedIn(page)), "requires authenticated user");
    await page.goto(`${BASE}/connecties`);
    await page.getByPlaceholder(/zoek op naam/i).fill("");
    await page.waitForTimeout(400);
    const followBtn = page.getByRole("button", { name: /^volgen$|^ontvolgen$|volgend/i }).first();
    test.skip((await followBtn.count()) === 0, "no other profiles to interact with");
    // Just make sure clicking doesn't blow up — the toggle is async and may show a toast.
    await followBtn.click();
    await page.waitForTimeout(500);
  });
});

test.describe("Profiel + volgverzoek flow", () => {
  test.beforeEach(() => {
    test.skip(!hasExplicitBackendBaseUrl, "requires explicit backend-backed profile data");
  });

  test("public profile page renders header, tabs and no runtime errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/profiel/${TEST_USER_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Projecten" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("gevolgd feed (favorieten) renders or redirects to auth", async ({ page }) => {
    await page.goto(`${BASE}/volgend`);
    await expect(page.getByRole("heading", { name: /gevolgd|welkom terug/i })).toBeVisible();
  });
});

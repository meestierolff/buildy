import { test, expect, BASE, trackConsoleErrors } from "./helpers";

test.describe("Auth flow", () => {
  test("login form has all required controls", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/auth`);
    await expect(page.getByRole("heading", { name: /welkom terug|start je dagboek/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toBeVisible();
    await expect(page.getByPlaceholder("Wachtwoord")).toBeVisible();
    await expect(page.getByRole("button", { name: /^inloggen$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /magic link/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /inloggen met google/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("can switch to registration mode", async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await page.getByRole("button", { name: /registreer/i }).click();
    await expect(page.getByRole("heading", { name: /start je dagboek/i })).toBeVisible();
    await expect(page.getByPlaceholder("Naam")).toBeVisible();
    await expect(page.getByRole("button", { name: /account aanmaken/i })).toBeVisible();
  });

  test("forgot-password page renders the reset form", async ({ page }) => {
    await page.goto(`${BASE}/wachtwoord-vergeten`);
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /reset|verstuur/i })).toBeVisible();
  });

  test("invalid credentials show an error toast without crashing", async ({ page }) => {
    await page.goto(`${BASE}/auth`);
    await page.getByRole("textbox", { name: /e-mailadres/i }).fill("nobody+e2e@buildy.test");
    await page.getByPlaceholder("Wachtwoord").fill("wrong-password");
    await page.getByRole("button", { name: /^inloggen$/i }).click();
    await expect(page.getByText(/ongeldige inloggegevens/i)).toBeVisible({ timeout: 10_000 });
  });
});

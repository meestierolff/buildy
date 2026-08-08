import { test, expect, BASE, OWNER_PROJECT_ID, isSignedIn, trackConsoleErrors } from "./helpers";

test.describe("Account settings", () => {
  test("renders account page or friendly login CTA", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/account`);
    // Either the protected settings UI or the login screen must be visible.
    const heading = page.getByRole("heading", { name: /account|instellingen/i });
    const login = page.getByRole("heading", { name: /welkom terug|start je dagboek/i });
    await expect(heading.or(login)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("password + danger-zone controls exist when signed in", async ({ page }) => {
    await page.goto(`${BASE}/account`);
    test.skip(!(await isSignedIn(page)), "requires authenticated user");
    await expect(page.getByPlaceholder(/nieuw wachtwoord/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /wachtwoord.*bijwerken|opslaan/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /account.*verwijderen/i })).toBeVisible();
  });
});

test.describe("Budget page", () => {
  test("renders header and totals without runtime errors", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto(`${BASE}/project/${OWNER_PROJECT_ID}/budget`);
    await page.waitForTimeout(2000);
    await expect(page.getByRole("heading", { name: /budget/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("owner can toggle budget-edit mode", async ({ page }) => {
    await page.goto(`${BASE}/project/${OWNER_PROJECT_ID}/budget`);
    test.skip(!(await isSignedIn(page)), "requires authenticated owner");
    await page.waitForTimeout(1500);
    const editBtn = page.getByRole("button", { name: /bewerk|pas.*budget/i }).first();
    test.skip((await editBtn.count()) === 0, "no editable budget on this project");
    await editBtn.click();
    // Some numeric input should appear.
    const input = page.locator("input[inputmode='numeric'], input[type='number']").first();
    await expect(input).toBeVisible({ timeout: 4000 });
  });
});

test.describe("Nieuw project", () => {
  test("form renders when signed in, or redirects to auth", async ({ page }) => {
    await page.goto(`${BASE}/project/nieuw`);
    await expect(page.getByRole("heading", { name: /leg de basis|welkom terug|start je dagboek/i })).toBeVisible();
    if (await page.getByRole("textbox", { name: /projectnaam/i }).count()) {
      await expect(page.getByRole("button", { name: /project starten/i })).toBeVisible();
    } else {
      await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toBeVisible();
    }
  });
});

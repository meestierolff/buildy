import type { Page } from "@playwright/test";
import { BASE, expect, test } from "./helpers";
import { fulfillJson, installSyntheticApi, success, syntheticAuthSession } from "./syntheticApi";

const password = "Drie rustige bouwdagen";

async function installPasswordAuthFixture(page: Page) {
  let authenticated = false;
  const submissions: Array<{ path: string; body: unknown }> = [];
  const fixture = await installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (url.pathname === "/api/auth/session") {
        await fulfillJson(route, syntheticAuthSession(authenticated));
        return true;
      }
      if (["/api/auth/sign-in", "/api/auth/sign-up"].includes(url.pathname) && request.method() === "POST") {
        const body = request.postDataJSON() as { next: string };
        submissions.push({ path: url.pathname, body });
        authenticated = true;
        await fulfillJson(route, success({ next: body.next }));
        return true;
      }
      return false;
    },
  });
  return { ...fixture, submissions };
}

async function fillCredentials(page: Page) {
  await page.getByLabel("Gebruikersnaam", { exact: true }).fill("Bouw_Eigenaar");
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password);
}

test.describe("Gebruikersnaam en wachtwoord", () => {
  test("toont inloggen zonder Google, e-mail of niet-bestaand wachtwoordherstel", async ({ page }) => {
    await installPasswordAuthFixture(page);
    await page.goto(BASE + "/auth");

    await expect(page.getByRole("heading", { name: "Ga verder met je verbouwverhaal." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inloggen", exact: true })).toBeVisible();
    await expect(page.getByLabel("Gebruikersnaam", { exact: true })).toHaveAttribute("autocomplete", "username");
    await expect(page.getByLabel("Wachtwoord", { exact: true })).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByLabel("Wachtwoord", { exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Wachtwoord tonen" }).click();
    await expect(page.getByLabel("Wachtwoord", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByText(/Google|magic link/i)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /wachtwoord vergeten/i })).toHaveCount(0);
  });

  test("maakt vanuit de bestaande registratieroute een account en hervat de bestemming", async ({ page }) => {
    const fixture = await installPasswordAuthFixture(page);
    const next = "/project/nieuw?intent=eerste-bouwmoment";
    await page.goto(BASE + "/auth?mode=register&next=" + encodeURIComponent(next));

    await expect(page.getByRole("heading", { name: "Je verhaal begint hier." })).toBeVisible();
    await expect(page.getByLabel("Wachtwoord", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await fillCredentials(page);
    await page.getByRole("button", { name: "Account maken", exact: true }).click();

    await expect(page).toHaveURL(BASE + next);
    await expect(page.getByLabel("Hoe heet je verbouwing?")).toBeVisible();
    expect(fixture.submissions).toEqual([{
      path: "/api/auth/sign-up",
      body: { username: "bouw_eigenaar", password, next },
    }]);
    expect(fixture.unhandled).toEqual([]);
  });

  test("logt in, controleert de sessie en behoudt die na een browserreload", async ({ page }) => {
    const fixture = await installPasswordAuthFixture(page);
    await page.goto(BASE + "/auth?next=" + encodeURIComponent("/project/nieuw"));
    await fillCredentials(page);
    await page.getByRole("button", { name: "Inloggen", exact: true }).click();

    await expect(page).toHaveURL(BASE + "/project/nieuw");
    await page.reload();
    await expect(page.getByLabel("Hoe heet je verbouwing?")).toBeVisible();
    expect(fixture.submissions).toEqual([{
      path: "/api/auth/sign-in",
      body: { username: "bouw_eigenaar", password, next: "/project/nieuw" },
    }]);
    expect(fixture.requests.filter((request) => request.pathname === "/api/auth/session").length).toBeGreaterThanOrEqual(3);
    expect(fixture.unhandled).toEqual([]);
  });

  test("behoudt de vervolgstap bij wisselen tussen inloggen en account maken", async ({ page }) => {
    await installPasswordAuthFixture(page);
    await page.goto(BASE + "/auth?next=" + encodeURIComponent("/project/nieuw"));
    await page.getByRole("button", { name: "Account maken", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Je verhaal begint hier." })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("next")).toBe("/project/nieuw");
    await page.getByRole("button", { name: "Inloggen", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ga verder met je verbouwverhaal." })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("next")).toBe("/project/nieuw");
  });

  test("toont geen verzonnen herstelroute", async ({ page }) => {
    await installPasswordAuthFixture(page);
    await page.goto(BASE + "/wachtwoord-vergeten");
    await expect(page.getByText(/404|niet gevonden/i).first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toHaveCount(0);
  });

  test("bewaart een beschermde verbouwingsbestemming vóór het inloggen", async ({ page }) => {
    await installPasswordAuthFixture(page);
    await page.goto(BASE + "/project/nieuw");

    await expect(page).toHaveURL(/\/auth\?next=%2Fproject%2Fnieuw$/);
    await expect(page.getByRole("button", { name: "Inloggen", exact: true })).toBeVisible();
  });
});

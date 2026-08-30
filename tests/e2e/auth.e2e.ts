import type { Page, Route } from "@playwright/test";
import { BASE, expect, test } from "./helpers";

const requestId = "a1000000-0000-4000-8000-000000000001";

function success(data: unknown) {
  return { data, meta: { requestId } };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });
}

async function installGoogleOnlyAuthFixture(page: Page) {
  let startBody: unknown;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === "https://accounts.google.com") {
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>Google OIDC destination captured</title><h1>Google OIDC</h1>",
      });
    }
    if (url.pathname === "/api/auth/session") {
      return json(route, success({ session: null, user: null }));
    }
    if (url.pathname === "/api/product-profile") {
      return json(route, success({
        profile: "feedback_beta",
        checkoutMode: "off",
        betaMode: false,
        inviteRequiredForNewAccounts: false,
        capabilities: {
          accountDeletion: true,
          checkout: false,
          emailAuth: false,
          feedback: true,
          googleSignIn: true,
          media: true,
          photobookPreview: true,
          renovations: true,
          sharing: true,
          story: true,
          updates: true,
        },
      }));
    }
    if (url.pathname === "/api/beta/status") {
      return json(route, success({
        betaMode: false,
        inviteRequiredForNewAccounts: false,
        label: "Private bèta",
      }));
    }
    if (url.pathname === "/api/product-events") {
      return json(route, success({ accepted: true, replayed: false }));
    }
    if (url.pathname === "/api/auth/sign-in/google" && request.method() === "POST") {
      startBody = request.postDataJSON();
      return json(route, success({
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic",
      }));
    }
    return route.continue();
  });
  return { startBody: () => startBody };
}

test.describe("Google-only auth", () => {
  test("shows one Google action and no password, e-mail or magic-link controls", async ({ page }) => {
    await installGoogleOnlyAuthFixture(page);
    await page.goto(`${BASE}/auth`);

    await expect(page.getByRole("heading", { name: "Ga verder met je verbouwverhaal." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Doorgaan met Google" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toHaveCount(0);
    await expect(page.getByLabel(/wachtwoord/i)).toHaveCount(0);
    await expect(page.getByText(/magic link/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /wachtwoord vergeten/i })).toHaveCount(0);
  });

  test("keeps historical registration links on the same single Google flow", async ({ page }) => {
    await installGoogleOnlyAuthFixture(page);
    await page.goto(`${BASE}/auth?mode=register&provider=google`);

    await expect(page.getByRole("heading", { name: "Ga verder met je verbouwverhaal." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Doorgaan met Google" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /registreer|inloggen met/i })).toHaveCount(0);
    await expect(page.getByLabel(/naam|biografie|adres|budget|aannemer/i)).toHaveCount(0);
  });

  test("posts a safe next path and hands navigation to Google", async ({ page }) => {
    const fixture = await installGoogleOnlyAuthFixture(page);
    await page.goto(`${BASE}/auth?next=${encodeURIComponent("/project/nieuw")}`);
    await page.getByRole("button", { name: "Doorgaan met Google" }).click();

    await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    expect(fixture.startBody()).toEqual({ next: "/project/nieuw" });
  });

  test("removes historical reset routes from the visible product", async ({ page }) => {
    await installGoogleOnlyAuthFixture(page);
    await page.goto(`${BASE}/wachtwoord-vergeten`);
    await expect(page.getByText(/404|niet gevonden/i).first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toHaveCount(0);
  });

  test("preserves a protected order destination through Google login", async ({ page }) => {
    await installGoogleOnlyAuthFixture(page);
    const orderId = "11111111-1111-4111-8111-111111111111";
    await page.goto(`${BASE}/bestellingen/${orderId}`);

    await expect(page).toHaveURL(
      new RegExp(`/auth\\?next=${encodeURIComponent(`/bestellingen/${orderId}`)}$`),
    );
    await expect(page.getByRole("button", { name: "Doorgaan met Google" })).toBeVisible();
  });
});

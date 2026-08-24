import type { Route } from "@playwright/test";

import { BASE, expect, test } from "./helpers";
import {
  FIXED_NOW,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

const budgetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const budgetItemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function budgetFixture(plannedAmountMinor = 50_000_00) {
  return {
    id: budgetId,
    projectId: SYNTHETIC_IDS.project,
    currency: "EUR",
    plannedAmountMinor,
    version: plannedAmountMinor === 50_000_00 ? 4 : 5,
    totals: {
      allocatedAmountMinor: 15_000_00,
      actualAmountMinor: 12_500_00,
      remainingAmountMinor: plannedAmountMinor - 12_500_00,
    },
    items: [{
      id: budgetItemId,
      updateId: SYNTHETIC_IDS.update,
      kind: "actual",
      category: "Keuken",
      description: "Volledig synthetische testpost",
      amountMinor: 12_500_00,
      occurredOn: "2026-08-20",
      sortOrder: 0,
      version: 2,
    }],
  };
}

async function accountRoutes(route: Route, pathname: string, method: string): Promise<boolean> {
  if (pathname === "/api/account/sessions" && method === "GET") {
    await fulfillJson(route, success({
      sessions: [{
        id: SYNTHETIC_IDS.session,
        isCurrent: true,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: FIXED_NOW,
        expiresAt: "2099-08-23T10:00:00.000Z",
        ipAddress: null,
        userAgent: "Mozilla/5.0 Macintosh",
      }],
    }));
    return true;
  }
  if (pathname === "/api/account/exports" && method === "GET") {
    await fulfillJson(route, success({ exports: [] }));
    return true;
  }
  if (pathname === "/api/account/profile" && method === "PATCH") {
    await fulfillJson(route, success({
      id: SYNTHETIC_IDS.owner,
      version: 4,
      replayed: false,
    }));
    return true;
  }
  return false;
}

test.describe("Accountinstellingen", () => {
  test("laadt server-owned accountdata en toont uitsluitend Google-login", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      handle: ({ request, route, url }) => accountRoutes(route, url.pathname, request.method()),
    });

    await page.goto(`${BASE}/account`);

    await expect(page.getByRole("heading", { level: 1, name: "Instellingen" })).toBeVisible();
    await expect(page.getByLabel("Weergavenaam")).toHaveValue("Synthetische eigenaar");
    await expect(page.getByText(/uitsluitend in met Google/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Actieve sessies" })).toBeVisible();
    await expect(page.getByText("Dit apparaat")).toBeVisible();
    await expect(page.getByRole("button", { name: "Account verwijderen" })).toBeVisible();
    await expect(page.getByLabel(/wachtwoord/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /wachtwoord/i })).toHaveCount(0);
    expect(fixture.unhandled).toEqual([]);
  });

  test("stuurt een profielwijziging zonder identity- of providergegevens", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      handle: ({ request, route, url }) => accountRoutes(route, url.pathname, request.method()),
    });

    await page.goto(`${BASE}/account`);
    await page.getByLabel("Weergavenaam").fill("Nieuwe synthetische naam");
    await page.getByRole("button", { name: "Profiel opslaan" }).click();
    await expect(page.getByText("Je profiel is bijgewerkt.")).toBeVisible();

    const mutation = fixture.requests.find((request) => (
      request.method === "PATCH" && request.pathname === "/api/account/profile"
    ));
    expect(mutation?.body).toMatchObject({
      displayName: "Nieuwe synthetische naam",
      expectedVersion: 3,
    });
    expect(mutation?.body).not.toHaveProperty("email");
    expect(mutation?.body).not.toHaveProperty("googleSubject");
    expect(fixture.unhandled).toEqual([]);
  });

  test("trekt een andere sessie in en vraagt een private data-export aan", async ({ page }) => {
    const otherSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const exportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let sessions = [
      {
        id: SYNTHETIC_IDS.session,
        isCurrent: true,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: FIXED_NOW,
        expiresAt: "2099-08-23T10:00:00.000Z",
        ipAddress: null,
        userAgent: "Mozilla/5.0 Macintosh",
      },
      {
        id: otherSessionId,
        isCurrent: false,
        createdAt: "2026-08-02T12:00:00.000Z",
        updatedAt: FIXED_NOW,
        expiresAt: "2099-08-24T10:00:00.000Z",
        ipAddress: null,
        userAgent: "Mozilla/5.0 Android",
      },
    ];
    let exports: Array<Record<string, unknown>> = [];
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/account/sessions" && request.method() === "GET") {
          await fulfillJson(route, success({ sessions }));
          return true;
        }
        if (url.pathname === `/api/account/sessions/${otherSessionId}` && request.method() === "DELETE") {
          sessions = sessions.filter((session) => session.id !== otherSessionId);
          await fulfillJson(route, success({
            revokedSessionId: otherSessionId,
            revokedCurrentSession: false,
          }));
          return true;
        }
        if (url.pathname === "/api/account/exports" && request.method() === "GET") {
          await fulfillJson(route, success({ exports }));
          return true;
        }
        if (url.pathname === "/api/account/exports" && request.method() === "POST") {
          const item = {
            id: exportId,
            status: "requested",
            includeMedia: false,
            manifestSha256: null,
            createdAt: FIXED_NOW,
            completedAt: null,
            expiresAt: null,
            downloadPath: null,
            failureCode: null,
          };
          exports = [item];
          await fulfillJson(route, success({ export: item, replayed: false }), 202);
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/account`);
    await expect(page.getByText("Android-apparaat")).toBeVisible();
    await page.getByRole("button", { name: "Sessie intrekken" }).click();
    await expect(page.getByText("De sessie is ingetrokken.")).toBeVisible();
    await expect(page.getByText("Android-apparaat")).toHaveCount(0);

    await page.getByRole("switch", { name: "Foto's en bestanden toevoegen" }).click();
    await page.getByRole("button", { name: "Data-export aanvragen" }).click();
    await expect(page.getByText("Je data-export staat in de wachtrij.")).toBeVisible();
    await expect(page.getByText("In wachtrij")).toBeVisible();

    expect(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "DELETE", pathname: `/api/account/sessions/${otherSessionId}` }),
      expect.objectContaining({
        method: "POST",
        pathname: "/api/account/exports",
        body: expect.objectContaining({ includeMedia: false }),
      }),
    ]));
    expect(fixture.unhandled).toEqual([]);
  });

  test("vereist de exacte verwijderbevestiging en meldt de accountverwijdering server-side aan", async ({ page }) => {
    let signedOut = false;
    const deletionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname === "/api/auth/session" && request.method() === "GET" && signedOut) {
          await fulfillJson(route, success({ session: null, user: null }));
          return true;
        }
        if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
          signedOut = true;
          await fulfillJson(route, success({ signedOut: true }));
          return true;
        }
        if (url.pathname === "/api/account/deletion" && request.method() === "POST") {
          await fulfillJson(route, success({
            deletion: {
              id: deletionId,
              status: "deletion_pending",
              activeOrderCount: 0,
            },
            replayed: false,
          }), 202);
          return true;
        }
        if (url.pathname === "/api/discovery" && request.method() === "GET") {
          await fulfillJson(route, success({ items: [], nextCursor: null }));
          return true;
        }
        return accountRoutes(route, url.pathname, request.method());
      },
    });

    await page.goto(`${BASE}/account`);
    await page.getByRole("button", { name: "Account verwijderen" }).click();
    const dialog = page.getByRole("alertdialog");
    const submit = dialog.getByRole("button", { name: "Definitief verwijderen" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Typ VERWIJDEREN").fill("VERWIJDEREN");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect.poll(() => fixture.requests.some((request) => (
      request.method === "POST" && request.pathname === "/api/account/deletion"
    ))).toBe(true);
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/account/deletion",
      body: expect.objectContaining({ confirmation: "VERWIJDEREN" }),
    }));
    await expect(page).toHaveURL(`${BASE}/`);
    expect(fixture.unhandled).toEqual([]);
  });
});

test.describe("Privébudget", () => {
  test("toont totalen en verwerkt één optimistic owner-wijziging", async ({ page }) => {
    let currentBudget = budgetFixture();
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (url.pathname !== `/api/projects/${SYNTHETIC_IDS.project}/budget`) return false;
        if (request.method() === "GET") {
          await fulfillJson(route, success(currentBudget));
          return true;
        }
        if (request.method() === "PATCH") {
          currentBudget = budgetFixture(55_000_00);
          await fulfillJson(route, success({
            resourceType: "budget",
            id: budgetId,
            version: 5,
            replayed: false,
          }));
          return true;
        }
        return false;
      },
    });

    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/budget`);
    await expect(page.getByRole("heading", { level: 1, name: "Wat de verbouwing kost." })).toBeVisible();
    await expect(page.getByText("€ 50.000,00")).toBeVisible();
    await expect(page.getByText("Keuken", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Wijzig" }).click();
    await page.getByLabel("Totaal verbouwingsbudget in euro").fill("55000,00");
    await page.getByRole("button", { name: "Opslaan" }).click();
    await expect(page.getByText("Budget bijgewerkt")).toBeVisible();

    const mutation = fixture.requests.find((request) => (
      request.method === "PATCH"
      && request.pathname === `/api/projects/${SYNTHETIC_IDS.project}/budget`
    ));
    expect(mutation?.body).toMatchObject({
      expectedVersion: 4,
      plannedAmountMinor: 55_000_00,
    });
    expect(mutation?.body).not.toHaveProperty("userId");
    expect(fixture.unhandled).toEqual([]);
  });

  test("houdt een uitgelogde budgetroute dicht met een Google-only bestemming", async ({ page }) => {
    const fixture = await installSyntheticApi(page, { authenticated: false });

    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/budget`);

    const signIn = page.locator("#main-content").getByRole("link", { name: "Inloggen", exact: true });
    await expect(page.getByRole("heading", { name: "Log in voor je budget" })).toBeVisible();
    await expect(signIn).toHaveAttribute(
      "href",
      `/auth?next=${encodeURIComponent(`/project/${SYNTHETIC_IDS.project}/budget`)}`,
    );
    await signIn.click();
    await expect(page).toHaveURL(
      new RegExp(`/auth\\?next=${encodeURIComponent(`/project/${SYNTHETIC_IDS.project}/budget`)}$`),
    );
    await expect(page.getByRole("button", { name: "Inloggen met Google" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /e-mailadres/i })).toHaveCount(0);
    expect(fixture.unhandled).toEqual([]);
  });
});

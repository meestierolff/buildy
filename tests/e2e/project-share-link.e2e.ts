import type { Page } from "@playwright/test";

import { BASE, allowBrowserDiagnostics, expect, test } from "./helpers";
import {
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
  syntheticProjectOverview,
} from "./syntheticApi";

const LINK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAW_LINK = "a".repeat(43);
const ROTATED_RAW_LINK = "b".repeat(43);
const EXPIRES_AT = "2099-08-30T10:00:00.000Z";

const ownerLink = (version = 1) => ({
  id: LINK_ID,
  projectId: SYNTHETIC_IDS.project,
  expiresAt: EXPIRES_AT,
  createdAt: "2026-08-23T10:00:00.000Z",
  version,
  state: "active" as const,
});

async function installOwnerShareFixture(page: Page) {
  let currentLink: ReturnType<typeof ownerLink> | null = null;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { __buildyCopiedLink?: string }).__buildyCopiedLink = value;
        },
      },
    });
  });
  return installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`) {
        await fulfillJson(route, success(syntheticProjectOverview("unlisted")));
        return true;
      }
      if (request.method() === "GET" && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates`) {
        await fulfillJson(route, success({ projectId: SYNTHETIC_IDS.project, items: [], nextCursor: null }));
        return true;
      }
      if (url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/share-link`) {
        if (request.method() === "GET") {
          await fulfillJson(route, success({ projectId: SYNTHETIC_IDS.project, link: currentLink }));
          return true;
        }
        if (request.method() === "POST") {
          currentLink = ownerLink(1);
          await fulfillJson(route, success({
            link: currentLink,
            shareUrl: `${BASE}/delen#toegang=${RAW_LINK}`,
            replayed: false,
          }), 201);
          return true;
        }
        if (request.method() === "DELETE") {
          currentLink = null;
          await fulfillJson(route, success({
            projectId: SYNTHETIC_IDS.project,
            linkId: LINK_ID,
            version: 2,
            revoked: true,
            replayed: false,
          }));
          return true;
        }
      }
      if (request.method() === "POST" && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/share-link/rotate`) {
        currentLink = ownerLink(1);
        await fulfillJson(route, success({
          link: currentLink,
          shareUrl: `${BASE}/delen#toegang=${ROTATED_RAW_LINK}`,
          replayed: false,
        }), 201);
        return true;
      }
      return false;
    },
  });
}

test.describe("Tijdelijke projectdeellink", () => {
  test("eigenaar maakt, kopieert, roteert en trekt een bearer-deellink in", async ({ page }) => {
    const fixture = await installOwnerShareFixture(page);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}`);

    await page.getByRole("button", { name: "Deel je verbouwing" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/link is een toegangssleutel/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Deellink maken" }).click();
    await dialog.getByRole("button", { name: "Link kopiëren" }).click();
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __buildyCopiedLink?: string }
    ).__buildyCopiedLink)).toBe(`${BASE}/delen#toegang=${RAW_LINK}`);

    await dialog.getByRole("button", { name: "Sluiten", exact: true }).last().click();
    await page.getByRole("button", { name: "Deel je verbouwing" }).click();
    await dialog.getByRole("button", { name: "Nieuwe link maken" }).click();
    await dialog.getByRole("button", { name: "Link kopiëren" }).click();
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __buildyCopiedLink?: string }
    ).__buildyCopiedLink)).toBe(`${BASE}/delen#toegang=${ROTATED_RAW_LINK}`);
    await dialog.getByRole("button", { name: "Link intrekken" }).click();
    await expect(dialog.getByText(/nog geen actieve deellink/i)).toBeVisible();

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/share-link`,
      body: expect.objectContaining({ expiresAt: expect.any(String), idempotencyKey: expect.any(String) }),
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/share-link/rotate`,
      body: expect.objectContaining({ expectedVersion: 1 }),
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "DELETE",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/share-link`,
      body: expect.objectContaining({ expectedVersion: 1 }),
    }));
    expect(fixture.requests.every((request) => !request.search.includes("toegang"))).toBe(true);
    expect(fixture.unhandled).toEqual([]);
  });

  test("fragment wordt vóór redemption verwijderd en succes navigeert naar een schoon projectpad", async ({ page }) => {
    allowBrowserDiagnostics(
      page,
      /^console: \[JavaScript Error: "downloadable font: download failed .*Instrument Serif.*$/,
      /^requestfailed: GET .*instrument-serif.* \(cancelled\)$/,
    );
    const networkUrls: string[] = [];
    page.on("request", (request) => networkUrls.push(request.url()));
    const fixture = await installSyntheticApi(page, {
      authenticated: false,
      handle: async ({ request, route, url }) => {
        if (request.method() === "POST" && url.pathname === "/api/project-share-links/redeem") {
          expect(url.search).toBe("");
          expect(request.postDataJSON()).toEqual({ token: RAW_LINK });
          await fulfillJson(route, success({
            projectId: SYNTHETIC_IDS.project,
            cleanPath: `/project/${SYNTHETIC_IDS.project}`,
            expiresAt: EXPIRES_AT,
          }));
          return true;
        }
        if (request.method() === "GET" && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}`) {
          await fulfillJson(route, success({
            ...syntheticProjectOverview("unlisted"),
            viewerAccess: "link",
            canEdit: false,
          }));
          return true;
        }
        if (request.method() === "GET" && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/updates`) {
          await fulfillJson(route, success({ projectId: SYNTHETIC_IDS.project, items: [], nextCursor: null }));
          return true;
        }
        return false;
      },
    });

    await page.goto(`${BASE}/delen#toegang=${RAW_LINK}`);
    await expect(page).toHaveURL(`${BASE}/project/${SYNTHETIC_IDS.project}`);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetische verbouwing" })).toBeVisible();
    expect(networkUrls.some((url) => url.includes(RAW_LINK))).toBe(false);
    expect(fixture.requests.find((request) => request.pathname === "/api/project-share-links/redeem")?.body)
      .toEqual({ token: RAW_LINK });
    expect(fixture.unhandled).toEqual([]);
  });

  test("verlopen link houdt een bruikbare, schone foutpagina over", async ({ page }) => {
    allowBrowserDiagnostics(
      page,
      /^console: Failed to load resource: the server responded with a status of 410 \(Gone\)$/,
    );
    const fixture = await installSyntheticApi(page, {
      authenticated: false,
      handle: async ({ request, route, url }) => {
        if (request.method() !== "POST" || url.pathname !== "/api/project-share-links/redeem") return false;
        await fulfillJson(route, {
          error: {
            code: "NOT_FOUND",
            message: "Deze deellink is verlopen.",
            requestId: SYNTHETIC_IDS.request,
          },
        }, 410);
        return true;
      },
    });

    await page.goto(`${BASE}/delen#toegang=${RAW_LINK}`);
    await expect(page).toHaveURL(`${BASE}/delen`);
    await expect(page.getByRole("heading", { name: "Deze deel-link is niet meer actief." })).toBeVisible();
    await expect(page.getByText(/vraag de maker/i)).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });
});

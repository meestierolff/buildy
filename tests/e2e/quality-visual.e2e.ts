import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";
import { notificationPageSchema } from "../../shared/contracts/engagement";
import { photobookDraftResponseSchema } from "../../shared/contracts/photobooks";
import {
  projectOverviewSchema,
  projectPageSchema,
  timelinePageSchema,
} from "../../shared/contracts/projects";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8090";
const APP_ORIGIN = new URL(BASE_URL).origin;
const FIXED_NOW = "2026-08-05T10:00:00.000Z";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const UPDATE_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_UPDATE_ID = "44444444-4444-4444-8444-444444444444";
const PHASE_ID = "55555555-5555-4555-8555-555555555555";
const ACTOR_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_ACTOR_ID = "77777777-7777-4777-8777-777777777777";
const PHOTOBOOK_DRAFT_ID = "88888888-8888-4888-8888-888888888888";
const PHOTOBOOK_REVISION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCUMENT_SHA256 = "b".repeat(64);
const PDF_BYTES = Buffer.from("%PDF-1.7\nsynthetic-buildy-proof\n%%EOF", "utf8");
const PDF_SHA256 = createHash("sha256").update(PDF_BYTES).digest("hex");

const OWNER = {
  id: OWNER_ID,
  displayName: "Synthetische bewoner",
  slug: "synthetische-bewoner",
};

const PROJECT_CARD = {
  id: PROJECT_ID,
  slug: "synthetische-stadswoning",
  title: "Synthetische stadswoning",
  description: "Een volledig verzonnen renovatieproject voor visuele kwaliteitscontrole.",
  projectType: "Volledige renovatie",
  visibility: "private" as const,
  progressPercentage: 48,
  version: 7,
  updatedAt: "2026-08-04T14:30:00.000Z",
  publishedAt: null,
  updateCount: 2,
  lastUpdateAt: "2026-08-04T14:30:00.000Z",
  owner: OWNER,
  cover: null,
};

const DISCOVERY_CARD = {
  ...PROJECT_CARD,
  title: "Licht in de benedenwoning",
  description: "Een bewust openbaar gemaakt, volledig synthetisch bouwverhaal.",
  projectType: "Duurzaam verbouwen",
  visibility: "public" as const,
  progressPercentage: 76,
  publishedAt: "2026-07-10T08:00:00.000Z",
  updateCount: 8,
  owner: {
    id: ACTOR_ID,
    displayName: "Synthetische maker",
    slug: "synthetische-maker",
  },
};

const PHASE = {
  id: PHASE_ID,
  name: "Ruwbouw",
  sortOrder: 1,
  isCustom: false,
};

const PROJECT_OVERVIEW = {
  ...PROJECT_CARD,
  startDate: "2026-02-01",
  expectedEndDate: "2026-11-30",
  contentRevision: 5,
  followerCount: 3,
  viewerAccess: "owner" as const,
  canEdit: true,
  phases: [PHASE],
};

const PROJECT_UPDATES = [
  {
    id: UPDATE_ID,
    projectId: PROJECT_ID,
    phase: PHASE,
    title: "De oude keuken is verwijderd",
    room: "Keuken",
    description: "De ruimte is leeg en klaar voor de nieuwe indeling.",
    updateDate: "2026-07-18",
    status: "published" as const,
    isMilestone: true,
    sortOrder: 0,
    contentRevision: 2,
    version: 2,
    publishedAt: "2026-07-18T09:00:00.000Z",
    updatedAt: "2026-07-18T09:00:00.000Z",
    media: [],
  },
  {
    id: SECOND_UPDATE_ID,
    projectId: PROJECT_ID,
    phase: PHASE,
    title: "Leidingen op hun nieuwe plek",
    room: "Keuken",
    description: "Water en elektra zijn voorbereid voor de volgende bouwfase.",
    updateDate: "2026-08-04",
    status: "published" as const,
    isMilestone: false,
    sortOrder: 1,
    contentRevision: 1,
    version: 1,
    publishedAt: "2026-08-04T14:30:00.000Z",
    updatedAt: "2026-08-04T14:30:00.000Z",
    media: [],
  },
];

const NOTIFICATIONS = [
  {
    id: "10101010-1010-4010-8010-101010101010",
    type: "comment.created",
    status: "unread" as const,
    actor: {
      id: ACTOR_ID,
      displayName: "Synthetische buur",
      slug: "synthetische-buur",
      avatar: null,
    },
    projectId: PROJECT_ID,
    updateId: UPDATE_ID,
    commentId: "20202020-2020-4020-8020-202020202020",
    orderId: null,
    readAt: null,
    createdAt: "2026-08-05T09:35:00.000Z",
  },
  {
    id: "30303030-3030-4030-8030-303030303030",
    type: "profile.follow.requested",
    status: "unread" as const,
    actor: {
      id: SECOND_ACTOR_ID,
      displayName: "Synthetische volger",
      slug: "synthetische-volger",
      avatar: null,
    },
    projectId: null,
    updateId: null,
    commentId: null,
    orderId: null,
    readAt: null,
    createdAt: "2026-08-05T08:20:00.000Z",
  },
  {
    id: "40404040-4040-4040-8040-404040404040",
    type: "profile.follow.accepted",
    status: "read" as const,
    actor: null,
    projectId: null,
    updateId: null,
    commentId: null,
    orderId: null,
    readAt: "2026-08-04T17:00:00.000Z",
    createdAt: "2026-08-04T16:45:00.000Z",
  },
];

function photobookDocument() {
  return {
    version: 1 as const,
    projectId: PROJECT_ID,
    projectRevision: 7,
    selectedFormat: "a4-landscape-hardcover-v1" as const,
    locale: "nl-NL" as const,
    print: {
      widthMm: 297 as const,
      heightMm: 210 as const,
      safeMarginMm: 12 as const,
      bleedMm: 0 as const,
      targetDpi: 300 as const,
      colorSpace: "RGB" as const,
    },
    cover: {
      title: "Synthetisch Bouwboek",
      subtitle: "Van lege ruimte naar nieuw thuis",
      mediaAssetId: null,
      crop: null,
    },
    chapters: [],
    pages: Array.from({ length: 24 }, (_, index) => ({
      id: index === 0 ? "cover" : `blank:${index + 1}`,
      number: index + 1,
      kind: index === 0 ? "cover" as const : "blank" as const,
      chapterId: null,
      updateId: null,
      background: index === 0 ? "#142238" : "#ffffff",
      overlay: null,
      blocks: index === 0 ? [{
        id: "cover-title",
        type: "text" as const,
        frame: { xMm: 26, yMm: 126, widthMm: 245, heightMm: 42 },
        font: "instrument-serif" as const,
        weight: "semibold" as const,
        style: "normal" as const,
        fontSizePt: 36,
        lineHeightPt: 38,
        align: "center" as const,
        color: "#ffffff",
        text: "Synthetisch Bouwboek",
        lines: ["Synthetisch Bouwboek"],
      }] : [],
    })),
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: 24,
    warnings: [],
    checksumSha256: DOCUMENT_SHA256,
  };
}

const PHOTOBOOK_DRAFT = {
  draftId: PHOTOBOOK_DRAFT_ID,
  version: 4,
  settings: {
    coverMediaAssetId: null,
    selectedFormat: "a4-landscape-hardcover-v1" as const,
    title: "Synthetisch Bouwboek",
    subtitle: "Van lege ruimte naar nieuw thuis",
    includeBudget: false,
    preferences: {
      coverCrop: null,
      cropByAsset: {},
      photoOrderByUpdate: {},
      layoutByPage: {},
    },
    version: 3,
  },
  exclusions: [],
  document: photobookDocument(),
  proof: {
    revisionId: PHOTOBOOK_REVISION_ID,
    status: "approved" as const,
    documentSha256: DOCUMENT_SHA256,
    pdfSha256: PDF_SHA256,
    pageCount: 24,
    pdfPath: `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/pdf`,
    thumbnailPaths: [],
  },
};

// Keep the route mocks on the same runtime contracts as the browser clients.
// These execute during Playwright discovery, before a browser or provider can be contacted.
projectPageSchema.parse({ items: [PROJECT_CARD], nextCursor: null });
projectPageSchema.parse({ items: [DISCOVERY_CARD], nextCursor: null });
projectOverviewSchema.parse(PROJECT_OVERVIEW);
timelinePageSchema.parse({ projectId: PROJECT_ID, items: PROJECT_UPDATES, nextCursor: null });
notificationPageSchema.parse({ items: NOTIFICATIONS, nextCursor: null, unreadCount: 2 });
photobookDraftResponseSchema.parse({
  data: PHOTOBOOK_DRAFT,
  meta: { requestId: REQUEST_ID },
});

interface MockDiagnostics {
  externalRequests: string[];
  runtimeErrors: string[];
  unhandledApiRequests: string[];
}

interface MockOptions {
  authenticated: boolean;
  checkoutMode?: "off" | "test" | "live";
}

function success(data: unknown) {
  return { data, meta: { requestId: REQUEST_ID } };
}

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(data),
  });
}

async function installSyntheticNetwork(
  page: Page,
  options: MockOptions,
): Promise<MockDiagnostics> {
  const diagnostics: MockDiagnostics = {
    externalRequests: [],
    runtimeErrors: [],
    unhandledApiRequests: [],
  };

  page.on("pageerror", (error) => {
    diagnostics.runtimeErrors.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.runtimeErrors.push(`console: ${message.text()}`);
    }
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.origin !== APP_ORIGIN) {
      diagnostics.externalRequests.push(`${method} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (method === "GET" && url.pathname === "/api/auth/session") {
      await json(route, success(options.authenticated ? {
        session: {
          id: "12121212-1212-4212-8212-121212121212",
          userId: OWNER_ID,
          expiresAt: "2099-08-05T20:00:00.000Z",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-05T09:00:00.000Z",
        },
        user: {
          id: OWNER_ID,
          name: OWNER.displayName,
          email: "quality-owner@example.invalid",
          emailVerified: true,
          image: null,
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-05T09:00:00.000Z",
        },
      } : { session: null, user: null }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/product-profile") {
      const checkoutMode = options.checkoutMode ?? "off";
      await json(route, success({
        profile: "feedback_beta",
        checkoutMode,
        betaMode: false,
        inviteRequiredForNewAccounts: false,
        capabilities: {
          accountDeletion: true,
          checkout: checkoutMode !== "off",
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
      return;
    }

    if (method === "GET" && url.pathname === "/api/beta/status") {
      await json(route, success({
        betaMode: false,
        inviteRequiredForNewAccounts: false,
        label: "Publieke feedbackbèta",
      }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/account/profile") {
      await json(route, success({
        id: OWNER_ID,
        displayName: OWNER.displayName,
        slug: OWNER.slug,
        bio: "Volledig synthetisch profiel voor visuele kwaliteitscontrole.",
        location: null,
        isPrivate: true,
        isPro: false,
        avatar: null,
        onboardedAt: "2026-08-01T12:05:00.000Z",
        version: 2,
        updatedAt: "2026-08-05T09:00:00.000Z",
      }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/discovery") {
      await json(route, success({ items: [DISCOVERY_CARD], nextCursor: null }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/projects") {
      await json(route, success({ items: [PROJECT_CARD], nextCursor: null }));
      return;
    }

    if (method === "GET" && url.pathname === `/api/projects/${PROJECT_ID}`) {
      await json(route, success(PROJECT_OVERVIEW));
      return;
    }

    if (
      method === "GET"
      && url.pathname === `/api/projects/${PROJECT_ID}/updates`
    ) {
      await json(route, success({
        projectId: PROJECT_ID,
        items: PROJECT_UPDATES,
        nextCursor: null,
      }));
      return;
    }

    if (method === "GET" && url.pathname === "/api/notifications") {
      await json(route, success({ items: NOTIFICATIONS, nextCursor: null, unreadCount: 2 }));
      return;
    }

    if (
      method === "GET"
      && url.pathname === `/api/projects/${PROJECT_ID}/photobook`
    ) {
      await json(route, success(PHOTOBOOK_DRAFT));
      return;
    }

    if (
      method === "GET"
      && url.pathname === `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/pdf`
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "content-length": String(PDF_BYTES.byteLength),
          "x-buildy-proof-revision": PHOTOBOOK_REVISION_ID,
          "x-buildy-proof-document-sha256": DOCUMENT_SHA256,
          "x-buildy-proof-pdf-sha256": PDF_SHA256,
          "x-request-id": REQUEST_ID,
        },
        body: PDF_BYTES,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/product-events") {
      await json(route, success({ accepted: true, replayed: false }), 201);
      return;
    }

    diagnostics.unhandledApiRequests.push(`${method} ${url.pathname}`);
    await json(route, {
      error: {
        code: "NOT_FOUND",
        message: "Niet opgenomen in de synthetische visual-suite.",
        requestId: REQUEST_ID,
      },
    }, 404);
  });

  return diagnostics;
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const documentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const bodyOverflow = document.body.scrollWidth - document.body.clientWidth;
    return { bodyOverflow, documentOverflow };
  });

  expect(overflow.documentOverflow, "document heeft horizontale overflow").toBeLessThanOrEqual(1);
  expect(overflow.bodyOverflow, "body heeft horizontale overflow").toBeLessThanOrEqual(1);
}

async function stabilizePage(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function saveCapture(
  page: Page,
  testInfo: TestInfo,
  viewportName: string,
  screenName: string,
  fullPage: boolean,
): Promise<void> {
  await expect(page).toHaveScreenshot(
    ["quality", viewportName, `${screenName}.png`],
    {
      animations: "disabled",
      caret: "hide",
      fullPage,
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
  );

  const path = resolve(
    "test-results",
    "quality-screenshots",
    viewportName,
    `${screenName}.png`,
  );
  await mkdir(dirname(path), { recursive: true });
  const screenshot = await page.screenshot({
    path,
    animations: "disabled",
    caret: "hide",
    fullPage,
  });
  await testInfo.attach(`${viewportName}-${screenName}`, {
    body: screenshot,
    contentType: "image/png",
  });
}

function appUrl(path: string): string {
  return new URL(path, `${APP_ORIGIN}/`).toString();
}

type VisualScenario = {
  assertReady: (page: Page) => Promise<void>;
  authenticated: boolean;
  checkoutMode?: "off" | "test" | "live";
  fullPage: boolean;
  name: string;
  path: string;
  prepare?: (page: Page) => Promise<void>;
};

const SCENARIOS: readonly VisualScenario[] = [
  {
    name: "landing",
    path: "/",
    authenticated: false,
    fullPage: true,
    assertReady: async (page) => {
      await expect(page.getByRole("heading", {
        level: 1,
        name: "Maak van je verbouwing een verhaal om te bewaren.",
      })).toBeVisible();
      await expect(page.getByText(
        "Je begint privé en kiest zelf wie ieder Bouwmoment kan zien.",
        { exact: true },
      )).toBeVisible();
    },
  },
  {
    name: "auth-registration",
    path: "/auth?mode=register&next=%2Fproject%2Fnieuw",
    authenticated: false,
    fullPage: true,
    assertReady: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "Start je dagboek." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Registreren met Google" })).toBeVisible();
      await expect(page.getByLabel(/wachtwoord|e-mailadres/i)).toHaveCount(0);
    },
  },
  {
    name: "project-detail",
    path: `/project/${PROJECT_ID}`,
    authenticated: true,
    fullPage: true,
    assertReady: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: PROJECT_CARD.title })).toBeVisible();
      await expect(page.getByRole("button", { name: "Bouwmoment toevoegen", exact: true })).toBeVisible();
      await expect(page.getByText("De oude keuken is verwijderd", { exact: true })).toBeVisible();
    },
  },
  {
    name: "update-composer",
    path: `/project/${PROJECT_ID}?update=nieuw`,
    authenticated: true,
    fullPage: false,
    prepare: async (page) => {
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByLabel("Korte titel of bijschrift (optioneel)", { exact: true })
        .fill("Nieuwe synthetische wandindeling");
    },
    assertReady: async (page) => {
      await expect(page.getByRole("heading", { name: "Wat is er veranderd?" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Bouwmoment plaatsen" })).toBeEnabled();
      await expect(page).toHaveURL(appUrl(`/project/${PROJECT_ID}?update=${UPDATE_ID}`));
    },
  },
  {
    name: "notifications",
    path: "/notificaties",
    authenticated: true,
    fullPage: true,
    assertReady: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "Notificaties" })).toBeVisible();
      await expect(page.getByText("Synthetische buur reageerde op je Bouwmoment", { exact: true })).toBeVisible();
      await expect(page.getByText("Synthetische volger wil je volgen", { exact: true })).toBeVisible();
    },
  },
  {
    name: "bouwboek",
    path: `/project/${PROJECT_ID}/bouwboek`,
    authenticated: true,
    fullPage: false,
    assertReady: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "Synthetisch Bouwboek" })).toBeVisible();
      await expect(page.getByText("Dit is je echte printproof", { exact: true })).toBeVisible();
      await expect(page.getByText(/Bestellen is nog niet beschikbaar/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Bouwboek bestellen" })).toHaveCount(0);
    },
  },
  {
    name: "checkout",
    path: `/project/${PROJECT_ID}/bouwboek`,
    authenticated: true,
    checkoutMode: "test",
    fullPage: false,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Bouwboek bestellen" }).click();
    },
    assertReady: async (page) => {
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Bouwboek bestellen" })).toBeVisible();
      await expect(dialog.getByText("Afleveradres", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Prijs en levering opvragen" })).toBeVisible();
    },
  },
];

const VIEWPORTS = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "desktop-1440x1000", width: 1440, height: 1000 },
] as const;

test.use({
  colorScheme: "light",
  locale: "nl-NL",
  serviceWorkers: "block",
  timezoneId: "Europe/Amsterdam",
});

for (const viewport of VIEWPORTS) {
  test.describe(`synthetische visuele kwaliteit · ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const scenario of SCENARIOS) {
      test(`${scenario.name} is deterministisch en past horizontaal`, async ({ page }, testInfo) => {
        await page.clock.setFixedTime(new Date(FIXED_NOW));
        await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
        const diagnostics = await installSyntheticNetwork(page, {
          authenticated: scenario.authenticated,
          checkoutMode: scenario.checkoutMode,
        });

        await page.goto(appUrl(scenario.path));
        if (scenario.prepare) await scenario.prepare(page);
        await scenario.assertReady(page);
        await stabilizePage(page);
        await expectNoHorizontalPageOverflow(page);
        await saveCapture(
          page,
          testInfo,
          viewport.name,
          scenario.name,
          scenario.fullPage,
        );

        expect(diagnostics.externalRequests, "provider- of externe requests").toEqual([]);
        expect(diagnostics.unhandledApiRequests, "niet-gemockte API-requests").toEqual([]);
        expect(diagnostics.runtimeErrors, "browserruntimefouten").toEqual([]);
      });
    }
  });
}

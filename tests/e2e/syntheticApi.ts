import type { Page, Request, Route } from "@playwright/test";

import type { CheckoutMode } from "../../shared/contracts/productProfile";
import type { ProjectVisibility } from "../../shared/contracts/projects";

export const SYNTHETIC_IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  update: "33333333-3333-4333-8333-333333333333",
  media: "44444444-4444-4444-8444-444444444444",
  phase: "55555555-5555-4555-8555-555555555555",
  publicProfile: "66666666-6666-4666-8666-666666666666",
  privateProfile: "77777777-7777-4777-8777-777777777777",
  session: "88888888-8888-4888-8888-888888888888",
  request: "99999999-9999-4999-8999-999999999999",
} as const;

export const FIXED_NOW = "2026-08-23T10:00:00.000Z";

export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export function success(data: unknown) {
  return { data, meta: { requestId: SYNTHETIC_IDS.request } };
}

export async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  });
}

export function syntheticAuthSession(authenticated = true) {
  if (!authenticated) return success({ session: null, user: null });
  return success({
    session: {
      id: SYNTHETIC_IDS.session,
      userId: SYNTHETIC_IDS.owner,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: FIXED_NOW,
      expiresAt: "2099-08-23T10:00:00.000Z",
    },
    user: {
      id: SYNTHETIC_IDS.owner,
      name: "Synthetische eigenaar",
      email: "eigenaar@example.invalid",
      emailVerified: true,
      image: null,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: FIXED_NOW,
    },
  });
}

export function syntheticProductProfile(checkoutMode: CheckoutMode = "off") {
  return success({
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
  });
}

export function syntheticOwnProfile() {
  return success({
    id: SYNTHETIC_IDS.owner,
    displayName: "Synthetische eigenaar",
    slug: "synthetische-eigenaar",
    bio: "Een volledig verzonnen profiel voor de Playwright-regressies.",
    location: "Utrecht",
    isPrivate: true,
    isPro: false,
    avatar: null,
    onboardedAt: "2026-08-01T12:05:00.000Z",
    version: 3,
    updatedAt: FIXED_NOW,
  });
}

export function syntheticProjectCard(visibility: ProjectVisibility = "private") {
  return {
    id: SYNTHETIC_IDS.project,
    slug: "synthetische-verbouwing",
    title: "Synthetische verbouwing",
    description: "Een volledig verzonnen verbouwing voor browserregressies.",
    projectType: "Volledige renovatie",
    visibility,
    progressPercentage: 42,
    version: 7,
    updatedAt: FIXED_NOW,
    publishedAt: visibility === "public" ? FIXED_NOW : null,
    updateCount: 1,
    lastUpdateAt: FIXED_NOW,
    owner: {
      id: SYNTHETIC_IDS.owner,
      displayName: "Synthetische eigenaar",
      slug: "synthetische-eigenaar",
    },
    cover: null,
  };
}

export function syntheticProjectOverview(visibility: ProjectVisibility = "private") {
  return {
    ...syntheticProjectCard(visibility),
    startDate: "2026-02-01",
    expectedEndDate: "2026-11-30",
    contentRevision: 3,
    followerCount: 2,
    viewerAccess: "owner",
    canEdit: true,
    phases: [{
      id: SYNTHETIC_IDS.phase,
      name: "Ruwbouw",
      sortOrder: 0,
      isCustom: false,
    }],
  };
}

export function syntheticProjectUpdate(withMedia = true) {
  return {
    id: SYNTHETIC_IDS.update,
    projectId: SYNTHETIC_IDS.project,
    phase: {
      id: SYNTHETIC_IDS.phase,
      name: "Ruwbouw",
      sortOrder: 0,
      isCustom: false,
    },
    title: "De eerste muur is open",
    room: "Keuken",
    description: "Een Bouwmoment uit uitsluitend synthetische testdata.",
    updateDate: "2026-08-22",
    status: "published",
    isMilestone: true,
    sortOrder: 0,
    contentRevision: 2,
    version: 2,
    publishedAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    media: withMedia ? [{
      id: SYNTHETIC_IDS.media,
      contentType: "image/png",
      width: 1200,
      height: 900,
      proxyPath: `/api/media/${SYNTHETIC_IDS.media}`,
      role: "gallery",
      sortOrder: 0,
      caption: "Synthetische privéfoto",
    }] : [],
  };
}

export type CapturedRequest = {
  body: unknown;
  method: string;
  pathname: string;
  search: string;
};

export type SyntheticRouteContext = {
  request: Request;
  route: Route;
  url: URL;
};

export type SyntheticRouteHandler = (
  context: SyntheticRouteContext,
) => boolean | Promise<boolean>;

type SyntheticApiOptions = {
  authenticated?: boolean;
  checkoutMode?: CheckoutMode;
  handle?: SyntheticRouteHandler;
};

function requestBody(request: Request): unknown {
  const raw = request.postData();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Installs a same-origin, fail-closed API boundary for browser tests.
 *
 * Scenario handlers run first. Every API request not handled by the scenario
 * or the shared product/auth/profile contract is recorded and answered with a
 * useful 404, so accidental dependencies on preview data cannot hide in CI.
 */
export async function installSyntheticApi(
  page: Page,
  options: SyntheticApiOptions = {},
): Promise<{ requests: CapturedRequest[]; unhandled: string[] }> {
  const requests: CapturedRequest[] = [];
  const unhandled: string[] = [];
  const authenticated = options.authenticated ?? true;
  const checkoutMode = options.checkoutMode ?? "off";

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname.startsWith("/api/")) {
      requests.push({
        body: requestBody(request),
        method,
        pathname: url.pathname,
        search: url.search,
      });
    }
    if (options.handle && await options.handle({ request, route, url })) return;
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (method === "GET" && url.pathname === "/api/auth/session") {
      await fulfillJson(route, syntheticAuthSession(authenticated));
      return;
    }
    if (method === "GET" && url.pathname === "/api/product-profile") {
      await fulfillJson(route, syntheticProductProfile(checkoutMode));
      return;
    }
    if (method === "GET" && url.pathname === "/api/account/profile" && authenticated) {
      await fulfillJson(route, syntheticOwnProfile());
      return;
    }
    if (method === "GET" && url.pathname === "/api/notifications" && authenticated) {
      await fulfillJson(route, success({
        items: [],
        nextCursor: null,
        unreadCount: 0,
      }));
      return;
    }
    if (method === "GET" && url.pathname === "/api/beta/status") {
      await fulfillJson(route, success({
        betaMode: false,
        inviteRequiredForNewAccounts: false,
        label: "Publieke feedbackbèta",
      }));
      return;
    }
    if (method === "POST" && url.pathname === "/api/product-events") {
      await fulfillJson(route, success({ accepted: true, replayed: false }), 201);
      return;
    }

    const key = `${method} ${url.pathname}${url.search}`;
    unhandled.push(key);
    await fulfillJson(route, {
      error: {
        code: "NOT_FOUND",
        message: `Geen synthetische fixture voor ${method} ${url.pathname}.`,
        requestId: SYNTHETIC_IDS.request,
      },
    }, 404);
  });

  return { requests, unhandled };
}

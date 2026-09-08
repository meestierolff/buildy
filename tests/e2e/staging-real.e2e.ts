import { createHash } from "node:crypto";
import { expect, request as requestFactory, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { z } from "zod";

import { apiErrorSchema, healthResponseSchema } from "../../shared/contracts/api";
import { authSessionResponseSchema } from "../../shared/contracts/auth";
import { photobookDraftResponseSchema } from "../../shared/contracts/photobooks";
import { productProfileResponseSchema } from "../../shared/contracts/productProfile";
import { projectOverviewResponseSchema, timelineResponseSchema } from "../../shared/contracts/projects";

const BASE = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8090").origin;

function requiredProjectId(): string {
  const value = process.env.PLAYWRIGHT_STAGING_PROJECT_ID?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("PLAYWRIGHT_STAGING_PROJECT_ID moet een bestaande private testverbouwing aanwijzen.");
  }
  return value.toLowerCase();
}

async function get(context: APIRequestContext, path: string): Promise<APIResponse> {
  try {
    return await context.get(BASE + path, { maxRedirects: 0, timeout: 30_000 });
  } catch {
    // Do not copy request headers, session material or private URLs into diagnostics.
    throw new Error("De staging-API kon niet binnen dertig seconden worden gelezen.");
  }
}

async function json<Schema extends z.ZodTypeAny>(response: APIResponse, schema: Schema): Promise<z.output<Schema>> {
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error("De staging-API gaf geen geldig contractantwoord; inhoud is niet opgenomen.");
  return parsed.data;
}

async function read<Schema extends z.ZodTypeAny>(context: APIRequestContext, path: string, schema: Schema): Promise<z.output<Schema>> {
  const response = await get(context, path);
  expect(response.status(), "De geautoriseerde staging-read moet slagen.").toBe(200);
  return json(response, schema);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// F0/F7 smoke over owner-prepared F1/F2/F5 fixtures, never a replacement for F1–F6.
// The owner must sign in with their username and password and prepare a private test renovation with
// at least two moments, three photos and an included digital Bouwboek beforehand.
// No browser is opened, so reports cannot capture the owner's DOM or screenshots.
// GET /photobook refreshes the existing server draft cache; no content is edited,
// no proof/payment is requested, and no project, feedback or account is deleted.
test.describe("@staging-real bestaande private MVP-fixture zonder API-mocks", () => {
  test("leest echte sessie, bewaarde foto's en digitaal Bouwboek met checkout uit", async ({ request }) => {
    test.setTimeout(180_000);
    expect(process.env.PLAYWRIGHT_MODE).toBe("staging-real");
    const projectId = requiredProjectId();
    const projectPath = "/api/projects/" + projectId;
    const timelinePath = projectPath + "/updates?limit=50";
    const bookPath = projectPath + "/photobook";

    test.info().annotations.push({
      type: "evidence-boundary",
      description: "Real hosted API persistence smoke only. Username/password login/logout, UI reload/edit, two-user sharing/revocation and engagement, feedback and disposable-account deletion still require separate F1–F6 evidence.",
    });

    const health = (await read(request, "/api/health", healthResponseSchema)).data;
    expect(["preview", "staging"].includes(health.environment), "Gebruik een geïsoleerde Preview of stagingomgeving.").toBe(true);
    expect(health.release).toMatch(/^[0-9a-f]{40}$/);
    const expectedRelease = process.env.LAUNCH_EXPECTED_GIT_SHA ?? process.env.GITHUB_SHA;
    if (expectedRelease) expect(health.release === expectedRelease, "De deployment moet bij de gekozen bron-SHA horen.").toBe(true);
    expect(health.capabilities).toMatchObject({
      database: "ready", authentication: "ready", media: "ready", photobooks: "ready",
      payments: "disabled", printFulfilment: "disabled",
    });
    test.info().annotations.push({ type: "deployment-sha", description: health.release });

    const profile = (await read(request, "/api/product-profile", productProfileResponseSchema)).data;
    expect(profile.profile).toBe("feedback_beta");
    expect(profile.checkoutMode).toBe("off");
    expect(profile.capabilities).toMatchObject({
      passwordSignIn: true, renovations: true, updates: true, media: true,
      story: true, sharing: true, photobookPreview: true, feedback: true,
      accountDeletion: true, checkout: false,
    });

    const storageState = await request.storageState();
    expect(storageState.cookies.filter((cookie) => cookie.name === "buildy_session").length).toBe(1);
    const session = (await read(request, "/api/auth/session", authSessionResponseSchema)).data;
    if (!session.session || !session.user) throw new Error("De beschermde statefile bevat geen actieve geauthenticeerde Buildy-sessie.");
    expect(new Date(session.session.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const project = (await read(request, projectPath, projectOverviewResponseSchema)).data;
    expect(project.id === projectId).toBe(true);
    expect(project.visibility).toBe("private");
    expect(project.viewerAccess).toBe("owner");
    expect(project.canEdit).toBe(true);
    const timeline = (await read(request, timelinePath, timelineResponseSchema)).data;
    expect(timeline.projectId === projectId).toBe(true);
    expect(timeline.nextCursor === null, "Gebruik een kleine stagingfixture van maximaal vijftig Bouwmomenten.").toBe(true);
    expect(timeline.items.length, "Bereid minimaal twee opgeslagen Bouwmomenten voor.").toBeGreaterThanOrEqual(2);
    const mediaById = new Map(timeline.items.flatMap((moment) => moment.media.map((asset) => [asset.id, asset] as const)));
    expect(mediaById.size, "Bereid minimaal drie verschillende opgeslagen testfoto's voor.").toBeGreaterThanOrEqual(3);

    const book = (await read(request, bookPath, photobookDraftResponseSchema)).data;
    expect(book.document.projectId === projectId).toBe(true);
    expect(book.document.projectRevision).toBe(project.contentRevision);
    expect(book.document.sourceAssetIds.length, "Neem minimaal drie testfoto's op in het digitale Bouwboek.").toBeGreaterThanOrEqual(3);
    expect(book.document.sourceAssetIds.every((id) => mediaById.has(id)), "Het Bouwboek moet de opgeslagen foto's gebruiken.").toBe(true);
    const momentIds = new Set(timeline.items.map((moment) => moment.id));
    const bookMomentIds = new Set(book.document.pages.flatMap((page) => page.updateId ? [page.updateId] : []));
    expect(bookMomentIds.size, "Neem minimaal twee Bouwmomenten op in het digitale Bouwboek.").toBeGreaterThanOrEqual(2);
    expect([...bookMomentIds].every((id) => momentIds.has(id)), "Het Bouwboek moet de opgeslagen Bouwmomenten gebruiken.").toBe(true);

    // A separate request context has no browser cache or client-side project state.
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
    const contextOptions = {
      baseURL: BASE,
      extraHTTPHeaders: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : undefined,
    };
    const freshOwner = await requestFactory.newContext({ ...contextOptions, storageState });
    try {
      const freshSession = (await read(freshOwner, "/api/auth/session", authSessionResponseSchema)).data;
      expect(freshSession.user?.id === session.user.id, "Een verse context moet dezelfde bestaande eigenaar herkennen.").toBe(true);
      const freshProject = (await read(freshOwner, projectPath, projectOverviewResponseSchema)).data;
      const freshTimeline = (await read(freshOwner, timelinePath, timelineResponseSchema)).data;
      const freshBook = (await read(freshOwner, bookPath, photobookDraftResponseSchema)).data;
      expect(fingerprint(freshProject) === fingerprint(project), "De opgeslagen verbouwing moet opnieuw leesbaar zijn.").toBe(true);
      expect(fingerprint(freshTimeline) === fingerprint(timeline), "De opgeslagen momenten en foto's moeten opnieuw leesbaar zijn.").toBe(true);
      expect(freshBook.draftId === book.draftId, "Het bestaande Bouwboekconcept moet behouden blijven.").toBe(true);
      expect(freshBook.document.checksumSha256 === book.document.checksumSha256, "De Bouwboekinhoud moet stabiel blijven.").toBe(true);
      expect(fingerprint(freshBook.settings) === fingerprint(book.settings), "De opgeslagen coverinstellingen moeten behouden blijven.").toBe(true);
      expect(fingerprint(freshBook.exclusions) === fingerprint(book.exclusions), "De opgeslagen boekselectie moet behouden blijven.").toBe(true);
    } finally {
      await freshOwner.dispose();
    }

    // Retain deployment protection, remove both account and any share capability.
    const anonymous = await requestFactory.newContext({
      ...contextOptions,
      storageState: {
        cookies: storageState.cookies.filter((cookie) => !cookie.name.startsWith("buildy_")),
        origins: [],
      },
    });
    try {
      const anonymousSession = (await read(anonymous, "/api/auth/session", authSessionResponseSchema)).data;
      expect(anonymousSession.user === null && anonymousSession.session === null).toBe(true);
      for (const [path, status, code] of [
        [projectPath, 404, "NOT_FOUND"],
        [timelinePath, 404, "NOT_FOUND"],
        [bookPath, 401, "UNAUTHENTICATED"],
      ] as const) {
        const denied = await get(anonymous, path);
        expect(denied.status(), "Een bezoeker zonder sessie of deelrecht mag deze private inhoud niet lezen.").toBe(status);
        expect((await json(denied, apiErrorSchema)).error.code).toBe(code);
      }

      // Read three real private derivatives, verify complete bytes, then deny the
      // identical URLs without account/share cookies. Never save the photo bytes.
      for (const id of book.document.sourceAssetIds.slice(0, 3)) {
        const path = mediaById.get(id)!.proxyPath + "?size=small";
        const photo = await get(request, path);
        expect(photo.status()).toBe(200);
        expect(photo.headers()["cache-control"]).toBe("private, no-store");
        expect(photo.headers()["content-type"]).toMatch(/^image\/(?:jpeg|png|webp|avif)$/);
        const bytes = await photo.body();
        expect(bytes.byteLength).toBeGreaterThan(0);
        expect(bytes.byteLength).toBe(Number(photo.headers()["content-length"]));
        const etag = photo.headers().etag;
        expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
        expect('"' + createHash("sha256").update(bytes).digest("hex") + '"' === etag, "De private fotobytes moeten hun opgeslagen checksum hebben.").toBe(true);
        const denied = await get(anonymous, path);
        expect(denied.status()).toBe(404);
        expect((await json(denied, apiErrorSchema)).error.code).toBe("NOT_FOUND");
      }
    } finally {
      await anonymous.dispose();
    }

    const orders = await get(request, "/api/orders");
    expect(orders.status(), "De bestelruntime moet gesloten blijven met checkout uit.").toBe(503);
    expect((await json(orders, apiErrorSchema)).error.code).toBe("PROVIDER_UNAVAILABLE");
  });
});

import type { Page } from "@playwright/test";

import { BASE, expect, test } from "./helpers";
import {
  FIXED_NOW,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROOF_REVISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORDER_NUMBER = "BLD-E2E-FOUNDER1";
const PDF_PATH = `/api/admin/orders/${ORDER_ID}/pdf`;
const PDF_FILENAME = `${ORDER_NUMBER}.pdf`;
const PDF_BYTES = Buffer.from("%PDF-1.4\n% Buildy synthetic locked print proof\n%%EOF\n", "utf8");

function queueItem(fulfilmentStatus = "in_production", version = 7) {
  return {
    orderId: ORDER_ID,
    orderNumber: ORDER_NUMBER,
    customerName: "Synthetische klant",
    projectId: SYNTHETIC_IDS.project,
    projectTitle: "Synthetische verbouwing",
    paidAt: "2026-08-20T10:00:00.000Z",
    quantity: 2,
    pageCount: 48,
    currency: "EUR",
    totalMinor: 13_500,
    paymentStatus: "paid",
    fulfilmentStatus,
    needsAttention: false,
    version,
  };
}

function orderDetail(fulfilmentStatus = "in_production", version = 7) {
  return {
    ...queueItem(fulfilmentStatus, version),
    ownerId: SYNTHETIC_IDS.owner,
    customerEmail: "klant@example.invalid",
    shippingAddress: {
      firstName: "Synthetische",
      lastName: "Klant",
      addressLine1: "Teststraat 1",
      addressLine2: null,
      postalCode: "1234 AB",
      city: "Utrecht",
      state: null,
      countryCode: "NL",
    },
    proofRevisionId: PROOF_REVISION_ID,
    documentSha256: "a".repeat(64),
    pdfSha256: "b".repeat(64),
    amounts: {
      currency: "EUR",
      subtotalMinor: 10_000,
      shippingMinor: 1_000,
      taxMinor: 2_500,
      totalMinor: 13_500,
    },
    refundedMinor: 0,
    manualProviderReference: null,
    fulfilmentNotes: null,
    trackingUrl: null,
    seller: {
      legalName: "Buildy Test B.V.",
      tradeName: "Buildy",
      registrationNumber: "TEST-12345678",
      vatNumber: null,
      address: "Testadres — niet bezorgen",
      countryCode: "NL",
      supportEmail: "support@example.invalid",
    },
    stripeReferences: {
      checkoutSessionId: "cs_test_founder",
      paymentIntentId: "pi_test_founder",
      chargeId: "ch_test_founder",
    },
    milestones: {
      reviewedAt: "2026-08-20T10:10:00.000Z",
      orderedManuallyAt: "2026-08-20T11:00:00.000Z",
      inProductionAt: FIXED_NOW,
      shippedAt: fulfilmentStatus === "shipped" ? FIXED_NOW : null,
      completedAt: null,
      refundReviewAt: null,
    },
    createdAt: "2026-08-20T09:55:00.000Z",
    updatedAt: FIXED_NOW,
    pdfPath: PDF_PATH,
    events: [{
      id: ORDER_EVENT_ID,
      eventType: "manual_fulfilment_in_production",
      actorUserId: SYNTHETIC_IDS.owner,
      fromStatus: "ordered_manually",
      toStatus: "in_production",
      occurredAt: FIXED_NOW,
    }],
  };
}

async function installDeniedAdminFixture(page: Page) {
  return installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (request.method() !== "GET" || !url.pathname.startsWith("/api/admin/orders")) {
        return false;
      }
      // Keep expected-denial traffic free of browser console errors while the
      // typed client still rejects the server response and renders no order.
      await fulfillJson(route, success(null));
      return true;
    },
  });
}

async function installFounderFixture(page: Page) {
  let fulfilmentStatus = "in_production";
  let version = 7;
  return installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === "/api/admin/orders") {
        await fulfillJson(route, success({
          items: [queueItem(fulfilmentStatus, version)],
          nextCursor: null,
        }));
        return true;
      }
      if (request.method() === "GET" && url.pathname === `/api/admin/orders/${ORDER_ID}`) {
        await fulfillJson(route, success(orderDetail(fulfilmentStatus, version)));
        return true;
      }
      if (request.method() === "GET" && url.pathname === PDF_PATH) {
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: {
            "cache-control": "private, no-store, max-age=0",
            "content-disposition": `attachment; filename="${PDF_FILENAME}"`,
          },
          body: PDF_BYTES,
        });
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/admin/orders/${ORDER_ID}/actions`
      ) {
        fulfilmentStatus = "shipped";
        version = 8;
        await fulfillJson(route, success({
          orderId: ORDER_ID,
          fulfilmentStatus,
          version,
          replayed: false,
        }));
        return true;
      }
      return false;
    },
  });
}

test.describe("Founder operations", () => {
  test("vertrouwt een gewone sessie niet en houdt orderdata en de print-PDF server-side gesloten", async ({ page }) => {
    const fixture = await installDeniedAdminFixture(page);

    await page.goto(`${BASE}/beheer/bestellingen`);
    await expect(page.getByRole("heading", { name: "Bestellingbeheer niet beschikbaar" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("kon niet worden geladen");
    await expect(page.getByText("Betaalde Bouwboeken")).toHaveCount(0);

    await page.goto(`${BASE}/beheer/bestellingen/${ORDER_ID}`);
    await expect(page.getByRole("heading", { name: "Bestellingbeheer niet beschikbaar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download print-PDF" })).toHaveCount(0);
    await expect(page.getByText("klant@example.invalid")).toHaveCount(0);

    expect(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", pathname: "/api/admin/orders" }),
      expect.objectContaining({
        method: "GET",
        pathname: `/api/admin/orders/${ORDER_ID}`,
      }),
    ]));
    expect(fixture.requests.some(({ pathname }) => pathname === PDF_PATH)).toBe(false);
    expect(fixture.unhandled).toEqual([]);
  });

  test("opent een betaalde order, downloadt exact de private PDF en schrijft de verzendstap met lock", async ({ page }) => {
    const fixture = await installFounderFixture(page);

    await page.goto(`${BASE}/beheer/bestellingen`);
    await expect(page.getByRole("heading", { name: "Betaalde Bouwboeken" })).toBeVisible();
    const paidOrder = page.getByRole("row", { name: new RegExp(ORDER_NUMBER) });
    await expect(paidOrder).toContainText("Synthetische klant");
    await expect(paidOrder).toContainText("In productie");
    await paidOrder.getByRole("link", { name: ORDER_NUMBER }).click();

    await expect(page).toHaveURL(`${BASE}/beheer/bestellingen/${ORDER_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetische verbouwing" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Exacte printversie" })).toBeVisible();

    const pdfLink = page.getByRole("link", { name: "Download print-PDF" });
    await expect(pdfLink).toHaveAttribute("href", PDF_PATH);
    await expect(pdfLink).not.toHaveAttribute("target");
    const pdfResponse = await pdfLink.evaluate(async (element) => {
      const response = await fetch((element as HTMLAnchorElement).href, {
        credentials: "include",
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        disposition: response.headers.get("content-disposition"),
        signature: String.fromCharCode(...bytes.slice(0, 4)),
      };
    });
    expect(pdfResponse).toEqual({
      status: 200,
      contentType: "application/pdf",
      disposition: `attachment; filename="${PDF_FILENAME}"`,
      signature: "%PDF",
    });
    expect(fixture.requests.filter(({ method, pathname, search }) => (
      method === "GET" && pathname === PDF_PATH && search === ""
    ))).toHaveLength(1);

    await page.getByLabel("Externe drukkerreferentie").fill("  DRUK-SYNTH-2026-42  ");
    await page.getByLabel("Trackinglink").fill("  https://tracking.example.invalid/pakket/opaque-42  ");
    await page.getByLabel("Interne notitie").fill("  Printproof en verpakking gecontroleerd.  ");
    await page.getByRole("button", { name: "Markeer als verzonden" }).click();

    await expect.poll(() => fixture.requests.filter(({ pathname }) => (
      pathname === `/api/admin/orders/${ORDER_ID}/actions`
    )).length).toBe(1);
    const actionRequest = fixture.requests.find(({ pathname }) => (
      pathname === `/api/admin/orders/${ORDER_ID}/actions`
    ));
    expect(actionRequest).toEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/admin/orders/${ORDER_ID}/actions`,
      search: "",
      body: {
        action: "mark_shipped",
        expectedVersion: 7,
        externalReference: "DRUK-SYNTH-2026-42",
        trackingUrl: "https://tracking.example.invalid/pakket/opaque-42",
        notes: "Printproof en verpakking gecontroleerd.",
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      },
    }));
    expect(fixture.requests.every(({ pathname, search }) => (
      !`${pathname}${search}`.includes("@") && !`${pathname}${search}`.includes("Teststraat")
    ))).toBe(true);
    expect(fixture.unhandled).toEqual([]);
  });
});

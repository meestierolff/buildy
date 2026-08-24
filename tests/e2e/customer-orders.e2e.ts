import { BASE, expect, test } from "./helpers";
import {
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIRST_EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PAID_EVENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const amounts = {
  currency: "EUR" as const,
  subtotalMinor: 8_000,
  shippingMinor: 800,
  taxMinor: 1_848,
  totalMinor: 10_648,
};

const listItem = {
  orderId: ORDER_ID,
  orderNumber: "BLD-20260823-ABCDEF12",
  projectId: SYNTHETIC_IDS.project,
  projectTitle: "Ons jaren-dertighuis",
  pageCount: 48,
  quantity: 2,
  amounts,
  status: "paid" as const,
  paymentStatus: "paid" as const,
  fulfilmentStatus: "in_production" as const,
  createdAt: "2026-08-23T09:00:00.000Z",
  paidAt: "2026-08-23T09:05:00.000Z",
};

test("een klant vindt de eigen bestelling terug en ziet de persisted statusgeschiedenis", async ({ page }) => {
  const fixture = await installSyntheticApi(page, {
    handle: async ({ request, route, url }) => {
      if (request.method() === "GET" && url.pathname === "/api/orders") {
        await fulfillJson(route, success({ items: [listItem], nextCursor: null }));
        return true;
      }
      if (request.method() === "GET" && url.pathname === `/api/orders/${ORDER_ID}`) {
        await fulfillJson(route, success({
          ...listItem,
          proofRevisionId: REVISION_ID,
          sku: "a4-landscape-hardcover-v1",
          format: "a4-landscape-hardcover-v1",
          destinationCountry: "NL",
          deliveryEstimate: "5–8 werkdagen na productie",
          termsVersion: "2026-08-01",
          refundedMinor: 0,
          trackingUrl: null,
          statusHistory: [
            {
              id: FIRST_EVENT_ID,
              eventType: "order.checkout_reserved.v1",
              fromStatus: null,
              toStatus: "awaiting_payment",
              occurredAt: "2026-08-23T09:00:00.000Z",
            },
            {
              id: PAID_EVENT_ID,
              eventType: "order.payment_succeeded.v1",
              fromStatus: "checkout_open",
              toStatus: "paid",
              occurredAt: "2026-08-23T09:05:00.000Z",
            },
          ],
        }));
        return true;
      }
      return false;
    },
  });

  await page.goto(`${BASE}/bestellingen`);
  await expect(page.getByRole("heading", { level: 1, name: "Bestellingen" })).toBeVisible();
  await expect(page.getByText("Ons jaren-dertighuis")).toBeVisible();
  await expect(page.getByText("In productie")).toBeVisible();

  await page.getByRole("link", { name: /Ons jaren-dertighuis/i }).click();
  await expect(page).toHaveURL(`${BASE}/bestellingen/${ORDER_ID}`);
  await expect(page.getByRole("heading", { name: "Vastgelegde voortgang" })).toBeVisible();
  await expect(page.getByText("Betaling bevestigd", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Bestelling aangemaakt")).toBeVisible();

  expect(fixture.requests).toContainEqual(expect.objectContaining({
    method: "GET",
    pathname: "/api/orders",
  }));
  expect(fixture.requests).toContainEqual(expect.objectContaining({
    method: "GET",
    pathname: `/api/orders/${ORDER_ID}`,
  }));
  expect(fixture.unhandled).toEqual([]);
});

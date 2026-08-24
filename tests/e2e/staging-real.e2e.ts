import { createHash } from "node:crypto";
import {
  expect,
  request as requestFactory,
  test,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";

import { authSessionResponseSchema } from "../../shared/contracts/auth";
import {
  createPhotobookCheckoutInputSchema,
  photobookCheckoutResponseSchema,
  photobookOrderResponseSchema,
  photobookQuoteResponseSchema,
} from "../../shared/contracts/orders";
import { photobookDraftResponseSchema } from "../../shared/contracts/photobooks";
import { productProfileResponseSchema } from "../../shared/contracts/productProfile";

const BASE = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8090").origin;
const VERCEL_BUFFERED_FUNCTION_LIMIT_BYTES = 4.5 * 1_024 * 1_024;
const CARD_NUMBER_SELECTORS = [
  'input[name="cardNumber"]',
  'input[name="cardnumber"]',
  'input[data-elements-stable-field-name="cardNumber"]',
  'input[autocomplete="cc-number"]',
  'input[aria-label*="Card number" i]',
  'input[aria-label*="Kaartnummer" i]',
] as const;
const TEST_ADDRESS = {
  firstName: "Buildy",
  lastName: "Stagingtest",
  addressLine1: "Teststraat 1",
  addressLine2: null,
  postalCode: "1234 AB",
  city: "Utrecht",
  state: null,
  countryCode: "NL",
} as const;

function requiredUuid(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} moet een bestaande opaque stagingfixture-UUID bevatten.`);
  }
  return value.toLowerCase();
}

async function responseJson(response: APIResponse): Promise<unknown> {
  expect(response.ok(), `API gaf HTTP ${response.status()} voor ${new URL(response.url()).pathname}`).toBe(true);
  return response.json() as Promise<unknown>;
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fieldInAnyFrame(
  page: Page,
  selectors: readonly string[],
  timeout = 30_000,
): Promise<Locator> {
  let found: Locator | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const field = frame.locator(selector).first();
        if (await field.isVisible().catch(() => false)) {
          found = field;
          return true;
        }
      }
    }
    return false;
  }, {
    timeout,
    message: `Stripe Checkout-veld ontbreekt: ${selectors.join(", ")}`,
  }).toBe(true);
  if (!found) throw new Error(`Stripe Checkout-veld ontbreekt: ${selectors.join(", ")}`);
  return found;
}

async function fillStripeField(page: Page, selectors: readonly string[], value: string): Promise<void> {
  const target = await fieldInAnyFrame(page, selectors);
  await expect(target).toBeEditable({ timeout: 15_000 });
  await target.fill(value);
}

async function selectCardPaymentMethod(page: Page): Promise<void> {
  if (await fieldInAnyFrame(page, CARD_NUMBER_SELECTORS, 3_000).catch(() => null)) return;

  const reveal = await fieldInAnyFrame(page, [
    'button:has-text("More payment methods")',
    'button:has-text("Meer betaalmethoden")',
    'button:has-text("Meer betaalopties")',
  ], 3_000).catch(() => null);
  if (reveal) await reveal.click();

  const option = await fieldInAnyFrame(page, [
    '[data-testid="card-accordion-item"]',
    '#payment-method-accordion-item-title-card',
    'label:has(input[type="radio"][value="card"])',
    '[role="button"]:has-text("Creditcard")',
    '[role="button"]:has-text("Card")',
    '[role="button"]:has-text("Kaart")',
    'button[aria-label="Card" i]',
    'button[aria-label="Kaart" i]',
  ], 20_000);
  await option.click();
}

async function selectStripeOptionWhenPresent(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<void> {
  const target = await fieldInAnyFrame(page, selectors, 5_000).catch(() => null);
  if (target) await target.selectOption(value);
}

async function fillStripeFieldWhenEmpty(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<void> {
  const target = await fieldInAnyFrame(page, selectors, 5_000).catch(() => null);
  if (!target || !(await target.isEditable().catch(() => false))) return;
  if ((await target.inputValue()).trim() === "") await target.fill(value);
}

test.describe("@staging-real providerreis zonder API-mocks", () => {
  test("verifieert sessie, grote private Blob-stream, Stripe-testbetaling en webhookstatus", async ({ page }) => {
    test.setTimeout(420_000);
    expect(process.env.PLAYWRIGHT_MODE).toBe("staging-real");
    const projectId = requiredUuid("PLAYWRIGHT_STAGING_PROJECT_ID");

    const storageState = await page.context().storageState();
    expect(storageState.cookies.some((cookie) => cookie.name === "buildy_session")).toBe(true);

    const sessionResponse = await page.request.get(`${BASE}/api/auth/session`);
    const session = authSessionResponseSchema.parse(await responseJson(sessionResponse)).data;
    if (!session.session || !session.user) throw new Error("De staging storage state bevat geen actieve Buildy-sessie.");
    expect(new Date(session.session.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const profileResponse = await page.request.get(`${BASE}/api/product-profile`);
    const profile = productProfileResponseSchema.parse(await responseJson(profileResponse)).data;
    expect(profile.checkoutMode).toBe("test");
    expect(profile.capabilities).toMatchObject({ googleSignIn: true, media: true, checkout: true });

    const draftResponse = await page.request.get(`${BASE}/api/projects/${projectId}/photobook`);
    const draft = photobookDraftResponseSchema.parse(await responseJson(draftResponse)).data;
    expect(draft.proof?.status).toBe("approved");
    expect(draft.proof?.pdfPath).toBeTruthy();
    expect(draft.proof?.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    const proof = draft.proof!;
    expect(proof.pdfPath).toBe(`/api/photobooks/proofs/${proof.revisionId}/pdf`);
    const proofUrl = new URL(proof.pdfPath!, BASE).toString();

    // Preserve deployment-protection cookies, but remove the Buildy session.
    // This proves that the same-origin PDF boundary itself remains private.
    const unauthenticated = await requestFactory.newContext({
      baseURL: BASE,
      storageState: {
        cookies: storageState.cookies.filter((cookie) => cookie.name !== "buildy_session"),
        origins: storageState.origins,
      },
    });
    try {
      const denied = await unauthenticated.get(proofUrl, { failOnStatusCode: false });
      expect(denied.status()).toBe(401);
      expect(denied.headers()["content-type"]).not.toContain("application/pdf");
    } finally {
      await unauthenticated.dispose();
    }

    const head = await page.request.head(proofUrl);
    expect(head.status()).toBe(200);
    const proofSize = Number(head.headers()["content-length"]);
    expect(Number.isSafeInteger(proofSize)).toBe(true);
    expect(proofSize).toBeGreaterThan(VERCEL_BUFFERED_FUNCTION_LIMIT_BYTES);
    expect(head.headers()).toMatchObject({
      "accept-ranges": "bytes",
      "cache-control": "private, no-store, max-age=0",
      "content-type": "application/pdf",
      "cross-origin-resource-policy": "same-origin",
      etag: `"sha256-${proof.pdfSha256}"`,
    });
    expect(head.headers()["x-buildy-proof-view-receipt"]).toBeUndefined();

    const rangeStart = Math.floor(proofSize / 2);
    const rangeEnd = rangeStart + 1_023;
    const partial = await page.request.get(proofUrl, {
      headers: { range: `bytes=${rangeStart}-${rangeEnd}` },
    });
    expect(partial.status()).toBe(206);
    expect(partial.headers()["content-range"]).toBe(`bytes ${rangeStart}-${rangeEnd}/${proofSize}`);
    expect(partial.headers()["content-length"]).toBe("1024");
    expect(partial.headers()["cache-control"]).toBe("private, no-store, max-age=0");
    expect(partial.headers()["x-buildy-proof-view-receipt"]).toBeUndefined();
    const partialBytes = await partial.body();
    expect(partialBytes.byteLength).toBe(1_024);

    const full = await page.request.get(proofUrl);
    expect(full.status()).toBe(200);
    const proofBytes = await full.body();
    expect(proofBytes.byteLength).toBe(proofSize);
    expect(proofBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(partialBytes.equals(proofBytes.subarray(rangeStart, rangeEnd + 1))).toBe(true);
    expect(createHash("sha256").update(proofBytes).digest("hex")).toBe(proof.pdfSha256);
    expect(full.headers()["content-length"]).toBe(String(proofSize));
    expect(full.headers()["content-range"]).toBeUndefined();
    expect(full.headers()["x-buildy-proof-view-receipt"]).toBeUndefined();
    expect(full.headers()["x-buildy-proof-revision"]).toBe(proof.revisionId);
    expect(full.headers()["x-buildy-proof-document-sha256"]).toBe(proof.documentSha256);
    expect(full.headers()["x-buildy-proof-pdf-sha256"]).toBe(proof.pdfSha256);

    const selection = {
      documentSha256: proof.documentSha256,
      pdfSha256: proof.pdfSha256!,
      quantity: 1,
      shippingAddress: TEST_ADDRESS,
    };
    const quoteResponse = await page.request.post(
      `${BASE}/api/photobooks/proofs/${proof.revisionId}/quote`,
      { data: selection, headers: { origin: BASE } },
    );
    const quote = photobookQuoteResponseSchema.parse(await responseJson(quoteResponse)).data;
    expect(quote.proofRevisionId).toBe(proof.revisionId);
    expect(quote.amounts.totalMinor).toBeGreaterThan(0);
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const checkoutInput = createPhotobookCheckoutInputSchema.parse({
      ...selection,
      idempotencyKey: crypto.randomUUID(),
      expectedQuoteReference: quote.quoteReference,
      expectedQuoteExpiresAt: quote.expiresAt,
      expectedAmounts: quote.amounts,
      termsVersion: quote.termsVersion,
      termsAccepted: true,
      personalisedProductAccepted: true,
    });
    const checkoutResponse = await page.request.post(
      `${BASE}/api/photobooks/proofs/${proof.revisionId}/checkout`,
      { data: checkoutInput, headers: { origin: BASE } },
    );
    const checkout = photobookCheckoutResponseSchema.parse(await responseJson(checkoutResponse)).data;
    expect(checkout).toMatchObject({
      projectId,
      proofRevisionId: proof.revisionId,
      amounts: quote.amounts,
      status: "checkout_open",
      replayed: false,
    });
    const checkoutUrl = new URL(checkout.checkoutUrl);
    expect(checkoutUrl.protocol).toBe("https:");
    expect(checkoutUrl.hostname).toBe("checkout.stripe.com");
    expect(checkoutUrl.username).toBe("");
    expect(checkoutUrl.password).toBe("");
    expect(checkoutUrl.port === "" || checkoutUrl.port === "443").toBe(true);
    expect(decodeURIComponent(checkout.checkoutUrl)).toContain("cs_test_");
    expect(new Date(checkout.checkoutExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const beforePaymentResponse = await page.request.get(`${BASE}/api/orders/${checkout.orderId}`);
    const beforePayment = photobookOrderResponseSchema.parse(await responseJson(beforePaymentResponse)).data;
    expect(beforePayment).toMatchObject({
      orderId: checkout.orderId,
      projectId,
      proofRevisionId: proof.revisionId,
      status: "checkout_open",
      paymentStatus: "unpaid",
      paidAt: null,
    });
    expect(beforePayment.statusHistory.some((event) => event.eventType === "order.payment_succeeded.v1")).toBe(false);

    await page.goto(checkout.checkoutUrl);
    await expect.poll(() => new URL(page.url()).hostname, { timeout: 30_000 }).toBe("checkout.stripe.com");
    await selectCardPaymentMethod(page);
    await fillStripeField(page, CARD_NUMBER_SELECTORS, "4242424242424242");
    await fillStripeField(page, [
      'input[name="cardExpiry"]',
      'input[name="expiry"]',
      'input[data-elements-stable-field-name="cardExpiry"]',
      'input[autocomplete="cc-exp"]',
      'input[aria-label*="expiration" i]',
      'input[aria-label*="verval" i]',
    ], "1234");
    await fillStripeField(page, [
      'input[name="cardCvc"]',
      'input[name="cvc"]',
      'input[data-elements-stable-field-name="cardCvc"]',
      'input[autocomplete="cc-csc"]',
      'input[aria-label*="security code" i]',
      'input[aria-label*="beveiligingscode" i]',
    ], "123");

    await fillStripeFieldWhenEmpty(page, [
      'input[type="email"]',
      'input[autocomplete="email"]',
    ], session.user.email);
    await selectStripeOptionWhenPresent(page, [
      'select[name="billingCountry"]',
      'select[autocomplete="country"]',
      'select[aria-label*="country" i]',
      'select[aria-label*="land" i]',
    ], "NL");
    for (const [selectors, value] of [
      [[
        'input[name="billingName"]',
        'input[autocomplete="cc-name"]',
        'input[aria-label*="name on card" i]',
        'input[aria-label*="naam op kaart" i]',
      ], "Buildy Stagingtest"],
      [[
        'input[name="billingAddressLine1"]',
        'input[autocomplete="address-line1"]',
        'input[aria-label*="address line 1" i]',
        'input[aria-label*="straat" i]',
      ], TEST_ADDRESS.addressLine1],
      [[
        'input[name="billingPostalCode"]',
        'input[autocomplete="postal-code"]',
        'input[aria-label*="postal" i]',
        'input[aria-label*="postcode" i]',
      ], "1234AB"],
      [[
        'input[name="billingLocality"]',
        'input[autocomplete="address-level2"]',
        'input[aria-label*="city" i]',
        'input[aria-label*="plaats" i]',
      ], TEST_ADDRESS.city],
    ] as const) {
      await fillStripeFieldWhenEmpty(page, selectors, value);
    }

    const pay = await fieldInAnyFrame(page, [
      'button[data-testid="hosted-payment-submit-button"]',
      'button[type="submit"]:has-text("Pay")',
      'button[type="submit"]:has-text("Betalen")',
      'button[type="submit"]:has-text("Afrekenen")',
      'button[type="submit"]',
    ], 30_000);
    await expect(pay).toBeEnabled({ timeout: 30_000 });
    await pay.click();
    await page.waitForURL(new RegExp(
      `^${regexEscape(BASE)}/bestellingen/${checkout.orderId}\\?checkout=success(?:[&#]|$)`,
    ), {
      timeout: 120_000,
    });

    let paidOrder: typeof beforePayment | undefined;
    await expect.poll(async () => {
      const response = await page.request.get(`${BASE}/api/orders/${checkout.orderId}`);
      if (!response.ok()) return `http-${response.status()}`;
      const order = photobookOrderResponseSchema.parse(await response.json()).data;
      paidOrder = order;
      return `${order.paymentStatus}:${order.status}:${order.statusHistory.some((event) => event.eventType === "order.payment_succeeded.v1")}`;
    }, { timeout: 120_000, intervals: [500, 1_000, 2_000, 5_000, 10_000] }).toBe("paid:paid:true");
    expect(paidOrder).toBeDefined();
    expect(paidOrder!.paidAt).not.toBeNull();
    expect(
      paidOrder!.statusHistory.filter((event) => event.eventType === "order.payment_succeeded.v1"),
    ).toHaveLength(1);
  });
});

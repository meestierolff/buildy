import type { CheckoutMode } from "../../shared/contracts/productProfile";
import { BASE, collectImageDiagnostics, expect, test, waitForPhotobookImages } from "./helpers";
import {
  PHOTOBOOK_DOCUMENT_SHA256,
  PHOTOBOOK_PDF_BYTES,
  PHOTOBOOK_PDF_SHA256,
  PHOTOBOOK_REVISION_ID,
  syntheticPhotobookDraft,
} from "./photobookFixture";
import {
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

async function installPhotobookFixture(
  page: Parameters<typeof installSyntheticApi>[0],
  checkoutMode: CheckoutMode,
  initialProofStatus: "ready" | "approved" | null = "approved",
) {
  let proofStatus = initialProofStatus;
  // Headless engines do not ship a consistent PDF viewer plug-in. The product
  // still fetches, validates and hashes the private PDF bytes below; only the
  // final browser-owned object-URL renderer is replaced with a stable document.
  await page.addInitScript(() => {
    URL.createObjectURL = () => "about:blank";
    URL.revokeObjectURL = () => undefined;
  });
  return installSyntheticApi(page, {
    checkoutMode,
    handle: async ({ request, route, url }) => {
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/photobook`
      ) {
        const draft = syntheticPhotobookDraft();
        await fulfillJson(route, success({
          ...draft,
          proof: proofStatus ? { ...draft.proof, status: proofStatus } : null,
        }));
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/photobook/proofs`
      ) {
        proofStatus = "ready";
        await fulfillJson(route, success({
          revisionId: PHOTOBOOK_REVISION_ID,
          status: "ready",
          replayed: false,
        }));
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/approve`
      ) {
        proofStatus = "approved";
        await fulfillJson(route, success({
          revisionId: PHOTOBOOK_REVISION_ID,
          status: "approved",
          replayed: false,
        }));
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/pdf`
      ) {
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: {
            "cache-control": "private, no-store, max-age=0",
            "content-length": String(PHOTOBOOK_PDF_BYTES.byteLength),
            "x-buildy-proof-revision": PHOTOBOOK_REVISION_ID,
            "x-buildy-proof-document-sha256": PHOTOBOOK_DOCUMENT_SHA256,
            "x-buildy-proof-pdf-sha256": PHOTOBOOK_PDF_SHA256,
          },
          body: PHOTOBOOK_PDF_BYTES,
        });
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/quote`
      ) {
        await fulfillJson(route, success({
          proofRevisionId: PHOTOBOOK_REVISION_ID,
          sku: "a4-landscape-hardcover-v1",
          format: "a4-landscape-hardcover-v1",
          pageCount: 24,
          quantity: 1,
          destinationCountry: "NL",
          quoteReference: "matrix:synthetic-approved-price",
          amounts: {
            currency: "EUR",
            subtotalMinor: 6_612,
            shippingMinor: 413,
            taxMinor: 1_475,
            totalMinor: 8_500,
          },
          deliveryEstimate: "Handmatige controle binnen twee werkdagen",
          taxTreatment: "vat_included",
          expiresAt: "2099-08-23T10:15:00.000Z",
          termsVersion: "2026-08-23",
          seller: {
            legalName: "Buildy Test B.V.",
            tradeName: "Buildy",
            registrationNumber: "00000000",
            vatNumber: "NL000000000B00",
            address: "Teststraat 1, 1234 AB Utrecht, Nederland",
            countryCode: "NL",
            supportEmail: "support@example.invalid",
          },
          personalisedProduct: true,
        }));
        return true;
      }
      if (
        request.method() === "POST"
        && url.pathname === `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/checkout`
      ) {
        await fulfillJson(route, success({
          orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          orderNumber: "BLD-2026-SYNTH001",
          projectId: SYNTHETIC_IDS.project,
          proofRevisionId: PHOTOBOOK_REVISION_ID,
          sku: "a4-landscape-hardcover-v1",
          format: "a4-landscape-hardcover-v1",
          pageCount: 24,
          quantity: 1,
          destinationCountry: "NL",
          amounts: {
            currency: "EUR",
            subtotalMinor: 6_612,
            shippingMinor: 413,
            taxMinor: 1_475,
            totalMinor: 8_500,
          },
          deliveryEstimate: "Handmatige controle binnen twee werkdagen",
          termsVersion: "2026-08-23",
          status: "checkout_open",
          checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_buildy_synthetic",
          checkoutExpiresAt: "2099-08-23T10:35:00.000Z",
          replayed: false,
        }));
        return true;
      }
      return false;
    },
  });
}

test.describe("Bouwboek-preview", () => {
  test("bouwt, bekijkt en keurt één exacte private printproof goed", async ({ page }) => {
    const fixture = await installPhotobookFixture(page, "off", null);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);

    await expect(page.getByText("Nog geen printproof")).toBeVisible();
    await page.getByRole("button", { name: "Echte printproof opbouwen" }).click();
    await expect(page.getByText("Klaar voor controle")).toBeVisible();
    const proofFrame = page.getByTitle("Printproof van 24 pagina's");
    await expect(proofFrame).toBeVisible();
    // The headless engines have no real PDF plug-in. Signal the final
    // browser-owned frame load after the product already verified the bytes,
    // headers and SHA-256 through the same-origin fixture.
    await proofFrame.dispatchEvent("load");
    await page.getByRole("button", { name: "Exacte proof goedkeuren" }).click();

    const dialog = page.getByRole("dialog", { name: "Exacte printproof goedkeuren" });
    const approve = dialog.getByRole("button", { name: "Goedkeuren", exact: true });
    await expect(approve).toBeDisabled();
    await dialog.getByLabel(/Ik heb deze echte printproof pagina voor pagina gecontroleerd/).click();
    await approve.click();
    await expect(page.getByText("Deze exacte proof is goedgekeurd.")).toBeVisible();

    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/projects/${SYNTHETIC_IDS.project}/photobook/proofs`,
      body: expect.objectContaining({
        expectedDraftVersion: 4,
        expectedDocumentSha256: PHOTOBOOK_DOCUMENT_SHA256,
      }),
    }));
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/approve`,
      body: expect.objectContaining({
        documentSha256: PHOTOBOOK_DOCUMENT_SHA256,
        pdfSha256: PHOTOBOOK_PDF_SHA256,
        proofViewed: true,
      }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("rendert de canonical cover en bladert printveilig op desktop", async ({ page }) => {
    const fixture = await installPhotobookFixture(page, "off");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);

    await expect(page.getByRole("heading", { level: 1, name: "Synthetisch Bouwboek" })).toBeVisible();
    await expect(page.getByText("Dit is je echte printproof")).toBeVisible();
    await expect(page.getByTitle("Printproof van 24 pagina's")).toBeVisible();
    await expect(page.getByRole("heading", { name: "A4 liggend hardcover" })).toBeVisible();
    await expect(page.getByRole("button", { name: /staand/i })).toHaveCount(0);
    await waitForPhotobookImages(page);
    expect(await collectImageDiagnostics(page)).toEqual({
      visibleImages: 0,
      brokenImages: 0,
      overlaps: 0,
    });

    await expect(page.getByText("Pagina 1 van 24")).toBeVisible();
    await page.getByRole("button", { name: "Volgende pagina" }).click();
    await expect(page.getByText("Pagina's 2–3 van 24")).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("bladert op 390px pagina voor pagina zonder horizontale pagina-overflow", async ({ page }) => {
    const fixture = await installPhotobookFixture(page, "off");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);

    await expect(page.getByText("Pagina 1 van 24")).toBeVisible();
    await page.getByRole("button", { name: "Volgende pagina" }).click();
    await expect(page.getByText("Pagina 2 van 24")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    expect(fixture.unhandled).toEqual([]);
  });
});

test.describe("Bouwboek-checkout", () => {
  test("blijft fail-closed bij CHECKOUT_MODE=off", async ({ page }) => {
    const fixture = await installPhotobookFixture(page, "off");
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);

    await expect(page.getByText("Deze exacte proof is goedgekeurd.")).toBeVisible();
    await expect(page.getByText(/Bestellen is nog niet beschikbaar/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Bouwboek bestellen" })).toHaveCount(0);
    expect(fixture.requests.some((request) => request.pathname.endsWith("/quote"))).toBe(false);
    expect(fixture.requests.some((request) => request.pathname.endsWith("/checkout"))).toBe(false);
    expect(fixture.unhandled).toEqual([]);
  });

  test("vraagt in testmodus alleen een exacte serverquote op en toont handmatige fulfilment", async ({ page }) => {
    const fixture = await installPhotobookFixture(page, "test");
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);
    await page.getByRole("button", { name: "Bouwboek bestellen" }).click();

    const dialog = page.getByRole("dialog", { name: "Bouwboek bestellen" });
    await dialog.getByLabel("Voornaam").fill("Ada");
    await dialog.getByLabel("Achternaam").fill("Tester");
    await dialog.getByLabel("Straat en huisnummer").fill("Teststraat 1");
    await dialog.getByLabel("Postcode").fill("1234 AB");
    await dialog.getByLabel("Plaats").fill("Utrecht");
    await dialog.getByRole("button", { name: "Prijs en levering opvragen" }).click();

    await expect(dialog.getByText("Exacte quote")).toBeVisible();
    await expect(dialog.getByText("Buildy Test B.V.")).toBeVisible();
    await expect(dialog.getByText(/plaatst de drukopdracht handmatig/i)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Naar beveiligde betaling" })).toBeDisabled();

    const quote = fixture.requests.find((request) => request.pathname.endsWith("/quote"));
    expect(quote?.body).toEqual({
      documentSha256: PHOTOBOOK_DOCUMENT_SHA256,
      pdfSha256: PHOTOBOOK_PDF_SHA256,
      quantity: 1,
      shippingAddress: {
        firstName: "Ada",
        lastName: "Tester",
        addressLine1: "Teststraat 1",
        addressLine2: null,
        postalCode: "1234 AB",
        city: "Utrecht",
        state: null,
        countryCode: "NL",
      },
    });
    expect(quote?.body).not.toHaveProperty("amounts");
    expect(quote?.body).not.toHaveProperty("productReference");
    expect(fixture.requests.some((request) => request.pathname.endsWith("/checkout"))).toBe(false);
    expect(fixture.unhandled).toEqual([]);
  });

  test("bevestigt de exacte quote en navigeert pas daarna naar gehoste Stripe Checkout", async ({ page }) => {
    const fixture = await installPhotobookFixture(page, "test");
    await page.route("https://checkout.stripe.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Stripe Checkout test</title><h1>Beveiligde testbetaling</h1>",
      });
    });
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);
    await page.getByRole("button", { name: "Bouwboek bestellen" }).click();

    const dialog = page.getByRole("dialog", { name: "Bouwboek bestellen" });
    await dialog.getByLabel("Voornaam").fill("Ada");
    await dialog.getByLabel("Achternaam").fill("Tester");
    await dialog.getByLabel("Straat en huisnummer").fill("Teststraat 1");
    await dialog.getByLabel("Postcode").fill("1234 AB");
    await dialog.getByLabel("Plaats").fill("Utrecht");
    await dialog.getByRole("button", { name: "Prijs en levering opvragen" }).click();
    await dialog.getByLabel(/Ik ga akkoord met de algemene voorwaarden/).click();
    await dialog.getByLabel(/Ik bevestig dat dit Bouwboek volgens mijn specificaties/).click();
    await dialog.getByRole("button", { name: "Naar beveiligde betaling" }).click();

    await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_buildy_synthetic");
    await expect(page.getByRole("heading", { name: "Beveiligde testbetaling" })).toBeVisible();
    const checkout = fixture.requests.find((request) => request.pathname.endsWith("/checkout"));
    expect(checkout?.body).toEqual({
      documentSha256: PHOTOBOOK_DOCUMENT_SHA256,
      pdfSha256: PHOTOBOOK_PDF_SHA256,
      quantity: 1,
      shippingAddress: {
        firstName: "Ada",
        lastName: "Tester",
        addressLine1: "Teststraat 1",
        addressLine2: null,
        postalCode: "1234 AB",
        city: "Utrecht",
        state: null,
        countryCode: "NL",
      },
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      expectedQuoteReference: "matrix:synthetic-approved-price",
      expectedQuoteExpiresAt: "2099-08-23T10:15:00.000Z",
      expectedAmounts: {
        currency: "EUR",
        subtotalMinor: 6_612,
        shippingMinor: 413,
        taxMinor: 1_475,
        totalMinor: 8_500,
      },
      termsVersion: "2026-08-23",
      termsAccepted: true,
      personalisedProductAccepted: true,
    });
    expect(fixture.unhandled).toEqual([]);
  });
});

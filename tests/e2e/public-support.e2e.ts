import { BASE, expect, test } from "./helpers";
import {
  FIXED_NOW,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  success,
} from "./syntheticApi";

const SUPPORT_RECEIPT = {
  id: "abababab-abab-4bab-8bab-abababababab",
  receiptCode: "HELP-BUILDY26",
  kind: "support",
  status: "received",
  submittedAt: FIXED_NOW,
  replayed: false,
} as const;

test.describe("Juridische en contactroutes", () => {
  test("opent iedere actieve juridische en supportroute met een bruikbare titel", async ({ page }) => {
    const fixture = await installSyntheticApi(page, { authenticated: false });
    for (const [pathname, title] of [
      ["/voorwaarden", "Algemene voorwaarden"],
      ["/privacy", "Privacyverklaring"],
      ["/support", "Waar kunnen we naar kijken?"],
    ] as const) {
      await page.goto(`${BASE}${pathname}`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      // Finish the current document's font loads before deliberately replacing it.
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
    }
    expect(fixture.unhandled).toEqual([]);
  });

  test("verstuurt een openbaar supportverzoek en belooft geen e-mailbevestiging", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      authenticated: false,
      handle: async ({ request, route, url }) => {
        if (request.method() !== "POST" || url.pathname !== "/api/support") return false;
        await fulfillJson(route, success(SUPPORT_RECEIPT), 201);
        return true;
      },
    });
    await page.goto(`${BASE}/support`);

    await page.getByLabel("Onderwerp").selectOption("technical");
    await page.getByLabel("E-mailadres").fill("bezoeker@example.invalid");
    await page.getByLabel("Je bericht").fill("De knop reageerde niet na een veilige test.");
    await page.getByLabel("Ik ga akkoord met verwerking voor mijn verzoek").check();
    await page.getByRole("button", { name: "Bericht versturen" }).click();

    await expect(page.getByRole("status")).toContainText("HELP-BUILDY26");
    await expect(page.getByRole("status")).not.toContainText(/e-mailbevestiging/i);
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/support",
      body: expect.objectContaining({
        category: "technical",
        kind: "support",
        route: "/support",
      }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("verstuurt vanaf Melden standaard een derdenverzoek", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      authenticated: false,
      handle: async ({ request, route, url }) => {
        if (request.method() !== "POST" || url.pathname !== "/api/support") return false;
        await fulfillJson(route, success({
          ...SUPPORT_RECEIPT,
          id: SYNTHETIC_IDS.request,
          kind: "third_party_request",
        }), 201);
        return true;
      },
    });
    await page.goto(`${BASE}/melden`);

    await expect(page.getByRole("heading", { name: "Meld het op de plek waar je het ziet" })).toBeVisible();
    await expect(page.getByLabel("Soort verzoek")).toHaveValue("third_party_request");
    await page.getByLabel("Onderwerp").selectOption("privacy");
    await page.getByLabel("E-mailadres").fill("betrokkene@example.invalid");
    await page.getByLabel("Je bericht").fill("Ik kom herkenbaar voor op deze voorbeeldinhoud.");
    await page.getByLabel("Ik ga akkoord met verwerking voor mijn verzoek").check();
    await page.getByRole("button", { name: "Bericht versturen" }).click();

    await expect(page.getByRole("status")).toContainText("Bericht ontvangen");
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/support",
      body: expect.objectContaining({ kind: "third_party_request", route: "/melden" }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });

  test("verstuurt ingelogde feedback met een privacybevestiging", async ({ page }) => {
    const fixture = await installSyntheticApi(page, {
      handle: async ({ request, route, url }) => {
        if (request.method() !== "POST" || url.pathname !== "/api/feedback") return false;
        await fulfillJson(route, success({
          ...SUPPORT_RECEIPT,
          id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          receiptCode: "HELP-FEEDBK26",
          kind: "feedback",
        }), 201);
        return true;
      },
    });
    await page.goto(`${BASE}/feedback`);

    await page.getByLabel("Wat werkte goed?").fill("Het Verhaal leest rustig.");
    await page.getByLabel("Wat was onduidelijk?").fill("De fotovolgorde was even zoeken.");
    await page.getByLabel("Wat mis je?").fill("Een sneller fotovoorbeeld.");
    await page.getByRole("button", { name: "4 van 5" }).click();
    await page.getByLabel("Ik deel geen gevoelige informatie").check();
    await page.getByRole("button", { name: "Feedback versturen" }).click();

    await expect(page.getByRole("status")).toContainText("HELP-FEEDBK26");
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/feedback",
      body: expect.objectContaining({
        category: "idea",
        route: "/feedback",
        message: expect.stringContaining("Waardering: 4/5"),
      }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });
});

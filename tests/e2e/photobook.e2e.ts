import { BASE, expect, test } from "./helpers";
import {
  PHOTOBOOK_DOCUMENT_SHA256,
  syntheticPhotobookDraft,
} from "./photobookFixture";
import {
  ONE_PIXEL_PNG,
  SYNTHETIC_IDS,
  fulfillJson,
  installSyntheticApi,
  syntheticProjectCard,
  success,
} from "./syntheticApi";

const SECOND_UPDATE_ID = "12121212-1212-4121-8121-121212121212";

function textBlock(input: {
  id: string;
  lines: string[];
  yMm: number;
  font?: "inter" | "instrument-serif";
  size?: number;
}) {
  const fontSizePt = input.size ?? 12;
  return {
    id: input.id,
    type: "text" as const,
    frame: { xMm: 28, yMm: input.yMm, widthMm: 241, heightMm: 34 },
    font: input.font ?? "inter" as const,
    weight: "regular" as const,
    style: "normal" as const,
    fontSizePt,
    lineHeightPt: fontSizePt + 4,
    align: "left" as const,
    color: "#26231f",
    text: input.lines.join("\n"),
    lines: input.lines,
  };
}

function syntheticDigitalDraft() {
  const draft = syntheticPhotobookDraft();
  const pages = draft.document.pages.map((page, index) => {
    if (index === 1) {
      return {
        ...page,
        id: `update:${SYNTHETIC_IDS.update}:text`,
        kind: "update_text" as const,
        updateId: SYNTHETIC_IDS.update,
        blocks: [
          textBlock({
            id: `update:${SYNTHETIC_IDS.update}:date:label`,
            lines: ["22 augustus 2026"],
            yMm: 30,
          }),
          textBlock({
            id: `update:${SYNTHETIC_IDS.update}:title`,
            lines: ["De eerste muur is open"],
            yMm: 58,
            font: "instrument-serif",
            size: 30,
          }),
          textBlock({
            id: `update:${SYNTHETIC_IDS.update}:body`,
            lines: ["Onder het oude stucwerk kwam het huis tevoorschijn."],
            yMm: 108,
          }),
        ],
      };
    }
    if (index === 2) {
      return {
        ...page,
        id: `update:${SYNTHETIC_IDS.update}:photos`,
        kind: "photos" as const,
        updateId: SYNTHETIC_IDS.update,
        blocks: [{
          id: `update:${SYNTHETIC_IDS.update}:photo`,
          type: "photo" as const,
          frame: { xMm: 18, yMm: 18, widthMm: 261, heightMm: 174 },
          assetId: SYNTHETIC_IDS.media,
          crop: { fit: "cover" as const, focusX: 0.5, focusY: 0.5, zoom: 1 },
          effectiveDpi: 300,
          altText: "Sloopfoto van de keuken",
        }],
      };
    }
    if (index === 3) {
      return {
        ...page,
        id: `update:${SECOND_UPDATE_ID}:text`,
        kind: "update_text" as const,
        updateId: SECOND_UPDATE_ID,
        blocks: [
          textBlock({
            id: `update:${SECOND_UPDATE_ID}:date:label`,
            lines: ["24 augustus 2026"],
            yMm: 30,
          }),
          textBlock({
            id: `update:${SECOND_UPDATE_ID}:title`,
            lines: ["Licht in de nieuwe keuken"],
            yMm: 58,
            font: "instrument-serif",
            size: 30,
          }),
          textBlock({
            id: `update:${SECOND_UPDATE_ID}:body`,
            lines: ["De eerste rustige ochtend in de open ruimte."],
            yMm: 108,
          }),
        ],
      };
    }
    return page;
  });

  return {
    ...draft,
    document: {
      ...draft.document,
      pages,
      sourceAssets: [{
        id: SYNTHETIC_IDS.media,
        sha256: "a".repeat(64),
        contentType: "image/png" as const,
        widthPixels: 1200,
        heightPixels: 900,
      }],
      sourceAssetIds: [SYNTHETIC_IDS.media],
      checksumSha256: PHOTOBOOK_DOCUMENT_SHA256,
    },
    proof: null,
  };
}

async function installDigitalBookFixture(
  page: Parameters<typeof installSyntheticApi>[0],
) {
  return installSyntheticApi(page, {
    checkoutMode: "off",
    handle: async ({ request, route, url }) => {
      if (
        request.method() === "GET"
        && url.pathname === `/api/projects/${SYNTHETIC_IDS.project}/photobook`
      ) {
        await fulfillJson(route, success(syntheticDigitalDraft()));
        return true;
      }
      if (request.method() === "GET" && url.pathname === "/api/projects") {
        await fulfillJson(route, success({
          items: [syntheticProjectCard()],
          nextCursor: null,
        }));
        return true;
      }
      if (
        request.method() === "GET"
        && url.pathname === `/api/media/${SYNTHETIC_IDS.media}`
      ) {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "cache-control": "private, no-store" },
          body: ONE_PIXEL_PNG,
        });
        return true;
      }
      if (request.method() === "POST" && url.pathname === "/api/feedback") {
        await fulfillJson(route, success({
          id: "34343434-3434-4343-8343-343434343434",
          receiptCode: "HELP-PRINT026",
          kind: "feedback",
          status: "received",
          submittedAt: "2026-08-30T10:00:00.000Z",
          replayed: false,
        }), 201);
        return true;
      }
      return false;
    },
  });
}

test.describe("Gratis digitaal Bouwboek", () => {
  test("bladert deterministisch van cover via voorwoord en Bouwmomenten naar het slot", async ({ page }) => {
    const fixture = await installDigitalBookFixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);

    await expect(page.getByRole("heading", {
      level: 1,
      name: "Je Bouwboek groeit met je verbouwing mee",
    })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Synthetisch Bouwboek" })).toBeVisible();

    const viewer = page.getByRole("region", { name: "Bouwboekweergave" });
    await expect(viewer.getByText("Cover · 1 van 6", { exact: true })).toBeVisible();
    await expect(viewer.getByLabel("Bouwboekpagina 1").getByText("Synthetisch Bouwboek", { exact: true })).toBeVisible();

    await viewer.getByRole("button", { name: "Volgende pagina" }).click();
    await expect(viewer.getByText("2–3 van 6", { exact: true })).toBeVisible();
    await expect(viewer.getByLabel("Bouwboekpagina 2").getByText("Van eerste idee", { exact: true })).toBeVisible();
    await expect(viewer.getByLabel("Bouwboekpagina 3").getByText("De eerste muur is open", { exact: true })).toBeVisible();

    await viewer.getByRole("button", { name: "Volgende pagina" }).click();
    await expect(viewer.getByText("4–5 van 6", { exact: true })).toBeVisible();
    await expect(viewer.getByLabel("Bouwboekpagina 4").getByRole("img", { name: "Sloopfoto van de keuken" })).toBeVisible();
    await expect(viewer.getByLabel("Bouwboekpagina 5").getByText("Licht in de nieuwe keuken", { exact: true })).toBeVisible();

    await viewer.getByRole("button", { name: "Volgende pagina" }).click();
    await expect(viewer.getByText("Tot slot · 6 van 6", { exact: true })).toBeVisible();
    await expect(viewer.getByLabel("Bouwboekpagina 6").getByText("Verder bouwen,", { exact: true })).toBeVisible();

    const layoutSection = page.getByRole("heading", { name: "Indeling" }).locator("..");
    await expect(layoutSection.getByRole("button")).toHaveCount(2);
    await expect(layoutSection.getByRole("button", { name: "Afwisselend" })).toBeVisible();
    await expect(layoutSection.getByRole("button", { name: "Foto groot" })).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });

  test("blijft op 390px op iedere digitale bladzijde binnen het scherm", async ({ page }) => {
    const fixture = await installDigitalBookFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);

    const viewer = page.getByRole("region", { name: "Bouwboekweergave" });
    const labels = [
      "Cover · 1 van 6",
      "Voorwoord · 2 van 6",
      "Bouwmoment · 3 van 6",
      "Foto’s · 4 van 6",
      "Bouwmoment · 5 van 6",
      "Tot slot · 6 van 6",
    ];

    for (const [index, label] of labels.entries()) {
      await expect(viewer.getByText(label, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }))).toEqual({ documentWidth: 390, viewportWidth: 390 });
      if (index < labels.length - 1) {
        await viewer.getByRole("button", { name: "Volgende pagina" }).click();
      }
    }
    expect(fixture.unhandled).toEqual([]);
  });

  test("opent drie printinteressevragen met een optionele waardering en gebruikt de feedbackbackend", async ({ page }) => {
    const fixture = await installDigitalBookFixture(page);
    await page.goto(`${BASE}/project/${SYNTHETIC_IDS.project}/bouwboek`);
    await page.getByRole("button", { name: "Ik wil dit later laten drukken" }).click();

    const dialog = page.getByRole("dialog", {
      name: "Vertel ons wat een gedrukt Bouwboek nodig heeft",
    });
    const form = dialog.getByRole("form", { name: "Interesse in een gedrukt Bouwboek delen" });
    await expect(form.locator("textarea")).toHaveCount(3);
    await expect(form.getByLabel("Wat werkte goed?", { exact: true })).toBeVisible();
    await expect(form.getByLabel("Wat was onduidelijk?", { exact: true })).toBeVisible();
    await expect(form.getByLabel("Wat mis je?", { exact: true })).toBeVisible();

    const rating = form.getByRole("group", { name: "Waardering van 1 tot 5" });
    await expect(rating.getByRole("button")).toHaveCount(5);
    await expect(form.getByText("(optioneel)", { exact: true })).toBeVisible();
    await form.getByLabel("Ik deel geen gevoelige informatie").check();
    await expect(form.getByRole("button", { name: "Interesse delen" })).toBeEnabled();

    await form.getByLabel("Wat werkte goed?", { exact: true }).fill("Het digitale verhaal leest rustig.");
    await form.getByLabel("Wat was onduidelijk?", { exact: true }).fill("Niets was onduidelijk.");
    await form.getByLabel("Wat mis je?", { exact: true }).fill("Een keuze voor papiersoort.");
    await rating.getByRole("button", { name: "4 van 5" }).click();
    await form.getByRole("button", { name: "Interesse delen" }).click();

    await expect(dialog.getByRole("status")).toContainText("HELP-PRINT026");
    expect(fixture.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      pathname: "/api/feedback",
      body: expect.objectContaining({
        category: "idea",
        route: `/project/${SYNTHETIC_IDS.project}/bouwboek`,
        message: [
          "Buildy-feedback v1",
          "Context: Interesse in later laten drukken",
          "Waardering: 4/5",
          "",
          "Wat werkte goed?",
          "Het digitale verhaal leest rustig.",
          "",
          "Wat was onduidelijk?",
          "Niets was onduidelijk.",
          "",
          "Wat mis je?",
          "Een keuze voor papiersoort.",
        ].join("\n"),
      }),
    }));
    expect(fixture.unhandled).toEqual([]);
  });
});

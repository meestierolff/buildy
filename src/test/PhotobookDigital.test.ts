import { describe, expect, it } from "vitest";
import type { PhotobookDocument, PhotobookPage } from "../../shared/contracts/photobooks";
import { deriveDigitalBook } from "@/pages/Photobook";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const EARLY_UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const LATE_UPDATE_ID = "33333333-3333-4333-8333-333333333333";

function cover(): PhotobookPage {
  return {
    id: "cover",
    number: 1,
    kind: "cover",
    chapterId: null,
    updateId: null,
    background: "#142238",
    overlay: null,
    blocks: [],
  };
}

function momentPage(input: {
  date: string;
  number: number;
  title: string;
  updateId: string;
}): PhotobookPage {
  return {
    id: `update:${input.updateId}:text:1`,
    number: input.number,
    kind: "update_text",
    chapterId: "chapter:test",
    updateId: input.updateId,
    background: "#ffffff",
    overlay: null,
    blocks: [
      {
        id: `update:${input.updateId}:date:0`,
        type: "text",
        frame: { xMm: 12, yMm: 18, widthMm: 273, heightMm: 8 },
        font: "inter",
        weight: "regular",
        style: "normal",
        fontSizePt: 8,
        lineHeightPt: 10,
        align: "left",
        color: "#777777",
        text: input.date,
        lines: [input.date],
      },
      {
        id: `update:${input.updateId}:title`,
        type: "text",
        frame: { xMm: 12, yMm: 37, widthMm: 273, heightMm: 24 },
        font: "instrument-serif",
        weight: "semibold",
        style: "normal",
        fontSizePt: 22,
        lineHeightPt: 25,
        align: "left",
        color: "#171717",
        text: input.title,
        lines: [input.title],
      },
    ],
  };
}

function documentWith(pages: PhotobookPage[]): PhotobookDocument {
  return {
    version: 1,
    projectId: PROJECT_ID,
    projectRevision: 1,
    selectedFormat: "a4-landscape-hardcover-v1",
    locale: "nl-NL",
    print: {
      widthMm: 297,
      heightMm: 210,
      safeMarginMm: 12,
      bleedMm: 0,
      targetDpi: 300,
      colorSpace: "RGB",
    },
    cover: { title: "Ons huis", subtitle: "", mediaAssetId: null, crop: null },
    chapters: [],
    pages,
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: pages.length,
    warnings: [],
    checksumSha256: "a".repeat(64),
  };
}

describe("digitaal Bouwboek", () => {
  it("leidt cover, opening, chronologische Bouwmomenten en afsluiting af", () => {
    const result = deriveDigitalBook(documentWith([
      cover(),
      momentPage({
        date: "12 augustus 2026",
        number: 2,
        title: "De keuken",
        updateId: LATE_UPDATE_ID,
      }),
      momentPage({
        date: "3 juli 2026",
        number: 3,
        title: "De eerste muur",
        updateId: EARLY_UPDATE_ID,
      }),
    ]));

    expect(result.document.pages.map((page) => page.id)).toEqual([
      "cover",
      "digital:opening",
      `update:${EARLY_UPDATE_ID}:text:1`,
      `update:${LATE_UPDATE_ID}:text:1`,
      "digital:closing",
    ]);
    expect(result.document.pages.map((page) => page.number)).toEqual([1, 2, 3, 4, 5]);
    expect(result.moments.map((moment) => moment.title)).toEqual([
      "De eerste muur",
      "De keuken",
    ]);
  });

  it("maakt geen fictieve bladzijden wanneer er nog geen Bouwmoment is", () => {
    const result = deriveDigitalBook(documentWith([cover()]));

    expect(result.moments).toEqual([]);
    expect(result.document.pages).toEqual([]);
    expect(result.document.pageCount).toBe(0);
  });
});

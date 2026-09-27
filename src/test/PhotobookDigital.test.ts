import { describe, expect, it } from "vitest";
import type { PhotobookDocument, PhotobookPage } from "../../shared/contracts/photobooks";
import { deriveDigitalBook } from "@/pages/Photobook";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const EARLY_UPDATE_ID = "22222222-2222-4222-8222-222222222222";
const LATE_UPDATE_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";

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
  const paddedPages: PhotobookPage[] = [...pages];
  while (paddedPages.length < 24) {
    paddedPages.push({
      ...cover(),
      id: `blank:${paddedPages.length + 1}`,
      number: paddedPages.length + 1,
      kind: "blank",
    });
  }
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
    pages: paddedPages,
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: paddedPages.length,
    warnings: [],
    checksumSha256: "a".repeat(64),
  };
}

describe("digitaal Bouwboek", () => {
  it("bewaart het canonieke document en leidt navigatie af in de servervolgorde", () => {
    const document = documentWith([
      cover(),
      { ...cover(), id: "chapter:test:divider", number: 2, kind: "chapter" },
      momentPage({
        date: "12 augustus 2026",
        number: 3,
        title: "De keuken",
        updateId: LATE_UPDATE_ID,
      }),
      {
        ...cover(),
        id: `update:${LATE_UPDATE_ID}:photos:1`,
        number: 4,
        kind: "photos",
        updateId: LATE_UPDATE_ID,
        blocks: [{
          id: `update:${LATE_UPDATE_ID}:photo:1`,
          type: "photo",
          frame: { xMm: 12, yMm: 12, widthMm: 273, heightMm: 186 },
          assetId: ASSET_ID,
          crop: { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 1 },
          effectiveDpi: 300,
          altText: "De keuken",
        }],
      },
      momentPage({
        date: "3 juli 2026",
        number: 5,
        title: "De eerste muur",
        updateId: EARLY_UPDATE_ID,
      }),
    ]);
    const unchangedDocument = structuredClone(document);
    const result = deriveDigitalBook(document);

    expect(result.document).toBe(document);
    expect(document).toEqual(unchangedDocument);
    expect(result.document.pageCount).toBe(24);
    expect(result.moments).toEqual([
      {
        assetIds: [ASSET_ID],
        date: "12 augustus 2026",
        firstPageIndex: 2,
        title: "De keuken",
        updateId: LATE_UPDATE_ID,
      },
      {
        assetIds: [],
        date: "3 juli 2026",
        firstPageIndex: 4,
        title: "De eerste muur",
        updateId: EARLY_UPDATE_ID,
      },
    ]);
  });

  it("bewaart cover en opvulpagina's zonder Bouwmomenten voor te stellen", () => {
    const document = documentWith([cover()]);
    const result = deriveDigitalBook(document);

    expect(result.moments).toEqual([]);
    expect(result.document).toBe(document);
    expect(result.document.pageCount).toBe(24);
  });
});

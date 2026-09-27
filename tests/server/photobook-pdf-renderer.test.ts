// @vitest-environment node

import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildPhotobookDocument,
  type BuildPhotobookDocumentInput,
} from "../../server/photobooks/document";
import {
  renderPhotobookPdf,
} from "../../server/photobooks/pdfRenderer";
import {
  PdfKitPhotobookTypography,
  loadPhotobookFontBytes,
  type PhotobookFontBytes,
} from "../../server/photobooks/typography";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const UPDATE_ID = "20000000-0000-4000-8000-000000000001";
const ASSET_ID = "30000000-0000-4000-8000-000000000001";

let fonts: PhotobookFontBytes;
let typography: PdfKitPhotobookTypography;

beforeAll(async () => {
  fonts = await loadPhotobookFontBytes();
  typography = new PdfKitPhotobookTypography(fonts);
});

afterAll(() => typography.close());

function build(overrides: Partial<BuildPhotobookDocumentInput> = {}) {
  return buildPhotobookDocument({
    projectId: PROJECT_ID,
    projectRevision: 1,
    projectTitle: "Een huis om in te leven",
    projectSubtitle: "Bouwboek",
    updates: [],
    maximumPages: 120,
    measurer: typography,
    ...overrides,
  });
}

describe("server-side canonical PDF renderer", () => {
  it("embeds visible glyphs for ordinary Dutch text in every registered font", () => {
    const sample = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 Bouwboek: één café, naïef, reünie, façade — ‘thuis’ €";
    const pdf = new PDFDocument({ autoFirstPage: false });
    typography.register(pdf);
    try {
      for (const name of Object.keys(fonts)) {
        pdf.font(name);
        // Inspect PDFKit's loaded fontkit face, not just the CSS subset label:
        // a missing glyph may still have a width and produce a valid PDF.
        const face = (pdf as PDFKit.PDFDocument & {
          _font: { font: {
            hasGlyphForCodePoint(codePoint: number): boolean;
            layout(text: string): { glyphs: Array<{ id: number }> };
          } };
        })._font.font;
        const missing = [...new Set(sample)].filter((character) =>
          !face.hasGlyphForCodePoint(character.codePointAt(0)!));
        expect(missing, name).toEqual([]);
        expect(face.layout(sample).glyphs.some((glyph) => glyph.id === 0), name).toBe(false);
      }
    } finally {
      pdf.end();
    }
  });

  it("embeds the canonical page model into a byte-stable complete PDF", async () => {
    const document = build();
    const assets = {
      readOriginal: async () => {
        throw new Error("empty proof must not request an asset");
      },
    };

    const first = await renderPhotobookPdf({ document, assets, fonts });
    const second = await renderPhotobookPdf({ document, assets, fonts });

    expect(first.bytes.subarray(0, 8).toString("ascii")).toMatch(/^%PDF-1\./);
    expect(first.bytes.subarray(-1_024).toString("ascii")).toContain("%%EOF");
    expect(first.pageCount).toBe(24);
    expect(first.documentSha256).toBe(document.checksumSha256);
    expect(first.pdfSha256).toBe(createHash("sha256").update(first.bytes).digest("hex"));
    expect(first.pdfSha256).toBe(second.pdfSha256);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.fontSetSha256).toMatch(/^[0-9a-f]{64}$/);
  }, 20_000);

  it("finishes embedding ordinary Dutch accents and ligatures across long canonical paragraphs", async () => {
    const paragraph = "Eén thermoskan koffie op de vensterbank, frisse ideeën voor de keuken en een reünie aan de nieuwe tafel. We bekijken de façade, meten de kamer opnieuw en werken rustig verder: schuren, passen en vastzetten.";
    const document = build({
      projectTitle: "Een thuis vol ideeën",
      projectSubtitle: "Van café tot keuken — één verhaal om te bewaren",
      updates: [{
        id: UPDATE_ID,
        updateDate: "2026-04-12",
        sortOrder: 0,
        title: "De eerste ideeën krijgen vorm",
        room: "Keuken",
        description: Array.from({ length: 48 }, (_, index) =>
          `Dagboekregel ${index + 1}. ${paragraph}`).join("\n\n"),
        phaseId: "finishing",
        phaseName: "Afwerking",
        media: [],
      }],
    });
    expect(document.pages.filter((page) => page.kind === "update_text").length).toBeGreaterThan(1);

    const proof = await renderPhotobookPdf({
      document,
      fonts,
      assets: { readOriginal: async () => { throw new Error("text-only book has no images"); } },
    });

    expect(proof.pageCount).toBe(document.pageCount);
    expect(proof.bytes.subarray(-1_024).toString("ascii")).toContain("%%EOF");
    expect(proof.pdfSizeBytes).toBeGreaterThan(10_000);
  }, 20_000);

  it("renders a verified high-resolution source and records its immutable assetset", async () => {
    const source = await sharp({
      create: { width: 1_200, height: 800, channels: 3, background: "#b45a32" },
    }).jpeg({ quality: 95 }).toBuffer();
    const sha256 = createHash("sha256").update(source).digest("hex");
    const document = build({
      coverMediaAssetId: ASSET_ID,
      excludedUpdateIds: new Set([UPDATE_ID]),
      updates: [{
        id: UPDATE_ID,
        updateDate: "2026-04-12",
        title: "Sloopdag",
        room: "Keuken",
        description: "De eerste dag.",
        phaseId: "phase-one",
        phaseName: "Start",
        sortOrder: 0,
        media: [{
          id: ASSET_ID,
          sha256,
          contentType: "image/jpeg",
          widthPixels: 1_200,
          heightPixels: 800,
          sortOrder: 0,
        }],
      }],
    });

    const proof = await renderPhotobookPdf({
      document,
      assets: { readOriginal: async () => source },
      fonts,
    });

    expect(proof.assetSet).toEqual([{ id: ASSET_ID, sha256 }]);
    expect(proof.assetSetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.pdfSizeBytes).toBeGreaterThan(10_000);
  }, 30_000);

  it("fails closed when original bytes no longer match the approved manifest", async () => {
    const expected = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#223344" },
    }).jpeg().toBuffer();
    const tampered = Buffer.from(expected);
    tampered[tampered.length - 3] ^= 1;
    const document = build({
      coverMediaAssetId: ASSET_ID,
      excludedUpdateIds: new Set([UPDATE_ID]),
      updates: [{
        id: UPDATE_ID,
        updateDate: "2026-04-12",
        title: null,
        room: null,
        description: null,
        phaseId: null,
        phaseName: null,
        sortOrder: 0,
        media: [{
          id: ASSET_ID,
          sha256: createHash("sha256").update(expected).digest("hex"),
          contentType: "image/jpeg",
          widthPixels: 600,
          heightPixels: 400,
          sortOrder: 0,
        }],
      }],
    });

    await expect(renderPhotobookPdf({
      document,
      assets: { readOriginal: async () => tampered },
      fonts,
    })).rejects.toMatchObject({
      code: "ASSET_CHECKSUM_MISMATCH",
    });
  });

  it("refuses to render a document carrying a blocking preflight warning", async () => {
    const document = build({
      coverMediaAssetId: ASSET_ID,
      updates: [],
    });

    await expect(renderPhotobookPdf({
      document,
      assets: { readOriginal: async () => new Uint8Array() },
      fonts,
    })).rejects.toMatchObject({ code: "PROOF_BLOCKED" });
  });
});

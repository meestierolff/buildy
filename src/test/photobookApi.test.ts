// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approvePhotobookProof,
  getPhotobookDraft,
  replacePhotobookExclusions,
  requestPhotobookProof,
  updatePhotobookSettings,
} from "@/lib/photobookApi";
import {
  coverCropImageStyle,
  framePercentStyle,
  hasExactPhotobookProof,
  normalizedPageIndex,
} from "@/lib/photobookPreview";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const UPDATE_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const DOCUMENT_SHA = "a".repeat(64);
const PDF_SHA = "b".repeat(64);
const VIEW_RECEIPT = `v1.1893456000.${"a".repeat(43)}`;

const settings = {
  coverMediaAssetId: null,
  selectedFormat: "a4-landscape-hardcover-v1" as const,
  title: "Ons huis",
  subtitle: "Van sleutel tot thuis",
  includeBudget: false,
  preferences: {
    coverCrop: null,
    cropByAsset: {},
    photoOrderByUpdate: {},
    layoutByPage: {},
  },
  version: 3,
};

function document() {
  return {
    version: 1 as const,
    projectId: PROJECT_ID,
    projectRevision: 8,
    selectedFormat: "a4-landscape-hardcover-v1" as const,
    locale: "nl-NL" as const,
    print: {
      widthMm: 297 as const,
      heightMm: 210 as const,
      safeMarginMm: 12 as const,
      bleedMm: 0 as const,
      targetDpi: 300 as const,
      colorSpace: "RGB" as const,
    },
    cover: { title: "Ons huis", subtitle: "", mediaAssetId: null, crop: null },
    chapters: [],
    pages: Array.from({ length: 24 }, (_, index) => ({
      id: index === 0 ? "cover" : `blank:${index + 1}`,
      number: index + 1,
      kind: index === 0 ? "cover" as const : "blank" as const,
      chapterId: null,
      updateId: null,
      background: index === 0 ? "#142238" : "#ffffff",
      overlay: null,
      blocks: index === 0 ? [{
        id: "cover-title",
        type: "text" as const,
        frame: { xMm: 26, yMm: 126, widthMm: 245, heightMm: 42 },
        font: "instrument-serif" as const,
        weight: "semibold" as const,
        style: "normal" as const,
        fontSizePt: 36,
        lineHeightPt: 38,
        align: "center" as const,
        color: "#ffffff",
        text: "Niet opnieuw laten omlopen",
        lines: ["Vastgelegde regel één", "Vastgelegde regel twee"],
      }] : [],
    })),
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: 24,
    warnings: [],
    checksumSha256: DOCUMENT_SHA,
  };
}

function draft(proof: null | Record<string, unknown> = null) {
  return {
    draftId: DRAFT_ID,
    version: 5,
    settings,
    exclusions: [],
    document: document(),
    proof,
  };
}

function successResponse(data: unknown): Response {
  return Response.json({ data, meta: { requestId: REQUEST_ID } });
}

describe("photobook API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leest het canonical document via de owner-cookie-API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse(draft()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPhotobookDraft(PROJECT_ID);

    expect(result.document.pageCount).toBe(24);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/photobook`,
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("stuurt uitsluitend contractuele settings en exclusions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successResponse(draft()))
      .mockResolvedValueOnce(successResponse(draft()));
    vi.stubGlobal("fetch", fetchMock);

    await updatePhotobookSettings(PROJECT_ID, settings);
    await replacePhotobookExclusions(PROJECT_ID, {
      exclusions: [{ targetType: "update", updateId: UPDATE_ID }],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/projects/${PROJECT_ID}/photobook/settings`);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(settings);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/projects/${PROJECT_ID}/photobook/exclusions`);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      exclusions: [{ targetType: "update", updateId: UPDATE_ID }],
    });
  });

  it("bindt aanvragen en goedkeuren aan de exacte document- en PDF-hashes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(successResponse({ revisionId: REVISION_ID, status: "rendering", replayed: false }))
      .mockResolvedValueOnce(successResponse({ revisionId: REVISION_ID, status: "approved", replayed: false }));
    vi.stubGlobal("fetch", fetchMock);

    await requestPhotobookProof(PROJECT_ID, {
      idempotencyKey: REQUEST_ID,
      expectedDraftVersion: 5,
      expectedDocumentSha256: DOCUMENT_SHA,
    });
    await approvePhotobookProof(REVISION_ID, {
      idempotencyKey: REQUEST_ID,
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      viewReceipt: VIEW_RECEIPT,
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      expectedDocumentSha256: DOCUMENT_SHA,
      expectedDraftVersion: 5,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/photobooks/proofs/${REVISION_ID}/approve`);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      documentSha256: DOCUMENT_SHA,
      pdfSha256: PDF_SHA,
      viewReceipt: VIEW_RECEIPT,
    });
  });
});

describe("canonical browsergeometrie", () => {
  it("zet millimeterframes exact om naar paginapercentages", () => {
    expect(framePercentStyle(
      { xMm: 29.7, yMm: 21, widthMm: 148.5, heightMm: 105 },
      { widthMm: 297, heightMm: 210 },
    )).toEqual({ left: "10%", top: "10%", width: "50%", height: "50%" });
  });

  it("repliceert focus en zoom uit de servercrop zonder object-cover opnieuw te laten kiezen", () => {
    expect(coverCropImageStyle(
      { widthPixels: 4_000, heightPixels: 2_000 },
      { widthMm: 100, heightMm: 100 },
      { fit: "cover", focusX: 1, focusY: 0.5, zoom: 2 },
    )).toEqual({
      left: "-300%",
      top: "-50%",
      width: "400%",
      height: "200%",
      objectFit: "fill",
    });
  });

  it("normaliseert pagina's voor mobiel en echte spreads", () => {
    expect(normalizedPageIndex(7, 24, false)).toBe(7);
    expect(normalizedPageIndex(0, 24, true)).toBe(0);
    expect(normalizedPageIndex(2, 24, true)).toBe(1);
    expect(normalizedPageIndex(7, 24, true)).toBe(7);
    expect(normalizedPageIndex(99, 24, true)).toBe(23);
  });

  it("geeft het echte-prooflabel uitsluitend bij complete ready/approved/locked metadata", () => {
    const ready = {
      revisionId: REVISION_ID,
      status: "ready" as const,
      pdfSha256: PDF_SHA,
      pageCount: 24,
      pdfPath: `/api/photobooks/proofs/${REVISION_ID}/pdf`,
      thumbnailPaths: [],
    };
    expect(hasExactPhotobookProof(ready, { pageCount: 24 })).toBe(true);
    expect(hasExactPhotobookProof({ ...ready, status: "rendering" }, { pageCount: 24 })).toBe(false);
    expect(hasExactPhotobookProof({ ...ready, pdfSha256: null }, { pageCount: 24 })).toBe(false);
    expect(hasExactPhotobookProof({ ...ready, pageCount: 26 }, { pageCount: 24 })).toBe(false);
  });
});

describe("Bouwboekbrowsermigratie", () => {
  it("bevat geen providerwidget, client-PDF of downloadfallback", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/Photobook.tsx"), "utf8").toLowerCase();
    expect(source).not.toContain("supabase");
    expect(source).not.toContain("peecho");
    expect(source).not.toContain("peechoexport");
    expect(source).not.toContain("download=");
    expect(source).not.toContain("window.open");
    expect(source).not.toContain("<iframe");
  });
});

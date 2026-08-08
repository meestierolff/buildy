// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { PhotobookTextMeasurer } from "../../server/photobooks/document";
import {
  buildPhotobookDocument,
  verifyPhotobookDocumentChecksum,
} from "../../server/photobooks/document";
import type { PhotobookDocument } from "../../shared/contracts/photobooks";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const UPDATE_ONE = "20000000-0000-4000-8000-000000000001";
const UPDATE_TWO = "20000000-0000-4000-8000-000000000002";
const ASSET_ONE = "30000000-0000-4000-8000-000000000001";
const ASSET_TWO = "30000000-0000-4000-8000-000000000002";

const measurer: PhotobookTextMeasurer = {
  wrap: ({ maxWidthMm, text }) => {
    const maximumCharacters = Math.max(1, Math.floor(maxWidthMm / 3));
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last && `${last} ${word}`.length <= maximumCharacters) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  },
};

function build(overrides: Partial<Parameters<typeof buildPhotobookDocument>[0]> = {}) {
  return buildPhotobookDocument({
    projectId: PROJECT_ID,
    projectRevision: 4,
    projectTitle: "Ons huis aan de singel",
    projectSubtitle: "Een verbouwing van fundering tot nok",
    maximumPages: 120,
    measurer,
    updates: [
      {
        id: UPDATE_TWO,
        updateDate: "2026-03-02",
        title: "De nieuwe balken",
        room: "Zolder",
        description: "De draagconstructie is hersteld en klaar voor de volgende stap.",
        phaseId: "phase-structure",
        phaseName: "Constructie",
        phaseSortOrder: 2,
        media: [{
          id: ASSET_TWO,
          sha256: "b".repeat(64),
          contentType: "image/jpeg",
          widthPixels: 1_200,
          heightPixels: 800,
          sortOrder: 0,
        }],
      },
      {
        id: UPDATE_ONE,
        updateDate: "2026-02-01",
        title: "De eerste sloopdag",
        room: "Keuken",
        description: "We begonnen rustig en haalden daarna de oude kasten weg.",
        phaseId: "phase-demolition",
        phaseName: "Sloop",
        phaseSortOrder: 1,
        media: [{
          id: ASSET_ONE,
          sha256: "a".repeat(64),
          contentType: "image/jpeg",
          widthPixels: 6_000,
          heightPixels: 4_000,
          sortOrder: 0,
          altText: "De lege keuken na de eerste sloopdag",
        }],
      },
    ],
    ...overrides,
  });
}

describe("canonical photobook document", () => {
  it("is deterministic, checksummed, grouped by phase order and padded to an even minimum", () => {
    const first = build();
    const second = build();

    expect(first).toEqual(second);
    expect(first.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPhotobookDocumentChecksum(first)).toBe(true);
    expect(first.pageCount).toBe(24);
    expect(first.pages).toHaveLength(24);
    expect(first.pages.map((page) => page.number)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    expect(first.chapters.map((chapter) => chapter.title)).toEqual(["Sloop", "Constructie"]);
    expect(first.sourceAssetIds).toEqual([ASSET_ONE, ASSET_TWO]);
    expect(first.pages[0]).toMatchObject({ kind: "cover", number: 1 });
  });

  it("detects a changed canonical page after approval", () => {
    const document = build();
    const changed = structuredClone(document) as PhotobookDocument;
    const textBlock = changed.pages[0]?.blocks.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("cover title fixture missing");
    textBlock.text = "Een andere titel";

    expect(verifyPhotobookDocumentChecksum(changed)).toBe(false);
  });

  it("honours exclusions and never includes an excluded asset in the proof manifest", () => {
    const document = build({
      excludedMediaAssetIds: new Set([ASSET_ONE]),
      excludedUpdateIds: new Set([UPDATE_TWO]),
    });

    expect(document.sourceAssetIds).toEqual([]);
    expect(document.chapters).toHaveLength(1);
    expect(document.pages.flatMap((page) => page.blocks).some(
      (block) => block.type === "photo",
    )).toBe(false);
  });

  it("emits blocking diagnostics for an incomplete selected cover and invalid source metadata", () => {
    const missingCover = "30000000-0000-4000-8000-000000000099";
    const document = build({
      coverMediaAssetId: missingCover,
      updates: [{
        id: UPDATE_ONE,
        updateDate: "2026-02-01",
        title: null,
        room: null,
        description: null,
        phaseId: null,
        phaseName: null,
        phaseSortOrder: null,
        media: [{
          id: missingCover,
          sha256: null,
          contentType: "image/jpeg",
          widthPixels: null,
          heightPixels: null,
          sortOrder: 0,
        }],
      }],
    });

    expect(document.warnings.filter((warning) => warning.severity === "blocking"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_ASSET", assetId: missingCover }),
      ]));
    expect(document.sourceAssetIds).toEqual([]);
  });

  it("calculates low effective DPI and extreme crop from print dimensions", () => {
    const document = build({
      coverMediaAssetId: ASSET_TWO,
      coverCrop: { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 3 },
    });

    expect(document.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "LOW_EFFECTIVE_DPI", assetId: ASSET_TWO, pageNumber: 1 }),
      expect.objectContaining({ code: "EXTREME_CROP", assetId: ASSET_TWO, pageNumber: 1 }),
    ]));
  });

  it("marks a provider page-limit excess without silently dropping pages", () => {
    const document = build({ maximumPages: 24 });
    expect(document.pageCount).toBe(24);

    const manyUpdates = Array.from({ length: 25 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      updateDate: `2026-04-${String((index % 28) + 1).padStart(2, "0")}`,
      title: `Update ${index + 1}`,
      room: null,
      description: "Een korte beschrijving.",
      phaseId: "many",
      phaseName: "Veel werk",
      phaseSortOrder: 1,
      media: [],
    }));
    const oversized = build({ maximumPages: 24, updates: manyUpdates });

    expect(oversized.pageCount).toBeGreaterThan(24);
    expect(oversized.pageCount % 2).toBe(0);
    expect(oversized.warnings).toContainEqual(expect.objectContaining({
      code: "PAGE_LIMIT_EXCEEDED",
      severity: "blocking",
    }));
  });
});

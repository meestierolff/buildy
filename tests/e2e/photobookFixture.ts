import { createHash } from "node:crypto";

import { SYNTHETIC_IDS } from "./syntheticApi";

export const PHOTOBOOK_DRAFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const PHOTOBOOK_REVISION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PHOTOBOOK_DOCUMENT_SHA256 = "d".repeat(64);

function minimalPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 55 >>\nstream\nBT /F1 24 Tf 72 500 Td (Synthetisch Buildy Bouwboek) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  body += offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

export const PHOTOBOOK_PDF_BYTES = minimalPdf();
export const PHOTOBOOK_PDF_SHA256 = createHash("sha256")
  .update(PHOTOBOOK_PDF_BYTES)
  .digest("hex");
export function syntheticPhotobookDocument() {
  return {
    version: 1 as const,
    projectId: SYNTHETIC_IDS.project,
    projectRevision: 7,
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
    cover: {
      title: "Synthetisch Bouwboek",
      subtitle: "Van eerste Bouwmoment tot bewaard Verhaal",
      mediaAssetId: null,
      crop: null,
    },
    chapters: [],
    pages: Array.from({ length: 24 }, (_, index) => ({
      id: index === 0 ? "cover" : `blank:${index + 1}`,
      number: index + 1,
      kind: index === 0 ? "cover" as const : "blank" as const,
      chapterId: null,
      updateId: null,
      background: index === 0 ? "#26231f" : "#fffdf8",
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
        color: "#fffdf8",
        text: "Synthetisch Bouwboek",
        lines: ["Synthetisch Bouwboek"],
      }] : [],
    })),
    sourceAssets: [],
    sourceAssetIds: [],
    pageCount: 24,
    warnings: [],
    checksumSha256: PHOTOBOOK_DOCUMENT_SHA256,
  };
}

export function syntheticPhotobookDraft() {
  return {
    draftId: PHOTOBOOK_DRAFT_ID,
    version: 4,
    settings: {
      coverMediaAssetId: null,
      selectedFormat: "a4-landscape-hardcover-v1" as const,
      title: "Synthetisch Bouwboek",
      subtitle: "Van eerste Bouwmoment tot bewaard Verhaal",
      includeBudget: false,
      preferences: {
        coverCrop: null,
        cropByAsset: {},
        photoOrderByUpdate: {},
        layoutByPage: {},
      },
      version: 3,
    },
    exclusions: [],
    document: syntheticPhotobookDocument(),
    proof: {
      revisionId: PHOTOBOOK_REVISION_ID,
      status: "approved" as const,
      documentSha256: PHOTOBOOK_DOCUMENT_SHA256,
      pdfSha256: PHOTOBOOK_PDF_SHA256,
      pageCount: 24,
      pdfPath: `/api/photobooks/proofs/${PHOTOBOOK_REVISION_ID}/pdf`,
      thumbnailPaths: [],
    },
  };
}

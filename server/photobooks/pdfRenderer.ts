import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  photobookDocumentSchema,
  type PhotobookCrop,
  type PhotobookDocument,
  type PhotobookSourceAsset,
} from "../../shared/contracts/photobooks.js";
import { detectImageContentType } from "../media/imageProcessing.js";
import { verifyPhotobookDocumentChecksum } from "./document.js";
import {
  PdfKitPhotobookTypography,
  fontKeyFor,
  loadPhotobookFontBytes,
  type PhotobookFontBytes,
} from "./typography.js";

const MM_TO_POINTS = 72 / 25.4;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 100_000_000;
const MAX_RENDERED_IMAGE_BYTES = 40 * 1024 * 1024;
const FIXED_PDF_DATE = new Date("2000-01-01T00:00:00.000Z");

export const PHOTOBOOK_RENDER_ENGINE = "pdfkit";
export const PHOTOBOOK_RENDER_VERSION = "pdfkit-0.19.1-buildy-1";

export type PhotobookRenderErrorCode =
  | "INVALID_DOCUMENT"
  | "DOCUMENT_CHECKSUM_MISMATCH"
  | "PROOF_BLOCKED"
  | "ASSET_MISSING"
  | "ASSET_CHECKSUM_MISMATCH"
  | "ASSET_CONTENT_TYPE_MISMATCH"
  | "ASSET_DIMENSION_MISMATCH"
  | "ASSET_DECODE_FAILED"
  | "PDF_RENDER_FAILED";

export class PhotobookRenderError extends Error {
  constructor(
    public readonly code: PhotobookRenderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PhotobookRenderError";
  }
}

export interface PhotobookOriginalAssetReader {
  readOriginal(asset: PhotobookSourceAsset): Promise<Uint8Array>;
}

export interface RenderedPhotobookProof {
  bytes: Buffer;
  pdfSha256: string;
  pdfSizeBytes: number;
  pageCount: number;
  documentSha256: string;
  assetSet: Array<{ id: string; sha256: string }>;
  assetSetSha256: string;
  renderEngine: typeof PHOTOBOOK_RENDER_ENGINE;
  renderVersion: typeof PHOTOBOOK_RENDER_VERSION;
  fontSetSha256: string;
}

function mm(value: number): number {
  return value * MM_TO_POINTS;
}

function color(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new PhotobookRenderError("INVALID_DOCUMENT", "Ongeldige printkleur.");
  return value;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function photobookFontSetChecksum(fonts: PhotobookFontBytes): string {
  const hash = createHash("sha256").update("buildy-photobook-font-set:v1\0");
  for (const [key, bytes] of Object.entries(fonts).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(key).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export function photobookAssetSetChecksum(assetSet: Array<{ id: string; sha256: string }>): string {
  const hash = createHash("sha256").update("buildy-photobook-asset-set:v1\0");
  for (const asset of assetSet) hash.update(asset.id).update("\0").update(asset.sha256).update("\0");
  return hash.digest("hex");
}

function cropRectangle(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  crop: PhotobookCrop,
): { left: number; top: number; width: number; height: number } | null {
  if (crop.fit === "contain") return null;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let width = sourceWidth;
  let height = sourceHeight;
  if (sourceRatio > targetRatio) width = sourceHeight * targetRatio;
  else height = sourceWidth / targetRatio;
  width = Math.max(1, Math.min(sourceWidth, Math.round(width / crop.zoom)));
  height = Math.max(1, Math.min(sourceHeight, Math.round(height / crop.zoom)));
  const left = Math.max(0, Math.min(sourceWidth - width, Math.round((sourceWidth - width) * crop.focusX)));
  const top = Math.max(0, Math.min(sourceHeight - height, Math.round((sourceHeight - height) * crop.focusY)));
  return { left, top, width, height };
}

async function renderPhoto(input: {
  asset: PhotobookSourceAsset;
  crop: PhotobookCrop;
  frameWidthMm: number;
  frameHeightMm: number;
  reader: PhotobookOriginalAssetReader;
  targetDpi: number;
}): Promise<Buffer> {
  let source: Uint8Array;
  try {
    source = await input.reader.readOriginal(input.asset);
  } catch (error) {
    throw new PhotobookRenderError("ASSET_MISSING", "Een originele printasset kon niet worden gelezen.", { cause: error });
  }
  if (source.byteLength < 1 || source.byteLength > MAX_SOURCE_BYTES) {
    throw new PhotobookRenderError("ASSET_MISSING", "Een originele printasset heeft een ongeldige grootte.");
  }
  if (digest(source) !== input.asset.sha256) {
    throw new PhotobookRenderError("ASSET_CHECKSUM_MISMATCH", "Een originele printasset wijkt af van de goedgekeurde assetset.");
  }
  try {
    if (detectImageContentType(source) !== input.asset.contentType) {
      throw new PhotobookRenderError(
        "ASSET_CONTENT_TYPE_MISMATCH",
        "Het beeldformaat van een originele printasset wijkt af van het assetmanifest.",
      );
    }
  } catch (error) {
    if (error instanceof PhotobookRenderError) throw error;
    throw new PhotobookRenderError(
      "ASSET_CONTENT_TYPE_MISMATCH",
      "Het beeldformaat van een originele printasset is ongeldig.",
      { cause: error },
    );
  }

  const targetWidth = Math.max(1, Math.round(input.frameWidthMm / 25.4 * input.targetDpi));
  const targetHeight = Math.max(1, Math.round(input.frameHeightMm / 25.4 * input.targetDpi));
  try {
    const metadata = await sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_SOURCE_PIXELS,
      sequentialRead: true,
    }).metadata();
    if (
      metadata.width !== input.asset.widthPixels
      || metadata.height !== input.asset.heightPixels
    ) {
      throw new PhotobookRenderError(
        "ASSET_DIMENSION_MISMATCH",
        "De afmetingen van een originele printasset wijken af van het assetmanifest.",
      );
    }

    let pipeline = sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_SOURCE_PIXELS,
      sequentialRead: true,
    });
    const rectangle = cropRectangle(
      input.asset.widthPixels,
      input.asset.heightPixels,
      targetWidth,
      targetHeight,
      input.crop,
    );
    if (rectangle) pipeline = pipeline.extract(rectangle);
    const rendered = await pipeline
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: rectangle ? "fill" : "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
      })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    if (rendered.byteLength < 1 || rendered.byteLength > MAX_RENDERED_IMAGE_BYTES) {
      throw new PhotobookRenderError("ASSET_DECODE_FAILED", "Een gerenderde printfoto heeft een onveilige grootte.");
    }
    return rendered;
  } catch (error) {
    if (error instanceof PhotobookRenderError) throw error;
    throw new PhotobookRenderError("ASSET_DECODE_FAILED", "Een originele printasset kon niet veilig worden gedecodeerd.", {
      cause: error,
    });
  }
}

function alignedX(
  document: PDFKit.PDFDocument,
  line: string,
  frameX: number,
  frameWidth: number,
  alignment: "left" | "center" | "right",
): number {
  if (alignment === "left") return frameX;
  const lineWidth = document.widthOfString(line);
  if (alignment === "center") return frameX + Math.max(0, (frameWidth - lineWidth) / 2);
  return frameX + Math.max(0, frameWidth - lineWidth);
}

async function collectPdf(document: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    document.once("error", reject);
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.end();
  });
}

export async function renderPhotobookPdf(input: {
  document: PhotobookDocument;
  assets: PhotobookOriginalAssetReader;
  fonts?: PhotobookFontBytes;
}): Promise<RenderedPhotobookProof> {
  const parsed = photobookDocumentSchema.safeParse(input.document);
  if (!parsed.success) {
    throw new PhotobookRenderError("INVALID_DOCUMENT", "Het canonical Bouwboekdocument is ongeldig.", {
      cause: parsed.error,
    });
  }
  const canonical = parsed.data;
  if (!verifyPhotobookDocumentChecksum(canonical)) {
    throw new PhotobookRenderError("DOCUMENT_CHECKSUM_MISMATCH", "Het canonical Bouwboekdocument is na vastlegging gewijzigd.");
  }
  if (canonical.warnings.some((warning) => warning.severity === "blocking")) {
    throw new PhotobookRenderError("PROOF_BLOCKED", "Het Bouwboek bevat blokkerende printwaarschuwingen.");
  }

  const fonts = input.fonts ?? await loadPhotobookFontBytes();
  const typography = new PdfKitPhotobookTypography(fonts);
  const pdf = new PDFDocument({
    autoFirstPage: false,
    bufferPages: false,
    compress: true,
    displayTitle: true,
    info: {
      Title: canonical.cover.title,
      Author: "Buildy",
      Subject: `Bouwboek ${canonical.checksumSha256}`,
      Creator: `${PHOTOBOOK_RENDER_ENGINE}/${PHOTOBOOK_RENDER_VERSION}`,
      Producer: "Buildy",
      CreationDate: FIXED_PDF_DATE,
      ModDate: FIXED_PDF_DATE,
    },
    lang: "nl-NL",
    margin: 0,
    pdfVersion: "1.7",
    size: [mm(canonical.print.widthMm), mm(canonical.print.heightMm)],
  });
  typography.register(pdf);

  try {
    const assetById = new Map(canonical.sourceAssets.map((asset) => [asset.id, asset]));
    for (const page of canonical.pages) {
      pdf.addPage({
        margin: 0,
        size: [mm(canonical.print.widthMm), mm(canonical.print.heightMm)],
      });
      pdf.rect(0, 0, mm(canonical.print.widthMm), mm(canonical.print.heightMm))
        .fill(color(page.background));

      for (const block of page.blocks.filter((candidate) => candidate.type === "photo")) {
        if (block.type !== "photo") continue;
        const asset = assetById.get(block.assetId);
        if (!asset) throw new PhotobookRenderError("ASSET_MISSING", "Een pagina verwijst naar een asset buiten het manifest.");
        const image = await renderPhoto({
          asset,
          crop: block.crop,
          frameWidthMm: block.frame.widthMm,
          frameHeightMm: block.frame.heightMm,
          reader: input.assets,
          targetDpi: canonical.print.targetDpi,
        });
        pdf.image(image, mm(block.frame.xMm), mm(block.frame.yMm), {
          width: mm(block.frame.widthMm),
          height: mm(block.frame.heightMm),
        });
      }

      if (page.overlay && page.overlay.opacity > 0) {
        pdf.save()
          .fillOpacity(page.overlay.opacity)
          .rect(0, 0, mm(canonical.print.widthMm), mm(canonical.print.heightMm))
          .fill(color(page.overlay.color))
          .restore();
      }

      for (const block of page.blocks.filter((candidate) => candidate.type === "text")) {
        if (block.type !== "text") continue;
        pdf.font(fontKeyFor({ font: block.font, style: block.style, weight: block.weight }))
          .fontSize(block.fontSizePt)
          .fillColor(color(block.color))
          .fillOpacity(1);
        const frameX = mm(block.frame.xMm);
        const frameWidth = mm(block.frame.widthMm);
        block.lines.forEach((line, lineIndex) => {
          const y = mm(block.frame.yMm) + lineIndex * block.lineHeightPt;
          pdf.text(line, alignedX(pdf, line, frameX, frameWidth, block.align), y, {
            lineBreak: false,
          });
        });
      }
    }

    const bytes = await collectPdf(pdf);
    if (
      bytes.byteLength < 8
      || bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
      || !bytes.subarray(Math.max(0, bytes.length - 1_024)).toString("ascii").includes("%%EOF")
    ) {
      throw new PhotobookRenderError("PDF_RENDER_FAILED", "De renderer produceerde geen volledige PDF.");
    }
    const assetSet = canonical.sourceAssets.map((asset) => ({ id: asset.id, sha256: asset.sha256 }));
    return {
      bytes,
      pdfSha256: digest(bytes),
      pdfSizeBytes: bytes.byteLength,
      pageCount: canonical.pageCount,
      documentSha256: canonical.checksumSha256,
      assetSet,
    assetSetSha256: photobookAssetSetChecksum(assetSet),
      renderEngine: PHOTOBOOK_RENDER_ENGINE,
      renderVersion: PHOTOBOOK_RENDER_VERSION,
    fontSetSha256: photobookFontSetChecksum(fonts),
    };
  } catch (error) {
    if (error instanceof PhotobookRenderError) throw error;
    throw new PhotobookRenderError("PDF_RENDER_FAILED", "De printproof kon niet deterministisch worden gerenderd.", {
      cause: error,
    });
  } finally {
    typography.close();
  }
}

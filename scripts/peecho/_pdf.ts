import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { PrintProductSpecification } from "../../server/print/printProvider";

const MAX_PDF_BYTES = 128 * 1024 * 1024;
const POINTS_TO_MILLIMETRES = 25.4 / 72;

export interface PdfInspection {
  filename: string;
  sizeBytes: number;
  sha256: string;
  version: string;
  pageCount: number;
  widthMm: number;
  heightMm: number;
  encrypted: false;
}

function roundedMillimetres(points: number): number {
  return Math.round(points * POINTS_TO_MILLIMETRES * 100) / 100;
}

export async function inspectPdf(pathValue: string): Promise<PdfInspection> {
  const path = resolve(pathValue);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 32 || stats.size > MAX_PDF_BYTES) {
    throw new Error("PDF moet een regulier, niet-gelinkt bestand tussen 32 bytes en 128 MiB zijn.");
  }
  const bytes = await readFile(path);
  const text = bytes.toString("latin1");
  const version = /^%PDF-(\d\.\d)/.exec(text.slice(0, 16))?.[1];
  if (!version || !text.slice(-2_048).includes("%%EOF")) {
    throw new Error("Bestand heeft geen volledige PDF-header en -trailer.");
  }
  if (/\/Encrypt\b/.test(text)) throw new Error("Versleutelde PDF-bestanden worden niet geaccepteerd.");
  if (/\/(?:JavaScript|JS|EmbeddedFile|Launch)\b/.test(text)) {
    throw new Error("PDF bevat actieve of ingesloten content en wordt geweigerd.");
  }
  if (/\/Rotate\s+(?:90|180|270)\b/.test(text)) {
    throw new Error("PDF gebruikt paginarotatie; render de pagina's in hun definitieve oriëntatie.");
  }

  const pageCount = [...text.matchAll(/\/Type\s*\/Page\b/g)].length;
  if (pageCount < 1 || pageCount > 10_000) {
    throw new Error("Paginatal kon niet betrouwbaar uit deze PDF worden bepaald.");
  }
  const mediaBoxes = [...text.matchAll(
    /\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/g,
  )].map((match) => {
    const x1 = Number(match[1]);
    const y1 = Number(match[2]);
    const x2 = Number(match[3]);
    const y2 = Number(match[4]);
    return {
      widthMm: roundedMillimetres(Math.abs(x2 - x1)),
      heightMm: roundedMillimetres(Math.abs(y2 - y1)),
    };
  });
  if (mediaBoxes.length < 1) {
    throw new Error("PDF bevat geen leesbare MediaBox met printafmetingen.");
  }
  const first = mediaBoxes[0];
  if (!first || first.widthMm <= 0 || first.heightMm <= 0) {
    throw new Error("PDF bevat ongeldige printafmetingen.");
  }
  if (mediaBoxes.some((box) => (
    Math.abs(box.widthMm - first.widthMm) > 0.05
    || Math.abs(box.heightMm - first.heightMm) > 0.05
  ))) {
    throw new Error("PDF bevat verschillende paginaformaten en wordt fail-closed geweigerd.");
  }

  return {
    filename: basename(path),
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    version,
    pageCount,
    widthMm: first.widthMm,
    heightMm: first.heightMm,
    encrypted: false,
  };
}

export function validatePdfForOffering(input: {
  pdf: PdfInspection;
  offering: PrintProductSpecification;
  requireEvenPages?: boolean;
  dimensionToleranceMm?: number;
}): void {
  const tolerance = input.dimensionToleranceMm ?? 1;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10) {
    throw new Error("Afmetingstolerantie moet tussen 0 en 10 mm liggen.");
  }
  if (
    input.pdf.pageCount < input.offering.minimumPageCount
    || input.pdf.pageCount > input.offering.maximumPageCount
  ) {
    throw new Error(
      `PDF-paginatal valt buiten ${input.offering.minimumPageCount}-${input.offering.maximumPageCount}.`,
    );
  }
  if ((input.requireEvenPages ?? true) && input.pdf.pageCount % 2 !== 0) {
    throw new Error("PDF voor het Bouwboek moet een even paginatal hebben.");
  }

  if (input.offering.dynamicSize) {
    const minimumWidth = input.offering.minimumWidthMm ?? input.offering.widthMm;
    const minimumHeight = input.offering.minimumHeightMm ?? input.offering.heightMm;
    if (
      input.pdf.widthMm + tolerance < minimumWidth
      || input.pdf.heightMm + tolerance < minimumHeight
      || input.pdf.widthMm - tolerance > input.offering.widthMm
      || input.pdf.heightMm - tolerance > input.offering.heightMm
    ) {
      throw new Error("Dynamisch PDF-formaat valt buiten de offeringgrenzen.");
    }
    return;
  }

  if (
    Math.abs(input.pdf.widthMm - input.offering.widthMm) > tolerance
    || Math.abs(input.pdf.heightMm - input.offering.heightMm) > tolerance
  ) {
    throw new Error(
      `PDF-formaat ${input.pdf.widthMm}×${input.pdf.heightMm} mm wijkt af van ${input.offering.widthMm}×${input.offering.heightMm} mm.`,
    );
  }
}

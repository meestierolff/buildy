import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import type { PhotobookTextMeasurer } from "./document.js";

const FONT_URLS = {
  "inter-regular": new URL(
    "../../node_modules/@fontsource/inter/files/inter-latin-ext-400-normal.woff2",
    import.meta.url,
  ),
  "inter-regular-italic": new URL(
    "../../node_modules/@fontsource/inter/files/inter-latin-ext-400-italic.woff2",
    import.meta.url,
  ),
  "inter-semibold": new URL(
    "../../node_modules/@fontsource/inter/files/inter-latin-ext-600-normal.woff2",
    import.meta.url,
  ),
  "inter-semibold-italic": new URL(
    "../../node_modules/@fontsource/inter/files/inter-latin-ext-600-italic.woff2",
    import.meta.url,
  ),
  "instrument-serif-regular": new URL(
    "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-normal.woff2",
    import.meta.url,
  ),
  "instrument-serif-regular-italic": new URL(
    "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-ext-400-italic.woff2",
    import.meta.url,
  ),
} as const;

export type PhotobookFontKey = keyof typeof FONT_URLS;
export type PhotobookFontBytes = Readonly<Record<PhotobookFontKey, Buffer>>;

export async function loadPhotobookFontBytes(): Promise<PhotobookFontBytes> {
  const entries = await Promise.all(
    Object.entries(FONT_URLS).map(async ([key, url]) => [key, await readFile(url)] as const),
  );
  return Object.freeze(Object.fromEntries(entries)) as PhotobookFontBytes;
}

export function fontKeyFor(input: {
  font: "inter" | "instrument-serif";
  style: "normal" | "italic";
  weight: "regular" | "semibold";
}): PhotobookFontKey {
  if (input.font === "instrument-serif") {
    return input.style === "italic"
      ? "instrument-serif-regular-italic"
      : "instrument-serif-regular";
  }
  if (input.weight === "semibold") {
    return input.style === "italic" ? "inter-semibold-italic" : "inter-semibold";
  }
  return input.style === "italic" ? "inter-regular-italic" : "inter-regular";
}

export function registerPhotobookFonts(
  document: PDFKit.PDFDocument,
  fonts: PhotobookFontBytes,
): void {
  for (const [key, bytes] of Object.entries(fonts)) document.registerFont(key, bytes);
}

function splitLongToken(
  document: PDFKit.PDFDocument,
  token: string,
  maximumWidthPoints: number,
): string[] {
  const parts: string[] = [];
  let current = "";
  for (const character of Array.from(token)) {
    if (current && document.widthOfString(`${current}${character}`) > maximumWidthPoints) {
      parts.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Uses the exact embedded PDF fonts for line breaking. The resulting lines are
 * persisted in the canonical document and reused by both proof and preview.
 */
export class PdfKitPhotobookTypography implements PhotobookTextMeasurer {
  private readonly metricsDocument: PDFKit.PDFDocument;

  constructor(private readonly fonts: PhotobookFontBytes) {
    this.metricsDocument = new PDFDocument({ autoFirstPage: false, compress: false });
    registerPhotobookFonts(this.metricsDocument, fonts);
  }

  register(document: PDFKit.PDFDocument): void {
    registerPhotobookFonts(document, this.fonts);
  }

  wrap(input: Parameters<PhotobookTextMeasurer["wrap"]>[0]): string[] {
    const maximumWidthPoints = input.maxWidthMm * 72 / 25.4;
    this.metricsDocument
      .font(fontKeyFor({
        font: input.font,
        style: input.fontStyle,
        weight: input.fontWeight,
      }))
      .fontSize(input.fontSizePt);

    const lines: string[] = [];
    for (const paragraph of input.text.replace(/\r\n?/g, "\n").split("\n")) {
      if (!paragraph.trim()) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const rawToken of paragraph.trim().split(/\s+/)) {
        const tokenParts = this.metricsDocument.widthOfString(rawToken) > maximumWidthPoints
          ? splitLongToken(this.metricsDocument, rawToken, maximumWidthPoints)
          : [rawToken];
        for (const token of tokenParts) {
          const candidate = current ? `${current} ${token}` : token;
          if (current && this.metricsDocument.widthOfString(candidate) > maximumWidthPoints) {
            lines.push(current);
            current = token;
          } else {
            current = candidate;
          }
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  close(): void {
    this.metricsDocument.end();
  }
}

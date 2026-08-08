import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PrintProductSpecification } from "../../server/print/printProvider";
import { inspectPdf, validatePdfForOffering } from "../../scripts/peecho/_pdf";

const temporaryDirectories: string[] = [];

const offering: PrintProductSpecification = {
  id: "233309",
  name: "A4 landscape hardcover",
  categoryCode: "BO",
  subcategoryCode: "HC",
  paperType: "Matte",
  catalogueItemCode: "AB-hc-M-l",
  minimumQuantity: 1,
  minimumPageCount: 24,
  maximumPageCount: 300,
  widthMm: 297,
  heightMm: 210,
  dynamicSize: false,
  minimumWidthMm: 210,
  minimumHeightMm: 148,
  basePrice: { currency: "EUR", amountMinor: 596 },
  pricePerPage: { currency: "EUR", amountMinor: 4 },
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function pdfPath(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "buildy-peecho-pdf-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "proof.pdf");
  await writeFile(path, contents, "latin1");
  return path;
}

describe("Peecho PDF validation script", () => {
  it("inspects page count, dimensions and a content hash without exposing the path", async () => {
    const path = await pdfPath(`%PDF-1.7
1 0 obj
<< /Type /Page /MediaBox [0 0 841.89 595.28] >>
endobj
%%EOF`);

    const inspection = await inspectPdf(path);

    expect(inspection).toMatchObject({
      filename: "proof.pdf",
      version: "1.7",
      pageCount: 1,
      widthMm: 297,
      heightMm: 210,
      encrypted: false,
    });
    expect(inspection.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(inspection)).not.toContain(path);
  });

  it("fails closed on encrypted or active PDF content", async () => {
    const encrypted = await pdfPath(`%PDF-1.7
1 0 obj
<< /Type /Page /MediaBox [0 0 841.89 595.28] /Encrypt 2 0 R >>
endobj
%%EOF`);

    await expect(inspectPdf(encrypted)).rejects.toThrow(/Versleutelde PDF/i);
  });

  it("enforces offering dimensions, page bounds and even pages", () => {
    const validInspection = {
      filename: "proof.pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
      version: "1.7",
      pageCount: 24,
      widthMm: 297,
      heightMm: 210,
      encrypted: false as const,
    };

    expect(() => validatePdfForOffering({ pdf: validInspection, offering })).not.toThrow();
    expect(() => validatePdfForOffering({
      pdf: { ...validInspection, pageCount: 25 },
      offering,
    })).toThrow(/even paginatal/i);
    expect(() => validatePdfForOffering({
      pdf: { ...validInspection, widthMm: 210, heightMm: 297 },
      offering,
    })).toThrow(/wijkt af/i);
  });
});

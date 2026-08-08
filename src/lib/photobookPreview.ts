import type {
  PhotobookCrop,
  PhotobookDocument,
  PhotobookSourceAsset,
} from "../../shared/contracts/photobooks";
import type { PhotobookDraft } from "./photobookApi";

export type PhotobookFrame = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

export function framePercentStyle(
  frame: PhotobookFrame,
  page: { widthMm: number; heightMm: number },
) {
  return {
    left: `${frame.xMm / page.widthMm * 100}%`,
    top: `${frame.yMm / page.heightMm * 100}%`,
    width: `${frame.widthMm / page.widthMm * 100}%`,
    height: `${frame.heightMm / page.heightMm * 100}%`,
  } as const;
}

export function pointsAsContainerWidth(points: number, pageWidthMm: number): string {
  return `${points * 25.4 / 72 / pageWidthMm * 100}cqw`;
}

export function coverCropImageStyle(
  asset: Pick<PhotobookSourceAsset, "widthPixels" | "heightPixels">,
  frame: Pick<PhotobookFrame, "widthMm" | "heightMm">,
  crop: PhotobookCrop,
) {
  if (crop.fit === "contain") {
    return {
      left: "0%",
      top: "0%",
      width: "100%",
      height: "100%",
      objectFit: "contain" as const,
    };
  }

  const sourceRatio = asset.widthPixels / asset.heightPixels;
  const frameRatio = frame.widthMm / frame.heightMm;
  let cropWidth = asset.widthPixels;
  let cropHeight = asset.heightPixels;
  if (sourceRatio > frameRatio) cropWidth = asset.heightPixels * frameRatio;
  else cropHeight = asset.widthPixels / frameRatio;
  cropWidth = Math.max(1, Math.min(asset.widthPixels, Math.round(cropWidth / crop.zoom)));
  cropHeight = Math.max(1, Math.min(asset.heightPixels, Math.round(cropHeight / crop.zoom)));
  const cropLeft = Math.max(0, Math.min(
    asset.widthPixels - cropWidth,
    Math.round((asset.widthPixels - cropWidth) * crop.focusX),
  ));
  const cropTop = Math.max(0, Math.min(
    asset.heightPixels - cropHeight,
    Math.round((asset.heightPixels - cropHeight) * crop.focusY),
  ));

  return {
    left: `${-cropLeft / cropWidth * 100}%`,
    top: `${-cropTop / cropHeight * 100}%`,
    width: `${asset.widthPixels / cropWidth * 100}%`,
    height: `${asset.heightPixels / cropHeight * 100}%`,
    objectFit: "fill" as const,
  };
}

export function normalizedPageIndex(index: number, pageCount: number, spread: boolean): number {
  if (pageCount < 1) return 0;
  const clamped = Math.max(0, Math.min(pageCount - 1, Math.trunc(index)));
  if (!spread || clamped === 0) return clamped;

  // The cover stands on its own. Printed spreads then pair pages 2–3, 4–5,
  // and so on; pairing pages 1–2 would mirror neither a bound book nor the PDF.
  return clamped % 2 === 1 ? clamped : clamped - 1;
}

export function hasExactPhotobookProof(
  proof: PhotobookDraft["proof"],
  document: Pick<PhotobookDocument, "pageCount">,
): boolean {
  return Boolean(
    proof &&
    ["ready", "approved", "locked"].includes(proof.status) &&
    proof.pdfSha256 &&
    proof.pdfPath &&
    proof.pageCount === document.pageCount,
  );
}

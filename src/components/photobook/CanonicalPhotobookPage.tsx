import { useMemo } from "react";
import type {
  PhotobookDocument,
  PhotobookPage,
} from "../../../shared/contracts/photobooks";
import { photobookMediaProxyPath } from "@/lib/photobookApi";
import {
  coverCropImageStyle,
  framePercentStyle,
  pointsAsContainerWidth,
} from "@/lib/photobookPreview";

interface CanonicalPhotobookPageProps {
  decorative?: boolean;
  document: PhotobookDocument;
  imageSize?: "small" | "medium" | "large";
  page: PhotobookPage;
}

export const CanonicalPhotobookPage = ({
  decorative = false,
  document,
  imageSize = "large",
  page,
}: CanonicalPhotobookPageProps) => {
  const assetById = useMemo(
    () => new Map(document.sourceAssets.map((asset) => [asset.id, asset])),
    [document.sourceAssets],
  );
  const photos = page.blocks.filter((block) => block.type === "photo");
  const textBlocks = page.blocks.filter((block) => block.type === "text");
  const pageSize = {
    widthMm: document.print.widthMm ?? 297,
    heightMm: document.print.heightMm ?? 210,
  };

  return (
    <figure
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Canonical Bouwboekpagina ${page.number}`}
      className="relative m-0 w-full overflow-hidden bg-white text-black"
      data-page-number={page.number}
      role={decorative ? "presentation" : undefined}
      style={{
        aspectRatio: `${pageSize.widthMm} / ${pageSize.heightMm}`,
        backgroundColor: page.background,
        containerType: "inline-size",
      }}
    >
      {photos.map((block) => {
        if (block.type !== "photo") return null;
        const asset = assetById.get(block.assetId);
        if (!asset) return null;
        const frame = {
          xMm: block.frame.xMm ?? 0,
          yMm: block.frame.yMm ?? 0,
          widthMm: block.frame.widthMm ?? 1,
          heightMm: block.frame.heightMm ?? 1,
        };
        const imageStyle = coverCropImageStyle(asset, frame, block.crop);
        return (
          <div
            className="absolute overflow-hidden bg-white"
            key={block.id}
            style={{ ...framePercentStyle(frame, pageSize), zIndex: 10 }}
          >
            <img
              alt={decorative ? "" : block.altText}
              className="absolute max-w-none select-none"
              draggable={false}
              height={asset.heightPixels}
              loading={imageSize === "large" ? "eager" : "lazy"}
              src={photobookMediaProxyPath(block.assetId, imageSize)}
              style={imageStyle}
              width={asset.widthPixels}
            />
          </div>
        );
      })}

      {page.overlay && page.overlay.opacity > 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundColor: page.overlay.color,
            opacity: page.overlay.opacity,
            zIndex: 20,
          }}
        />
      )}

      {textBlocks.map((block) => {
        if (block.type !== "text") return null;
        const instrument = block.font === "instrument-serif";
        const frame = {
          xMm: block.frame.xMm ?? 0,
          yMm: block.frame.yMm ?? 0,
          widthMm: block.frame.widthMm ?? 1,
          heightMm: block.frame.heightMm ?? 1,
        };
        return (
          <div
            className="absolute overflow-hidden"
            key={block.id}
            style={{
              ...framePercentStyle(frame, pageSize),
              color: block.color,
              fontFamily: instrument
                ? '"Buildy Proof Instrument Serif", "Instrument Serif", Georgia, serif'
                : '"Buildy Proof Inter", Inter, system-ui, sans-serif',
              fontSize: pointsAsContainerWidth(block.fontSizePt, pageSize.widthMm),
              fontStyle: block.style,
              fontSynthesis: "none",
              fontWeight: instrument ? 400 : block.weight === "semibold" ? 600 : 400,
              lineHeight: block.lineHeightPt / block.fontSizePt,
              textAlign: block.align,
              zIndex: 30,
            }}
          >
            {block.lines.map((line, index) => (
              <span className="block whitespace-pre" key={`${block.id}:line:${index}`}>
                {line || "\u00a0"}
              </span>
            ))}
          </div>
        );
      })}
    </figure>
  );
};

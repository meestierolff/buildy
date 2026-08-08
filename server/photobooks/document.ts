import { createHash } from "node:crypto";
import {
  LAUNCH_PHOTOBOOK_FORMAT,
  LAUNCH_PHOTOBOOK_MIN_PAGES,
  photobookDocumentSchema,
  type PhotobookCrop,
  type PhotobookDocument,
  type PhotobookPage,
  type PhotobookSourceAsset,
  type PhotobookWarning,
} from "../../shared/contracts/photobooks.js";
import { canonicalJson } from "../security/canonicalJson.js";

const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;
const SAFE_MARGIN_MM = 12;
const PHOTO_GAP_MM = 4;
const LOW_DPI_THRESHOLD = 200;
const EXTREME_CROP_VISIBLE_FRACTION = 0.45;
const MM_PER_INCH = 25.4;
const POINTS_PER_MM = 72 / MM_PER_INCH;

export type PhotobookLayout = "auto" | "one" | "two" | "three" | "grid";

export interface PhotobookTextMeasurer {
  /** Returns exact lines for the embedded font used by the proof renderer. */
  wrap(input: {
    font: "inter" | "instrument-serif";
    fontSizePt: number;
    fontStyle: "normal" | "italic";
    fontWeight: "regular" | "semibold";
    maxWidthMm: number;
    text: string;
  }): string[];
}

export interface PhotobookMediaSource {
  id: string;
  sha256: string | null;
  contentType: string | null;
  widthPixels: number | null;
  heightPixels: number | null;
  sortOrder: number;
  altText?: string | null;
}

export interface PhotobookUpdateSource {
  id: string;
  updateDate: string;
  title: string | null;
  room: string | null;
  description: string | null;
  phaseId: string | null;
  phaseName: string | null;
  phaseSortOrder: number | null;
  media: PhotobookMediaSource[];
}

export interface BuildPhotobookDocumentInput {
  projectId: string;
  projectRevision: number;
  projectTitle: string;
  projectSubtitle?: string | null;
  coverMediaAssetId?: string | null;
  coverCrop?: PhotobookCrop | null;
  updates: PhotobookUpdateSource[];
  excludedUpdateIds?: ReadonlySet<string>;
  excludedMediaAssetIds?: ReadonlySet<string>;
  excludedChapterKeys?: ReadonlySet<string>;
  photoOrderByUpdate?: Readonly<Record<string, readonly string[]>>;
  layoutByPage?: Readonly<Record<string, PhotobookLayout>>;
  cropByAsset?: Readonly<Record<string, PhotobookCrop>>;
  maximumPages: number;
  measurer: PhotobookTextMeasurer;
}

type Frame = { xMm: number; yMm: number; widthMm: number; heightMm: number };
type ValidMedia = PhotobookMediaSource & PhotobookSourceAsset;

function documentBody(document: PhotobookDocument): Omit<PhotobookDocument, "checksumSha256"> {
  const { checksumSha256: _checksum, ...body } = document;
  return body;
}

export function photobookDocumentChecksum(
  document: Omit<PhotobookDocument, "checksumSha256">,
): string {
  return createHash("sha256")
    .update("buildy-photobook-document:v1\0")
    .update(canonicalJson(document))
    .digest("hex");
}

export function verifyPhotobookDocumentChecksum(document: PhotobookDocument): boolean {
  const parsed = photobookDocumentSchema.safeParse(document);
  return parsed.success
    && photobookDocumentChecksum(documentBody(parsed.data)) === parsed.data.checksumSha256;
}

function defaultCrop(): PhotobookCrop {
  return { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 1 };
}

function mediaValidationWarning(media: PhotobookMediaSource, updateId: string | null): PhotobookWarning | null {
  const validContentType = ["image/jpeg", "image/png", "image/webp", "image/avif"]
    .includes(media.contentType ?? "");
  if (!media.sha256 || !/^[0-9a-f]{64}$/.test(media.sha256)) {
    return {
      code: "MISSING_ASSET",
      severity: "blocking",
      pageNumber: null,
      assetId: media.id,
      updateId,
      message: "Een bronfoto ontbreekt of heeft nog geen geverifieerde checksum.",
    };
  }
  if (
    !validContentType
    || !Number.isSafeInteger(media.widthPixels)
    || (media.widthPixels ?? 0) <= 0
    || !Number.isSafeInteger(media.heightPixels)
    || (media.heightPixels ?? 0) <= 0
  ) {
    return {
      code: "INVALID_IMAGE_METADATA",
      severity: "blocking",
      pageNumber: null,
      assetId: media.id,
      updateId,
      message: "Een bronfoto heeft geen geldige afmetingen of een niet-ondersteund beeldformaat.",
    };
  }
  return null;
}

function asValidMedia(media: PhotobookMediaSource): ValidMedia {
  return {
    ...media,
    sha256: media.sha256!,
    contentType: media.contentType as ValidMedia["contentType"],
    widthPixels: media.widthPixels!,
    heightPixels: media.heightPixels!,
  };
}

function asSourceAsset(media: ValidMedia): PhotobookSourceAsset {
  return {
    id: media.id,
    sha256: media.sha256,
    contentType: media.contentType,
    widthPixels: media.widthPixels,
    heightPixels: media.heightPixels,
  };
}

function cropFacts(asset: ValidMedia, frame: Frame, crop: PhotobookCrop): {
  effectiveDpi: number;
  visibleFraction: number;
} {
  const sourceRatio = asset.widthPixels / asset.heightPixels;
  const frameRatio = frame.widthMm / frame.heightMm;
  let renderedWidthMm = frame.widthMm;
  let renderedHeightMm = frame.heightMm;
  let visibleWidthPixels = asset.widthPixels;
  let visibleHeightPixels = asset.heightPixels;

  if (crop.fit === "contain") {
    if (sourceRatio > frameRatio) renderedHeightMm = frame.widthMm / sourceRatio;
    else renderedWidthMm = frame.heightMm * sourceRatio;
  } else if (sourceRatio > frameRatio) {
    visibleWidthPixels = asset.heightPixels * frameRatio;
  } else {
    visibleHeightPixels = asset.widthPixels / frameRatio;
  }

  visibleWidthPixels /= crop.zoom;
  visibleHeightPixels /= crop.zoom;
  const horizontalDpi = visibleWidthPixels / (renderedWidthMm / MM_PER_INCH);
  const verticalDpi = visibleHeightPixels / (renderedHeightMm / MM_PER_INCH);
  return {
    effectiveDpi: Math.round(Math.min(horizontalDpi, verticalDpi)),
    visibleFraction: Math.min(1, (visibleWidthPixels * visibleHeightPixels) /
      (asset.widthPixels * asset.heightPixels)),
  };
}

function warningForPhoto(
  asset: ValidMedia,
  crop: PhotobookCrop,
  pageNumber: number,
  updateId: string | null,
  facts: ReturnType<typeof cropFacts>,
): PhotobookWarning[] {
  const warnings: PhotobookWarning[] = [];
  if (facts.effectiveDpi < LOW_DPI_THRESHOLD) {
    warnings.push({
      code: "LOW_EFFECTIVE_DPI",
      severity: "warning",
      pageNumber,
      assetId: asset.id,
      updateId,
      message: `Deze foto komt op circa ${facts.effectiveDpi} DPI uit; 300 DPI is het printdoel.`,
    });
  }
  if (crop.fit === "cover" && facts.visibleFraction < EXTREME_CROP_VISIBLE_FRACTION) {
    warnings.push({
      code: "EXTREME_CROP",
      severity: "warning",
      pageNumber,
      assetId: asset.id,
      updateId,
      message: "Door deze uitsnede blijft minder dan 45% van de bronfoto zichtbaar.",
    });
  }
  return warnings;
}

function photoFrames(layout: PhotobookLayout, count: number): Frame[] {
  const width = PAGE_WIDTH_MM - SAFE_MARGIN_MM * 2;
  const height = PAGE_HEIGHT_MM - SAFE_MARGIN_MM * 2;
  const resolved = layout === "auto"
    ? count === 1 ? "one" : count === 2 ? "two" : count === 3 ? "three" : "grid"
    : layout;

  if (resolved === "one" || count === 1) {
    return [{ xMm: SAFE_MARGIN_MM, yMm: SAFE_MARGIN_MM, widthMm: width, heightMm: height }];
  }
  if (resolved === "two" || count === 2) {
    const cellWidth = (width - PHOTO_GAP_MM) / 2;
    return [0, 1].map((index) => ({
      xMm: SAFE_MARGIN_MM + index * (cellWidth + PHOTO_GAP_MM),
      yMm: SAFE_MARGIN_MM,
      widthMm: cellWidth,
      heightMm: height,
    }));
  }
  if (resolved === "three" || count === 3) {
    const largeWidth = (width - PHOTO_GAP_MM) * 0.62;
    const smallWidth = width - PHOTO_GAP_MM - largeWidth;
    const smallHeight = (height - PHOTO_GAP_MM) / 2;
    return [
      { xMm: SAFE_MARGIN_MM, yMm: SAFE_MARGIN_MM, widthMm: largeWidth, heightMm: height },
      { xMm: SAFE_MARGIN_MM + largeWidth + PHOTO_GAP_MM, yMm: SAFE_MARGIN_MM, widthMm: smallWidth, heightMm: smallHeight },
      { xMm: SAFE_MARGIN_MM + largeWidth + PHOTO_GAP_MM, yMm: SAFE_MARGIN_MM + smallHeight + PHOTO_GAP_MM, widthMm: smallWidth, heightMm: smallHeight },
    ];
  }
  const cellWidth = (width - PHOTO_GAP_MM) / 2;
  const cellHeight = (height - PHOTO_GAP_MM) / 2;
  return [0, 1, 2, 3].map((index) => ({
    xMm: SAFE_MARGIN_MM + (index % 2) * (cellWidth + PHOTO_GAP_MM),
    yMm: SAFE_MARGIN_MM + Math.floor(index / 2) * (cellHeight + PHOTO_GAP_MM),
    widthMm: cellWidth,
    heightMm: cellHeight,
  }));
}

function layoutBatchSize(layout: PhotobookLayout, remaining: number): number {
  if (layout === "one") return 1;
  if (layout === "two") return Math.min(2, remaining);
  if (layout === "three") return Math.min(3, remaining);
  return Math.min(4, remaining);
}

function orderedMedia(
  update: PhotobookUpdateSource,
  customOrder: readonly string[] | undefined,
): PhotobookMediaSource[] {
  const order = new Map((customOrder ?? []).map((id, index) => [id, index]));
  return [...update.media].sort((left, right) => {
    const leftCustom = order.get(left.id);
    const rightCustom = order.get(right.id);
    if (leftCustom !== undefined || rightCustom !== undefined) {
      return (leftCustom ?? Number.MAX_SAFE_INTEGER) - (rightCustom ?? Number.MAX_SAFE_INTEGER);
    }
    return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
  });
}

function localizedDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function lineCapacity(heightMm: number, lineHeightPt: number): number {
  return Math.max(1, Math.floor(heightMm / (lineHeightPt / POINTS_PER_MM)));
}

function textBlock(input: {
  id: string;
  frame: Frame;
  text: string;
  lines: string[];
  font: "inter" | "instrument-serif";
  weight: "regular" | "semibold";
  style?: "normal" | "italic";
  fontSizePt: number;
  lineHeightPt: number;
  align?: "left" | "center" | "right";
  color: string;
}) {
  return {
    id: input.id,
    type: "text" as const,
    frame: input.frame,
    font: input.font,
    weight: input.weight,
    style: input.style ?? "normal",
    fontSizePt: input.fontSizePt,
    lineHeightPt: input.lineHeightPt,
    align: input.align ?? "left",
    color: input.color,
    text: input.text,
    lines: input.lines,
  };
}

export function buildPhotobookDocument(input: BuildPhotobookDocumentInput): PhotobookDocument {
  if (!Number.isSafeInteger(input.maximumPages) || input.maximumPages < LAUNCH_PHOTOBOOK_MIN_PAGES || input.maximumPages > 400) {
    throw new RangeError("maximumPages moet tussen 24 en 400 liggen.");
  }

  const pages: PhotobookPage[] = [];
  const warnings: PhotobookWarning[] = [];
  const sourceAssets = new Map<string, PhotobookSourceAsset>();
  const excludedUpdates = input.excludedUpdateIds ?? new Set<string>();
  const excludedMedia = input.excludedMediaAssetIds ?? new Set<string>();
  const excludedChapters = input.excludedChapterKeys ?? new Set<string>();
  const validMediaById = new Map<string, ValidMedia>();

  for (const update of input.updates) {
    for (const media of update.media) {
      if (excludedMedia.has(media.id)) continue;
      const warning = mediaValidationWarning(media, update.id);
      if (warning) {
        warnings.push(warning);
        continue;
      }
      const valid = asValidMedia(media);
      const existing = validMediaById.get(valid.id);
      if (existing && existing.sha256 !== valid.sha256) {
        warnings.push({
          code: "INVALID_IMAGE_METADATA",
          severity: "blocking",
          pageNumber: null,
          assetId: valid.id,
          updateId: update.id,
          message: "Dezelfde asset-ID verwijst naar verschillende bronbytes.",
        });
        continue;
      }
      validMediaById.set(valid.id, valid);
    }
  }

  const visibleUpdates = input.updates
    .filter((update) => !excludedUpdates.has(update.id))
    .sort((left, right) => left.updateDate.localeCompare(right.updateDate) || left.id.localeCompare(right.id));
  const requestedCover = input.coverMediaAssetId
    ? validMediaById.get(input.coverMediaAssetId)
    : undefined;
  const coverAsset = requestedCover
    ?? visibleUpdates.flatMap((update) => orderedMedia(update, input.photoOrderByUpdate?.[update.id]))
      .map((media) => validMediaById.get(media.id))
      .find((media): media is ValidMedia => Boolean(media));
  if (input.coverMediaAssetId && !requestedCover) {
    warnings.push({
      code: "MISSING_ASSET",
      severity: "blocking",
      pageNumber: null,
      assetId: input.coverMediaAssetId,
      updateId: null,
      message: "De gekozen coverfoto is niet compleet of niet langer beschikbaar.",
    });
  }

  const coverCrop = coverAsset ? input.coverCrop ?? input.cropByAsset?.[coverAsset.id] ?? defaultCrop() : null;
  const coverBlocks: PhotobookPage["blocks"] = [];
  if (coverAsset && coverCrop) {
    const frame = { xMm: 0, yMm: 0, widthMm: PAGE_WIDTH_MM, heightMm: PAGE_HEIGHT_MM };
    const facts = cropFacts(coverAsset, frame, coverCrop);
    coverBlocks.push({
      id: "cover-photo",
      type: "photo",
      frame,
      assetId: coverAsset.id,
      crop: coverCrop,
      effectiveDpi: facts.effectiveDpi,
      altText: coverAsset.altText?.trim() || "Coverfoto van het verbouwingsproject",
    });
    warnings.push(...warningForPhoto(coverAsset, coverCrop, 1, null, facts));
    sourceAssets.set(coverAsset.id, asSourceAsset(coverAsset));
  }
  const coverTitleLines = input.measurer.wrap({
    font: "instrument-serif",
    fontSizePt: 36,
    fontStyle: "normal",
    fontWeight: "semibold",
    maxWidthMm: 245,
    text: input.projectTitle,
  });
  if (coverTitleLines.length > 3) {
    warnings.push({
      code: "TEXT_OVERFLOW",
      severity: "blocking",
      pageNumber: 1,
      assetId: null,
      updateId: null,
      message: "De covertitel past niet binnen drie regels.",
    });
  }
  coverBlocks.push(textBlock({
    id: "cover-title",
    frame: { xMm: 26, yMm: 126, widthMm: 245, heightMm: 42 },
    text: input.projectTitle,
    lines: coverTitleLines.slice(0, 3),
    font: "instrument-serif",
    weight: "semibold",
    fontSizePt: 36,
    lineHeightPt: 38,
    align: "center",
    color: "#ffffff",
  }));
  const subtitle = input.projectSubtitle?.trim() ?? "";
  if (subtitle) {
    const subtitleLines = input.measurer.wrap({
      font: "inter",
      fontSizePt: 11,
      fontStyle: "normal",
      fontWeight: "regular",
      maxWidthMm: 220,
      text: subtitle,
    });
    if (subtitleLines.length > 2) warnings.push({
      code: "TEXT_OVERFLOW",
      severity: "blocking",
      pageNumber: 1,
      assetId: null,
      updateId: null,
      message: "De coverondertitel past niet binnen twee regels.",
    });
    coverBlocks.push(textBlock({
      id: "cover-subtitle",
      frame: { xMm: 38.5, yMm: 172, widthMm: 220, heightMm: 14 },
      text: subtitle,
      lines: subtitleLines.slice(0, 2),
      font: "inter",
      weight: "regular",
      fontSizePt: 11,
      lineHeightPt: 14,
      align: "center",
      color: "#ffffff",
    }));
  }
  pages.push({
    id: "cover",
    number: 1,
    kind: "cover",
    chapterId: null,
    updateId: null,
    background: coverAsset ? "#111111" : "#142238",
    overlay: coverAsset ? { color: "#000000", opacity: 0.45 } : null,
    blocks: coverBlocks,
  });

  const chapterGroups = new Map<string, {
    id: string;
    key: string;
    title: string;
    order: number;
    updates: PhotobookUpdateSource[];
  }>();
  for (const update of visibleUpdates) {
    const key = update.phaseId ?? "other";
    if (excludedChapters.has(key)) continue;
    const existing = chapterGroups.get(key);
    if (existing) existing.updates.push(update);
    else chapterGroups.set(key, {
      id: `chapter:${key}`,
      key,
      title: update.phaseName?.trim() || "Overige updates",
      order: update.phaseSortOrder ?? Number.MAX_SAFE_INTEGER,
      updates: [update],
    });
  }

  const chapters: PhotobookDocument["chapters"] = [];
  const sortedChapters = [...chapterGroups.values()]
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "nl-NL") || left.key.localeCompare(right.key));
  for (const chapter of sortedChapters) {
    const chapterPageNumber = pages.length + 1;
    const chapterLines = input.measurer.wrap({
      font: "instrument-serif",
      fontSizePt: 40,
      fontStyle: "normal",
      fontWeight: "semibold",
      maxWidthMm: 235,
      text: chapter.title,
    });
    if (chapterLines.length > 2) warnings.push({
      code: "TEXT_OVERFLOW",
      severity: "blocking",
      pageNumber: chapterPageNumber,
      assetId: null,
      updateId: null,
      message: `De hoofdstuktitel ‘${chapter.title}’ past niet binnen twee regels.`,
    });
    pages.push({
      id: `${chapter.id}:divider`,
      number: chapterPageNumber,
      kind: "chapter",
      chapterId: chapter.id,
      updateId: null,
      background: "#f5f1e8",
      overlay: null,
      blocks: [
        textBlock({
          id: `${chapter.id}:eyebrow`,
          frame: { xMm: 31, yMm: 78, widthMm: 235, heightMm: 8 },
          text: "HOOFDSTUK",
          lines: ["HOOFDSTUK"],
          font: "inter",
          weight: "semibold",
          fontSizePt: 9,
          lineHeightPt: 11,
          align: "center",
          color: "#b45a32",
        }),
        textBlock({
          id: `${chapter.id}:title`,
          frame: { xMm: 31, yMm: 91, widthMm: 235, heightMm: 36 },
          text: chapter.title,
          lines: chapterLines.slice(0, 2),
          font: "instrument-serif",
          weight: "semibold",
          fontSizePt: 40,
          lineHeightPt: 42,
          align: "center",
          color: "#1e1e1e",
        }),
      ],
    });
    chapters.push({
      id: chapter.id,
      key: chapter.key,
      title: chapter.title,
      updateIds: chapter.updates.map((update) => update.id),
      firstPageNumber: chapterPageNumber,
    });

    for (const update of chapter.updates) {
      const heading = update.title?.trim() || update.room?.trim() || "Update";
      const headingLines = input.measurer.wrap({
        font: "instrument-serif",
        fontSizePt: 22,
        fontStyle: "normal",
        fontWeight: "semibold",
        maxWidthMm: 273,
        text: heading,
      });
      if (headingLines.length > 2) warnings.push({
        code: "TEXT_OVERFLOW",
        severity: "blocking",
        pageNumber: pages.length + 1,
        assetId: null,
        updateId: update.id,
        message: "Een updatetitel past niet binnen twee regels.",
      });
      const description = update.description?.trim() ?? "";
      const descriptionLines = description
        ? input.measurer.wrap({
            font: "instrument-serif",
            fontSizePt: 12,
            fontStyle: "italic",
            fontWeight: "regular",
            maxWidthMm: 273,
            text: description,
          })
        : [];
      let lineOffset = 0;
      let textPageIndex = 0;
      do {
        const first = textPageIndex === 0;
        const bodyFrame: Frame = first
          ? { xMm: 12, yMm: 68, widthMm: 273, heightMm: 124 }
          : { xMm: 12, yMm: 32, widthMm: 273, heightMm: 160 };
        const capacity = lineCapacity(bodyFrame.heightMm, 15.6);
        const lines = descriptionLines.slice(lineOffset, lineOffset + capacity);
        const number = pages.length + 1;
        const blocks: PhotobookPage["blocks"] = [
          textBlock({
            id: `update:${update.id}:date:${textPageIndex}`,
            frame: { xMm: 12, yMm: 18, widthMm: 273, heightMm: 8 },
            text: first ? localizedDate(update.updateDate) : `${localizedDate(update.updateDate)} · vervolg`,
            lines: [first ? localizedDate(update.updateDate) : `${localizedDate(update.updateDate)} · vervolg`],
            font: "inter",
            weight: "regular",
            fontSizePt: 8,
            lineHeightPt: 10,
            color: "#777777",
          }),
        ];
        if (first) blocks.push(textBlock({
          id: `update:${update.id}:title`,
          frame: { xMm: 12, yMm: 37, widthMm: 273, heightMm: 24 },
          text: heading,
          lines: headingLines.slice(0, 2),
          font: "instrument-serif",
          weight: "semibold",
          fontSizePt: 22,
          lineHeightPt: 25,
          color: "#171717",
        }));
        if (lines.length > 0) blocks.push(textBlock({
          id: `update:${update.id}:body:${textPageIndex}`,
          frame: bodyFrame,
          text: lines.join("\n"),
          lines,
          font: "instrument-serif",
          weight: "regular",
          style: "italic",
          fontSizePt: 12,
          lineHeightPt: 15.6,
          color: "#3f3f3f",
        }));
        pages.push({
          id: `update:${update.id}:text:${textPageIndex + 1}`,
          number,
          kind: "update_text",
          chapterId: chapter.id,
          updateId: update.id,
          background: "#ffffff",
          overlay: null,
          blocks,
        });
        lineOffset += lines.length;
        textPageIndex += 1;
      } while (lineOffset < descriptionLines.length);

      const selectedMedia = orderedMedia(update, input.photoOrderByUpdate?.[update.id])
        .filter((media) => !excludedMedia.has(media.id))
        .map((media) => validMediaById.get(media.id))
        .filter((media): media is ValidMedia => Boolean(media));
      let mediaOffset = 0;
      let photoPageIndex = 0;
      while (mediaOffset < selectedMedia.length) {
        const layoutKey = `update:${update.id}:photos:${photoPageIndex + 1}`;
        const layout = input.layoutByPage?.[layoutKey] ?? input.layoutByPage?.[update.id] ?? "auto";
        const batch = selectedMedia.slice(mediaOffset, mediaOffset + layoutBatchSize(layout, selectedMedia.length - mediaOffset));
        const frames = photoFrames(layout, batch.length);
        const pageNumber = pages.length + 1;
        const blocks = batch.map((asset, index) => {
          const frame = frames[index];
          const crop = input.cropByAsset?.[asset.id] ?? defaultCrop();
          const facts = cropFacts(asset, frame, crop);
          warnings.push(...warningForPhoto(asset, crop, pageNumber, update.id, facts));
          sourceAssets.set(asset.id, asSourceAsset(asset));
          return {
            id: `${layoutKey}:asset:${asset.id}`,
            type: "photo" as const,
            frame,
            assetId: asset.id,
            crop,
            effectiveDpi: facts.effectiveDpi,
            altText: asset.altText?.trim() || `Projectfoto bij ${heading}`,
          };
        });
        pages.push({
          id: layoutKey,
          number: pageNumber,
          kind: "photos",
          chapterId: chapter.id,
          updateId: update.id,
          background: "#ffffff",
          overlay: null,
          blocks,
        });
        mediaOffset += batch.length;
        photoPageIndex += 1;
      }
    }
  }

  while (pages.length < LAUNCH_PHOTOBOOK_MIN_PAGES || pages.length % 2 !== 0) {
    pages.push({
      id: `blank:${pages.length + 1}`,
      number: pages.length + 1,
      kind: "blank",
      chapterId: null,
      updateId: null,
      background: "#ffffff",
      overlay: null,
      blocks: [],
    });
  }
  if (pages.length > input.maximumPages) {
    warnings.push({
      code: "PAGE_LIMIT_EXCEEDED",
      severity: "blocking",
      pageNumber: null,
      assetId: null,
      updateId: null,
      message: `Dit Bouwboek heeft ${pages.length} pagina's; de ingestelde limiet is ${input.maximumPages}.`,
    });
  }

  const orderedSourceAssets = [...sourceAssets.values()].sort((left, right) => left.id.localeCompare(right.id));
  const body: Omit<PhotobookDocument, "checksumSha256"> = {
    version: 1,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    selectedFormat: LAUNCH_PHOTOBOOK_FORMAT,
    locale: "nl-NL",
    print: {
      widthMm: 297,
      heightMm: 210,
      safeMarginMm: 12,
      bleedMm: 0,
      targetDpi: 300,
      colorSpace: "RGB",
    },
    cover: {
      title: input.projectTitle,
      subtitle,
      mediaAssetId: coverAsset?.id ?? null,
      crop: coverCrop,
    },
    chapters,
    pages,
    sourceAssets: orderedSourceAssets,
    sourceAssetIds: orderedSourceAssets.map((asset) => asset.id),
    pageCount: pages.length,
    warnings,
  };
  return photobookDocumentSchema.parse({
    ...body,
    checksumSha256: photobookDocumentChecksum(body),
  });
}

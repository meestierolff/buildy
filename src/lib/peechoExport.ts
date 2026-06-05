import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

/**
 * Peecho hardcover specs (A4 landscape):
 * - 297 x 210 mm
 * - 300 dpi recommended
 * - RGB color profile
 * - Min 10 mm margins
 * - Even number of pages
 * - No bleed / cut marks (Peecho adds these)
 * - Embedded fonts (jsPDF embeds standard fonts via WinAnsi)
 * Source: https://support.peecho.com/hc/en-us/articles/19730953142428
 */

export type PeechoFormat = "A4_LANDSCAPE" | "A4_PORTRAIT" | "SQUARE_210";
export type PeechoStepLayout = "auto" | "1-full" | "2-side" | "2-stack" | "grid";

const FORMATS: Record<PeechoFormat, { w: number; h: number; label: string }> = {
  A4_LANDSCAPE: { w: 297, h: 210, label: "A4 liggend" },
  A4_PORTRAIT: { w: 210, h: 297, label: "A4 staand" },
  SQUARE_210: { w: 210, h: 210, label: "Vierkant 21x21cm" },
};

const MARGIN = 12; // mm — guideline minimum is 10, we keep 12 for safety
const DPI = 300;
const MM_PER_INCH = 25.4;
export const PEECHO_MIN_PAGES = 24;

export const getPeechoPrintPageCount = (pageCount: number) => {
  let total = Math.max(pageCount, PEECHO_MIN_PAGES);
  if (total % 2 !== 0) total += 1;
  return total;
};

const mmToPx = (mm: number) => Math.round((mm / MM_PER_INCH) * DPI);

// Fetch an image as RGB JPEG dataURL at target px dimensions (cover-fit).
async function loadImageAsJpeg(
  url: string,
  targetWmm: number,
  targetHmm: number,
  fit: "cover" | "contain" = "cover",
): Promise<string | null> {
  try {
    const targetW = mmToPx(targetWmm);
    const targetH = mmToPx(targetHmm);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d")!;
    // Fill white first (flattens transparency to RGB)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetW, targetH);
    // cover-fit by default; contain-fit is used where source details must never be cropped.
    const srcRatio = img.width / img.height;
    const dstRatio = targetW / targetH;
    if (fit === "contain") {
      let dw = targetW;
      let dh = targetH;
      let dx = 0;
      let dy = 0;
      if (srcRatio > dstRatio) {
        dh = targetW / srcRatio;
        dy = (targetH - dh) / 2;
      } else {
        dw = targetH * srcRatio;
        dx = (targetW - dw) / 2;
      }
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
    } else {
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcRatio > dstRatio) {
        sw = img.height * dstRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / dstRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
    }
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch (e) {
    console.warn("Image load failed", url, e);
    return null;
  }
}

interface Step {
  id: string;
  step_date: string;
  location_name: string | null;
  description: string | null;
  phase: string | null;
  step_media?: Array<{ id: string; media_url: string; media_type: string; sort_order?: number | null; created_at?: string | null }>;
}

interface Trip {
  title: string;
  address: string | null;
  project_type: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  floorplan_url: string | null;
}

interface Settings {
  cover_title: string | null;
  cover_subtitle: string | null;
  cover_media_id: string | null;
  chapter_overrides: Record<string, string>;
  step_layout_overrides?: Record<string, PeechoStepLayout>;
  step_photo_order?: Record<string, string[]>;
}

export interface BuildArgs {
  trip: Trip;
  steps: Step[];
  settings: Settings;
  excludedMedia: Set<string>;
  excludedSteps: Set<string>;
  format?: PeechoFormat;
}

const clampLines = (pdf: jsPDF, text: string, maxWidth: number, maxLines: number) => {
  const lines = pdf.splitTextToSize(text, maxWidth) as string[];
  if (lines.length <= maxLines) return lines;
  const result = lines.slice(0, maxLines);
  result[maxLines - 1] = `${result[maxLines - 1].replace(/[.,;:\s]+$/, "")}...`;
  return result;
};

const drawStepCaption = (
  pdf: jsPDF,
  params: {
    x: number;
    y: number;
    w: number;
    chapterTitle: string;
    dateLabel: string;
    locationName: string;
    description?: string | null;
    compact?: boolean;
  },
) => {
  const { x, y, w, chapterTitle, dateLabel, locationName, description, compact } = params;
  pdf.setTextColor(180, 90, 50);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(compact ? 7 : 8);
  pdf.text(chapterTitle.toUpperCase(), x, y);

  pdf.setTextColor(120, 120, 120);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(compact ? 7 : 8);
  pdf.text(dateLabel, x, y + 5);

  pdf.setFont("times", "bold");
  pdf.setTextColor(20, 20, 20);
  pdf.setFontSize(compact ? 13 : 15);
  pdf.text(clampLines(pdf, locationName || "Update", w, compact ? 1 : 2), x, y + 13);

  if (description) {
    pdf.setFont("times", "italic");
    pdf.setFontSize(compact ? 8 : 9);
    pdf.setTextColor(60, 60, 60);
    pdf.text(clampLines(pdf, `"${description}"`, w, compact ? 1 : 2), x, y + (compact ? 20 : 23));
  }
};

const getOrderedPhotos = (
  step: Step,
  settings: Settings,
  excludedMedia: Set<string>,
) => {
  const allPhotos = [...(step.step_media || [])]
    .filter((m) => m.media_type !== "video" && m.media_type !== "pdf" && !excludedMedia.has(m.id))
    .sort((a, b) => {
      const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  const customOrder = settings.step_photo_order?.[step.id];
  if (!customOrder?.length) return allPhotos;

  return [...allPhotos].sort((a, b) => {
    const ai = customOrder.indexOf(a.id);
    const bi = customOrder.indexOf(b.id);
    if (ai === -1 && bi === -1) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
};

const getPageLayout = (settings: Settings, stepId: string, pageKey: string): PeechoStepLayout =>
  settings.step_layout_overrides?.[pageKey] || settings.step_layout_overrides?.[stepId] || "auto";

const getBatchSize = (layout: PeechoStepLayout, remainingPhotos: number) => {
  if (layout === "1-full") return 1;
  if (layout === "2-side" || layout === "2-stack") return Math.min(2, remainingPhotos);
  return Math.min(4, remainingPhotos);
};

export async function buildPeechoPdf(args: BuildArgs): Promise<Blob> {
  const fmt = FORMATS[args.format || "A4_LANDSCAPE"];
  const pdf = new jsPDF({
    unit: "mm",
    format: [fmt.w, fmt.h],
    orientation: fmt.w > fmt.h ? "landscape" : "portrait",
    compress: true,
  });

  const { trip, steps, settings, excludedMedia, excludedSteps } = args;
  const W = fmt.w;
  const H = fmt.h;
  const innerW = W - MARGIN * 2;
  const innerH = H - MARGIN * 2;

  let isFirst = true;
  const addPage = () => {
    if (isFirst) {
      isFirst = false;
    } else {
      pdf.addPage([W, H], W > H ? "landscape" : "portrait");
    }
  };

  // ====== COVER (page 1) ======
  addPage();
  const firstVisiblePhoto = steps
    .filter((step) => !excludedSteps.has(step.id))
    .flatMap((step) => step.step_media || [])
    .find((media) => !excludedMedia.has(media.id) && media.media_type !== "video" && media.media_type !== "pdf");
  const coverMedia = settings.cover_media_id
    ? steps.flatMap(s => s.step_media || []).find(m => m.id === settings.cover_media_id)?.media_url
    : trip.cover_image_url || firstVisiblePhoto?.media_url;

  if (coverMedia) {
    const data = await loadImageAsJpeg(coverMedia, W, H);
    if (data) pdf.addImage(data, "JPEG", 0, 0, W, H, undefined, "FAST");
  } else {
    pdf.setFillColor(14, 27, 44);
    pdf.rect(0, 0, W, H, "F");
  }
  // Dark overlay for readability
  pdf.setFillColor(0, 0, 0);
  pdf.setGState(pdf.GState({ opacity: 0.45 }));
  pdf.rect(0, 0, W, H, "F");
  pdf.setGState(pdf.GState({ opacity: 1 }));

  const coverTextPos = settings.chapter_overrides.__cover_text_pos__ || "bottom";
  const coverAnchorY =
    coverTextPos === "top" ? MARGIN + 28
      : coverTextPos === "center" ? H / 2 - 8
      : H - MARGIN - 36;

  pdf.setTextColor(255, 255, 255);
  if (trip.project_type) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(trip.project_type.toUpperCase(), W / 2, coverAnchorY - 12, { align: "center" });
  }
  pdf.setFont("times", "bold");
  const title = settings.cover_title || trip.title;
  pdf.setFontSize(title.length > 42 ? 30 : 36);
  const titleLines = clampLines(pdf, title, innerW - 20, 3);
  pdf.text(titleLines, W / 2, coverAnchorY, { align: "center" });
  const titleBlockH = titleLines.length * 11;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  const subtitle = settings.cover_subtitle ?? trip.address ?? "";
  if (subtitle) pdf.text(clampLines(pdf, subtitle, innerW - 20, 1), W / 2, coverAnchorY + titleBlockH + 4, { align: "center" });

  if (trip.start_date && trip.end_date) {
    pdf.setFontSize(11);
    const range = `${format(new Date(trip.start_date), "d MMM yyyy", { locale: nl })} - ${format(new Date(trip.end_date), "d MMM yyyy", { locale: nl })}`;
    pdf.text(range, W / 2, coverAnchorY + titleBlockH + (subtitle ? 12 : 4), { align: "center" });
  }

  pdf.setFontSize(8);
  pdf.text("Een Buildy verbouwingslogboek", W / 2, H - MARGIN, { align: "center" });

  // ====== FLOORPLAN (optional) ======
  if (trip.floorplan_url) {
    addPage();
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, W, H, "F");
    pdf.setTextColor(180, 90, 50);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("PLATTEGROND", W / 2, MARGIN + 6, { align: "center" });
    pdf.setFont("times", "bold");
    pdf.setFontSize(20);
    pdf.setTextColor(20, 20, 20);
    pdf.text(clampLines(pdf, trip.title, innerW, 1), W / 2, MARGIN + 16, { align: "center" });
    if (trip.address) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(120, 120, 120);
      pdf.text(clampLines(pdf, trip.address, innerW, 1), W / 2, MARGIN + 23, { align: "center" });
    }
    const imageTop = MARGIN + (trip.address ? 30 : 25);
    const imageH = H - imageTop - MARGIN;
    const data = await loadImageAsJpeg(trip.floorplan_url, innerW, imageH, "contain");
    if (data) pdf.addImage(data, "JPEG", MARGIN, imageTop, innerW, imageH, undefined, "FAST");
  }

  // ====== CONTENT ======
  const visibleSteps = steps.filter(s => !excludedSteps.has(s.id));
  const grouped = new Map<string, Step[]>();
  for (const s of visibleSteps) {
    const k = s.phase || "Overige updates";
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(s);
  }
  const sortedPhases = Array.from(grouped.keys()).sort((a, b) => {
    const firstDateForPhase = (phase: string) =>
      grouped.get(phase)!.reduce((earliest, step) => {
        const date = step.step_date ?? "";
        return !earliest || (date && date < earliest) ? date : earliest;
      }, "");
    const aDate = firstDateForPhase(a);
    const bDate = firstDateForPhase(b);
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });

  for (const phase of sortedPhases) {
    // Chapter divider page
    addPage();
    pdf.setFillColor(245, 243, 238);
    pdf.rect(0, 0, W, H, "F");
    pdf.setTextColor(180, 90, 50);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("HOOFDSTUK", W / 2, H / 2 - 10, { align: "center" });
    pdf.setFont("times", "bold");
    pdf.setFontSize(40);
    pdf.setTextColor(30, 30, 30);
    const chapterTitle = settings.chapter_overrides[phase] || phase;
    pdf.text(clampLines(pdf, chapterTitle, innerW * 0.8, 2), W / 2, H / 2 + 5, { align: "center" });
    pdf.setDrawColor(180, 90, 50);
    pdf.setLineWidth(0.8);
    pdf.line(W / 2 - 12, H / 2 + 12, W / 2 + 12, H / 2 + 12);

    for (const step of grouped.get(phase)!) {
      const photos = getOrderedPhotos(step, settings, excludedMedia);
      const hasDescription = !!step.description;
      if (photos.length === 0 && !hasDescription) continue;

      const dateLabel = format(new Date(step.step_date), "d MMM yyyy", { locale: nl });
      if (photos.length === 0) {
        // Text-only page
        addPage();
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, W, H, "F");

        pdf.setTextColor(180, 90, 50);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text(chapterTitle.toUpperCase(), MARGIN, MARGIN + 8);
        pdf.setTextColor(120, 120, 120);
        pdf.setFont("helvetica", "normal");
        pdf.text(dateLabel, MARGIN, MARGIN + 14);

        pdf.setFont("times", "bold");
        pdf.setTextColor(20, 20, 20);
        pdf.setFontSize(22);
        const loc = step.location_name || "Update";
        pdf.text(clampLines(pdf, loc, innerW, 2), MARGIN, MARGIN + 42);
        pdf.setFont("times", "italic");
        pdf.setFontSize(12);
        pdf.setTextColor(60, 60, 60);
        const desc = `"${step.description}"`;
        pdf.text(clampLines(pdf, desc, innerW, 8), MARGIN, MARGIN + 58);
      } else {
        let pageIdx = 0;
        let photoIdx = 0;
        while (photoIdx < photos.length) {
          const pageKey = `${step.id}-${pageIdx}`;
          const layout = getPageLayout(settings, step.id, pageKey);
          const batchSize = getBatchSize(layout, photos.length - photoIdx);
          const batch = photos.slice(photoIdx, photoIdx + batchSize);
          const isFirstBatch = photoIdx === 0;
          addPage();
          pdf.setFillColor(248, 247, 244);
          pdf.rect(0, 0, W, H, "F");

          const shouldCaption = isFirstBatch;
          const captionH = shouldCaption ? (hasDescription ? 36 : 26) : 0;
          const gridTop = MARGIN;
          const gridH = innerH - captionH - (shouldCaption ? 4 : 0);
          const gridW = innerW;
          const gap = 3;

          if (batch.length === 1 || layout === "1-full") {
            const data = await loadImageAsJpeg(batch[0].media_url, gridW, gridH, "contain");
            if (data) pdf.addImage(data, "JPEG", MARGIN, gridTop, gridW, gridH, undefined, "FAST");
          } else if (layout === "2-stack" && batch.length >= 2) {
            const cellH = (gridH - gap) / 2;
            for (let j = 0; j < batch.length; j++) {
              const data = await loadImageAsJpeg(batch[j].media_url, gridW, cellH, "contain");
              if (data) pdf.addImage(data, "JPEG", MARGIN, gridTop + j * (cellH + gap), gridW, cellH, undefined, "FAST");
            }
          } else if (layout === "2-side" || batch.length === 2) {
            const cellW = (gridW - gap) / 2;
            for (let j = 0; j < batch.length; j++) {
              const data = await loadImageAsJpeg(batch[j].media_url, cellW, gridH, "contain");
              if (data) pdf.addImage(data, "JPEG", MARGIN + j * (cellW + gap), gridTop, cellW, gridH, undefined, "FAST");
            }
          } else if (batch.length === 3) {
            const leftW = gridW * 0.58;
            const rightW = gridW - leftW - gap;
            const rightH = (gridH - gap) / 2;
            const hero = await loadImageAsJpeg(batch[0].media_url, leftW, gridH, "contain");
            if (hero) pdf.addImage(hero, "JPEG", MARGIN, gridTop, leftW, gridH, undefined, "FAST");
            for (let j = 1; j < 3; j++) {
              const data = await loadImageAsJpeg(batch[j].media_url, rightW, rightH, "contain");
              if (data) pdf.addImage(data, "JPEG", MARGIN + leftW + gap, gridTop + (j - 1) * (rightH + gap), rightW, rightH, undefined, "FAST");
            }
          } else if (layout === "auto" && batch.length === 4) {
            const cellW = (gridW - gap * 3) / 4;
            for (let j = 0; j < batch.length; j++) {
              const data = await loadImageAsJpeg(batch[j].media_url, cellW, gridH, "contain");
              if (data) pdf.addImage(data, "JPEG", MARGIN + j * (cellW + gap), gridTop, cellW, gridH, undefined, "FAST");
            }
          } else {
            const cellW = (gridW - gap) / 2;
            const cellH = (gridH - gap) / 2;
            for (let j = 0; j < batch.length; j++) {
              const col = j % 2;
              const row = Math.floor(j / 2);
              const data = await loadImageAsJpeg(batch[j].media_url, cellW, cellH, "contain");
              if (data) pdf.addImage(data, "JPEG", MARGIN + col * (cellW + gap), gridTop + row * (cellH + gap), cellW, cellH, undefined, "FAST");
            }
          }

          if (shouldCaption) {
            drawStepCaption(pdf, {
              x: MARGIN,
              y: H - MARGIN - captionH + 6,
              w: innerW,
              chapterTitle,
              dateLabel,
              locationName: step.location_name || "Update",
              description: step.description,
              compact: captionH <= 26,
            });
          }

          photoIdx += batchSize;
          pageIdx++;
        }
      }
    }
  }

  // ====== Pad before back cover so the back cover stays the final printed page ======
  while (pdf.getNumberOfPages() + 1 < PEECHO_MIN_PAGES || (pdf.getNumberOfPages() + 1) % 2 !== 0) {
    pdf.addPage([W, H], W > H ? "landscape" : "portrait");
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, W, H, "F");
  }

  // ====== BACK COVER ======
  addPage();
  pdf.setFillColor(18, 18, 18);
  pdf.rect(0, 0, W, H, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("BUILDY", W / 2, H / 2 - 24, { align: "center" });
  pdf.setFont("times", "italic");
  pdf.setFontSize(18);
  const backTitleLines = clampLines(pdf, title, innerW * 0.7, 3);
  pdf.text(backTitleLines, W / 2, H / 2 - 4, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Gemaakt met Buildy", W / 2, H / 2 + backTitleLines.length * 8 + 6, { align: "center" });

  return pdf.output("blob");
}

export const PEECHO_FORMATS = FORMATS;

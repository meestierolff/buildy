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

const FORMATS: Record<PeechoFormat, { w: number; h: number; label: string }> = {
  A4_LANDSCAPE: { w: 297, h: 210, label: "A4 liggend" },
  A4_PORTRAIT: { w: 210, h: 297, label: "A4 staand" },
  SQUARE_210: { w: 210, h: 210, label: "Vierkant 21x21cm" },
};

const MARGIN = 12; // mm — guideline minimum is 10, we keep 12 for safety
const DPI = 300;
const MM_PER_INCH = 25.4;

const mmToPx = (mm: number) => Math.round((mm / MM_PER_INCH) * DPI);

// Fetch an image as RGB JPEG dataURL at target px dimensions (cover-fit).
async function loadImageAsJpeg(
  url: string,
  targetWmm: number,
  targetHmm: number,
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
    // cover-fit
    const srcRatio = img.width / img.height;
    const dstRatio = targetW / targetH;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcRatio > dstRatio) {
      sw = img.height * dstRatio;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / dstRatio;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
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
  step_media?: Array<{ id: string; media_url: string; media_type: string }>;
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
}

export interface BuildArgs {
  trip: Trip;
  steps: Step[];
  settings: Settings;
  excludedMedia: Set<string>;
  excludedSteps: Set<string>;
  format?: PeechoFormat;
}

const PHASE_ORDER = [
  "Aankoop", "Voorbereiding/Design", "Voorbereiding", "Sloop",
  "Ruwbouw", "Installatie", "Afbouw", "Afwerking", "Inrichting", "Oplevering",
];

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
  const coverMedia = settings.cover_media_id
    ? steps.flatMap(s => s.step_media || []).find(m => m.id === settings.cover_media_id)?.media_url
    : trip.cover_image_url;

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

  pdf.setTextColor(255, 255, 255);
  if (trip.project_type) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(trip.project_type.toUpperCase(), W / 2, H / 2 - 22, { align: "center" });
  }
  pdf.setFont("times", "bold");
  pdf.setFontSize(36);
  const title = settings.cover_title || trip.title;
  const titleLines = pdf.splitTextToSize(title, innerW - 20);
  pdf.text(titleLines, W / 2, H / 2, { align: "center" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  const subtitle = settings.cover_subtitle ?? trip.address ?? "";
  if (subtitle) pdf.text(subtitle, W / 2, H / 2 + 14, { align: "center" });

  if (trip.start_date && trip.end_date) {
    pdf.setFontSize(11);
    const range = `${format(new Date(trip.start_date), "d MMM yyyy", { locale: nl })} — ${format(new Date(trip.end_date), "d MMM yyyy", { locale: nl })}`;
    pdf.text(range, W / 2, H / 2 + 22, { align: "center" });
  }

  pdf.setFontSize(8);
  pdf.text("Een Buildy verbouwingslogboek", W / 2, H - MARGIN, { align: "center" });

  // ====== FLOORPLAN (optional) ======
  if (trip.floorplan_url) {
    addPage();
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, W, H, "F");
    pdf.setTextColor(60, 60, 60);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("PLATTEGROND", W / 2, MARGIN + 6, { align: "center" });
    pdf.setFont("times", "bold");
    pdf.setFontSize(20);
    pdf.setTextColor(20, 20, 20);
    pdf.text(trip.title, W / 2, MARGIN + 14, { align: "center" });
    const data = await loadImageAsJpeg(trip.floorplan_url, innerW, innerH - 20);
    if (data) pdf.addImage(data, "JPEG", MARGIN, MARGIN + 20, innerW, innerH - 20, undefined, "FAST");
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
    const ai = PHASE_ORDER.indexOf(a);
    const bi = PHASE_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
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
    pdf.text(chapterTitle, W / 2, H / 2 + 5, { align: "center" });
    pdf.setDrawColor(180, 90, 50);
    pdf.setLineWidth(0.8);
    pdf.line(W / 2 - 12, H / 2 + 12, W / 2 + 12, H / 2 + 12);

    for (const step of grouped.get(phase)!) {
      const photos = (step.step_media || []).filter(
        m => m.media_type !== "video" && !excludedMedia.has(m.id)
      );
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
        pdf.text(chapterTitle.toUpperCase(), MARGIN, MARGIN + 4);
        pdf.setTextColor(120, 120, 120);
        pdf.setFont("helvetica", "normal");
        pdf.text(dateLabel, MARGIN, MARGIN + 10);
        pdf.setFont("times", "bold");
        pdf.setTextColor(20, 20, 20);
        pdf.setFontSize(22);
        const loc = step.location_name || "";
        pdf.text(pdf.splitTextToSize(loc, innerW), MARGIN, MARGIN + 22);
        pdf.setFont("times", "italic");
        pdf.setFontSize(12);
        pdf.setTextColor(60, 60, 60);
        const desc = `"${step.description}"`;
        pdf.text(pdf.splitTextToSize(desc, innerW), MARGIN, MARGIN + 38);
      } else if (photos.length === 1) {
        // Full-bleed photo with caption
        addPage();
        const data = await loadImageAsJpeg(photos[0].media_url, W, H);
        if (data) pdf.addImage(data, "JPEG", 0, 0, W, H, undefined, "FAST");
        // bottom caption bar
        pdf.setFillColor(0, 0, 0);
        pdf.setGState(pdf.GState({ opacity: 0.55 }));
        pdf.rect(0, H - 38, W, 38, "F");
        pdf.setGState(pdf.GState({ opacity: 1 }));
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text(chapterTitle.toUpperCase(), MARGIN, H - 28);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.text(dateLabel, MARGIN, H - 22);
        pdf.setFont("times", "bold");
        pdf.setFontSize(16);
        pdf.text(pdf.splitTextToSize(step.location_name || "", innerW), MARGIN, H - 13);
        if (hasDescription) {
          pdf.setFont("times", "italic");
          pdf.setFontSize(9);
          const d = pdf.splitTextToSize(`"${step.description}"`, innerW);
          pdf.text(d.slice(0, 2), MARGIN, H - 5);
        }
      } else {
        // Grid pages of up to 4 photos each
        for (let i = 0; i < photos.length; i += 4) {
          const batch = photos.slice(i, i + 4);
          const isFirstBatch = i === 0;
          addPage();
          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, W, H, "F");

          const captionH = isFirstBatch ? 32 : 0;
          const gridTop = MARGIN;
          const gridH = innerH - captionH;
          const gridW = innerW;
          const gap = 3;

          if (batch.length === 2) {
            const cellW = (gridW - gap) / 2;
            for (let j = 0; j < 2; j++) {
              const data = await loadImageAsJpeg(batch[j].media_url, cellW, gridH);
              if (data) pdf.addImage(data, "JPEG", MARGIN + j * (cellW + gap), gridTop, cellW, gridH, undefined, "FAST");
            }
          } else {
            const cellW = (gridW - gap) / 2;
            const cellH = (gridH - gap) / 2;
            for (let j = 0; j < batch.length; j++) {
              const col = j % 2;
              const row = Math.floor(j / 2);
              const data = await loadImageAsJpeg(batch[j].media_url, cellW, cellH);
              if (data) pdf.addImage(data, "JPEG", MARGIN + col * (cellW + gap), gridTop + row * (cellH + gap), cellW, cellH, undefined, "FAST");
            }
          }

          if (isFirstBatch) {
            const capY = H - MARGIN - captionH + 6;
            pdf.setTextColor(180, 90, 50);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(8);
            pdf.text(chapterTitle.toUpperCase(), MARGIN, capY);
            pdf.setTextColor(120, 120, 120);
            pdf.setFont("helvetica", "normal");
            pdf.text(dateLabel, MARGIN, capY + 5);
            pdf.setFont("times", "bold");
            pdf.setTextColor(20, 20, 20);
            pdf.setFontSize(14);
            pdf.text(pdf.splitTextToSize(step.location_name || "", innerW), MARGIN, capY + 13);
            if (hasDescription) {
              pdf.setFont("times", "italic");
              pdf.setFontSize(9);
              pdf.setTextColor(60, 60, 60);
              const d = pdf.splitTextToSize(`"${step.description}"`, innerW);
              pdf.text(d.slice(0, 2), MARGIN, capY + 21);
            }
          }
        }
      }
    }
  }

  // ====== BACK COVER ======
  addPage();
  pdf.setFillColor(14, 27, 44);
  pdf.rect(0, 0, W, H, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("times", "italic");
  pdf.setFontSize(14);
  pdf.text(trip.title, W / 2, H / 2 - 4, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Gemaakt met Buildy", W / 2, H / 2 + 6, { align: "center" });

  // ====== Pad to even page count (Peecho requirement) ======
  const total = pdf.getNumberOfPages();
  if (total % 2 !== 0) {
    pdf.addPage([W, H], W > H ? "landscape" : "portrait");
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, W, H, "F");
  }

  return pdf.output("blob");
}

export const PEECHO_FORMATS = FORMATS;

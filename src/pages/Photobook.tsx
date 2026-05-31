import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, Pencil, Eye, EyeOff, Check, BookOpen, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";
import { buildPeechoPdf, PEECHO_FORMATS, type PeechoFormat } from "@/lib/peechoExport";

type StepLayout = "auto" | "1-full" | "2-side" | "2-stack" | "grid";
type CoverTextPos = "bottom" | "top" | "center";

interface PhotobookSettings {
  cover_title: string | null;
  cover_subtitle: string | null;
  cover_media_id: string | null;
  chapter_overrides: Record<string, string>;
  step_layout_overrides: Record<string, StepLayout>;
  step_photo_order: Record<string, string[]>;
}

const STEP_LAYOUTS: { id: StepLayout; label: string; icon: React.ReactNode }[] = [
  {
    id: "auto",
    label: "Auto",
    icon: (
      <div className="w-9 h-7 border-2 border-current rounded-sm p-0.5 grid grid-cols-2 grid-rows-2 gap-0.5 opacity-80">
        <div className="bg-current/40 rounded-[1px] col-span-2" />
        <div className="bg-current/40 rounded-[1px]" />
        <div className="bg-current/40 rounded-[1px]" />
      </div>
    ),
  },
  {
    id: "1-full",
    label: "1 groot",
    icon: (
      <div className="w-9 h-7 border-2 border-current rounded-sm p-0.5">
        <div className="w-full h-full bg-current/40 rounded-[1px]" />
      </div>
    ),
  },
  {
    id: "2-side",
    label: "2 naast",
    icon: (
      <div className="w-9 h-7 border-2 border-current rounded-sm p-0.5 grid grid-cols-2 gap-0.5">
        <div className="bg-current/40 rounded-[1px]" />
        <div className="bg-current/40 rounded-[1px]" />
      </div>
    ),
  },
  {
    id: "2-stack",
    label: "2 gestapeld",
    icon: (
      <div className="w-9 h-7 border-2 border-current rounded-sm p-0.5 grid grid-rows-2 gap-0.5">
        <div className="bg-current/40 rounded-[1px]" />
        <div className="bg-current/40 rounded-[1px]" />
      </div>
    ),
  },
  {
    id: "grid",
    label: "2×2 grid",
    icon: (
      <div className="w-9 h-7 border-2 border-current rounded-sm p-0.5 grid grid-cols-2 grid-rows-2 gap-0.5">
        <div className="bg-current/40 rounded-[1px]" />
        <div className="bg-current/40 rounded-[1px]" />
        <div className="bg-current/40 rounded-[1px]" />
        <div className="bg-current/40 rounded-[1px]" />
      </div>
    ),
  },
];

const Photobook = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  // pageIdx: flat 0-based index into the pages array (0 = cover)
  const [pageIdx, setPageIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [overviewMode, setOverviewMode] = useState(false);
  const [settings, setSettings] = useState<PhotobookSettings>({
    cover_title: null,
    cover_subtitle: null,
    cover_media_id: null,
    chapter_overrides: {},
    step_layout_overrides: {},
    step_photo_order: {},
  });
  const [excludedMedia, setExcludedMedia] = useState<Set<string>>(new Set());
  const [excludedSteps, setExcludedSteps] = useState<Set<string>>(new Set());

  const isOwner = user && trip?.user_id === user.id;

  const [printOpen, setPrintOpen] = useState(false);
  const [printFormat, setPrintFormat] = useState<PeechoFormat>("A4_LANDSCAPE");
  const [printBusy, setPrintBusy] = useState(false);
  const [printedPdfUrl, setPrintedPdfUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [stepBudgetMap, setStepBudgetMap] = useState<Map<string, number>>(new Map());
  const PEECHO_SCRIPT_URL = (import.meta.env.VITE_PEECHO_SCRIPT_URL as string) || "";

  useEffect(() => {
    if (!user) { setIsPro(false); return; }
    supabase.from("profiles").select("is_pro").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      setIsPro(!!(data as any)?.is_pro);
    });
  }, [user]);

  const handleGeneratePeechoPdf = async () => {
    if (!trip || !id) return;
    if (!isPro) { toast.error("Buildy Pro vereist"); return; }
    setPrintBusy(true);
    setPrintedPdfUrl(null);
    try {
      const blob = await buildPeechoPdf({
        trip, steps, settings, excludedMedia, excludedSteps, format: printFormat,
      });
      // Upload to public storage so Peecho can fetch the PDF directly
      const path = `${trip.user_id}/peecho/${id}-${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("trip-media").upload(path, blob, {
        contentType: "application/pdf", upsert: true,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("trip-media").getPublicUrl(path);
      setPrintedPdfUrl(pub.publicUrl);
      toast.success("Boek klaar — klik hieronder om te bestellen");
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Genereren mislukt");
    } finally {
      setPrintBusy(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      const [{ data: tripData }, { data: stepsData }, { data: settingsData }, { data: exMedia }, { data: exSteps }, { data: privInfo }, { data: budgetData }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("steps").select("*, step_media(*)").eq("trip_id", id).order("step_date", { ascending: true }),
        supabase.from("photobook_settings").select("*").eq("trip_id", id).maybeSingle(),
        supabase.from("photobook_excluded_media").select("media_id").eq("trip_id", id),
        supabase.from("photobook_excluded_steps").select("step_id").eq("trip_id", id),
        supabase.from("trip_private_info").select("address").eq("trip_id", id).maybeSingle(),
        supabase.from("step_budget").select("step_id, cost").eq("trip_id", id),
      ]);
      setStepBudgetMap(new Map((budgetData || []).map((r: any) => [r.step_id, Number(r.cost) || 0])));
      setTrip(tripData ? { ...tripData, address: privInfo?.address ?? null } : null);
      setSteps(stepsData || []);
      if (settingsData) {
        setSettings({
          cover_title: settingsData.cover_title,
          cover_subtitle: settingsData.cover_subtitle,
          cover_media_id: settingsData.cover_media_id,
          chapter_overrides: (settingsData.chapter_overrides as any) || {},
          step_layout_overrides: (settingsData.step_layout_overrides as any) || {},
          step_photo_order: (settingsData.step_photo_order as any) || {},
        });
      }
      setExcludedMedia(new Set((exMedia || []).map((r: any) => r.media_id)));
      setExcludedSteps(new Set((exSteps || []).map((r: any) => r.step_id)));
      setLoading(false);
    };
    fetchData();
  }, [id]);

  const upsertSettings = async (patch: Partial<PhotobookSettings>) => {
    if (!id) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase.from("photobook_settings").upsert({
      trip_id: id,
      cover_title: next.cover_title,
      cover_subtitle: next.cover_subtitle,
      cover_media_id: next.cover_media_id,
      chapter_overrides: next.chapter_overrides as any,
      step_layout_overrides: next.step_layout_overrides as any,
      step_photo_order: next.step_photo_order as any,
    });
    if (error) toast.error("Kon niet opslaan");
  };

  const updateTripField = async (patch: Record<string, any>) => {
    if (!id) return;
    setTrip((t: any) => ({ ...t, ...patch }));
    const { error } = await supabase.from("trips").update(patch).eq("id", id);
    if (error) toast.error("Kon niet opslaan");
  };


  const toggleMedia = async (mediaId: string) => {
    if (!id) return;
    const isOut = excludedMedia.has(mediaId);
    const next = new Set(excludedMedia);
    if (isOut) {
      next.delete(mediaId);
      await supabase.from("photobook_excluded_media").delete().eq("trip_id", id).eq("media_id", mediaId);
    } else {
      next.add(mediaId);
      await supabase.from("photobook_excluded_media").insert({ trip_id: id, media_id: mediaId });
    }
    setExcludedMedia(next);
  };

  const toggleStep = async (stepId: string) => {
    if (!id) return;
    const isOut = excludedSteps.has(stepId);
    const next = new Set(excludedSteps);
    if (isOut) {
      next.delete(stepId);
      await supabase.from("photobook_excluded_steps").delete().eq("trip_id", id).eq("step_id", stepId);
    } else {
      next.add(stepId);
      await supabase.from("photobook_excluded_steps").insert({ trip_id: id, step_id: stepId });
    }
    setExcludedSteps(next);
  };

  // Build pages (memoized)
  const pages = useMemo(() => {
    if (!trip) return [];

    const list: { key: string; node: React.ReactNode; meta?: { stepId?: string; chapter?: string; firstStep?: boolean } }[] = [];

    const allMedia = steps.flatMap((s) => (s.step_media || []).map((m: any) => ({ ...m, step: s })));
    const coverImage = settings.cover_media_id
      ? allMedia.find((m) => m.id === settings.cover_media_id)
      : trip.cover_image_url
      ? { media_url: trip.cover_image_url }
      : null;
    const coverTitle = settings.cover_title || trip.title;
    const coverSubtitle = settings.cover_subtitle ?? trip.address ?? "";

    const coverTextPos: CoverTextPos = (settings.chapter_overrides["__cover_text_pos__"] as CoverTextPos) || "bottom";

    list.push({
      key: "cover",
      node: (
        <div className="h-full flex flex-col relative overflow-hidden bg-primary">
          {/* Full-bleed photo */}
          {coverImage && (
            <img
              src={coverImage.media_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
          {/* Gradient overlay based on text position */}
          {coverImage && (
            <div className={`absolute inset-0 ${
              coverTextPos === "top" ? "bg-gradient-to-b from-black/75 via-black/20 to-transparent"
              : coverTextPos === "center" ? "bg-black/35"
              : "bg-gradient-to-t from-black/85 via-black/55 to-transparent"
            } pointer-events-none`} />
          )}

          {/* Title content — positioned by coverTextPos */}
          <div className={`absolute inset-x-0 text-center px-[6%] text-white ${
            coverTextPos === "top" ? "top-[8%]"
            : coverTextPos === "center" ? "top-1/2 -translate-y-1/2"
            : "bottom-[7%]"
          }`}>
            {trip.project_type && (
              <p className="text-[8px] uppercase tracking-[0.35em] text-white/70 mb-2 font-bold">{trip.project_type}</p>
            )}
            <h1 className="text-5xl font-bold mb-3 font-serif drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">{coverTitle}</h1>
            {coverSubtitle && (
              <p className="text-sm mb-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">{coverSubtitle}</p>
            )}
            {trip.start_date && trip.end_date && (
              <p className="text-sm drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
                {format(new Date(trip.start_date), "d MMM yyyy", { locale: nl })} — {format(new Date(trip.end_date), "d MMM yyyy", { locale: nl })}
              </p>
            )}
          </div>

          {/* Buildy watermark — subtle bottom-right corner */}
          <div className="absolute bottom-2 right-3 flex items-center gap-1 opacity-50">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="text-[8px] font-semibold text-white tracking-tight">buildy</span>
          </div>
        </div>
      ),
    });



    if (trip.floorplan_url) {
      list.push({
        key: "floorplan",
        node: (
          <div className="h-full flex flex-col bg-card p-12">
            <div className="text-center mb-6">
              <p className="text-xs uppercase tracking-[0.3em] text-accent font-bold mb-2">Plattegrond</p>
              <h2 className="text-3xl font-serif font-bold">{trip.title}</h2>
              {trip.address && <p className="text-sm text-muted-foreground mt-1">{trip.address}</p>}
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={trip.floorplan_url}
                alt="Plattegrond"
                className="max-w-full max-h-full object-contain rounded-md shadow-sm"
              />
            </div>
          </div>
        ),
      });
    }


    const visibleSteps = editing ? steps : steps.filter((s) => !excludedSteps.has(s.id));
    const grouped = new Map<string, any[]>();
    for (const step of visibleSteps) {
      const key = step.phase || "Overige updates";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(step);
    }
    // Sort phases by the earliest step_date within each phase (chronological)
    const sortedPhases = Array.from(grouped.keys()).sort((a, b) => {
      const aDate = grouped.get(a)![0].step_date ?? "";
      const bDate = grouped.get(b)![0].step_date ?? "";
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });

    // Per-step index and cumulative budget cost
    const stepIdxMap = new Map(visibleSteps.map((s, i) => [s.id, i]));
    const cumulativeCostMap = new Map<string, number>();
    let runningCost = 0;
    for (const s of visibleSteps) {
      runningCost += stepBudgetMap.get(s.id) ?? 0;
      cumulativeCostMap.set(s.id, runningCost);
    }
    const totalVisible = visibleSteps.length;
    const budgetTotal = (trip.budget_total as number | null) ?? null;

    for (const phase of sortedPhases) {
      const chapterTitle = settings.chapter_overrides[phase] || phase;
      list.push({
        key: `ch-${phase}`,
        meta: { chapter: phase },
        node: (
          <div className="h-full flex flex-col items-center justify-center p-12 bg-secondary text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-accent font-bold mb-4">Hoofdstuk</p>
            <h2 className="text-5xl font-bold font-serif">{chapterTitle}</h2>
            <div className="w-16 h-1 bg-accent mt-6" />
          </div>
        ),
      });

      for (const step of grouped.get(phase)!) {
        // Apply custom photo order, then filter out excluded media
        const allStepPhotos = (step.step_media || []).filter((m: any) => m.media_type !== "video");
        const customOrder = settings.step_photo_order[step.id] as string[] | undefined;
        const orderedPhotos = customOrder?.length
          ? [...allStepPhotos].sort((a: any, b: any) => {
              const ai = customOrder.indexOf(a.id);
              const bi = customOrder.indexOf(b.id);
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            })
          : allStepPhotos;
        const photos = orderedPhotos.filter((m: any) => !excludedMedia.has(m.id));
        const hasDescription = !!step.description;

        if (photos.length === 0 && !hasDescription) continue;

        const stepIdx = stepIdxMap.get(step.id) ?? 0;
        const cumulativeCost = cumulativeCostMap.get(step.id) ?? 0;
        const layout: StepLayout = (settings.step_layout_overrides[step.id] as StepLayout) ?? "auto";

        // Text-only
        if (photos.length === 0) {
          list.push({
            key: `${step.id}-0`,
            meta: { stepId: step.id, firstStep: true },
            node: (
              <div className="h-full flex flex-col bg-card">
                <div className="flex-1 flex flex-col justify-center p-10 md:p-16">
                  <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{chapterTitle}</p>
                  <p className="text-xs text-muted-foreground mb-2">{format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}</p>
                  <h2 className="text-3xl font-bold font-serif mb-3">{step.location_name}</h2>
                  <p className="text-base leading-relaxed text-foreground/80 italic whitespace-pre-line">"{step.description}"</p>
                </div>
                <StepPageFooter step={step} stepIdx={stepIdx} totalSteps={totalVisible} cumulativeCost={cumulativeCost} budgetTotal={budgetTotal} />
              </div>
            ),
          });
          continue;
        }

        // Determine batch size from layout
        const batchSize =
          layout === "1-full" ? 1
          : layout === "2-side" || layout === "2-stack" ? 2
          : 4; // "grid" or "auto" → 4

        // For "auto" with a single photo, use full-bleed layout
        const useFullBleed = layout === "1-full" || (layout === "auto" && photos.length === 1);

        let pageIdx = 0;
        for (let i = 0; i < photos.length; i += batchSize) {
          const batch = photos.slice(i, i + batchSize);
          const isFirst = pageIdx === 0;
          const pageKey = `${step.id}-${pageIdx}`;

          if (useFullBleed) {
            // Single photo with safe printer margin + caption
            list.push({
              key: pageKey,
              meta: { stepId: step.id, firstStep: pageIdx === 0 },
              node: (
                <div className="h-full flex flex-col bg-[#f8f7f4] p-[5%]">
                  <div className="flex-[3] min-h-0 overflow-hidden">
                    <img src={batch[0].media_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </div>
                  {isFirst && (
                    <div className="flex-[1] min-h-0 pt-3 overflow-hidden">
                      <p className="text-[8px] uppercase tracking-[0.2em] text-accent font-bold mb-0.5">{chapterTitle}</p>
                      <p className="text-[8px] text-muted-foreground mb-1">{format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}</p>
                      <h2 className="text-lg font-bold font-serif leading-tight mb-1">{step.location_name}</h2>
                      {hasDescription && <p className="text-[10px] text-foreground/70 italic leading-snug line-clamp-3">"{step.description}"</p>}
                    </div>
                  )}
                  <StepPageFooter step={step} stepIdx={stepIdx} totalSteps={totalVisible} cumulativeCost={cumulativeCost} budgetTotal={budgetTotal} />
                </div>
              ),
            });
          } else {
            // Grid layout — with gap between photos and printer-safe margin
            const gridClass =
              layout === "2-side" ? "grid-cols-2 grid-rows-1"
              : layout === "2-stack" ? "grid-cols-1 grid-rows-2"
              : layout === "grid" ? "grid-cols-2 grid-rows-[1fr_1fr]"
              : batch.length === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-2 grid-rows-[1fr_1fr]"; // auto

            list.push({
              key: pageKey,
              meta: { stepId: step.id, firstStep: pageIdx === 0 },
              node: (
                <div className="h-full flex flex-col bg-card overflow-hidden p-[5%]">
                  <div className={`flex-1 overflow-hidden grid min-h-0 gap-[3%] ${gridClass}`}>
                    {batch.map((m: any) => (
                      <img key={m.id} src={m.media_url} loading="lazy" alt="" className="w-full h-full object-cover min-h-0 min-w-0 block" />
                    ))}
                  </div>
                  {isFirst && (
                    <div className="pt-3">
                      <p className="text-[10px] uppercase tracking-widest text-accent mb-0.5 font-bold">{chapterTitle}</p>
                      <h2 className="text-base font-bold font-serif leading-tight">{step.location_name}</h2>
                      {hasDescription && <p className="text-xs text-foreground/70 mt-0.5 italic line-clamp-2">"{step.description}"</p>}
                    </div>
                  )}
                  <StepPageFooter step={step} stepIdx={stepIdx} totalSteps={totalVisible} cumulativeCost={cumulativeCost} budgetTotal={budgetTotal} />
                </div>
              ),
            });
          }

          pageIdx++;
        }
      }
    }

    return list;
  }, [trip, steps, settings, excludedMedia, excludedSteps, editing, stepBudgetMap]);

  // Build page spreads: spread 0 = [null, cover], spread n = [pages[2n-1], pages[2n]]
  const spreads = useMemo(() => {
    if (pages.length === 0) return [[null, null]];
    const result: (typeof pages[0] | null)[][] = [];
    result.push([null, pages[0]]);
    for (let i = 1; i < pages.length; i += 2) {
      result.push([pages[i] ?? null, pages[i + 1] ?? null]);
    }
    return result;
  }, [pages]);

  // Derive spread index from flat page index
  const spreadIdx = pageIdx === 0 ? 0 : Math.ceil(pageIdx / 2);
  const safeSpread = Math.min(spreadIdx, Math.max(0, spreads.length - 1));
  const [leftPage, rightPage] = spreads[safeSpread];
  const isCover = safeSpread === 0;

  // Spread navigation helpers (desktop)
  const goToPrevSpread = () => setPageIdx(safeSpread <= 1 ? 0 : (safeSpread - 1) * 2 - 1);
  const goToNextSpread = () => setPageIdx(Math.min(pages.length - 1, safeSpread * 2 + 1));
  const goToFirstSpread = () => setPageIdx(0);
  const goToLastSpread = () => setPageIdx(Math.max(0, pages.length - 1));

  const PRICE_PER_PAGE = 0.75;
  const BOOK_BASE = 12.95;
  const CONTENT_PAGES = Math.max(0, pages.length - 1);
  const totalPrice = BOOK_BASE + CONTENT_PAGES * PRICE_PER_PAGE;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <div className="container py-4 flex flex-wrap items-center gap-3">
        <Link to={`/trip/${id}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Button>
        </Link>
        <span className="text-sm text-muted-foreground">
          {isCover
            ? "Cover"
            : `Pagina ${(safeSpread - 1) * 2 + 1}–${Math.min((safeSpread - 1) * 2 + 2, pages.length - 1)} / ${pages.length - 1}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPrintedPdfUrl(null); setPrintOpen(true); }}
              className="gap-1.5"
            >
              <BookOpen className="h-4 w-4" />
              Bestel als boek
            </Button>
          )}
          {isOwner && (
            <Button
              variant={editing ? "default" : "outline"}
              size="sm"
              onClick={() => { setEditing(!editing); if (editing) setOverviewMode(false); }}
              className="gap-1.5"
            >
              {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editing ? "Klaar" : "Bewerk"}
            </Button>
          )}
          {isOwner && editing && (
            <Button
              variant={overviewMode ? "secondary" : "outline"}
              size="sm"
              onClick={() => setOverviewMode(!overviewMode)}
              className="gap-1.5"
            >
              <LayoutGrid className="h-4 w-4" />
              {overviewMode ? "Boek" : "Overzicht"}
            </Button>
          )}
        </div>
      </div>

      {editing && !overviewMode && isCover && (
        <div className="container pb-3 space-y-2">
          <div className="rounded-lg border bg-card p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cover</p>

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Omslagfoto</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  onClick={() => upsertSettings({ cover_media_id: null })}
                  className={`flex-shrink-0 w-14 h-14 rounded border-2 overflow-hidden relative ${!settings.cover_media_id ? "border-primary" : "border-transparent"}`}
                  title="Standaard: projectcover"
                >
                  {trip.cover_image_url ? (
                    <img src={trip.cover_image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center text-[9px]">Geen</div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-primary/80 text-primary-foreground text-[8px] py-0.5 text-center font-medium">Project</span>
                </button>
                {steps.flatMap((s: any) => (s.step_media || []).filter((m: any) => m.media_type !== "video")).map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => upsertSettings({ cover_media_id: m.id })}
                    className={`flex-shrink-0 w-14 h-14 rounded border-2 overflow-hidden ${settings.cover_media_id === m.id ? "border-primary" : "border-transparent"}`}
                  >
                    <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <Input
              placeholder={trip.title}
              value={settings.cover_title ?? ""}
              onChange={(e) => upsertSettings({ cover_title: e.target.value || null })}
            />
            <Input
              placeholder={trip.address ?? "Ondertitel"}
              value={settings.cover_subtitle ?? ""}
              onChange={(e) => upsertSettings({ cover_subtitle: e.target.value || null })}
            />

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Tekstpositie</p>
              <div className="flex gap-2">
                {([["top", "Boven"], ["center", "Midden"], ["bottom", "Onder"]] as const).map(([val, label]) => {
                  const active = (settings.chapter_overrides["__cover_text_pos__"] || "bottom") === val;
                  return (
                    <button
                      key={val}
                      onClick={() => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, "__cover_text_pos__": val } })}
                      className={`flex-1 py-1.5 rounded border text-xs font-medium transition ${active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              💡 Klik op een foto in het boek om die uit het fotoboek te halen (blijft in je tijdlijn).
              Klik op een hoofdstukpagina om de titel aan te passen.
            </p>
          </div>
        </div>
      )}

      {editing && !overviewMode && !isCover && (() => {
        // On mobile: use the current single page's stepId; on desktop: use both spread pages
        const currentStep = pages[pageIdx]?.meta?.stepId;
        const visibleStepIds = Array.from(new Set(
          [currentStep, leftPage?.meta?.stepId, rightPage?.meta?.stepId].filter(Boolean) as string[]
        ));
        if (visibleStepIds.length === 0) return null;
        return (
          <div className="container pb-3 space-y-2">
            {visibleStepIds.map((stepId) => {
              const step = steps.find((s: any) => s.id === stepId);
              if (!step) return null;
              const currentLayout: StepLayout = (settings.step_layout_overrides[stepId] as StepLayout) ?? "auto";
              const isHidden = excludedSteps.has(stepId);
              const photos = (step.step_media || []).filter((m: any) => m.media_type !== "video");
              return (
                <div key={stepId} className="rounded-lg border bg-card p-3 space-y-3">
                  {/* Step header + include/exclude toggle */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold truncate min-w-0">{step.location_name}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground">{isHidden ? "Verborgen" : "In fotoboek"}</span>
                      <Switch checked={!isHidden} onCheckedChange={() => toggleStep(stepId)} />
                    </div>
                  </div>

                  {/* Layout selector */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Lay-out</p>
                    <div className="flex gap-2 flex-wrap">
                      {STEP_LAYOUTS.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => upsertSettings({ step_layout_overrides: { ...settings.step_layout_overrides, [stepId]: l.id } })}
                          title={l.label}
                          className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition ${currentLayout === l.id ? "border-primary bg-primary/5" : "border-transparent hover:border-muted-foreground/30"}`}
                        >
                          {l.icon}
                          <span className="text-[10px] text-muted-foreground">{l.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Photo order/exclude — moved OUT of page overlay */}
                  {photos.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                        Foto's — sleep om volgorde te wijzigen · klik om te verbergen
                      </p>
                      <PhotoManagePanel
                        stepId={stepId}
                        photos={photos}
                        excludedMedia={excludedMedia}
                        onToggleMedia={toggleMedia}
                        onReorder={(sid, newOrder) => upsertSettings({ step_photo_order: { ...settings.step_photo_order, [sid]: newOrder } })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}


      {overviewMode && (
        <div className="flex-1 flex flex-col bg-[#16162a] overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto">
              <p className="text-white/50 text-sm mb-5">
                {pages.length} pagina's · klik op een pagina om er naartoe te gaan
              </p>
              <div className="flex flex-wrap gap-4">
                {pages.map((page, idx) => {
                  const targetSpreadIdx = idx === 0 ? 0 : Math.ceil(idx / 2);
                  const isStepHidden = page.meta?.stepId ? excludedSteps.has(page.meta.stepId) : false;
                  return (
                    <button
                      key={page.key}
                      onClick={() => { setPageIdx(idx); setOverviewMode(false); }}
                      className="group flex flex-col items-center gap-1.5"
                      title={idx === 0 ? "Cover" : `Pagina ${idx}`}
                    >
                      <div
                        className="rounded overflow-hidden border-2 border-transparent group-hover:border-white/50 transition relative bg-[#f8f7f4]"
                        style={{ width: 150, height: 100 }}
                      >
                        <div
                          style={{
                            width: 600,
                            height: 400,
                            transformOrigin: "top left",
                            transform: "scale(0.25)",
                            position: "absolute",
                            top: 0,
                            left: 0,
                            pointerEvents: "none",
                          }}
                        >
                          {page.node}
                        </div>

                        {isStepHidden && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <EyeOff className="h-5 w-5 text-white/70" />
                          </div>
                        )}
                      </div>
                      <span className="text-[9px] text-white/40 group-hover:text-white/70 transition tabular-nums">
                        {idx === 0 ? "Cover" : idx}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="bg-background border-t px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="font-semibold">{CONTENT_PAGES}</span>
              <span className="text-muted-foreground"> pagina's</span>
              <span className="text-muted-foreground text-xs ml-2">(incl. cover: {pages.length})</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Schatting:{" "}
              <span className="font-semibold text-foreground">
                €{totalPrice.toFixed(2).replace(".", ",")}
              </span>
              <span className="text-xs ml-2">
                · €{PRICE_PER_PAGE.toFixed(2).replace(".", ",")} p/p + €{BOOK_BASE.toFixed(2).replace(".", ",")} basis
              </span>
            </p>
          </div>
        </div>
      )}
      {!overviewMode && (
      <div className="flex-1 flex flex-col bg-[#16162a]">

        {/* ── MOBILE: single page portrait (shows exactly one printed page) ── */}
        <div className="md:hidden flex-1 flex flex-col items-center justify-center py-6 px-4">
          <div
            className="mx-auto relative rounded-sm overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] bg-[#f8f7f4]"
            style={{ width: "min(100%, calc((100vh - 220px) * 3 / 2))", aspectRatio: "3/2" }}
          >

            {pages[pageIdx] ? (
              <div className="absolute inset-0">
                {pages[pageIdx].node}
                {editing && pages[pageIdx].meta?.chapter && (
                  <ChapterEditOverlay
                    phase={pages[pageIdx].meta!.chapter!}
                    value={settings.chapter_overrides[pages[pageIdx].meta!.chapter!] || ""}
                    onChange={(v) => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, ...(v ? { [pages[pageIdx].meta!.chapter!]: v } : {}) } })}
                  />
                )}
              </div>
            ) : (
              <div className="w-full h-full bg-[#e8e6df]" />
            )}
          </div>
          {/* Mobile nav */}
          <div className="flex items-center gap-3 mt-5">
            <button onClick={() => setPageIdx(0)} disabled={pageIdx === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronsLeft className="h-4 w-4" /></button>
            <button onClick={() => setPageIdx(Math.max(0, pageIdx - 1))} disabled={pageIdx === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-white/60 text-sm min-w-[110px] text-center tabular-nums">
              {pageIdx === 0 ? "Cover" : `${pageIdx} / ${pages.length - 1}`}
            </span>
            <button onClick={() => setPageIdx(Math.min(pages.length - 1, pageIdx + 1))} disabled={pageIdx >= pages.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => setPageIdx(pages.length - 1)} disabled={pageIdx >= pages.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronsRight className="h-4 w-4" /></button>
          </div>
          <p className="text-white/30 text-xs mt-2 text-center">Elke pagina zoals hij gedrukt wordt</p>
        </div>

        {/* ── DESKTOP: two-page spread view ── */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center py-8 px-4">
        {/* Book spread */}
        <div className="w-full max-w-6xl" style={{ aspectRatio: "3/1" }}>
          <div className="relative h-full rounded-sm overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.85)]">
            <div className="flex h-full">
              {/* Left page */}
              <div
                className="flex-1 relative overflow-hidden bg-[#f8f7f4]"
                style={{ boxShadow: "inset -8px 0 24px rgba(0,0,0,0.12)" }}
              >
                {leftPage ? (
                  <div className="absolute inset-0">
                    {leftPage.node}
                    {editing && leftPage.meta?.chapter && (
                      <ChapterEditOverlay
                        phase={leftPage.meta.chapter}
                        value={settings.chapter_overrides[leftPage.meta.chapter] || ""}
                        onChange={(v) => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, ...(v ? { [leftPage.meta!.chapter!]: v } : {}) } })}
                      />
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full bg-[#e8e6df]" />
                )}
              </div>

              {/* Spine */}
              <div
                className="w-[6px] flex-shrink-0"
                style={{ background: "linear-gradient(to right, rgba(0,0,0,0.28), rgba(0,0,0,0.06), rgba(0,0,0,0.28))" }}
              />

              {/* Right page */}
              <div
                className="flex-1 relative overflow-hidden bg-[#f8f7f4]"
                style={{ boxShadow: "inset 8px 0 24px rgba(0,0,0,0.12)" }}
              >
                {rightPage ? (
                  <div className="absolute inset-0">
                    {rightPage.node}
                    {editing && rightPage.meta?.chapter && (
                      <ChapterEditOverlay
                        phase={rightPage.meta.chapter}
                        value={settings.chapter_overrides[rightPage.meta.chapter] || ""}
                        onChange={(v) => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, ...(v ? { [rightPage.meta!.chapter!]: v } : {}) } })}
                      />
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full bg-[#f0efe9]" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation — Polarsteps style */}
        <div className="flex items-center gap-3 mt-6">
          <button onClick={goToFirstSpread} disabled={safeSpread === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition" title="Eerste pagina"><ChevronsLeft className="h-4 w-4" /></button>
          <button onClick={goToPrevSpread} disabled={safeSpread === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition" title="Vorige spread"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-white/60 text-sm min-w-[120px] text-center tabular-nums">
            {isCover ? "Cover" : `${(safeSpread - 1) * 2 + 1}\u2013${Math.min((safeSpread - 1) * 2 + 2, pages.length - 1)} / ${pages.length - 1}`}
          </span>
          <button onClick={goToNextSpread} disabled={safeSpread >= spreads.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition" title="Volgende spread"><ChevronRight className="h-4 w-4" /></button>
          <button onClick={goToLastSpread} disabled={safeSpread >= spreads.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition" title="Laatste pagina"><ChevronsRight className="h-4 w-4" /></button>
        </div>
        {!editing && (
          <p className="text-white/35 text-xs mt-3 text-center">
            Gebruik de pijlen om door het boek te bladeren.
          </p>
        )}
        </div>{/* end desktop */}
      </div>
      )}


      <Dialog open={printOpen} onOpenChange={(open) => { setPrintOpen(open); if (!open) setPrintedPdfUrl(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bestel als hardcover Bouwboek</DialogTitle>
            <DialogDescription>
              Wij maken een print-klare PDF van jouw verbouwing en sturen die direct naar Peecho. Zij zorgen voor druk en verzending aan huis.
            </DialogDescription>
          </DialogHeader>

          {!isPro ? (
            <div className="space-y-3 rounded-md border border-accent/40 bg-accent/5 p-4">
              <div className="flex items-start gap-2">
                <div className="text-xs font-bold uppercase tracking-widest bg-accent text-accent-foreground px-2 py-0.5 rounded-full">Buildy Pro</div>
              </div>
              <p className="text-sm font-medium leading-snug">
                Een hardcover Bouwboek laten drukken is een Buildy Pro-functie.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Stuur ons een berichtje — we activeren Pro handmatig voor jouw account en je kunt meteen bestellen.
              </p>
              <Button asChild className="w-full">
                <a href="mailto:hi@buildy.app?subject=Buildy%20Pro%20activeren&body=Hoi%2C%20ik%20wil%20graag%20mijn%20verbouwing%20als%20Bouwboek%20bestellen!">
                  Vraag Pro aan
                </a>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Formaat</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PEECHO_FORMATS) as PeechoFormat[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => { setPrintFormat(k); setPrintedPdfUrl(null); }}
                      disabled={printBusy}
                      className={`rounded-md border p-2 text-left text-xs transition ${printFormat === k ? "border-primary bg-primary/5" : "border-border hover:bg-muted"}`}
                    >
                      <p className="font-semibold">{PEECHO_FORMATS[k].label}</p>
                      <p className="text-muted-foreground">{PEECHO_FORMATS[k].w} × {PEECHO_FORMATS[k].h} mm</p>
                    </button>
                  ))}
                </div>
              </div>

              {!printedPdfUrl ? (
                <Button onClick={handleGeneratePeechoPdf} disabled={printBusy} className="w-full gap-2">
                  {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                  {printBusy ? "Boek voorbereiden…" : "Boek klaarmaken voor bestelling"}
                </Button>
              ) : (
                <PeechoPrintWidget
                  pdfUrl={printedPdfUrl}
                  pages={pages.length}
                  format={PEECHO_FORMATS[printFormat]}
                  coverUrl={trip?.cover_image_url ?? undefined}
                  title={settings.cover_title || trip?.title || "Bouwboek"}
                  scriptUrl={PEECHO_SCRIPT_URL}
                />
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Betaling en verzending via Peecho. Levertijd ca. 7–14 werkdagen.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrintOpen(false)}>Sluiten</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** Panel-style photo manager rendered outside the page (in the edit controls panel) */
const PhotoManagePanel = ({
  stepId,
  photos,
  excludedMedia,
  onToggleMedia,
  onReorder,
}: {
  stepId: string;
  photos: any[];
  excludedMedia: Set<string>;
  onToggleMedia: (id: string) => void;
  onReorder: (stepId: string, newOrder: string[]) => void;
}) => {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const newOrder = photos.map((m: any) => m.id);
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(targetIdx, 0, moved);
    onReorder(stepId, newOrder);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
      {photos.map((m: any, idx: number) => {
        const out = excludedMedia.has(m.id);
        const isDragging = dragIdx === idx;
        const isOver = dragOverIdx === idx && dragIdx !== idx;
        return (
          <div
            key={m.id}
            className={`relative group cursor-grab active:cursor-grabbing transition-opacity select-none ${isDragging ? "opacity-30" : ""}`}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragIdx(idx); }}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          >
            <img
              src={m.media_url}
              alt=""
              draggable={false}
              className={`w-14 h-14 object-cover rounded-md transition ${out ? "opacity-40 grayscale" : ""} ${isOver ? "ring-2 ring-primary" : ""}`}
            />
            {out && (
              <>
                <div className="absolute inset-0 rounded-md ring-2 ring-destructive" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <EyeOff className="h-4 w-4 text-destructive drop-shadow" />
                </div>
              </>
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-md">
              <button
                onClick={() => onToggleMedia(m.id)}
                className="text-white p-1.5 hover:bg-white/20 rounded-full"
                title={out ? "Terugzetten in fotoboek" : "Verberg uit fotoboek"}
              >
                {out ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const PhotoEditOverlay = ({
  step,
  excludedMedia,
  onToggleMedia,
  onReorder,
}: {
  step: any;
  excludedMedia: Set<string>;
  onToggleMedia: (id: string) => void;
  onReorder: (stepId: string, newOrder: string[]) => void;
}) => {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  if (!step) return null;
  const photos = (step.step_media || []).filter((m: any) => m.media_type !== "video");

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const newOrder = photos.map((m: any) => m.id);
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(targetIdx, 0, moved);
    onReorder(step.id, newOrder);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  return (
    <div className="absolute bottom-2 left-2 right-2 z-10 bg-black/70 backdrop-blur rounded-lg p-2">
      <p className="text-[9px] text-white/50 mb-1.5 select-none">Sleep om volgorde te wijzigen · Hover voor toon/verberg</p>
      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {photos.map((m: any, idx: number) => {
          const out = excludedMedia.has(m.id);
          const isDragging = dragIdx === idx;
          const isOver = dragOverIdx === idx && dragIdx !== idx;
          return (
            <div
              key={m.id}
              className={`relative group cursor-grab active:cursor-grabbing transition-opacity select-none ${isDragging ? "opacity-30" : ""}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragIdx(idx); }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
              onDragLeave={() => setDragOverIdx(null)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
            >
              <img
                src={m.media_url}
                alt=""
                draggable={false}
                className={`w-12 h-12 object-cover rounded transition ${out ? "opacity-40 grayscale" : ""} ${isOver ? "ring-2 ring-white ring-offset-1 ring-offset-black/70" : ""}`}
              />
              {out && (
                <>
                  <div className="absolute inset-0 rounded ring-2 ring-destructive" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <EyeOff className="h-4 w-4 text-destructive drop-shadow" />
                  </div>
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded">
                    Uit
                  </span>
                </>
              )}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded">
                <button
                  onClick={() => onToggleMedia(m.id)}
                  className="text-white p-1 hover:bg-white/20 rounded"
                  title={out ? "Terugzetten in fotoboek" : "Verberg uit fotoboek"}
                >
                  {out ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const StepPageFooter = ({
  step,
  stepIdx,
  totalSteps,
  cumulativeCost,
  budgetTotal,
}: {
  step: any;
  stepIdx: number;
  totalSteps: number;
  cumulativeCost: number;
  budgetTotal: number | null;
}) => {
  const progressPct = totalSteps > 0 ? ((stepIdx + 1) / totalSteps) * 100 : 0;

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-4 py-1.5 bg-[#f4f3ef] border-t border-black/[0.06]">
      {/* Step counter */}
      <span className="text-[7px] text-muted-foreground/50 font-medium tabular-nums shrink-0">
        {stepIdx + 1}/{totalSteps}
      </span>
      {/* Thin progress line */}
      <div className="flex-1 h-[2px] rounded-full bg-black/[0.07] overflow-hidden">
        <div className="h-full rounded-full bg-accent/50 transition-all" style={{ width: `${progressPct}%` }} />
      </div>
      {/* Date */}
      <span className="text-[7px] text-muted-foreground/50 shrink-0">
        {format(new Date(step.step_date), "d MMM ''yy", { locale: nl })}
      </span>
    </div>
  );
};

const ChapterEditOverlay = ({ phase, value, onChange }: { phase: string; value: string; onChange: (v: string) => void }) => {
  return (
    <div className="absolute bottom-4 left-4 right-4 z-10">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Standaard: ${phase}`}
        className="bg-background/95 backdrop-blur"
      />
    </div>
  );
};

/**
 * Renders Peecho's Print Button JS widget for direct ordering.
 * The widget loads Peecho's checkout in a popup when clicked.
 * data-src must be a publicly accessible PDF URL (Supabase public storage).
 */
const PeechoPrintWidget = ({
  pdfUrl,
  pages,
  format,
  coverUrl,
  title,
  scriptUrl,
}: {
  pdfUrl: string;
  pages: number;
  format: { w: number; h: number; label: string };
  coverUrl?: string;
  title: string;
  scriptUrl: string;
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;

    // Inject Peecho JS script once per page lifecycle
    const scriptId = "peecho-print-script";
    if (!document.getElementById(scriptId) && scriptUrl) {
      const s = document.createElement("script");
      s.id = scriptId;
      s.type = "text/javascript";
      s.async = true;
      s.src = scriptUrl;
      document.head.appendChild(s);
    }

    // When the script loads (or is already loaded), re-init the button
    const reinit = () => {
      if ((window as any).peecho?.init) {
        (window as any).peecho.init();
      }
    };
    const existing = document.getElementById(scriptId);
    if (existing) {
      existing.addEventListener("load", reinit);
      reinit(); // try immediately in case already loaded
    }
    return () => {
      existing?.removeEventListener("load", reinit);
    };
  }, [pdfUrl, scriptUrl]);

  return (
    <div className="rounded-md border bg-secondary/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
        <p className="text-xs font-medium text-accent">Bouwboek klaar voor bestelling</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Klik op de knop hieronder. Peecho opent een bestelscherm waar je je adres invult en betaalt. Wij zorgen voor druk en verzending.
      </p>
      <div ref={containerRef} className="flex justify-center py-2">
        {/* Peecho Print Button — Peecho's JS replaces this anchor with their branded button */}
        <a
          title="Bouwboek bestellen"
          href="https://www.peecho.com/"
          className="peecho-print-button"
          data-filetype="pdf"
          data-width={format.w}
          data-height={format.h}
          data-pages={pages}
          data-src={pdfUrl}
          data-thumbnail={coverUrl || ""}
          data-locale="nl_NL"
          data-currency="EUR"
          data-text="Bestel Bouwboek"
        >
          Bouwboek bestellen via Peecho
        </a>
      </div>
      {!scriptUrl && (
        <p className="text-[10px] text-destructive text-center">
          Configureer <code>VITE_PEECHO_SCRIPT_URL</code> in je .env om het bestelwidget te activeren.
        </p>
      )}
    </div>
  );
};

export default Photobook;

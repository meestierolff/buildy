import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, Pencil, Eye, EyeOff, Check, BookOpen, Loader2, ExternalLink, PackageCheck, AlertTriangle, Cloud, CloudOff, FileText, Upload, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";
import { buildPeechoPdf, getPeechoPrintPageCount, PEECHO_FORMATS, PEECHO_MIN_PAGES, type PeechoFormat } from "@/lib/peechoExport";
import { assertPeechoPdfReachable, createPeechoReference } from "@/lib/peecho";
import { usePageMeta } from "@/hooks/usePageMeta";
import { hydrateStepsMedia } from "@/lib/mediaUrl";

type StepLayout = "auto" | "1-full" | "2-side" | "2-stack" | "3-mixed" | "grid";
type CoverTextPos = "bottom" | "top" | "center";

const PRINT_PAGE_WIDTH = 600;
const PRINT_PAGE_HEIGHT = 400;
const TEXT_CHARS_PER_PAGE = 900;

const PHOTO_DND_MIME = "application/x-buildy-photo";


const sortMediaByTimelineOrder = <T extends { sort_order?: number | null; created_at?: string | null }>(media: T[]) =>
  [...media].sort((a, b) => {
    const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

const getPageLayout = (
  overrides: Record<string, StepLayout>,
  pageKey: string,
  stepId: string,
): StepLayout => overrides[pageKey] ?? overrides[stepId] ?? "auto";

const getPhotobookBatchSize = (layout: StepLayout, remainingPhotos: number) => {
  if (layout === "1-full") return 1;
  if (layout === "2-side" || layout === "2-stack") return Math.min(2, remainingPhotos);
  if (layout === "3-mixed") return Math.min(3, remainingPhotos);
  return Math.min(4, remainingPhotos);
};

const layoutForPhotoCount = (count: number, preferred?: StepLayout): StepLayout => {
  if (count <= 1) return "1-full";
  if (count === 2) return preferred === "2-stack" ? "2-stack" : "2-side";
  if (count === 3) return "3-mixed";
  return "grid";
};

const splitTextIntoPages = (text: string, maxChars = TEXT_CHARS_PER_PAGE) => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const pages: string[] = [];
  let current = "";
  const words = trimmed.split(/(\s+)/);

  for (const word of words) {
    if (!word) continue;
    const next = `${current}${word}`;
    if (current && next.length > maxChars) {
      pages.push(current.trim());
      current = word.trimStart();
    } else {
      current = next;
    }
  }

  if (current.trim()) pages.push(current.trim());
  return pages;
};

interface PhotobookPageMeta {
  stepId?: string;
  chapter?: string;
  firstStep?: boolean;
  photoIds?: string[];
}

interface PhotobookPage {
  key: string;
  node: React.ReactNode;
  meta?: PhotobookPageMeta;
}

interface PhotobookSettings {
  cover_title: string | null;
  cover_subtitle: string | null;
  cover_media_id: string | null;
  chapter_overrides: Record<string, string>;
  step_layout_overrides: Record<string, StepLayout>;
  step_photo_order: Record<string, string[]>;
}

interface PhotobookOrder {
  id: string;
  merchant_reference: string;
  peecho_id: string | null;
  format: string;
  page_count: number;
  status: string;
  payment_status?: string;
  payment_amount_cents?: number | null;
  payment_currency?: string;
  fulfillment_status?: string;
  fulfillment_error?: string | null;
  tracking_code: string | null;
  tracking_url: string | null;
  created_at: string;
  ordered_at: string | null;
  status_updated_at: string | null;
}

const PHOTOBOOK_ORDER_SELECT_BASE = "id, merchant_reference, peecho_id, format, page_count, status, tracking_code, tracking_url, created_at, ordered_at, status_updated_at";
const PHOTOBOOK_ORDER_SELECT_EXTENDED = "id, merchant_reference, peecho_id, format, page_count, status, payment_status, payment_amount_cents, payment_currency, fulfillment_status, fulfillment_error, tracking_code, tracking_url, created_at, ordered_at, status_updated_at";

const fetchPhotobookOrders = async (tripId: string) => {
  const legacy = await supabase
    .from("photobook_orders")
    .select(PHOTOBOOK_ORDER_SELECT_BASE)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (legacy.error) {
    console.error("Could not fetch photobook order history:", legacy.error);
    return [];
  }
  return legacy.data || [];
};

const STEP_LAYOUTS: { id: StepLayout; label: string; icon: React.ReactNode }[] = [
  {
    id: "auto",
    label: "Buildy",
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
    id: "3-mixed",
    label: "3 mix",
    icon: (
      <div className="w-9 h-7 border-2 border-current rounded-sm p-0.5 grid grid-cols-[1.35fr_1fr] grid-rows-2 gap-0.5">
        <div className="bg-current/40 rounded-[1px] row-span-2" />
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
  const [searchParams] = useSearchParams();
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
  const [printStep, setPrintStep] = useState<"idle" | "pdf" | "upload" | "checkout" | "done">("idle");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [photobookOrders, setPhotobookOrders] = useState<PhotobookOrder[]>([]);
  const [stepBudgetMap, setStepBudgetMap] = useState<Map<string, number>>(new Map());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimerRef = useRef<number | null>(null);
  const checkoutToastShown = useRef(false);
  usePageMeta({
    title: trip?.title ? `Bouwboek van ${trip.title} — Buildy` : "Bouwboek maken — Buildy",
    description: "Bekijk en bestel het Bouwboek van deze verbouwing met foto's, fases en mijlpalen.",
    path: id ? `/trip/${id}/photobook` : undefined,
    noIndex: true,
  });
  const defaultCoverMedia = useMemo(() => {
    if (trip?.cover_image_url) return { media_url: trip.cover_image_url, media_type: "image" };
    return steps
      .flatMap((s) => s.step_media || [])
      .find((m: any) => m.media_type !== "video" && m.media_type !== "pdf") ?? null;
  }, [steps, trip?.cover_image_url]);

  useEffect(() => {
    if (checkoutToastShown.current) return;
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      checkoutToastShown.current = true;
      toast.success("Betaling ontvangen — we verwerken je Bouwboek order");
    } else if (checkout === "cancelled") {
      checkoutToastShown.current = true;
      toast.info("Betaling geannuleerd. Je kunt je Bouwboek opnieuw klaarmaken wanneer je wilt.");
    }
  }, [searchParams]);

  const handleGeneratePeechoPdf = async () => {
    if (!trip || !id) return;
    setPrintBusy(true);
    setCheckoutUrl(null);
    setPrintStep("pdf");
    let uploadedPdfPath: string | null = null;
    let pdfReadyForCheckout = false;
    try {
      const orderReference = createPeechoReference(id);
      const blob = await buildPeechoPdf({
        trip, steps, settings, excludedMedia, excludedSteps, format: printFormat,
      });
      setPrintStep("upload");
      // Upload to public storage so Peecho can fetch the PDF directly
      const path = `${trip.user_id}/peecho/${orderReference}.pdf`;
      const { error: upErr } = await supabase.storage.from("trip-media").upload(path, blob, {
        contentType: "application/pdf", upsert: true,
      });
      if (upErr) throw upErr;
      uploadedPdfPath = path;

      const { data: pub } = supabase.storage.from("trip-media").getPublicUrl(path);
      await assertPeechoPdfReachable(pub.publicUrl);
      pdfReadyForCheckout = true;
      const pageCount = getPeechoPrintPageCount(pages.length);

      setPrintStep("checkout");
      const { data: orderData, error: orderErr } = await supabase
        .from("photobook_orders")
        .insert({
          trip_id: id,
          user_id: trip.user_id,
          merchant_reference: orderReference,
          pdf_url: pub.publicUrl,
          format: printFormat,
          page_count: pageCount,
          status: "pdf_ready",
          payment_status: "unpaid",
          payment_currency: "eur",
          fulfillment_status: "not_started",
        })
        .select(PHOTOBOOK_ORDER_SELECT_EXTENDED)
        .single();
      if (orderErr || !orderData) throw orderErr || new Error("Order kon niet worden aangemaakt");
      const newOrder = orderData as unknown as PhotobookOrder;

      const { data: checkoutData, error: checkoutErr } = await supabase.functions.invoke("create-photobook-checkout", {
        body: { orderId: newOrder.id },
      });
      if (checkoutErr) throw checkoutErr;
      if (!checkoutData?.checkoutUrl) throw new Error("Checkout-url ontbreekt");

      setPrintStep("done");
      setCheckoutUrl(checkoutData.checkoutUrl);
      setPhotobookOrders((current) => [newOrder, ...current.filter((order) => order.id !== newOrder.id)].slice(0, 5));
      toast.success("Boek klaar — je gaat nu naar de beveiligde betaling");
      window.location.assign(checkoutData.checkoutUrl);
    } catch (e: any) {
      if (uploadedPdfPath && !pdfReadyForCheckout) {
        const { error: cleanupErr } = await supabase.storage.from("trip-media").remove([uploadedPdfPath]);
        if (cleanupErr) {
          console.error("Could not clean up unregistered Peecho PDF:", cleanupErr);
        }
      }
      console.error(e);
      setPrintStep("idle");
      toast.error(e.message || "Genereren mislukt");
    } finally {
      setPrintBusy(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      const [{ data: tripData }, { data: stepsData }, { data: settingsData }, { data: exMedia }, { data: exSteps }, { data: privInfo }, { data: budgetData }, orderData] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("steps").select("*, step_media(*)").eq("trip_id", id).order("step_date", { ascending: true }),
        supabase.from("photobook_settings").select("*").eq("trip_id", id).maybeSingle(),
        supabase.from("photobook_excluded_media").select("media_id").eq("trip_id", id),
        supabase.from("photobook_excluded_steps").select("step_id").eq("trip_id", id),
        supabase.from("trip_private_info").select("address").eq("trip_id", id).maybeSingle(),
        supabase.from("step_budget").select("step_id, cost").eq("trip_id", id),
        fetchPhotobookOrders(id),
      ]);
      setStepBudgetMap(new Map((budgetData || []).map((r: any) => [r.step_id, Number(r.cost) || 0])));
      setTrip(tripData ? { ...tripData, address: privInfo?.address ?? null } : null);
      await hydrateStepsMedia(stepsData as any);
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
      setPhotobookOrders((orderData || []) as PhotobookOrder[]);
      setLoading(false);
    };
    fetchData();
  }, [id, user?.id]);

  const upsertSettings = useCallback(async (patch: Partial<PhotobookSettings>) => {
    if (!id) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaveState("saving");
    const { error } = await supabase.from("photobook_settings").upsert({
      trip_id: id,
      cover_title: next.cover_title,
      cover_subtitle: next.cover_subtitle,
      cover_media_id: next.cover_media_id,
      chapter_overrides: next.chapter_overrides as any,
      step_layout_overrides: next.step_layout_overrides as any,
      step_photo_order: next.step_photo_order as any,
    });
    if (error) {
      setSaveState("idle");
      toast.error("Kon niet opslaan");
      return;
    }
    setSaveState("saved");
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
  }, [id, settings]);


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

  // Reorder photos within a step by drag & drop on the page preview.
  // Inserts dragged photo at the target's position in the step's visible photo order.
  const reorderPhotoTo = useCallback((stepId: string, draggedPhotoId: string, targetPhotoId: string) => {
    const step: any = steps.find((s: any) => s.id === stepId);
    if (!step) return;
    const baseTimeline = sortMediaByTimelineOrder(
      (step.step_media || []).filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf")
    );
    const customOrder = settings.step_photo_order[stepId];
    const ordered = customOrder?.length
      ? [...baseTimeline].sort((a: any, b: any) => {
          const ai = customOrder.indexOf(a.id);
          const bi = customOrder.indexOf(b.id);
          if (ai === -1 && bi === -1) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
      : baseTimeline;
    const ids = ordered.map((m: any) => m.id);
    const from = ids.indexOf(draggedPhotoId);
    const to = ids.indexOf(targetPhotoId);
    if (from === -1 || to === -1 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, draggedPhotoId);
    upsertSettings({ step_photo_order: { ...settings.step_photo_order, [stepId]: ids } });
  }, [settings.step_photo_order, steps, upsertSettings]);

  // Build pages (memoized)
  const pages = useMemo(() => {
    if (!trip) return [];

    const list: PhotobookPage[] = [];

    const allMedia = steps.flatMap((s) => (s.step_media || []).map((m: any) => ({ ...m, step: s })));
    const coverImage = settings.cover_media_id
      ? allMedia.find((m) => m.id === settings.cover_media_id)
      : defaultCoverMedia;
    const coverTitle = settings.cover_title || trip.title;
    const coverSubtitle = settings.cover_subtitle ?? trip.address ?? "";
    const coverTitleSize = coverTitle.length > 36
      ? "text-3xl"
      : coverTitle.length > 22
      ? "text-4xl"
      : "text-5xl";

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
            <h1 className={`${coverTitleSize} font-bold leading-[0.95] mb-3 font-serif drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)] [overflow-wrap:break-word] [hyphens:none] line-clamp-3`}>{coverTitle}</h1>
            {coverSubtitle && (
              <p className="text-sm mb-1 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] [overflow-wrap:break-word] line-clamp-2">{coverSubtitle}</p>
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
      const firstDateForPhase = (phase: string) =>
        grouped.get(phase)!.reduce((earliest, step) => {
          const date = step.step_date ?? "";
          return !earliest || (date && date < earliest) ? date : earliest;
        }, "");
      const aDate = firstDateForPhase(a);
      const bDate = firstDateForPhase(b);
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

    for (let phaseIdx = 0; phaseIdx < sortedPhases.length; phaseIdx++) {
      const phase = sortedPhases[phaseIdx];
      const chapterTitle = settings.chapter_overrides[phase] || phase;
      const phaseSteps = grouped.get(phase)!;
      const phaseStart = phaseSteps.reduce((a, s: any) => !a || (s.step_date && s.step_date < a) ? s.step_date : a, "");
      const phaseEnd = phaseSteps.reduce((a, s: any) => !a || (s.step_date && s.step_date > a) ? s.step_date : a, "");

      // Chapter divider page — quiet blueprint feel
      list.push({
        key: `chapter-${phase}`,
        meta: { chapter: phase, stepId: phaseSteps[0]?.id, firstStep: false },
        node: (
          <div className="h-full flex flex-col bg-[#f6f1e7] relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.08] pointer-events-none" style={{
              backgroundImage: "linear-gradient(to right, #1a3c2a 1px, transparent 1px), linear-gradient(to bottom, #1a3c2a 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }} />
            <div className="flex-1 flex flex-col justify-center px-[12%]">
              <p className="text-[9px] uppercase tracking-[0.4em] text-accent font-bold mb-4">Hoofdstuk {String(phaseIdx + 1).padStart(2, "0")}</p>
              <div className="flex items-baseline gap-5">
                <span className="text-[6rem] leading-none font-serif font-bold text-primary/15 tabular-nums">{String(phaseIdx + 1).padStart(2, "0")}</span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-3xl font-serif font-bold leading-tight [overflow-wrap:anywhere] line-clamp-2">{chapterTitle}</h2>
                  {phaseStart && (
                    <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-[0.15em]">
                      {format(new Date(phaseStart), "MMM yyyy", { locale: nl })}
                      {phaseEnd && phaseEnd !== phaseStart ? ` — ${format(new Date(phaseEnd), "MMM yyyy", { locale: nl })}` : ""}
                      <span className="ml-3">· {phaseSteps.length} update{phaseSteps.length === 1 ? "" : "s"}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-8 h-px w-24 bg-accent/40" />
            </div>
          </div>
        ),
      });

      for (const step of phaseSteps) {
        // Apply custom photo order, then filter out excluded media
        const allStepPhotos = sortMediaByTimelineOrder((step.step_media || []).filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf"));
        const customOrder = settings.step_photo_order[step.id] as string[] | undefined;
        const orderedPhotos = customOrder?.length
          ? [...allStepPhotos].sort((a: any, b: any) => {
              const ai = customOrder.indexOf(a.id);
              const bi = customOrder.indexOf(b.id);
              if (ai === -1 && bi === -1) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            })
          : allStepPhotos;
        const photos = orderedPhotos.filter((m: any) => !excludedMedia.has(m.id));
        const hasDescription = !!step.description;
        const descriptionPages = hasDescription ? splitTextIntoPages(step.description as string) : [];

        if (photos.length === 0 && !hasDescription && !step.location_name) continue;

        const stepIdx = stepIdxMap.get(step.id) ?? 0;
        const cumulativeCost = cumulativeCostMap.get(step.id) ?? 0;
        const introTextPages: (string | null)[] = descriptionPages.length ? descriptionPages : [null];
        introTextPages.forEach((descriptionPage, textPageIdx) => {
          list.push({
            key: textPageIdx === 0 ? `${step.id}-intro` : `${step.id}-text-${textPageIdx}`,
            meta: { stepId: step.id, firstStep: textPageIdx === 0 },
            node: (
              <div className="h-full grid grid-rows-[minmax(0,1fr)_auto] bg-card overflow-hidden">
                <div className="min-h-0 overflow-hidden flex flex-col justify-center px-[10%] py-[8%]">
                  <p className="text-[9px] uppercase tracking-[0.25em] text-accent mb-1.5 font-bold">{chapterTitle}</p>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    {format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}
                    {textPageIdx > 0 ? " · vervolg" : ""}
                  </p>
                  {step.location_name && (
                    <h2 className="text-xl font-bold font-serif mb-3 leading-tight [overflow-wrap:anywhere] line-clamp-2">{step.location_name}</h2>
                  )}
                  {descriptionPage && (
                    <p className="text-[11px] leading-[1.55] text-foreground/80 italic whitespace-pre-line [overflow-wrap:anywhere]">
                      &quot;{descriptionPage}&quot;
                    </p>
                  )}
                </div>
                <StepPageFooter
                  step={step}
                  stepIdx={stepIdx}
                  totalSteps={totalVisible}
                  cumulativeCost={cumulativeCost}
                  budgetTotal={budgetTotal}
                />
              </div>
            ),
          });
        });

        if (photos.length === 0) continue;

        // Subsequent pages: photos only, no captions
        let pageIdx = 0;
        let photoIdx = 0;
        while (photoIdx < photos.length) {
          const pageKey = `${step.id}-${pageIdx}`;
          const layout = getPageLayout(settings.step_layout_overrides, pageKey, step.id);
          const batchSize = getPhotobookBatchSize(layout, photos.length - photoIdx);
          const batch = photos.slice(photoIdx, photoIdx + batchSize) as any[];
          const useFullBleed = layout === "1-full" || batch.length === 1;

          if (useFullBleed) {
            list.push({
              key: pageKey,
              meta: { stepId: step.id, firstStep: false, photoIds: batch.map((m: any) => m.id) },
              node: (
                <div className="h-full bg-card overflow-hidden p-[5%]">
                  <PhotoFrame
                    src={batch[0].media_url}
                    className="h-full"
                    stepId={step.id}
                    photoId={batch[0].id}
                    editing={editing}
                    onMovePhoto={reorderPhotoTo}
                  />
                </div>
              ),
            });
          } else {
            const gridClass =
              layout === "2-side" ? "grid-cols-2 grid-rows-1"
              : layout === "2-stack" ? "grid-cols-1 grid-rows-2"
              : layout === "3-mixed" ? "grid-cols-[1.35fr_1fr] grid-rows-2"
              : layout === "grid" ? "grid-cols-2 grid-rows-[1fr_1fr]"
              : batch.length === 3 ? "grid-cols-[1.35fr_1fr] grid-rows-2"
              : batch.length === 4 ? "grid-cols-4 grid-rows-1"
              : batch.length === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-2 grid-rows-[1fr_1fr]";

            list.push({
              key: pageKey,
              meta: { stepId: step.id, firstStep: false, photoIds: batch.map((m: any) => m.id) },
              node: (
                <div className="h-full bg-card overflow-hidden p-[5%]">
                  <div className={`h-full overflow-hidden grid gap-[3%] ${gridClass}`}>
                    {(layout === "auto" || layout === "3-mixed") && batch.length === 3 ? (
                      <>
                        <PhotoFrame
                          src={batch[0].media_url}
                          className="row-span-2"
                          stepId={step.id}
                          photoId={batch[0].id}
                          editing={editing}
                          onMovePhoto={reorderPhotoTo}
                        />
                        {batch.slice(1).map((m: any) => (
                          <PhotoFrame
                            key={m.id}
                            src={m.media_url}
                            stepId={step.id}
                            photoId={m.id}
                            editing={editing}
                            onMovePhoto={reorderPhotoTo}
                          />
                        ))}
                      </>
                    ) : (
                      batch.map((m: any) => (
                        <PhotoFrame
                          key={m.id}
                          src={m.media_url}
                          stepId={step.id}
                          photoId={m.id}
                          editing={editing}
                          onMovePhoto={reorderPhotoTo}
                        />
                      ))
                    )}
                  </div>
                </div>
              ),
            });
          }


          photoIdx += batchSize;
          pageIdx++;
        }
      }
    }


    while (list.length + 1 < PEECHO_MIN_PAGES || (list.length + 1) % 2 !== 0) {
      list.push({
        key: `blank-${list.length}`,
        node: <div className="h-full bg-[#f8f7f4]" />,
      });
    }

    list.push({
      key: "back-cover",
      node: (
        <div className="h-full flex flex-col items-center justify-center bg-[#121212] text-white p-12 text-center">
          <p className="text-[10px] uppercase tracking-[0.32em] text-white/45 font-bold mb-5">Buildy</p>
          <h2 className="text-3xl font-serif italic leading-tight max-w-[70%] [overflow-wrap:anywhere] line-clamp-3">{coverTitle}</h2>
          <p className="mt-5 text-[10px] uppercase tracking-[0.2em] text-white/45">Gemaakt met Buildy</p>
        </div>
      ),
    });

    return list;
  }, [trip, steps, settings, excludedMedia, excludedSteps, editing, stepBudgetMap, defaultCoverMedia, reorderPhotoTo]);

  // Build page spreads: spread 0 = [cover, page 2], spread n = [pages[2n], pages[2n + 1]]
  const spreads = useMemo(() => {
    if (pages.length === 0) return [[null, null]];
    const result: (typeof pages[0] | null)[][] = [];
    for (let i = 0; i < pages.length; i += 2) {
      result.push([pages[i] ?? null, pages[i + 1] ?? null]);
    }
    return result;
  }, [pages]);

  // Derive spread index from flat page index
  const spreadIdx = Math.floor(pageIdx / 2);
  const safeSpread = Math.min(spreadIdx, Math.max(0, spreads.length - 1));
  const [leftPage, rightPage] = spreads[safeSpread];
  const isCover = pageIdx === 0 || leftPage?.key === "cover";

  // Spread navigation helpers (desktop)
  const goToPrevSpread = () => setPageIdx(Math.max(0, (safeSpread - 1) * 2));
  const goToNextSpread = () => setPageIdx(Math.min(pages.length - 1, (safeSpread + 1) * 2));
  const goToFirstSpread = () => setPageIdx(0);
  const goToLastSpread = () => setPageIdx(Math.max(0, pages.length - 1));

  const PRICE_PER_PAGE = 0.75;
  const BOOK_BASE = 12.95;
  const PRINT_PAGES = getPeechoPrintPageCount(pages.length);
  const CONTENT_PAGES = Math.max(0, PRINT_PAGES - 2);
  const totalPrice = BOOK_BASE + PRINT_PAGES * PRICE_PER_PAGE;

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
            ? pages[1] ? "Cover + pagina 2" : "Cover"
            : `Pagina ${safeSpread * 2 + 1}–${Math.min(safeSpread * 2 + 2, PRINT_PAGES)} / ${PRINT_PAGES}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isOwner && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setCheckoutUrl(null); setPrintOpen(true); }}
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
                  {defaultCoverMedia ? (
                    <img src={defaultCoverMedia.media_url} alt="" className="w-full h-full object-cover" />
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

      {editing && !overviewMode && (() => {
        const renderControls = (visiblePages: (typeof pages[0] | null | undefined)[], className: string) => {
          const pageEntries = visiblePages
            .filter((page): page is typeof pages[0] => !!page?.meta?.stepId)
            .filter((page, index, list) => list.findIndex((item) => item.key === page.key) === index)
            .map((page) => ({
              page,
              pageNumber: pages.findIndex((item) => item.key === page.key) + 1,
              step: steps.find((step: any) => step.id === page.meta?.stepId),
              photoIds: page.meta?.photoIds ?? [],
            }))
            .filter((entry) => !!entry.step);

          if (pageEntries.length === 0) return null;

          const visibleStepIds = Array.from(new Set(pageEntries.map((entry) => entry.step.id)));

          return (
            <div className={`container pb-3 space-y-2 ${className}`}>
              {visibleStepIds.map((stepId) => {
                const step = steps.find((s: any) => s.id === stepId);
                if (!step) return null;
                const isHidden = excludedSteps.has(stepId);
                const timelinePhotos = sortMediaByTimelineOrder((step.step_media || []).filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf"));
                const customOrder = settings.step_photo_order[stepId];
                const photos = customOrder?.length
                  ? [...timelinePhotos].sort((a: any, b: any) => {
                      const ai = customOrder.indexOf(a.id);
                      const bi = customOrder.indexOf(b.id);
                      if (ai === -1 && bi === -1) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
                      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                    })
                  : timelinePhotos;
                const allStepPhotoPages = pages
                  .map((page, pageIndex) => ({
                    key: page.key,
                    pageNumber: pageIndex + 1,
                    photoIds: page.meta?.photoIds ?? [],
                    layout: getPageLayout(settings.step_layout_overrides, page.key, stepId),
                    stepId: page.meta?.stepId,
                  }))
                  .filter((page) => page.stepId === stepId && page.photoIds.length > 0);
                const movePhotoToPage = (photoId: string, sourcePageKey: string, targetPageKey: string) => {
                  if (sourcePageKey === targetPageKey) return;
                  const sourcePage = allStepPhotoPages.find((page) => page.key === sourcePageKey);
                  const targetPage = allStepPhotoPages.find((page) => page.key === targetPageKey);
                  if (!sourcePage || !targetPage) return;
                  if (targetPage.photoIds.length >= 4) {
                    toast.error("Maximaal vier foto's per pagina");
                    return;
                  }

                  const currentPhotoIds = photos.map((photo: any) => photo.id);
                  const includedIds = currentPhotoIds.filter((id: string) => !excludedMedia.has(id));
                  const hiddenIds = currentPhotoIds.filter((id: string) => excludedMedia.has(id));
                  const withoutMoved = includedIds.filter((id: string) => id !== photoId);
                  const targetAnchor = [...targetPage.photoIds].reverse().find((id) => withoutMoved.includes(id));
                  const insertAt = targetAnchor ? withoutMoved.indexOf(targetAnchor) + 1 : withoutMoved.length;
                  const nextIncluded = [...withoutMoved];
                  nextIncluded.splice(insertAt, 0, photoId);

                  const nextLayoutOverrides = { ...settings.step_layout_overrides };
                  const sourceLayout = getPageLayout(settings.step_layout_overrides, sourcePageKey, stepId);
                  const targetLayout = getPageLayout(settings.step_layout_overrides, targetPageKey, stepId);
                  const sourceCount = sourcePage.photoIds.length - 1;
                  const targetCount = targetPage.photoIds.length + 1;

                  if (sourceCount > 0) {
                    nextLayoutOverrides[sourcePageKey] = layoutForPhotoCount(sourceCount, sourceLayout);
                  } else {
                    delete nextLayoutOverrides[sourcePageKey];
                  }
                  nextLayoutOverrides[targetPageKey] = layoutForPhotoCount(targetCount, targetLayout);

                  upsertSettings({
                    step_photo_order: { ...settings.step_photo_order, [stepId]: [...nextIncluded, ...hiddenIds] },
                    step_layout_overrides: nextLayoutOverrides,
                  });
                };

                return (
                  <div key={stepId} className="rounded-lg border bg-card p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{step.location_name}</p>
                        <p className="text-[10px] text-muted-foreground">Volgorde geldt als basis voor alle pagina's van deze update.</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">{isHidden ? "Verborgen" : "In fotoboek"}</span>
                        <Switch checked={!isHidden} onCheckedChange={() => toggleStep(stepId)} />
                      </div>
                    </div>

                    {photos.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                          Foto's — sleep om volgorde te wijzigen of sleep op een pagina · klik om te verbergen
                        </p>

                        <PhotoManagePanel
                          stepId={stepId}
                          photos={photos}
                          excludedMedia={excludedMedia}
                          onToggleMedia={toggleMedia}
                          onReorder={(sid, newOrder) => upsertSettings({ step_photo_order: { ...settings.step_photo_order, [sid]: newOrder } })}
                        />
                        {allStepPhotoPages.length > 1 && (
                          <PhotoPageBuckets
                            pages={allStepPhotoPages}
                            photos={photos}
                            excludedMedia={excludedMedia}
                            onMovePhoto={movePhotoToPage}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {pageEntries.map(({ page, pageNumber, step }) => {
                  const currentLayout = getPageLayout(settings.step_layout_overrides, page.key, step.id);
                  const hasPageOverride = !!settings.step_layout_overrides[page.key];
                  return (
                    <div key={page.key} className="rounded-lg border bg-card p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Lay-out pagina {pageNumber}</p>
                          <p className="text-xs font-medium truncate">{step.location_name}</p>
                        </div>
                        {!hasPageOverride && settings.step_layout_overrides[step.id] && (
                          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">oude update-instelling</span>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {STEP_LAYOUTS.map((layoutOption) => (
                          <button
                            key={layoutOption.id}
                            onClick={() => upsertSettings({ step_layout_overrides: { ...settings.step_layout_overrides, [page.key]: layoutOption.id } })}
                            title={layoutOption.label}
                            className={`flex flex-col items-center gap-1 p-2 rounded border-2 transition ${currentLayout === layoutOption.id ? "border-primary bg-primary/5" : "border-transparent hover:border-muted-foreground/30"}`}
                          >
                            {layoutOption.icon}
                            <span className="text-[10px] text-muted-foreground">{layoutOption.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        };

        return (
          <>
            {renderControls([pages[pageIdx]], "md:hidden")}
            {renderControls([leftPage, rightPage], "hidden md:block")}
          </>
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
                        style={{ width: PRINT_PAGE_WIDTH / 4, height: PRINT_PAGE_HEIGHT / 4 }}
                      >
                        <div
                          style={{
                            width: PRINT_PAGE_WIDTH,
                            height: PRINT_PAGE_HEIGHT,
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
              <span className="text-muted-foreground text-xs ml-2">(printklaar: {PRINT_PAGES}, min. Peecho: {PEECHO_MIN_PAGES})</span>
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
          <PrintPagePreview
            className="mx-auto relative rounded-sm overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] bg-[#f8f7f4]"
            style={{ width: "min(100%, calc((100vh - 220px) * 3 / 2))", aspectRatio: "3/2" }}
            overlay={editing && pages[pageIdx]?.meta?.chapter ? (
              <ChapterEditOverlay
                phase={pages[pageIdx].meta!.chapter!}
                value={settings.chapter_overrides[pages[pageIdx].meta!.chapter!] || ""}
                onChange={(v) => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, ...(v ? { [pages[pageIdx].meta!.chapter!]: v } : {}) } })}
              />
            ) : undefined}
          >
            {pages[pageIdx] ? (
              pages[pageIdx].node
            ) : (
              <div className="w-full h-full bg-[#e8e6df]" />
            )}
          </PrintPagePreview>
          {/* Mobile nav */}
          <div className="flex items-center gap-3 mt-5">
            <button aria-label="Eerste pagina" title="Eerste pagina" onClick={() => setPageIdx(0)} disabled={pageIdx === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronsLeft className="h-4 w-4" /></button>
            <button aria-label="Vorige pagina" title="Vorige pagina" onClick={() => setPageIdx(Math.max(0, pageIdx - 1))} disabled={pageIdx === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-white/60 text-sm min-w-[110px] text-center tabular-nums">
              {pageIdx === 0 ? "Cover" : `${pageIdx + 1} / ${PRINT_PAGES}`}
            </span>
            <button aria-label="Volgende pagina" title="Volgende pagina" onClick={() => setPageIdx(Math.min(pages.length - 1, pageIdx + 1))} disabled={pageIdx >= pages.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronRight className="h-4 w-4" /></button>
            <button aria-label="Laatste pagina" title="Laatste pagina" onClick={() => setPageIdx(pages.length - 1)} disabled={pageIdx >= pages.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition"><ChevronsRight className="h-4 w-4" /></button>
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
              <PrintPagePreview
                className="flex-1 relative overflow-hidden bg-[#f8f7f4]"
                style={{ boxShadow: "inset -8px 0 24px rgba(0,0,0,0.12)" }}
                overlay={editing && leftPage?.meta?.chapter ? (
                  <ChapterEditOverlay
                    phase={leftPage.meta.chapter}
                    value={settings.chapter_overrides[leftPage.meta.chapter] || ""}
                    onChange={(v) => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, ...(v ? { [leftPage.meta!.chapter!]: v } : {}) } })}
                  />
                ) : undefined}
              >
                {leftPage ? (
                  leftPage.node
                ) : (
                  <div className="w-full h-full bg-[#e8e6df]" />
                )}
              </PrintPagePreview>

              {/* Spine */}
              <div
                className="w-[6px] flex-shrink-0"
                style={{ background: "linear-gradient(to right, rgba(0,0,0,0.28), rgba(0,0,0,0.06), rgba(0,0,0,0.28))" }}
              />

              {/* Right page */}
              <PrintPagePreview
                className="flex-1 relative overflow-hidden bg-[#f8f7f4]"
                style={{ boxShadow: "inset 8px 0 24px rgba(0,0,0,0.12)" }}
                overlay={editing && rightPage?.meta?.chapter ? (
                  <ChapterEditOverlay
                    phase={rightPage.meta.chapter}
                    value={settings.chapter_overrides[rightPage.meta.chapter] || ""}
                    onChange={(v) => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, ...(v ? { [rightPage.meta!.chapter!]: v } : {}) } })}
                  />
                ) : undefined}
              >
                {rightPage ? (
                  rightPage.node
                ) : (
                  <div className="w-full h-full bg-[#f0efe9]" />
                )}
              </PrintPagePreview>
            </div>
          </div>
        </div>

        {/* Navigation — Polarsteps style */}
        <div className="flex items-center gap-3 mt-6">
          <button onClick={goToFirstSpread} disabled={safeSpread === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition" title="Eerste pagina"><ChevronsLeft className="h-4 w-4" /></button>
          <button onClick={goToPrevSpread} disabled={safeSpread === 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center text-white transition" title="Vorige spread"><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-white/60 text-sm min-w-[120px] text-center tabular-nums">
            {isCover
              ? pages[1] ? "Cover–2" : "Cover"
              : `${safeSpread * 2 + 1}\u2013${Math.min(safeSpread * 2 + 2, PRINT_PAGES)} / ${PRINT_PAGES}`}
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


      <Dialog open={printOpen} onOpenChange={(open) => { setPrintOpen(open); if (!open) setCheckoutUrl(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bestel als hardcover Bouwboek</DialogTitle>
            <DialogDescription>
              Wij maken een printklare PDF, rekenen veilig af via Stripe en sturen je betaalde order daarna door naar Peecho voor druk en verzending.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
              <div className="rounded-md border bg-muted/35 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Formaat</p>
                <p className="mt-1 text-sm font-semibold">{PEECHO_FORMATS[printFormat].label}</p>
                <p className="text-xs text-muted-foreground">
                  {PEECHO_FORMATS[printFormat].w} × {PEECHO_FORMATS[printFormat].h} mm, vast liggend voor brede fotocomposities.
                </p>
              </div>

              {!checkoutUrl ? (
                <Button onClick={handleGeneratePeechoPdf} disabled={printBusy} className="w-full gap-2">
                  {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                  {printBusy ? "Checkout voorbereiden…" : "Boek klaarmaken en betalen"}
                </Button>
              ) : (
                <a href={checkoutUrl} className="block">
                  <Button className="w-full gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Ga naar beveiligde betaling
                  </Button>
                </a>
              )}

              <p className="text-[11px] text-muted-foreground text-center">
                Na betaling maken we de Peecho-order aan. Levertijd is afhankelijk van printproductie en verzending.
              </p>
              <PhotobookOrderHistory orders={photobookOrders} />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrintOpen(false)}>Sluiten</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

type OrderBadgeVariant = "default" | "secondary" | "destructive" | "outline";

const getOrderStatusMeta = (status: string): { label: string; variant: OrderBadgeVariant } => {
  const normalized = status.toLowerCase();
  if (normalized.includes("ship") || normalized.includes("verzond")) return { label: "Verzonden", variant: "default" };
  if (normalized.includes("production") || normalized.includes("print")) return { label: "In productie", variant: "secondary" };
  if (normalized.includes("cancel") || normalized.includes("fail") || normalized.includes("error")) return { label: "Aandacht nodig", variant: "destructive" };
  if (normalized === "payment_pending") return { label: "Betaling open", variant: "outline" };
  if (normalized === "pdf_ready") return { label: "PDF klaar", variant: "outline" };
  if (normalized === "paid_pending_fulfillment") return { label: "Betaald, verwerking volgt", variant: "secondary" };
  if (normalized === "ready_for_checkout") return { label: "Checkout klaar", variant: "outline" };
  if (normalized.includes("submitted") || normalized.includes("paid") || normalized.includes("order")) return { label: "Besteld", variant: "secondary" };
  return { label: status.replace(/_/g, " "), variant: "outline" };
};

const formatOrderDate = (value: string | null) => {
  if (!value) return "Nog niet bevestigd";
  try {
    return format(new Date(value), "d MMM yyyy HH:mm", { locale: nl });
  } catch {
    return value;
  }
};

const PhotobookOrderHistory = ({ orders }: { orders: PhotobookOrder[] }) => {
  if (orders.length === 0) return null;

  return (
    <div className="rounded-md border bg-background/70 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <PackageCheck className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bouwboek orders</p>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
        {orders.map((order) => {
          const status = getOrderStatusMeta(order.status);
          const reference = order.merchant_reference.split("-").slice(-2).join("-");
          return (
            <div key={order.id} className="rounded-md border bg-card p-2.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">Referentie {reference}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {order.page_count} pagina's · {PEECHO_FORMATS[order.format as PeechoFormat]?.label ?? order.format}
                    {order.payment_amount_cents ? ` · €${(order.payment_amount_cents / 100).toFixed(2).replace(".", ",")}` : ""}
                  </p>
                  {order.fulfillment_error && (
                    <p className="mt-1 text-[11px] text-destructive">{order.fulfillment_error}</p>
                  )}
                </div>
                <Badge variant={status.variant} className="shrink-0">
                  {status.label}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{formatOrderDate(order.ordered_at ?? order.status_updated_at ?? order.created_at)}</span>
                {order.tracking_url && (
                  <a
                    href={order.tracking_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Track & trace
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const usePrintPageScale = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let animationFrame = 0;
    const measureScale = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const nextScale = Math.min(width / PRINT_PAGE_WIDTH, height / PRINT_PAGE_HEIGHT);
      setScale((currentScale) =>
        Math.abs(currentScale - nextScale) < 0.001 ? currentScale : nextScale,
      );
    };

    const scheduleScaleMeasurement = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measureScale);
    };

    measureScale();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleScaleMeasurement);
    observer?.observe(element);
    window.addEventListener("resize", scheduleScaleMeasurement);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleScaleMeasurement);
    };
  }, []);

  return { ref, scale };
};

const PrintPagePreview = ({
  children,
  className = "",
  style,
  overlay,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  overlay?: React.ReactNode;
}) => {
  const { ref, scale } = usePrintPageScale();

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      style={{
        aspectRatio: `${PRINT_PAGE_WIDTH} / ${PRINT_PAGE_HEIGHT}`,
        ...style,
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: PRINT_PAGE_WIDTH,
          height: PRINT_PAGE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
        }}
      >
        <div className="absolute inset-0" data-photobook-page>
          {children}
        </div>
      </div>
      {overlay}
    </div>
  );
};

const PhotoFrame = ({
  src,
  className = "",
  stepId,
  photoId,
  editing = false,
  onMovePhoto,
}: {
  src: string;
  className?: string;
  stepId?: string;
  photoId?: string;
  editing?: boolean;
  onMovePhoto?: (targetStepId: string, draggedPhotoId: string, targetPhotoId: string) => void;
}) => {
  const [isOver, setIsOver] = useState(false);
  const interactive = editing && !!stepId && !!photoId && !!onMovePhoto;

  return (
    <div
      className={`relative min-h-0 min-w-0 overflow-hidden bg-secondary flex items-center justify-center ${className} ${interactive ? "cursor-grab active:cursor-grabbing" : ""}`}
      draggable={interactive}
      onDragStart={(e) => {
        if (!interactive) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(PHOTO_DND_MIME, JSON.stringify({ stepId, photoId }));
      }}
      onDragOver={(e) => {
        if (!interactive) return;
        if (!Array.from(e.dataTransfer.types).includes(PHOTO_DND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        if (!interactive) return;
        setIsOver(false);
        const raw = e.dataTransfer.getData(PHOTO_DND_MIME);
        if (!raw) return;
        e.preventDefault();
        try {
          const data = JSON.parse(raw) as { stepId: string; photoId: string };
          if (data.stepId !== stepId) {
            toast.error("Foto's kunnen alleen binnen dezelfde update verplaatst worden");
            return;
          }
          if (data.photoId === photoId) return;
          onMovePhoto!(stepId!, data.photoId, photoId!);
        } catch {/* ignore */}
      }}
    >
      <img src={src} alt="" loading="lazy" draggable={false} className="block h-full w-full object-contain pointer-events-none" />
      {interactive && isOver && (
        <div className="absolute inset-0 ring-4 ring-primary ring-inset bg-primary/10 pointer-events-none" />
      )}
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
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(PHOTO_DND_MIME, JSON.stringify({ stepId, photoId: m.id }));
              setDragIdx(idx);
            }}

            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          >
            <img
              src={m.media_url}
              alt=""
              draggable={false}
              className={`w-14 h-14 object-contain rounded-md bg-muted transition ${out ? "opacity-40 grayscale" : ""} ${isOver ? "ring-2 ring-primary" : ""}`}
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

const PhotoPageBuckets = ({
  pages,
  photos,
  excludedMedia,
  onMovePhoto,
}: {
  pages: Array<{ key: string; pageNumber: number; photoIds: string[]; layout: StepLayout }>;
  photos: any[];
  excludedMedia: Set<string>;
  onMovePhoto: (photoId: string, sourcePageKey: string, targetPageKey: string) => void;
}) => {
  const [dragging, setDragging] = useState<{ photoId: string; sourcePageKey: string } | null>(null);
  const [dragOverPageKey, setDragOverPageKey] = useState<string | null>(null);
  const photoMap = new Map(photos.map((photo: any) => [photo.id, photo]));

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Pagina's van deze update — sleep foto's naar een pagina
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {pages.map((page) => {
          const visiblePhotoIds = page.photoIds.filter((photoId) => !excludedMedia.has(photoId));
          const isOver = dragOverPageKey === page.key;
          return (
            <div
              key={page.key}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverPageKey(page.key);
              }}
              onDragLeave={() => setDragOverPageKey(null)}
              onDrop={() => {
                if (dragging) onMovePhoto(dragging.photoId, dragging.sourcePageKey, page.key);
                setDragging(null);
                setDragOverPageKey(null);
              }}
              className={`min-h-24 rounded-md border bg-secondary/30 p-2 transition ${
                isOver ? "border-primary ring-2 ring-primary/20" : "border-border"
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Pagina {page.pageNumber}
                </p>
                <span className="rounded-full bg-background px-2 py-0.5 text-[9px] text-muted-foreground">
                  {visiblePhotoIds.length} foto{visiblePhotoIds.length === 1 ? "" : "'s"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {visiblePhotoIds.map((photoId) => {
                  const photo = photoMap.get(photoId);
                  if (!photo) return null;
                  const isDragging = dragging?.photoId === photoId;
                  return (
                    <div
                      key={photoId}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragging({ photoId, sourcePageKey: page.key });
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDragOverPageKey(null);
                      }}
                      className={`h-14 w-14 shrink-0 cursor-grab overflow-hidden rounded-md border bg-background active:cursor-grabbing ${
                        isDragging ? "opacity-40" : ""
                      }`}
                      title="Sleep naar een andere pagina"
                    >
                      <img src={photo.media_url} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
                    </div>
                  );
                })}
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
}: {
  step: any;
  stepIdx: number;
  totalSteps: number;
  // Accepted for forward-compat; cost/budget footer UI not yet rendered.
  cumulativeCost?: number;
  budgetTotal?: number | null;
}) => {
  const progressPct = totalSteps > 0 ? ((stepIdx + 1) / totalSteps) * 100 : 0;

  return (
    <div className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 bg-[#f4f3ef] border-t border-black/[0.05]">
      {/* Step counter */}
      <span className="text-[6px] text-muted-foreground/45 font-medium tabular-nums shrink-0">
        {stepIdx + 1}/{totalSteps}
      </span>
      {/* Thin progress line */}
      <div className="flex-1 h-px rounded-full bg-black/[0.06] overflow-hidden">
        <div className="h-full rounded-full bg-accent/50 transition-all" style={{ width: `${progressPct}%` }} />
      </div>
      {/* Date */}
      <span className="text-[6px] text-muted-foreground/45 shrink-0">
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

export default Photobook;

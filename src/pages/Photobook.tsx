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
import { assertPeechoPdfBlob, createPeechoReference } from "@/lib/peecho";
import { usePageMeta } from "@/hooks/usePageMeta";
import { hydrateStepsMedia, hydrateTripAssets } from "@/lib/mediaUrl";

type StepLayout = "auto" | "1-full" | "2-side" | "2-stack" | "3-mixed" | "grid";
type CoverTextPos = "bottom" | "top" | "center";
type PhotobookOrientation = "landscape" | "portrait" | "square";

const PAGE_DIMS: Record<PhotobookOrientation, { w: number; h: number }> = {
  landscape: { w: 600, h: 400 },
  portrait: { w: 420, h: 594 },
  square: { w: 500, h: 500 },
};



// Kept for splitTextIntoPages default; portrait uses a narrower value.
const getCharsPerLine = (orientation: PhotobookOrientation) =>
  orientation === "landscape" ? 62 : orientation === "portrait" ? 44 : 50;

const PhotobookLayoutContext = React.createContext<{ w: number; h: number; orientation: PhotobookOrientation }>({
  w: PAGE_DIMS.landscape.w,
  h: PAGE_DIMS.landscape.h,
  orientation: "landscape",
});
const usePhotobookLayout = () => React.useContext(PhotobookLayoutContext);


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

const getLinesPerPage = (orientation: PhotobookOrientation) =>
  orientation === "landscape" ? 15 : orientation === "portrait" ? 24 : 19;

/**
 * Splits a description into printable page chunks in reading order.
 * Text is first wrapped into display lines (paragraph breaks kept as one blank
 * line) and only then paged, so no content is silently clipped or reordered.
 */
const splitTextIntoPages = (text: string, locationName?: string | null, orientation: PhotobookOrientation = "landscape") => {
  const charsPerLine = getCharsPerLine(orientation);
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const wrapLine = (paragraphLine: string): string[] => {
    const words = paragraphLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const wrapped: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && candidate.length > charsPerLine) {
        wrapped.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) wrapped.push(line);
    return wrapped;
  };

  const displayLines: string[] = [];
  normalized.split(/\n{2,}/).forEach((paragraph, paragraphIdx) => {
    if (paragraphIdx > 0) displayLines.push("");
    paragraph.split("\n").forEach((rawLine) => {
      displayLines.push(...wrapLine(rawLine.trim()));
    });
  });

  const titleLines = locationName ? Math.min(2, Math.ceil(locationName.trim().length / 26)) : 0;
  const linesPerPage = getLinesPerPage(orientation);
  const firstPageLines = Math.max(4, linesPerPage - 2 - titleLines);

  const pages: string[] = [];
  let cursor = 0;
  while (cursor < displayLines.length) {
    const budget = pages.length === 0 ? firstPageLines : linesPerPage;
    const chunk = displayLines.slice(cursor, cursor + budget);
    cursor += chunk.length;
    while (chunk.length && chunk[0] === "") chunk.shift();
    while (chunk.length && chunk[chunk.length - 1] === "") chunk.pop();
    if (chunk.length) pages.push(chunk.join("\n"));
  }
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

interface PhotobookPriceQuote {
  baseCents: number;
  pageCents: number;
  shippingCents: number;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  vatIncluded: boolean;
  shippingCountries: string[];
  deliveryEstimate: string;
  termsVersion: string;
  seller: {
    legalName: string;
    contactEmail: string;
    contactPhone: string;
    postalAddress: string;
    registrationNumber: string;
  };
}

const PHOTOBOOK_ORDER_SELECT_BASE = "id, merchant_reference, peecho_id, format, page_count, status, tracking_code, tracking_url, created_at, ordered_at, status_updated_at";
const PHOTOBOOK_ORDER_SELECT_EXTENDED = "id, merchant_reference, peecho_id, format, page_count, status, payment_status, payment_amount_cents, payment_currency, fulfillment_status, fulfillment_error, tracking_code, tracking_url, created_at, ordered_at, status_updated_at";

const fetchPhotobookOrders = async (tripId: string) => {
  const extended = await supabase
    .from("photobook_orders")
    .select(PHOTOBOOK_ORDER_SELECT_EXTENDED)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!extended.error) return extended.data || [];

  const legacy = await supabase
    .from("photobook_orders")
    .select(PHOTOBOOK_ORDER_SELECT_BASE)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (legacy.error) {
    console.error("Could not fetch photobook order history:", extended.error, legacy.error);
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
  const [dataError, setDataError] = useState<string | null>(null);

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
  const settingsRef = useRef(settings);
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveVersionRef = useRef(0);
  const [excludedMedia, setExcludedMedia] = useState<Set<string>>(new Set());
  const [excludedSteps, setExcludedSteps] = useState<Set<string>>(new Set());

  const isOwner = user && trip?.user_id === user.id;

  const [printOpen, setPrintOpen] = useState(false);
  const [printFormat, setPrintFormat] = useState<PeechoFormat>("A4_LANDSCAPE");
  const [printBusy, setPrintBusy] = useState(false);
  const [printStep, setPrintStep] = useState<"idle" | "pdf" | "upload" | "checkout" | "done">("idle");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [preparedPageCount, setPreparedPageCount] = useState<number | null>(null);
  const [priceQuote, setPriceQuote] = useState<PhotobookPriceQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [photobookOrders, setPhotobookOrders] = useState<PhotobookOrder[]>([]);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [stepBudgetMap, setStepBudgetMap] = useState<Map<string, number>>(new Map());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimerRef = useRef<number | null>(null);
  const checkoutToastShown = useRef(false);
  const checkoutLockRef = useRef(false);
  const cancelledCheckoutHandled = useRef<string | null>(null);
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
    }
  }, [searchParams]);

  useEffect(() => {
    const cancelledOrderId = searchParams.get("checkout") === "cancelled"
      ? searchParams.get("order")
      : null;
    if (!cancelledOrderId || !user || cancelledCheckoutHandled.current === cancelledOrderId) return;
    cancelledCheckoutHandled.current = cancelledOrderId;

    supabase.functions.invoke("create-photobook-checkout", {
      body: { action: "cancel", orderId: cancelledOrderId },
    }).then(async ({ error }) => {
      if (error) {
        console.error("Could not close cancelled checkout session:", error);
        toast.info("De betaling kon niet als geannuleerd worden bevestigd. Controleer je bestelstatus; een bankbetaling kan nog worden verwerkt.");
        return;
      }
      toast.info("Betaling geannuleerd. Je kunt je Bouwboek opnieuw klaarmaken wanneer je wilt.");
      if (id) setPhotobookOrders((await fetchPhotobookOrders(id)) as PhotobookOrder[]);
    });
  }, [id, searchParams, user]);

  const handleGeneratePeechoPdf = async () => {
    if (!trip || !id || !user || !isOwner || checkoutLockRef.current) return;
    if (!legalAccepted) {
      toast.error("Ga eerst akkoord met de voorwaarden");
      return;
    }
    if (!priceQuote?.termsVersion) {
      toast.error("De actuele prijs en voorwaarden konden niet worden geladen");
      return;
    }
    const printablePhotos = steps
      .filter((step) => !excludedSteps.has(step.id))
      .flatMap((step) => step.step_media || [])
      .filter((media) => media.media_type !== "video" && media.media_type !== "pdf" && !excludedMedia.has(media.id));
    if (printablePhotos.length === 0) {
      toast.error("Voeg minimaal één foto uit een update aan je Bouwboek toe");
      return;
    }

    checkoutLockRef.current = true;
    setPrintBusy(true);
    setCheckoutUrl(null);
    setPrintStep("pdf");
    let uploadedPdfPath: string | null = null;
    let checkoutRequested = false;
    let checkoutRegistered = false;
    try {
      const orderReference = createPeechoReference(id);
      const { blob, failedImages, renderedPhotos, pageCount } = await buildPeechoPdf({
        trip, steps, settings, excludedMedia, excludedSteps, format: printFormat,
      });
      await assertPeechoPdfBlob(blob);
      if (renderedPhotos === 0) {
        throw new Error("Er zijn geen printbare foto's in je boek. Voeg minimaal één foto toe.");
      }
      if (failedImages > 0) {
        throw new Error(
          `${failedImages} foto${failedImages === 1 ? "" : "'s"} konden niet worden geladen (mogelijk verlopen link). Ververs de pagina en probeer opnieuw — we willen geen lege pagina's in je boek.`
        );
      }
      setPrintStep("upload");
      // Personalized books stay private; the server creates a temporary signed
      // URL for Peecho only after Stripe confirms payment.
      const path = `${user.id}/${id}/${orderReference}.pdf`;
      const { error: upErr } = await supabase.storage.from("photobook-pdfs").upload(path, blob, {
        contentType: "application/pdf", upsert: false,
      });
      if (upErr) throw upErr;
      uploadedPdfPath = path;

      setPrintStep("checkout");
      checkoutRequested = true;
      const { data: checkoutData, error: checkoutErr } = await supabase.functions.invoke("create-photobook-checkout", {
        body: {
          action: "checkout",
          tripId: id,
          merchantReference: orderReference,
          pdfPath: path,
          format: printFormat,
          pageCount,
          legalAccepted: true,
          acceptedTermsVersion: priceQuote.termsVersion,
        },
      });
      if (checkoutErr) throw checkoutErr;
      if (!checkoutData?.checkoutUrl) throw new Error("Checkout-url ontbreekt");
      if (!checkoutData?.order) throw new Error("Orderbevestiging ontbreekt");
      checkoutRegistered = true;

      setPrintStep("done");
      setCheckoutUrl(checkoutData.checkoutUrl);
      setPreparedPageCount(pageCount);
      if (checkoutData.quote) setPriceQuote(checkoutData.quote as PhotobookPriceQuote);
      const newOrder = checkoutData.order as PhotobookOrder;
      setPhotobookOrders((current) => [newOrder, ...current.filter((order) => order.id !== newOrder.id)].slice(0, 5));
      toast.success("Boek klaar — controleer het totaal en open daarna de beveiligde betaling");
    } catch (e: unknown) {
      if (uploadedPdfPath && !checkoutRegistered) {
        let canRemovePdf = !checkoutRequested;
        if (checkoutRequested) {
          const registration = await supabase
            .from("photobook_orders")
            .select("id")
            .eq("pdf_storage_path", uploadedPdfPath)
            .maybeSingle();
          if (registration.error) {
            console.error("Could not verify whether the private PDF belongs to an order:", registration.error);
          } else {
            canRemovePdf = !registration.data;
          }
        }
        if (canRemovePdf) {
          const { error: cleanupErr } = await supabase.storage.from("photobook-pdfs").remove([uploadedPdfPath]);
          if (cleanupErr) console.error("Could not clean up unregistered private PDF:", cleanupErr);
        }
      }
      console.error(e);
      setPrintStep("idle");
      toast.error(e instanceof Error ? e.message : "Genereren mislukt");
    } finally {
      checkoutLockRef.current = false;
      setPrintBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      if (!id) return;
      setLoading(true);
      setDataError(null);
      const [tripResult, stepsResult, settingsResult, exMediaResult, exStepsResult, privateResult, budgetResult, budgetTotalResult, orderData] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("steps").select("*, step_media(*)").eq("trip_id", id).order("step_date", { ascending: true }),
        supabase.from("photobook_settings").select("*").eq("trip_id", id).maybeSingle(),
        supabase.from("photobook_excluded_media").select("media_id").eq("trip_id", id),
        supabase.from("photobook_excluded_steps").select("step_id").eq("trip_id", id),
        supabase.from("trip_private_info").select("address").eq("trip_id", id).maybeSingle(),
        supabase.from("step_budget").select("step_id, cost").eq("trip_id", id),
        supabase.from("trip_budgets").select("budget_total").eq("trip_id", id).maybeSingle(),
        fetchPhotobookOrders(id),
      ]);
      if (cancelled) return;
      if (tripResult.error || stepsResult.error || !tripResult.data) {
        console.error("Could not load photobook:", tripResult.error, stepsResult.error);
        setTrip(null);
        setSteps([]);
        setDataError("Dit Bouwboek bestaat niet of je hebt geen toegang.");
        setLoading(false);
        return;
      }

      const tripData = tripResult.data;
      const stepsData = stepsResult.data || [];
      const settingsData = settingsResult.data;
      const exMedia = exMediaResult.data;
      const exSteps = exStepsResult.data;
      const privInfo = privateResult.data;
      const budgetData = budgetResult.data;
      const budgetTotalRow = budgetTotalResult.data;
      await Promise.all([
        hydrateTripAssets([tripData]),
        hydrateStepsMedia(stepsData as any),
      ]);
      if (cancelled) return;
      setStepBudgetMap(new Map((budgetData || []).map((r: any) => [r.step_id, Number(r.cost) || 0])));
      setTrip({ ...tripData, address: privInfo?.address ?? null, budget_total: budgetTotalRow?.budget_total ?? null });
      setSteps(stepsData);
      if (settingsData) {
        const loadedSettings: PhotobookSettings = {
          cover_title: settingsData.cover_title,
          cover_subtitle: settingsData.cover_subtitle,
          cover_media_id: settingsData.cover_media_id,
          chapter_overrides: (settingsData.chapter_overrides as any) || {},
          step_layout_overrides: (settingsData.step_layout_overrides as any) || {},
          step_photo_order: (settingsData.step_photo_order as any) || {},
        };
        settingsRef.current = loadedSettings;
        setSettings(loadedSettings);
      } else {
        const defaultSettings: PhotobookSettings = {
          cover_title: null,
          cover_subtitle: null,
          cover_media_id: null,
          chapter_overrides: {},
          step_layout_overrides: {},
          step_photo_order: {},
        };
        settingsRef.current = defaultSettings;
        setSettings(defaultSettings);
      }
      setExcludedMedia(new Set((exMedia || []).map((r: any) => r.media_id)));
      setExcludedSteps(new Set((exSteps || []).map((r: any) => r.step_id)));
      setPhotobookOrders((orderData || []) as PhotobookOrder[]);
      setLoading(false);
    };
    fetchData().catch((error) => {
      if (cancelled) return;
      console.error("Could not load photobook:", error);
      setDataError("Het Bouwboek kon niet worden geladen. Probeer het opnieuw.");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, user?.id]);

  const upsertSettings = useCallback((patch: Partial<PhotobookSettings>) => {
    if (!id) return Promise.resolve();
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    setSaveState("saving");
    const version = ++settingsSaveVersionRef.current;
    const operation = settingsSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const { error } = await supabase.from("photobook_settings").upsert({
          trip_id: id,
          cover_title: next.cover_title,
          cover_subtitle: next.cover_subtitle,
          cover_media_id: next.cover_media_id,
          chapter_overrides: next.chapter_overrides as any,
          step_layout_overrides: next.step_layout_overrides as any,
          step_photo_order: next.step_photo_order as any,
        });
        if (error) throw error;
      });
    settingsSaveQueueRef.current = operation;
    operation.then(() => {
      if (version !== settingsSaveVersionRef.current) return;
      setSaveState("saved");
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
    }).catch((error) => {
      console.error("Could not save photobook settings:", error);
      if (version === settingsSaveVersionRef.current) setSaveState("idle");
      toast.error("Kon je Bouwboek-aanpassing niet opslaan");
    });
    return operation;
  }, [id]);

  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
  }, []);


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

  const savedOrientation = settings.chapter_overrides["__orientation__"] as PhotobookOrientation;
  const orientation: PhotobookOrientation =
    savedOrientation === "portrait" || savedOrientation === "square" ? savedOrientation : "landscape";

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

          {/* Buildy watermark — current brand mark, subtle bottom-right corner */}
          <div className="absolute bottom-2 right-3 flex items-center gap-1 opacity-60">
            <svg viewBox="0 0 40 40" className="h-3.5 w-3.5 text-white" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M9.5 18.2 20 9.8l10.5 8.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12.5 17.3v10.2h15V17.3L20 11.2l-7.5 6.1Z" fill="currentColor" fillOpacity="0.85" />
              <path d="M7.8 29.3c4.4-.5 8.5.4 12.2 2.7 3.7-2.3 7.8-3.2 12.2-2.7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <span className="text-[8px] font-serif italic text-white tracking-tight">Buildy</span>
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


    const visibleSteps = (editing ? steps : steps.filter((s) => !excludedSteps.has(s.id)))
      .slice()
      .sort((a, b) => new Date(a.step_date || 0).getTime() - new Date(b.step_date || 0).getTime());

    const segments: { phase: string; steps: any[] }[] = [];
    for (const step of visibleSteps) {
      const phase = step.phase || "Overige updates";
      if (segments.length === 0 || segments[segments.length - 1].phase !== phase) {
        segments.push({ phase, steps: [step] });
      } else {
        segments[segments.length - 1].steps.push(step);
      }
    }

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

    for (let segmentIdx = 0; segmentIdx < segments.length; segmentIdx++) {
      const { phase, steps: phaseSteps } = segments[segmentIdx];
      const chapterTitle = settings.chapter_overrides[phase] || phase;
      const phaseStart = phaseSteps[0]?.step_date || "";
      const phaseEnd = phaseSteps[phaseSteps.length - 1]?.step_date || "";

      // Chapter divider page — quiet blueprint feel
      list.push({
        key: `chapter-${segmentIdx}-${phase}`,
        meta: { chapter: phase, stepId: phaseSteps[0]?.id, firstStep: false },
        node: (
          <div className="h-full flex flex-col bg-[#f6f1e7] relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.08] pointer-events-none" style={{
              backgroundImage: "linear-gradient(to right, #1a3c2a 1px, transparent 1px), linear-gradient(to bottom, #1a3c2a 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }} />
            <div className="flex-1 flex flex-col justify-center px-[12%]">
              <p className="text-[9px] uppercase tracking-[0.4em] text-accent font-bold mb-4">Hoofdstuk {String(segmentIdx + 1).padStart(2, "0")}</p>
              <div className="flex items-baseline gap-5">
                <span className="text-[6rem] leading-none font-serif font-bold text-primary/15 tabular-nums">{String(segmentIdx + 1).padStart(2, "0")}</span>
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
        const descriptionPages = hasDescription ? splitTextIntoPages(step.description as string, step.location_name, orientation) : [];

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
                <div className="min-h-0 overflow-hidden flex flex-col justify-start px-[10%] pt-[8%] pb-[4%]">
                  <p className="text-[9px] uppercase tracking-[0.25em] text-accent mb-1.5 font-bold">{chapterTitle}</p>
                  <p className="text-[10px] text-muted-foreground mb-3">
                    {format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}
                    {textPageIdx > 0 ? " · vervolg" : ""}
                  </p>
                  {step.location_name && textPageIdx === 0 && (
                    <h2 className="text-xl font-bold font-serif mb-3 leading-tight [overflow-wrap:anywhere] line-clamp-2">{step.location_name}</h2>
                  )}
                  {descriptionPage && (
                    <p className="text-[11px] leading-[1.55] text-foreground/80 italic whitespace-pre-line [overflow-wrap:anywhere]">
                      {descriptionPage}
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

    const totalUpdates = visibleSteps.length;
    const totalPhotos = visibleSteps.reduce((sum, s: any) => sum + (s.step_media || []).filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf" && !excludedMedia.has(m.id)).length, 0);
    const projectStart = visibleSteps[0]?.step_date;
    const projectEnd = visibleSteps[visibleSteps.length - 1]?.step_date;
    const durationDays = projectStart && projectEnd
      ? Math.max(1, Math.round((new Date(projectEnd).getTime() - new Date(projectStart).getTime()) / 86400000))
      : 0;

    list.push({
      key: "back-cover",
      node: (
        <div className="h-full flex flex-col bg-[#121212] text-white p-12 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
            backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }} />
          <div className="flex-1 flex flex-col items-center justify-center text-center relative">
            <p className="text-[10px] uppercase tracking-[0.32em] text-white/45 font-bold mb-4">Bouwboek</p>
            <h2 className="text-2xl font-serif italic leading-tight max-w-[75%] [overflow-wrap:anywhere] line-clamp-2">{coverTitle}</h2>
            <div className="mt-6 h-px w-16 bg-accent/60" />
            <div className="mt-6 grid grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-2xl font-serif font-bold tabular-nums">{totalUpdates}</p>
                <p className="text-[8px] uppercase tracking-[0.2em] text-white/45 mt-1">Updates</p>
              </div>
              <div>
                <p className="text-2xl font-serif font-bold tabular-nums">{totalPhotos}</p>
                <p className="text-[8px] uppercase tracking-[0.2em] text-white/45 mt-1">Foto's</p>
              </div>
              <div>
                <p className="text-2xl font-serif font-bold tabular-nums">{durationDays > 0 ? durationDays : "—"}</p>
                <p className="text-[8px] uppercase tracking-[0.2em] text-white/45 mt-1">Dagen</p>
              </div>
            </div>
            {projectStart && projectEnd && (
              <p className="mt-6 text-[10px] uppercase tracking-[0.2em] text-white/40">
                {format(new Date(projectStart), "d MMM yyyy", { locale: nl })} — {format(new Date(projectEnd), "d MMM yyyy", { locale: nl })}
              </p>
            )}
          </div>
          <p className="text-[9px] uppercase tracking-[0.32em] text-white/35 text-center">Gemaakt met Buildy</p>
        </div>
      ),
    });

    return list;
  }, [trip, steps, settings, excludedMedia, excludedSteps, editing, stepBudgetMap, defaultCoverMedia, reorderPhotoTo, orientation]);

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

  const PRINT_PAGES = getPeechoPrintPageCount(pages.length);
  const CONTENT_PAGES = Math.max(0, PRINT_PAGES - 2);
  const printablePhotoCount = useMemo(() => steps
    .filter((step) => !excludedSteps.has(step.id))
    .flatMap((step) => step.step_media || [])
    .filter((media: any) => media.media_type !== "video" && media.media_type !== "pdf" && !excludedMedia.has(media.id))
    .length, [excludedMedia, excludedSteps, steps]);

  const { w: pageW, h: pageH } = PAGE_DIMS[orientation];
  const layoutCtx = useMemo(() => ({ w: pageW, h: pageH, orientation }), [pageW, pageH, orientation]);

  // Keep printFormat in sync with orientation setting
  useEffect(() => {
    setPrintFormat(
      orientation === "portrait"
        ? "A4_PORTRAIT"
        : orientation === "square"
          ? "SQUARE_210"
          : "A4_LANDSCAPE",
    );
  }, [orientation]);

  useEffect(() => {
    if (!printOpen || !id || !isOwner) return;
    let cancelled = false;
    setLegalAccepted(false);
    setQuoteLoading(true);
    setQuoteError(null);
    setPriceQuote(null);
    supabase.functions.invoke("create-photobook-checkout", {
      body: {
        action: "quote",
        tripId: id,
        format: printFormat,
        pageCount: PRINT_PAGES,
      },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.quote) {
        console.error("Could not load photobook quote:", error, data);
        setQuoteError("Bestellen is tijdelijk niet beschikbaar. Probeer het later opnieuw.");
        return;
      }
      setPriceQuote(data.quote as PhotobookPriceQuote);
    }).finally(() => {
      if (!cancelled) setQuoteLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [PRINT_PAGES, id, isOwner, printFormat, printOpen]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (dataError || !trip) {
    return (
      <div className="container max-w-xl py-16 text-center space-y-4">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-serif font-semibold">Bouwboek niet beschikbaar</h1>
        <p className="text-sm text-muted-foreground">{dataError || "Dit Bouwboek kon niet worden gevonden."}</p>
        <Button asChild variant="outline"><Link to="/"><ArrowLeft className="mr-2 h-4 w-4" />Terug naar Buildy</Link></Button>
      </div>
    );
  }

  return (
    <PhotobookLayoutContext.Provider value={layoutCtx}>
    <div className="min-h-[100dvh] bg-muted flex flex-col pb-[env(safe-area-inset-bottom)]">
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
        {isOwner && editing && (
          <span
            className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium transition-opacity ${saveState === "idle" ? "opacity-0" : "opacity-100"} ${saveState === "saved" ? "text-emerald-600" : "text-muted-foreground"}`}
            aria-live="polite"
          >
            {saveState === "saving" ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Opslaan…</>
            ) : saveState === "saved" ? (
              <><Cloud className="h-3 w-3" /> Opgeslagen</>
            ) : (
              <><CloudOff className="h-3 w-3" /> —</>
            )}
          </span>
        )}
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
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Oriëntatie boek</p>
              <div className="flex gap-2">
                {([["landscape", "Liggend (A4)"], ["portrait", "Staand (A4)"], ["square", "Vierkant"]] as const).map(([val, label]) => {
                  const active = orientation === val;
                  return (
                    <button
                      key={val}
                      onClick={() => upsertSettings({ chapter_overrides: { ...settings.chapter_overrides, "__orientation__": val } })}
                      className={`flex-1 py-1.5 rounded border text-xs font-medium transition ${active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>


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

                    {photos.length > 0 && allStepPhotoPages.length > 1 && (
                      <div>
                        <PhotoPageBuckets
                          pages={allStepPhotoPages}
                          photos={photos}
                          excludedMedia={excludedMedia}
                          onMovePhoto={movePhotoToPage}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {pageEntries.map(({ page, pageNumber, step }) => {
                  const currentLayout = getPageLayout(settings.step_layout_overrides, page.key, step.id);
                  const hasPageOverride = !!settings.step_layout_overrides[page.key];

                  const timelinePhotos = sortMediaByTimelineOrder((step.step_media || []).filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf"));
                  const customOrder = settings.step_photo_order[step.id];
                  const stepPhotos = customOrder?.length
                    ? [...timelinePhotos].sort((a: any, b: any) => {
                        const ai = customOrder.indexOf(a.id);
                        const bi = customOrder.indexOf(b.id);
                        if (ai === -1 && bi === -1) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
                        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                      })
                    : timelinePhotos;
                  
                  // Filter to only show photos assigned to THIS specific page
                  const pagePhotosForManager = stepPhotos.filter((p: any) => (page.meta?.photoIds || []).includes(p.id));

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

                      {pagePhotosForManager && pagePhotosForManager.length > 0 && (
                        <div className="mt-4 pt-3 border-t">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                            Sleep foto's om te verplaatsen · klik om te verbergen
                          </p>
                          <PhotoManagePanel
                            stepId={step.id}
                            photos={pagePhotosForManager}
                            excludedMedia={excludedMedia}
                            onToggleMedia={toggleMedia}
                            onReorder={(sid, newOrderOfThisPage) => {
                              const currentIds = stepPhotos.map((p: any) => p.id);
                              const oldIdsOfThisPage = pagePhotosForManager.map((p: any) => p.id);
                              const newGlobalOrder = [...currentIds];
                              
                              let newOrderIdx = 0;
                              for (let i = 0; i < newGlobalOrder.length; i++) {
                                if (oldIdsOfThisPage.includes(newGlobalOrder[i])) {
                                   newGlobalOrder[i] = newOrderOfThisPage[newOrderIdx++];
                                }
                              }
                              
                              upsertSettings({ step_photo_order: { ...settings.step_photo_order, [sid]: newGlobalOrder } });
                            }}
                          />
                        </div>
                      )}
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
                  const thumbScale = 0.25;
                  return (
                    <button
                      key={page.key}
                      onClick={() => { setPageIdx(idx); setOverviewMode(false); }}
                      className="group flex flex-col items-center gap-1.5"
                      title={idx === 0 ? "Cover" : `Pagina ${idx}`}
                    >
                      <div
                        className="rounded overflow-hidden border-2 border-transparent group-hover:border-white/50 transition relative bg-[#f8f7f4]"
                        style={{ width: pageW * thumbScale, height: pageH * thumbScale }}
                      >
                        <div
                          style={{
                            width: pageW,
                            height: pageH,
                            transformOrigin: "top left",
                            transform: `scale(${thumbScale})`,
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
              Prijs en verzending worden actueel berekend bij bestellen
            </p>
          </div>
        </div>
      )}
      {!overviewMode && (
      <div className="flex-1 flex flex-col bg-[#16162a]">

        {/* ── MOBILE: single page portrait (shows exactly one printed page) ── */}
        <div className="md:hidden flex-1 flex flex-col items-center justify-start pt-4 pb-8 px-4">
          <PrintPagePreview
            className="mx-auto relative w-full rounded-sm overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] bg-[#f8f7f4]"
            style={{ maxWidth: `calc((100dvh - 300px) * ${pageW} / ${pageH})`, aspectRatio: `${pageW} / ${pageH}` }}

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
          <p className="text-white/40 text-xs mt-2 text-center">
            Opmaakvoorbeeld — de print-PDF wordt bij bestellen apart opgebouwd en gecontroleerd
          </p>
        </div>

        {/* ── DESKTOP: two-page spread view ── */}
        <div className="hidden md:flex flex-1 flex-col items-center justify-center py-8 px-4">
        {/* Book spread */}
        <div
          className="w-full max-w-6xl mx-auto"
          style={{
            aspectRatio: `${pageW * 2} / ${pageH}`,
            maxWidth: `min(72rem, calc((100dvh - 260px) * ${pageW * 2} / ${pageH}))`,
          }}
        >

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


      <Dialog open={printOpen} onOpenChange={(open) => { setPrintOpen(open); if (!open) { setCheckoutUrl(null); setPreparedPageCount(null); setPrintStep("idle"); setLegalAccepted(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bestel als hardcover Bouwboek</DialogTitle>
            <DialogDescription>
              Printklare PDF, veilig afrekenen via Stripe, druk en verzending via Peecho. De editor toont een inhoudsvoorvertoning; uitsnedes en tekstomloop kunnen in het drukbestand licht afwijken.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {printablePhotoCount === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-semibold">Nog geen foto's in je boek</p>
                  <p>Voeg minimaal één foto uit een update toe. Buildy vult het boek automatisch aan tot minimaal {PEECHO_MIN_PAGES} pagina's.</p>
                </div>
              </div>
            )}

            {(() => {
              const isMobile = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
              const heavy = pages.length > 60;
              if (isMobile && heavy && !printBusy) {
                return (
                  <div className="flex items-start gap-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-blue-900">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="text-xs">
                      <p className="font-semibold">Groot boek — beste op desktop</p>
                      <p>Dit boek heeft {pages.length} pagina's. Het opbouwen van de printklare PDF kan op mobiel lang duren of vastlopen. Bestel bij voorkeur vanaf een laptop of desktop.</p>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {!printBusy && !checkoutUrl && (() => {
              const previewPhotos = steps
                .filter((s) => !excludedSteps.has(s.id))
                .flatMap((s: any) => (s.step_media || []))
                .filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf" && !excludedMedia.has(m.id))
                .slice(0, 4);
              if (previewPhotos.length === 0) return null;
              return (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Voorproefje binnenpagina's</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {previewPhotos.map((m: any) => (
                      <div key={m.id} className="aspect-square overflow-hidden rounded-sm border bg-muted">
                        <img src={m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {!printBusy && !checkoutUrl && (
              <CheckoutCoverPicker
                trip={trip}
                steps={steps}
                settings={settings}
                defaultCoverMedia={defaultCoverMedia}
                onPick={(mediaId) => upsertSettings({ cover_media_id: mediaId })}
              />
            )}

            {!printBusy && !checkoutUrl && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Kies een formaat</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(PEECHO_FORMATS) as PeechoFormat[]).map((fmt) => {
                    const f = PEECHO_FORMATS[fmt];
                    const active = printFormat === fmt;
                    const ratio = f.w / f.h;
                    return (
                      <button
                        key={fmt}
                        onClick={() => {
                          const nextOrientation: PhotobookOrientation = fmt === "A4_PORTRAIT"
                            ? "portrait"
                            : fmt === "SQUARE_210"
                              ? "square"
                              : "landscape";
                          setPrintFormat(fmt);
                          setPreparedPageCount(null);
                          upsertSettings({
                            chapter_overrides: { ...settings.chapter_overrides, "__orientation__": nextOrientation },
                          });
                        }}
                        className={`group flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition ${active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
                      >
                        <div
                          className="bg-card border border-muted-foreground/30 rounded-sm shadow-sm"
                          style={{
                            width: ratio >= 1 ? 56 : 56 * ratio,
                            height: ratio >= 1 ? 56 / ratio : 56,
                          }}
                        />
                        <span className="text-[10px] font-semibold leading-tight text-center">{f.label}</span>
                        <span className="text-[9px] text-muted-foreground tabular-nums">{f.w}×{f.h}mm</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-md border bg-muted/35 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Samenvatting</p>
                <p className="text-sm font-semibold">{preparedPageCount ?? PRINT_PAGES} pagina's · {PEECHO_FORMATS[printFormat].label}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">{checkoutUrl ? "Te betalen incl. btw" : "Indicatie incl. btw"}</p>
                {quoteLoading ? (
                  <Loader2 className="ml-auto h-5 w-5 animate-spin text-muted-foreground" />
                ) : priceQuote ? (
                  <p className="text-lg font-bold tabular-nums">
                    {(priceQuote.totalCents / 100).toLocaleString("nl-NL", { style: "currency", currency: priceQuote.currency.toUpperCase() })}
                  </p>
                ) : (
                  <p className="text-sm font-medium text-destructive">Niet beschikbaar</p>
                )}
              </div>
              </div>
              {priceQuote && (
                <div className="border-t pt-2 text-[11px] text-muted-foreground space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <span>Boek {(priceQuote.subtotalCents / 100).toLocaleString("nl-NL", { style: "currency", currency: priceQuote.currency.toUpperCase() })}</span>
                    <span>Verzending {(priceQuote.shippingCents / 100).toLocaleString("nl-NL", { style: "currency", currency: priceQuote.currency.toUpperCase() })}</span>
                  </div>
                  <p className="border-t pt-1.5">
                    Verkocht door <span className="font-medium text-foreground">{priceQuote.seller.legalName}</span>
                    {priceQuote.seller.registrationNumber ? ` · ${priceQuote.seller.registrationNumber}` : ""}
                    {priceQuote.seller.postalAddress ? ` · ${priceQuote.seller.postalAddress}` : ""}
                    {" · "}
                    <a className="underline underline-offset-2" href={`mailto:${priceQuote.seller.contactEmail}`}>
                      {priceQuote.seller.contactEmail}
                    </a>
                    {" · "}
                    <a className="underline underline-offset-2" href={`tel:${priceQuote.seller.contactPhone.replace(/[^+\d]/g, "")}`}>
                      {priceQuote.seller.contactPhone}
                    </a>
                  </p>
                </div>
              )}
            </div>

            {quoteError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                {quoteError}
              </div>
            )}

            {printBusy && (
              <div className="rounded-md border bg-background p-3 space-y-2">
                {[
                  { key: "pdf", label: "Printklare PDF opbouwen", icon: FileText },
                  { key: "upload", label: "Bestand veilig uploaden", icon: Upload },
                  { key: "checkout", label: "Beveiligde betaling openen", icon: CreditCard },
                ].map(({ key, label, icon: Icon }) => {
                  const order = ["pdf", "upload", "checkout", "done"];
                  const currentIdx = order.indexOf(printStep);
                  const myIdx = order.indexOf(key);
                  const done = currentIdx > myIdx;
                  const active = currentIdx === myIdx;
                  return (
                    <div key={key} className="flex items-center gap-2.5 text-sm">
                      <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {done ? <Check className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                      </div>
                      <span className={done ? "text-muted-foreground line-through" : active ? "font-medium" : "text-muted-foreground"}>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {!checkoutUrl && !printBusy && (
              <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-xs leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(e) => setLegalAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-muted-foreground">
                  Ik ga akkoord met de{" "}
                  <a href="/voorwaarden" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">algemene voorwaarden</a>
                  {priceQuote?.termsVersion ? ` (versie ${priceQuote.termsVersion})` : ""}.
                  Ik heb kennisgenomen van de{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">privacyverklaring</a>.
                  Ik begrijp dat dit Bouwboek volgens mijn specificaties wordt gemaakt en dat daarom geen{" "}
                  <a href="/herroeping" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">herroepingsrecht</a>{" "}
                  geldt.
                </span>
              </label>
            )}

            {!checkoutUrl ? (
              <Button
                onClick={handleGeneratePeechoPdf}
                disabled={printBusy || printablePhotoCount === 0 || !legalAccepted || quoteLoading || !priceQuote || !!quoteError}
                className="w-full gap-2"
              >
                {printBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                {printBusy ? "Bezig…" : "PDF maken en totaal bevestigen"}
              </Button>
            ) : (
              <a href={checkoutUrl} className="block" rel="noreferrer">
                <Button className="w-full gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Betaal {priceQuote ? (priceQuote.totalCents / 100).toLocaleString("nl-NL", { style: "currency", currency: priceQuote.currency.toUpperCase() }) : "veilig"} via Stripe
                </Button>
              </a>
            )}

            <p className="text-[11px] text-muted-foreground text-center">
              {priceQuote
                ? `Levering in ${priceQuote.shippingCountries.join(", ")} · verwacht ${priceQuote.deliveryEstimate}. Na betaling gaat je persoonlijke boek naar Peecho voor productie.`
                : "Na betaling gaat je persoonlijke boek naar Peecho voor productie."}
            </p>
            <PhotobookOrderHistory orders={photobookOrders} />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrintOpen(false)}>Sluiten</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </PhotobookLayoutContext.Provider>
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

const CheckoutCoverPicker = ({
  trip,
  steps,
  settings,
  defaultCoverMedia,
  onPick,
}: {
  trip: any;
  steps: any[];
  settings: PhotobookSettings;
  defaultCoverMedia: any;
  onPick: (mediaId: string | null) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const activeDrag = usePhotoDragState();
  const dragOver = activeDrag?.hoverKey === "cover-target";

  const [cropRatio, setCropRatio] = useState<"landscape" | "square" | "portrait">("landscape");
  const [focusX, setFocusX] = useState(50);
  const [focusY, setFocusY] = useState(50);

  const ratioStyle = {
    landscape: "3 / 2",
    square: "1 / 1",
    portrait: "2 / 3",
  }[cropRatio];

  const allPhotos = useMemo(
    () =>
      steps.flatMap((s: any) =>
        (s.step_media || []).filter((m: any) => m.media_type !== "video" && m.media_type !== "pdf"),
      ),
    [steps],
  );

  const activeCover = settings.cover_media_id
    ? allPhotos.find((m: any) => m.id === settings.cover_media_id) ?? defaultCoverMedia
    : defaultCoverMedia;
  const isCustom = !!settings.cover_media_id;

  const handleCoverDrop = (payload: PhotoDragPayload, targetKey: string) => {
    if (targetKey !== "cover-target") return;
    if (allPhotos.some((m: any) => m.id === payload.photoId)) {
      onPick(payload.photoId);
      toast.success("Omslagfoto bijgewerkt");
    }
  };


  const ratioOptions: { value: "landscape" | "square" | "portrait"; label: string; icon: string }[] = [
    { value: "landscape", label: "Liggend", icon: "▭" },
    { value: "square", label: "Vierkant", icon: "□" },
    { value: "portrait", label: "Staand", icon: "▯" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Omslagfoto</p>
        {isCustom && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Standaard gebruiken
          </button>
        )}
      </div>

      <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-[11px]">
        {ratioOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setCropRatio(opt.value)}
            className={`px-2.5 py-1 rounded transition ${
              cropRatio === opt.value
                ? "bg-background shadow-sm font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={cropRatio === opt.value}
          >
            <span className="mr-1" aria-hidden>{opt.icon}</span>
            {opt.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-photo-drop="cover-target"
        className={`group relative w-full overflow-hidden rounded-lg border-2 transition ${
          dragOver ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-muted-foreground/50"
        }`}

        style={{ aspectRatio: ratioStyle }}
        aria-label="Klik om omslagfoto te kiezen of sleep een foto hierheen"
      >
        {activeCover ? (
          <img
            src={activeCover.media_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: `${focusX}% ${focusY}%` }}
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-6 text-white text-center">
          <p className="font-serif text-lg leading-tight line-clamp-2 drop-shadow">
            {settings.cover_title || trip?.title}
          </p>
          {(settings.cover_subtitle || trip?.address) && (
            <p className="text-[11px] mt-0.5 opacity-90 line-clamp-1">
              {settings.cover_subtitle || trip?.address}
            </p>
          )}
        </div>
        <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <Pencil className="h-3 w-3" />
          {expanded ? "Verberg foto's" : "Wijzig omslag"}
        </div>
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/30 text-primary-foreground text-xs font-semibold">
            Laat los om als omslag te gebruiken
          </div>
        )}
      </button>

      {activeCover && (
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-2">
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Horizontaal</span>
            <input
              type="range"
              min={0}
              max={100}
              value={focusX}
              onChange={(e) => setFocusX(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Horizontale uitsnede"
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Verticaal</span>
            <input
              type="range"
              min={0}
              max={100}
              value={focusY}
              onChange={(e) => setFocusY(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="Verticale uitsnede"
            />
          </label>
        </div>
      )}

      {expanded && (
        <div className="rounded-md border bg-muted/30 p-2">
          <p className="text-[11px] text-muted-foreground mb-2">
            Klik op een foto of sleep er één naar de omslag-voorvertoning.
          </p>
          <div className="grid grid-cols-6 gap-1.5 max-h-44 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => onPick(null)}
              className={`relative aspect-square overflow-hidden rounded border-2 ${
                !settings.cover_media_id ? "border-primary" : "border-transparent hover:border-muted-foreground/40"
              }`}
              title="Standaardcover"
            >
              {defaultCoverMedia ? (
                <img src={defaultCoverMedia.media_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-muted" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-primary/80 text-primary-foreground text-[8px] py-0.5 text-center font-medium">
                Standaard
              </span>
            </button>
            {allPhotos.map((m: any) => {
              const active = settings.cover_media_id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onPointerDown={(event) =>
                    startPhotoDrag(event, { photoId: m.id, sourceKey: `cover-pick:${m.id}` }, handleCoverDrop)
                  }
                  onClick={() => onPick(m.id)}
                  className={`relative aspect-square overflow-hidden rounded border-2 cursor-grab touch-none select-none active:cursor-grabbing [-webkit-touch-callout:none] ${
                    active ? "border-primary" : "border-transparent hover:border-muted-foreground/40"
                  }`}
                >
                  <img src={m.media_url} alt="" className="w-full h-full object-cover pointer-events-none" />

                  {active && (
                    <span className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground rounded-full p-0.5">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
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
  const { w, h } = usePhotobookLayout();
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let animationFrame = 0;
    const measureScale = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;

      const nextScale = Math.min(width / w, height / h);
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
  }, [w, h]);

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
  const { w, h } = usePhotobookLayout();

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      style={{
        aspectRatio: `${w} / ${h}`,
        ...style,
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: w,
          height: h,
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

/* ──────────────────────────────────────────────────────────────
   Pointer-based photo drag & drop.
   Native HTML5 drag events do not fire on touch devices, so all photo
   dragging in the Bouwboek editor uses pointer events + hit testing on
   elements marked with `data-photo-drop`.
   ────────────────────────────────────────────────────────────── */

type PhotoDragPayload = { photoId: string; sourceKey: string };
type ActivePhotoDrag = { payload: PhotoDragPayload; hoverKey: string | null } | null;

let activePhotoDrag: ActivePhotoDrag = null;
const photoDragListeners = new Set<() => void>();

const publishPhotoDrag = (next: ActivePhotoDrag) => {
  activePhotoDrag = next;
  photoDragListeners.forEach((listener) => listener());
};

const usePhotoDragState = () => {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((value) => value + 1);
    photoDragListeners.add(listener);
    return () => {
      photoDragListeners.delete(listener);
    };
  }, []);
  return activePhotoDrag;
};

const findPhotoDropTarget = (x: number, y: number) => {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  const dropElement = element?.closest("[data-photo-drop]") as HTMLElement | null;
  return dropElement?.dataset.photoDrop ?? null;
};

const startPhotoDrag = (
  event: React.PointerEvent,
  payload: PhotoDragPayload,
  onDrop: (payload: PhotoDragPayload, targetKey: string) => void,
) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let active = false;

  const handleMove = (moveEvent: PointerEvent) => {
    if (!active) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
      active = true;
    }
    if (moveEvent.cancelable) moveEvent.preventDefault();
    publishPhotoDrag({ payload, hoverKey: findPhotoDropTarget(moveEvent.clientX, moveEvent.clientY) });
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleCancel);
  };

  function handleUp(upEvent: PointerEvent) {
    cleanup();
    const targetKey = active ? findPhotoDropTarget(upEvent.clientX, upEvent.clientY) : null;
    publishPhotoDrag(null);
    if (active) {
      // A real drag happened — swallow the click that follows the pointerup so
      // dropping a photo never doubles as a select/open action.
      const swallow = (clickEvent: MouseEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 300);
    }
    if (targetKey && targetKey !== payload.sourceKey) onDrop(payload, targetKey);
  }


  function handleCancel() {
    cleanup();
    publishPhotoDrag(null);
  }

  window.addEventListener("pointermove", handleMove, { passive: false });
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleCancel);
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
  const drag = usePhotoDragState();
  const interactive = editing && !!stepId && !!photoId && !!onMovePhoto;
  const dropKey = `frame:${stepId}:${photoId}`;
  const isSource = interactive && drag?.payload.sourceKey === dropKey;
  const isOver = interactive && !!drag && drag.hoverKey === dropKey && drag.payload.sourceKey !== dropKey;

  return (
    <div
      data-photo-drop={interactive ? dropKey : undefined}
      className={`relative min-h-0 min-w-0 overflow-hidden bg-secondary flex items-center justify-center [-webkit-touch-callout:none] ${className} ${interactive ? "cursor-grab active:cursor-grabbing touch-none select-none" : ""} ${isSource ? "opacity-40" : ""}`}
      onPointerDown={(event) => {
        if (!interactive) return;
        startPhotoDrag(event, { photoId: photoId!, sourceKey: dropKey }, (payload, targetKey) => {
          const [, targetStepId, targetPhotoId] = targetKey.split(":");
          if (!targetPhotoId) return;
          if (targetStepId !== stepId) {
            toast.error("Foto's kunnen alleen binnen dezelfde update verplaatst worden");
            return;
          }
          onMovePhoto!(stepId!, payload.photoId, targetPhotoId);
        });
      }}
    >
      <img src={src} alt="" loading="lazy" draggable={false} className="block h-full w-full object-contain pointer-events-none" />
      {isOver && <div className="absolute inset-0 ring-4 ring-primary ring-inset bg-primary/10 pointer-events-none" />}
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
  const drag = usePhotoDragState();

  const handleDrop = (payload: PhotoDragPayload, targetKey: string) => {
    const ids = photos.map((m: any) => m.id);
    const fromIdx = ids.indexOf(payload.photoId);
    const toIdx = ids.indexOf(targetKey.replace(`panel:${stepId}:`, ""));
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const newOrder = [...ids];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    onReorder(stepId, newOrder);
  };

  return (
    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
      {photos.map((m: any) => {
        const out = excludedMedia.has(m.id);
        const dropKey = `panel:${stepId}:${m.id}`;
        const isDragging = drag?.payload.sourceKey === dropKey;
        const isOver = !!drag && drag.hoverKey === dropKey && drag.payload.sourceKey !== dropKey;
        return (
          <div
            key={m.id}
            data-photo-drop={dropKey}
            className={`relative group cursor-grab touch-none active:cursor-grabbing transition-opacity select-none [-webkit-touch-callout:none] ${isDragging ? "opacity-30" : ""}`}
            onPointerDown={(event) => startPhotoDrag(event, { photoId: m.id, sourceKey: dropKey }, handleDrop)}
          >
            <img
              src={m.media_url}
              alt=""
              draggable={false}
              className={`w-14 h-14 object-contain rounded-md bg-muted transition pointer-events-none ${out ? "opacity-40 grayscale" : ""} ${isOver ? "ring-2 ring-primary" : ""}`}
            />
            {out && (
              <>
                <div className="absolute inset-0 rounded-md ring-2 ring-destructive pointer-events-none" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <EyeOff className="h-4 w-4 text-destructive drop-shadow" />
                </div>
              </>
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-black/60 rounded-md">
              <button
                onPointerDown={(event) => event.stopPropagation()}
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
  const drag = usePhotoDragState();
  const photoMap = new Map(photos.map((photo: any) => [photo.id, photo]));

  const handleDrop = (payload: PhotoDragPayload, targetKey: string) => {
    if (!targetKey.startsWith("bucket:")) return;
    const targetPageKey = targetKey.slice("bucket:".length);
    const sourcePageKey = payload.sourceKey.slice("bucket:".length).split("::")[0];
    onMovePhoto(payload.photoId, sourcePageKey, targetPageKey);
  };

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Pagina's van deze update — sleep foto's naar een pagina
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {pages.map((page) => {
          const visiblePhotoIds = page.photoIds.filter((photoId) => !excludedMedia.has(photoId));
          const bucketKey = `bucket:${page.key}`;
          const isOver = !!drag && drag.hoverKey === bucketKey;
          return (
            <div
              key={page.key}
              data-photo-drop={bucketKey}
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
                  const sourceKey = `bucket:${page.key}::${photoId}`;
                  const isDragging = drag?.payload.sourceKey === sourceKey;
                  return (
                    <div
                      key={photoId}
                      onPointerDown={(event) => startPhotoDrag(event, { photoId, sourceKey }, handleDrop)}
                      className={`h-14 w-14 shrink-0 cursor-grab touch-none select-none overflow-hidden rounded-md border bg-background active:cursor-grabbing [-webkit-touch-callout:none] ${
                        isDragging ? "opacity-40" : ""
                      }`}
                      title="Sleep naar een andere pagina"
                    >
                      <img src={photo.media_url} alt="" className="h-full w-full object-cover pointer-events-none" loading="lazy" draggable={false} />
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

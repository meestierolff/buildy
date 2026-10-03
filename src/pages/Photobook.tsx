import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  Crop,
  Images,
  Download,
  EyeOff,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type {
  PhotobookDocument,
  PhotobookExclusion,
  PhotobookLayout,
  PhotobookPage,
  PhotobookSettings,
} from "../../shared/contracts/photobooks";
import { PhotobookCropControls } from "@/components/photobook/PhotobookCropControls";
import { PhotobookViewer } from "@/components/photobook/PhotobookViewer";
import { ResilientImage } from "@/components/ResilientMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  usePhotobookDraft,
  useReplacePhotobookExclusions,
  useRequestPhotobookProof,
  useUpdatePhotobookSettings,
} from "@/hooks/usePhotobook";
import { ApiClientError } from "@/lib/apiClient";
import {
  createPhotobookIdempotencyKey,
  loadPhotobookProofView,
  photobookMediaProxyPath,
  type RequestPhotobookProofInput,
} from "@/lib/photobookApi";
import { hasExactPhotobookProof } from "@/lib/photobookPreview";
import { Link, useNavigate, useParams } from "@/lib/router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MomentSummary = {
  assetIds: string[];
  date: string;
  firstPageIndex: number;
  title: string;
  updateId: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function pageText(page: PhotobookPage, marker: string): string {
  const block = page.blocks.find((candidate) =>
    candidate.type === "text" && candidate.id.includes(marker));
  return block?.type === "text" ? block.lines.join(" ").trim() : "";
}

export function deriveDigitalBook(document: PhotobookDocument): {
  document: PhotobookDocument;
  moments: MomentSummary[];
} {
  const pagesByUpdate = new Map<string, { firstPageIndex: number; pages: PhotobookPage[] }>();
  document.pages.forEach((page, index) => {
    if (!page.updateId) return;
    const existing = pagesByUpdate.get(page.updateId);
    if (existing) existing.pages.push(page);
    else pagesByUpdate.set(page.updateId, { firstPageIndex: index, pages: [page] });
  });

  const moments = [...pagesByUpdate.entries()].map(([updateId, { firstPageIndex, pages }]) => {
    const textPage = pages.find((page) => page.kind === "update_text") ?? pages[0]!;
    const assetIds = pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.type === "photo" ? [block.assetId] : []));
    return {
      assetIds: [...new Set(assetIds)],
      date: pageText(textPage, ":date:"),
      firstPageIndex,
      title: pageText(textPage, ":title") || "Bouwmoment",
      updateId,
    };
  });

  return { document, moments };
}

function exclusionLabel(exclusion: PhotobookExclusion, index: number): string {
  if (exclusion.targetType === "update") return `Verborgen Bouwmoment ${index + 1}`;
  if (exclusion.targetType === "media") return `Verborgen foto ${index + 1}`;
  return `Verborgen hoofdstuk ${index + 1}`;
}

const Photobook = () => {
  const { id = "" } = useParams<{ id: string }>();
  const { loading: authLoading, user } = useAuth();
  const navigate = useNavigate();
  const validProjectId = UUID.test(id);
  const draftQuery = usePhotobookDraft(id, Boolean(user) && validProjectId);
  const settingsMutation = useUpdatePhotobookSettings(id);
  const exclusionsMutation = useReplacePhotobookExclusions(id);
  const proofMutation = useRequestPhotobookProof(id);
  const [settingsDraft, setSettingsDraft] = useState<PhotobookSettings | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [selectedMomentId, setSelectedMomentId] = useState<string | null>(null);
  const [coverAssetLimit, setCoverAssetLimit] = useState(12);
  const [cropAssetId, setCropAssetId] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfController = useRef<AbortController | null>(null);
  const pdfRequest = useRef<RequestPhotobookProofInput | null>(null);
  const pdfObjectUrls = useRef(new Set<string>());
  const appliedSettingsVersion = useRef<number | null>(null);

  const draft = draftQuery.data;
  const sourceDocument = draft?.document;
  const serverSettings = draft?.settings;
  const digitalBook = useMemo(
    () => sourceDocument ? deriveDigitalBook(sourceDocument) : null,
    [sourceDocument],
  );
  const document = digitalBook?.document;
  const moments = digitalBook?.moments ?? [];
  const bookWarnings = useMemo(() => [...new Map(
    (sourceDocument?.warnings ?? []).map((warning) => [
      `${warning.severity}:${warning.pageNumber}:${warning.message}`,
      warning,
    ]),
  ).values()], [sourceDocument?.warnings]);
  const pdfBlocked = bookWarnings.some((warning) => warning.severity === "blocking");
  const settingsDirty = Boolean(
    settingsDraft && serverSettings && JSON.stringify(settingsDraft) !== JSON.stringify(serverSettings),
  );
  const pdfRendering = draft?.proof?.status === "rendering"
    && draft.proof.documentSha256 === sourceDocument?.checksumSha256;
  const pdfFailed = draft?.proof?.status === "failed"
    && draft.proof.documentSha256 === sourceDocument?.checksumSha256;

  usePageMeta({
    title: sourceDocument ? `${sourceDocument.cover.title} — Bouwboek` : "Bouwboek — Buildy",
    description: "Bekijk hoe je Bouwboek vanzelf groeit met ieder Bouwmoment.",
    path: validProjectId ? `/project/${id}/bouwboek` : undefined,
    noIndex: true,
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/auth?next=${encodeURIComponent(`/project/${id}/bouwboek`)}`, { replace: true });
    }
  }, [authLoading, id, navigate, user]);

  useEffect(() => {
    if (!serverSettings || appliedSettingsVersion.current === serverSettings.version) return;
    appliedSettingsVersion.current = serverSettings.version;
    setSettingsDraft(serverSettings);
  }, [serverSettings]);

  useEffect(() => {
    if (!document?.pageCount) {
      setActivePage(0);
      return;
    }
    setActivePage((current) => Math.min(current, document.pageCount - 1));
  }, [document?.pageCount, sourceDocument?.checksumSha256]);

  useEffect(() => {
    setPdfError(null);
    setPdfLoading(false);
    pdfRequest.current = null;
    const objectUrls = pdfObjectUrls.current;
    return () => {
      pdfController.current?.abort();
      pdfController.current = null;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, [id, sourceDocument?.checksumSha256, user?.id]);

  const downloadPdf = async () => {
    if (!draft || settingsDirty || pdfBlocked || pdfController.current || proofMutation.isPending || pdfRendering) return;
    const controller = new AbortController();
    pdfController.current = controller;
    setPdfLoading(true);
    setPdfError(null);
    try {
      let currentDraft = draft;
      if (!hasExactPhotobookProof(currentDraft.proof, currentDraft.document)) {
        if (!pdfRequest.current || pdfFailed) {
          pdfRequest.current = {
            idempotencyKey: createPhotobookIdempotencyKey(),
            expectedDraftVersion: draft.version,
            expectedDocumentSha256: draft.document.checksumSha256,
          };
        }
        const requested = await proofMutation.mutateAsync(pdfRequest.current);
        if (controller.signal.aborted) return;
        if (requested.status === "failed") {
          pdfRequest.current = null;
          throw new Error("PDF generation failed");
        }
        const refreshed = await draftQuery.refetch();
        if (controller.signal.aborted) return;
        if (!refreshed.data || refreshed.data.document.checksumSha256 !== draft.document.checksumSha256) {
          throw new ApiClientError({ status: 409, code: "CONFLICT", message: "Het Bouwboek is gewijzigd." });
        }
        currentDraft = refreshed.data;
        if (currentDraft.proof?.status === "rendering"
          && currentDraft.proof.documentSha256 === currentDraft.document.checksumSha256) return;
      }
      const proof = currentDraft.proof;
      if (!proof?.pdfSha256 || !hasExactPhotobookProof(proof, currentDraft.document)) {
        throw new Error("PDF unavailable");
      }
      const loaded = await loadPhotobookProofView({
        revisionId: proof.revisionId,
        documentSha256: currentDraft.document.checksumSha256,
        pdfSha256: proof.pdfSha256,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(loaded.blob);
      pdfObjectUrls.current.add(url);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "Bouwboek.pdf";
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        if (pdfObjectUrls.current.delete(url)) URL.revokeObjectURL(url);
      }, 1_000);
    } catch (error) {
      if (!controller.signal.aborted) {
        setPdfError(error instanceof ApiClientError && error.code === "CONFLICT"
          ? "Je Bouwboek is intussen gewijzigd. Vernieuw de pagina en probeer opnieuw."
          : error instanceof ApiClientError && ["PROVIDER_UNAVAILABLE", "VALIDATION_FAILED"].includes(error.code)
            ? error.message
          : "Je PDF kon niet worden gemaakt of gedownload. Probeer het opnieuw.");
      }
    } finally {
      if (pdfController.current === controller) {
        pdfController.current = null;
        setPdfLoading(false);
      }
    }
  };

  const updateSettingsDraft = useCallback((change: (settings: PhotobookSettings) => PhotobookSettings) => {
    setSettingsDraft((current) => current ? change(current) : current);
  }, []);

  const saveSettings = async () => {
    if (!settingsDraft || settingsMutation.isPending) return;
    try {
      await settingsMutation.mutateAsync(settingsDraft);
      toast.success("Bouwboek bijgewerkt");
    } catch (error) {
      console.error("Photobook settings update failed", error);
      toast.error(errorMessage(error, "Bouwboek bijwerken mislukt"));
    }
  };

  const replaceExclusions = async (exclusions: PhotobookExclusion[]) => {
    if (!draft || exclusionsMutation.isPending) return;
    if (settingsDirty) {
      toast.error("Sla eerst je andere wijzigingen op");
      return;
    }
    try {
      await exclusionsMutation.mutateAsync({ exclusions });
      toast.success("Inhoud van je Bouwboek bijgewerkt");
    } catch (error) {
      console.error("Photobook exclusions update failed", error);
      toast.error(errorMessage(error, "Inhoud bijwerken mislukt"));
    }
  };

  const hideMoment = (updateId: string) => {
    if (!draft) return;
    const alreadyHidden = draft.exclusions.some(
      (exclusion) => exclusion.targetType === "update" && exclusion.updateId === updateId,
    );
    if (!alreadyHidden) {
      void replaceExclusions([...draft.exclusions, { targetType: "update", updateId }]);
    }
  };

  const restoreExclusion = (target: PhotobookExclusion) => {
    if (!draft) return;
    void replaceExclusions(draft.exclusions.filter((exclusion) =>
      JSON.stringify(exclusion) !== JSON.stringify(target)));
  };

  // Editing keeps its own selection: a spread may start with another moment.
  const currentMoment = moments.find((moment) => moment.updateId === selectedMomentId) ?? moments[0];
  const currentPhotoOrder = useMemo(() => {
    if (!currentMoment || !settingsDraft) return currentMoment?.assetIds ?? [];
    const configured = settingsDraft.preferences.photoOrderByUpdate[currentMoment.updateId] ?? [];
    const available = new Set(currentMoment.assetIds);
    const ordered = configured.filter((assetId) => available.has(assetId));
    const orderedSet = new Set(ordered);
    return [...ordered, ...currentMoment.assetIds.filter((assetId) => !orderedSet.has(assetId))];
  }, [currentMoment, settingsDraft]);
  const layoutChoice = currentMoment
    ? settingsDraft?.preferences.layoutByPage[currentMoment.updateId] ?? "auto"
    : "auto";

  const setLayoutChoice = (value: PhotobookLayout) => {
    if (!currentMoment) return;
    const photoPage = document?.pages.findIndex((page) => page.kind === "photos" && page.updateId === currentMoment.updateId) ?? -1;
    setActivePage(photoPage >= 0 ? photoPage : currentMoment.firstPageIndex);
    updateSettingsDraft((settings) => {
      const layoutByPage = { ...settings.preferences.layoutByPage };
      // An explicit choice for a moment also replaces its older page overrides.
      Object.keys(layoutByPage).forEach((key) => {
        if (key.startsWith(`update:${currentMoment.updateId}:photos:`)) delete layoutByPage[key];
      });
      layoutByPage[currentMoment.updateId] = value;
      return { ...settings, preferences: { ...settings.preferences, layoutByPage } };
    });
  };

  const hidePhoto = (mediaAssetId: string) => {
    if (!draft || draft.exclusions.some((item) => item.targetType === "media" && item.mediaAssetId === mediaAssetId)) return;
    void replaceExclusions([...draft.exclusions, { targetType: "media", mediaAssetId }]);
  };

  const movePhoto = (assetId: string, direction: -1 | 1) => {
    if (!currentMoment || currentPhotoOrder.length > 100) return;
    const order = [...currentPhotoOrder];
    const index = order.indexOf(assetId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    updateSettingsDraft((settings) => ({
      ...settings,
      preferences: {
        ...settings.preferences,
        photoOrderByUpdate: {
          ...settings.preferences.photoOrderByUpdate,
          [currentMoment.updateId]: order,
        },
      },
    }));
  };

  if (authLoading || (!user && !draftQuery.isError)) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center" role="status">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Bouwboek laden…</span>
      </main>
    );
  }

  if (!validProjectId || draftQuery.isError) {
    return (
      <main className="container py-20">
        <div className="mx-auto max-w-lg rounded-xl border bg-card p-8 text-center shadow-sm">
          <BookOpen className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 font-serif text-3xl">Bouwboek niet beschikbaar</h1>
          <p className="mt-2 text-sm text-muted-foreground" role="alert">
            Dit Bouwboek bestaat niet, is niet van jou of kan nu niet worden geladen.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {validProjectId ? (
              <Button onClick={() => draftQuery.refetch()} type="button" variant="outline">
                <RefreshCcw aria-hidden="true" /> Opnieuw proberen
              </Button>
            ) : null}
            <Button asChild variant="ghost"><Link to="/">Terug naar overzicht</Link></Button>
          </div>
        </div>
      </main>
    );
  }

  if (draftQuery.isPending || !draft || !sourceDocument || !document || !settingsDraft) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center" role="status">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Bouwboek samenstellen…</span>
      </main>
    );
  }

  const busy = settingsMutation.isPending || exclusionsMutation.isPending;
  const emptyBook = moments.length === 0 && draft.exclusions.length === 0;
  const coverAssetId = settingsDraft.coverMediaAssetId ?? document.cover.mediaAssetId;
  const cropAssetBlock = currentMoment && cropAssetId
    ? document.pages.flatMap((page) => page.updateId === currentMoment.updateId ? page.blocks : [])
      .find((block) => block.type === "photo" && block.assetId === cropAssetId)
    : undefined;

  return (
    <main className="min-h-screen bg-background pb-8 text-foreground dark:bg-background dark:text-foreground">
      <header className="border-b border-border bg-card/95 dark:border-border dark:bg-card/95">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Button asChild aria-label="Terug naar verbouwing" className="h-11 w-11 shrink-0" size="icon" variant="ghost">
            <Link to={`/project/${id}`}><ArrowLeft aria-hidden="true" /></Link>
          </Button>
          <div className="min-w-0">
            <p className="eyebrow">Jouw Bouwboek</p>
            <h1 className="mt-1 text-xl font-semibold leading-tight tracking-tight sm:text-2xl">Je verbouwing, om te bewaren</h1>
          </div>
        </div>
      </header>

      {emptyBook ? (
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20" aria-labelledby="empty-book-title">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-[0_28px_70px_rgba(38,35,31,0.10)] dark:border-border dark:bg-card sm:px-12">
            <div className="absolute inset-y-0 left-0 w-2 bg-accent" aria-hidden="true" />
            <BookOpen className="mx-auto h-10 w-10 text-accent" aria-hidden="true" />
            <h2 className="mt-5 font-serif text-4xl" id="empty-book-title">Je eerste bladzijde begint met een Bouwmoment</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
              Voeg een foto en een paar woorden toe. Je Bouwboek groeit daarna vanzelf met je verbouwing mee.
            </p>
            <Button asChild className="mt-7" size="lg"><Link to={`/project/${id}`}>Naar je verbouwing</Link></Button>
          </div>
        </section>
      ) : (
        <div className="mx-auto grid max-w-7xl gap-6 px-3 py-5 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 lg:px-8">
          <div className="min-w-0">
            <div className="mb-4 px-1">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">{sourceDocument.cover.title}</h2>
                <Badge className="mt-1 shrink-0 border-border bg-transparent text-muted-foreground dark:border-border dark:text-muted-foreground" variant="outline">
                  {document.pageCount} pagina’s
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">
                {moments.length} {moments.length === 1 ? "Bouwmoment" : "Bouwmomenten"} · groeit met ieder nieuw moment
              </p>
            </div>

            <PhotobookViewer activePage={activePage} document={document} onActivePageChange={setActivePage} />

            <div className="mt-5 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-sm text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                Van de eerste sleutel tot de laatste verfstreek. Dit is jullie verhaal.
              </p>
              <Button
                className="min-h-12 shrink-0"
                disabled={settingsDirty || pdfBlocked || busy || pdfLoading || proofMutation.isPending || pdfRendering}
                onClick={() => void downloadPdf()}
                type="button"
                variant="outline"
              >
                {pdfLoading || proofMutation.isPending || pdfRendering
                  ? <Loader2 className="animate-spin" aria-hidden="true" />
                  : <Download aria-hidden="true" />}
                {pdfLoading || proofMutation.isPending || pdfRendering ? "PDF wordt gemaakt…" : "Download PDF"}
              </Button>
            </div>
            {pdfError || pdfFailed ? (
              <p className="mt-3 px-1 text-sm text-destructive" role="alert">
                {pdfError ?? "Je PDF kon niet worden gemaakt. Probeer het opnieuw."}
              </p>
            ) : pdfRendering ? (
              <p className="mt-3 px-1 text-sm text-muted-foreground dark:text-muted-foreground" role="status">
                Je PDF wordt gemaakt. Je kunt hem hier downloaden zodra hij klaar is.
              </p>
            ) : null}

            {bookWarnings.length > 0 ? (
              <section aria-labelledby="book-warnings-title" className="mt-5 rounded-xl border border-border bg-card p-4 dark:border-border dark:bg-card">
                <h3 className="text-sm font-semibold" id="book-warnings-title">Let op in je Bouwboek</h3>
                {pdfBlocked ? <p className="mt-1 text-sm">Pas de gemarkeerde punten aan om je PDF te downloaden.</p> : null}
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-sm">
                  {bookWarnings.map((warning) => (
                    <li className={warning.severity === "blocking" ? "text-destructive" : "text-muted-foreground dark:text-muted-foreground"} key={`${warning.severity}:${warning.pageNumber}:${warning.message}`}>
                      {warning.severity === "blocking" ? <strong>Pas aan: </strong> : null}
                      {warning.pageNumber !== null ? `Pagina ${warning.pageNumber}: ` : ""}{warning.code === "LOW_EFFECTIVE_DPI" ? "Deze foto kan wat onscherp worden als je ver inzoomt. Kies eventueel een grotere foto." : warning.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <aside className="min-w-0 self-start rounded-2xl border border-border bg-card dark:border-border dark:bg-card" aria-label="Bouwboek aanpassen">
            <div className="px-4 pt-5 sm:px-5">
              <p className="eyebrow">Maak het van jullie</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Jouw boek, jouw keuzes</h2>
            </div>
            <Tabs defaultValue={moments.length === 0 ? "content" : "cover"} className="mt-4">
              <TabsList aria-label="Bouwboek aanpassen" className="mx-4 grid h-12 grid-cols-3 bg-muted dark:bg-muted sm:mx-5">
                <TabsTrigger className="h-10" value="cover">Cover</TabsTrigger>
                <TabsTrigger className="h-10" value="content">Inhoud</TabsTrigger>
                <TabsTrigger className="h-10" value="layout">Indeling</TabsTrigger>
              </TabsList>
              <fieldset disabled={busy} className="min-w-0">
                <TabsContent value="cover" className="m-0 space-y-5 p-4 sm:p-5">
                  <div className="space-y-2">
                    <Label htmlFor="photobook-title">Titel op de cover</Label>
                    <Input className="h-12 text-base" id="photobook-title" maxLength={160} placeholder={sourceDocument.cover.title}
                      onChange={(event) => updateSettingsDraft((settings) => ({ ...settings, title: event.target.value.trimStart() || null }))}
                      value={settingsDraft.title ?? ""} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="photobook-subtitle">Ondertitel</Label>
                    <Input className="h-12 text-base" id="photobook-subtitle" maxLength={240} placeholder="Van klushuis naar ons thuis"
                      onChange={(event) => updateSettingsDraft((settings) => ({ ...settings, subtitle: event.target.value.trimStart() }))}
                      value={settingsDraft.subtitle ?? sourceDocument.cover.subtitle} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" id="cover-photos-label">Coverfoto</p>
                    <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-labelledby="cover-photos-label">
                      <button aria-label="Kies automatisch een coverfoto" aria-pressed={settingsDraft.coverMediaAssetId === null}
                        className="flex aspect-[4/3] items-center justify-center rounded-lg border-2 border-border px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-accent/5 dark:border-border"
                        onClick={() => { setActivePage(0); updateSettingsDraft((settings) => ({ ...settings, coverMediaAssetId: null, preferences: { ...settings.preferences, coverCrop: null } })); }} type="button">
                        <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" /> Auto
                      </button>
                      {sourceDocument.sourceAssets.slice(0, coverAssetLimit).map((asset, index) => (
                        <button aria-label={`Kies foto ${index + 1} als cover`} aria-pressed={settingsDraft.coverMediaAssetId === asset.id}
                          className="aspect-[4/3] overflow-hidden rounded-lg border-2 border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary" key={asset.id}
                          onClick={() => { setActivePage(0); updateSettingsDraft((settings) => ({ ...settings, coverMediaAssetId: asset.id, preferences: { ...settings.preferences, coverCrop: { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 1 } } })); }} type="button">
                          <ResilientImage alt="" className="h-full w-full object-cover" loading="lazy" src={photobookMediaProxyPath(asset.id, "small")} />
                        </button>
                      ))}
                    </div>
                    {coverAssetLimit < sourceDocument.sourceAssets.length ? (
                      <Button className="mt-2 min-h-11 w-full" onClick={() => setCoverAssetLimit((count) => Math.min(sourceDocument.sourceAssets.length, count + 12))} type="button" variant="ghost">Meer foto’s</Button>
                    ) : null}
                  </div>
                  {coverAssetId ? (
                    <details className="rounded-lg border border-[#E5DDD1] p-3 dark:border-border">
                      <summary className="min-h-8 cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Uitsnede van de cover</summary>
                      <PhotobookCropControls id="cover" crop={settingsDraft.preferences.coverCrop ?? document.cover.crop ?? { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 1 }}
                        onChange={(crop) => { setActivePage(0); updateSettingsDraft((settings) => ({ ...settings, preferences: { ...settings.preferences, coverCrop: crop } })); }} />
                    </details>
                  ) : null}
                </TabsContent>

                <TabsContent value="content" className="m-0 space-y-5 p-4 sm:p-5">
                  <p className="text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Kies wat je wilt bewaren in je boek. Je originele Bouwmomenten blijven in je verhaal staan.</p>
                  {currentMoment ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="photobook-moment">Bouwmoment</Label>
                        <select className="h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base" id="photobook-moment" value={currentMoment.updateId}
                          onChange={(event) => { const moment = moments.find((item) => item.updateId === event.target.value); if (moment) { setSelectedMomentId(moment.updateId); setActivePage(moment.firstPageIndex); setCropAssetId(null); } }}>
                          {moments.map((moment) => <option key={moment.updateId} value={moment.updateId}>{moment.title}{moment.date ? ` · ${moment.date}` : ""}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{currentPhotoOrder.length} {currentPhotoOrder.length === 1 ? "foto" : "foto’s"}</span>
                        <Button className="min-h-11" disabled={settingsDirty} onClick={() => hideMoment(currentMoment.updateId)} type="button" variant="ghost"><EyeOff aria-hidden="true" /> Moment verbergen</Button>
                      </div>
                      <ol className="space-y-3">
                        {currentPhotoOrder.map((assetId, index) => (
                          <li className="overflow-hidden rounded-xl border border-[#E5DDD1] dark:border-border" key={assetId}>
                            <div className="flex items-center gap-3 p-2">
                              <ResilientImage alt={`Foto ${index + 1} bij ${currentMoment.title}`} className="h-16 w-20 rounded-md object-cover" loading="lazy" src={photobookMediaProxyPath(assetId, "small")} />
                              <span className="flex-1 text-sm font-medium">Foto {index + 1}</span>
                              <Button aria-label={`Foto ${index + 1} verbergen`} className="h-11 w-11" disabled={settingsDirty} onClick={() => hidePhoto(assetId)} size="icon" type="button" variant="ghost"><EyeOff aria-hidden="true" /></Button>
                            </div>
                            <div className="flex items-center justify-between border-t border-[#E5DDD1] px-2 dark:border-border">
                              <Button aria-expanded={cropAssetId === assetId} className="min-h-11" onClick={() => {
                                setCropAssetId((current) => current === assetId ? null : assetId);
                                const photoPage = document.pages.findIndex((page) => page.updateId === currentMoment.updateId && page.blocks.some((block) => block.type === "photo" && block.assetId === assetId));
                                if (photoPage >= 0) setActivePage(photoPage);
                              }} type="button" variant="ghost"><Crop aria-hidden="true" /> Uitsnede</Button>
                              <div className="flex">
                                <Button aria-label={`Foto ${index + 1} eerder plaatsen`} className="h-11 w-11" disabled={index === 0 || currentPhotoOrder.length > 100} onClick={() => movePhoto(assetId, -1)} size="icon" type="button" variant="ghost"><ArrowUp aria-hidden="true" /></Button>
                                <Button aria-label={`Foto ${index + 1} later plaatsen`} className="h-11 w-11" disabled={index === currentPhotoOrder.length - 1 || currentPhotoOrder.length > 100} onClick={() => movePhoto(assetId, 1)} size="icon" type="button" variant="ghost"><ArrowDown aria-hidden="true" /></Button>
                              </div>
                            </div>
                            {cropAssetId === assetId ? (
                              <div className="border-t border-[#E5DDD1] p-3 dark:border-border">
                                <PhotobookCropControls id={`photo-${assetId}`} crop={settingsDraft.preferences.cropByAsset[assetId] ?? (cropAssetBlock?.type === "photo" ? cropAssetBlock.crop : { fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 1 })}
                                  onChange={(crop) => updateSettingsDraft((settings) => ({ ...settings, preferences: { ...settings.preferences, cropByAsset: { ...settings.preferences.cropByAsset, [assetId]: crop } } }))} />
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : <p className="text-sm">Alle Bouwmomenten zijn verborgen. Zet ze hieronder terug om verder te bladeren.</p>}
                  {draft.exclusions.length > 0 ? (
                    <section className="border-t border-[#E5DDD1] pt-4 dark:border-border" aria-labelledby="hidden-content-title">
                      <h3 className="text-sm font-semibold" id="hidden-content-title">Verborgen inhoud</h3>
                      <ul className="mt-2 space-y-2">
                        {draft.exclusions.map((exclusion, index) => (
                          <li className="flex items-center justify-between gap-2 text-xs" key={JSON.stringify(exclusion)}>
                            {exclusion.targetType === "media" ? <ResilientImage alt="" className="h-12 w-14 shrink-0 rounded object-cover" loading="lazy" src={photobookMediaProxyPath(exclusion.mediaAssetId, "small")} /> : null}
                            <span className="flex-1">{exclusionLabel(exclusion, index)}</span>
                            <Button aria-label={`${exclusionLabel(exclusion, index)} terugzetten`} className="min-h-11" disabled={settingsDirty} onClick={() => restoreExclusion(exclusion)} size="sm" type="button" variant="ghost"><RotateCcw aria-hidden="true" /> Terugzetten</Button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </TabsContent>

                <TabsContent value="layout" className="m-0 space-y-4 p-4 sm:p-5">
                  {currentMoment ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="photobook-layout-moment">Indeling voor Bouwmoment</Label>
                        <select className="h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base" id="photobook-layout-moment" value={currentMoment.updateId}
                          onChange={(event) => { const moment = moments.find((item) => item.updateId === event.target.value); if (moment) { setSelectedMomentId(moment.updateId); setActivePage(moment.firstPageIndex); } }}>
                          {moments.map((moment) => <option key={moment.updateId} value={moment.updateId}>{moment.title}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { value: "auto", label: "Afwisselend", icon: "▥", description: "Buildy kiest de verdeling" },
                          { value: "one", label: "Foto groot", icon: "▰", description: "Eén foto per fotopagina" },
                          { value: "two", label: "Naast elkaar", icon: "▥", description: "Twee foto’s per fotopagina" },
                          { value: "grid", label: "Collage", icon: "▦", description: "Tot vier foto’s bij elkaar" },
                        ] as const).map((option) => (
                          <button aria-pressed={layoutChoice === option.value} className="rounded-xl border border-border p-3 text-left transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-accent/5 dark:border-border" key={option.value} onClick={() => setLayoutChoice(option.value)} type="button">
                            <span className="block text-2xl text-accent" aria-hidden="true">{option.icon}</span>
                            <span className="mt-1 block text-sm font-semibold">{option.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground dark:text-muted-foreground">{option.description}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground dark:text-muted-foreground">De eerste foto blijft bij je tekst. Deze keuze geldt voor de fotopagina’s daarna.</p>
                    </>
                  ) : <div className="py-4 text-center text-sm text-muted-foreground"><Images className="mx-auto mb-3 h-7 w-7" aria-hidden="true" />Zet eerst een Bouwmoment terug bij Inhoud.</div>}
                </TabsContent>
              </fieldset>
            </Tabs>
            <div className="flex items-center justify-between gap-3 border-t border-[#E5DDD1] p-4 dark:border-border sm:p-5">
              {settingsDirty ? (
                <p className="text-xs leading-5 text-muted-foreground dark:text-muted-foreground" role="status">Sla op om je voorbeeld bij te werken en je PDF te downloaden.</p>
              ) : <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4 shrink-0" aria-hidden="true" />Alles is bewaard.</p>}
              <Button className="min-h-11 shrink-0" disabled={!settingsDirty || busy} onClick={saveSettings} type="button">
                {settingsMutation.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />} Opslaan
              </Button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
};

export default Photobook;

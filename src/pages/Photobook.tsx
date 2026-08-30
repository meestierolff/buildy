import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookHeart,
  BookOpen,
  Check,
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
  PhotobookPage,
  PhotobookSettings,
} from "../../shared/contracts/photobooks";
import FeedbackForm from "@/components/moderation/FeedbackForm";
import { PhotobookViewer } from "@/components/photobook/PhotobookViewer";
import { ResilientImage } from "@/components/ResilientMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  usePhotobookDraft,
  useReplacePhotobookExclusions,
  useUpdatePhotobookSettings,
} from "@/hooks/usePhotobook";
import { ApiClientError } from "@/lib/apiClient";
import { recordProductEvent } from "@/lib/betaApi";
import { photobookMediaProxyPath } from "@/lib/photobookApi";
import { Link, useNavigate, useParams } from "@/lib/router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MomentSummary = {
  assetIds: string[];
  date: string;
  firstPageIndex: number;
  title: string;
  updateId: string;
};

const DUTCH_MONTHS: Record<string, number> = {
  januari: 0,
  februari: 1,
  maart: 2,
  april: 3,
  mei: 4,
  juni: 5,
  juli: 6,
  augustus: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function pageText(page: PhotobookPage, marker: string): string {
  const block = page.blocks.find((candidate) =>
    candidate.type === "text" && candidate.id.includes(marker));
  return block?.type === "text" ? block.lines.join(" ").trim() : "";
}

function localizedDateValue(value: string): number {
  const match = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})/i.exec(value.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;
  const month = DUTCH_MONTHS[match[2]!.toLowerCase()];
  if (month === undefined) return Number.MAX_SAFE_INTEGER;
  return Date.UTC(Number(match[3]), month, Number(match[1]));
}

function editorialPage(input: {
  body: string[];
  eyebrow: string;
  id: string;
  number: number;
  title: string[];
  tone: "opening" | "closing";
}): PhotobookPage {
  const opening = input.tone === "opening";
  return {
    id: input.id,
    number: input.number,
    kind: "chapter",
    chapterId: null,
    updateId: null,
    background: opening ? "#F5F1E8" : "#26372F",
    overlay: null,
    blocks: [
      {
        id: `${input.id}:eyebrow`,
        type: "text",
        frame: { xMm: 34, yMm: 55, widthMm: 229, heightMm: 12 },
        font: "inter",
        weight: "semibold",
        style: "normal",
        fontSizePt: 9,
        lineHeightPt: 11,
        align: "center",
        color: opening ? "#A94E36" : "#E5B29F",
        text: input.eyebrow,
        lines: [input.eyebrow],
      },
      {
        id: `${input.id}:title`,
        type: "text",
        frame: { xMm: 32, yMm: 78, widthMm: 233, heightMm: 54 },
        font: "instrument-serif",
        weight: "regular",
        style: "normal",
        fontSizePt: 36,
        lineHeightPt: 39,
        align: "center",
        color: opening ? "#26231F" : "#FFFDF8",
        text: input.title.join("\n"),
        lines: input.title,
      },
      {
        id: `${input.id}:body`,
        type: "text",
        frame: { xMm: 51, yMm: 148, widthMm: 195, heightMm: 34 },
        font: "inter",
        weight: "regular",
        style: "normal",
        fontSizePt: 10,
        lineHeightPt: 15,
        align: "center",
        color: opening ? "#655F57" : "#E9E3D9",
        text: input.body.join("\n"),
        lines: input.body,
      },
    ],
  };
}

export function deriveDigitalBook(document: PhotobookDocument): {
  document: PhotobookDocument;
  moments: MomentSummary[];
} {
  const updatePages = document.pages.filter((page) => Boolean(page.updateId));
  const pagesByUpdate = new Map<string, PhotobookPage[]>();
  for (const page of updatePages) {
    if (!page.updateId) continue;
    const existing = pagesByUpdate.get(page.updateId) ?? [];
    existing.push(page);
    pagesByUpdate.set(page.updateId, existing);
  }

  const grouped = [...pagesByUpdate.entries()].map(([updateId, pages], originalIndex) => {
    const textPage = pages.find((page) => page.kind === "update_text") ?? pages[0]!;
    const date = pageText(textPage, ":date:");
    const title = pageText(textPage, ":title") || "Bouwmoment";
    const assetIds = pages.flatMap((page) =>
      page.blocks.flatMap((block) => block.type === "photo" ? [block.assetId] : []));
    return {
      assetIds: [...new Set(assetIds)],
      date,
      originalIndex,
      pages,
      sortDate: localizedDateValue(date),
      title,
      updateId,
    };
  }).sort((left, right) =>
    left.sortDate - right.sortDate || left.originalIndex - right.originalIndex);

  if (grouped.length === 0) {
    return { document: { ...document, pages: [], pageCount: 0 }, moments: [] };
  }

  const sourcePages = [
    document.pages.find((page) => page.kind === "cover") ?? document.pages[0]!,
    editorialPage({
      body: [
        "Een huis verandert stap voor stap.",
        "Hier krijgen de momenten ertussen een vaste plek.",
      ],
      eyebrow: "ONS VERBOUWINGSVERHAAL",
      id: "digital:opening",
      number: 2,
      title: ["Van eerste idee", "tot thuis"],
      tone: "opening",
    }),
    ...grouped.flatMap((group) => group.pages),
    editorialPage({
      body: [
        "Dit verhaal is nog niet af.",
        "Ieder nieuw Bouwmoment krijgt vanzelf een plek.",
      ],
      eyebrow: "WORDT VERVOLGD",
      id: "digital:closing",
      number: 1,
      title: ["Verder bouwen,", "verder bewaren"],
      tone: "closing",
    }),
  ];
  const pages = sourcePages.map((page, index) => ({ ...page, number: index + 1 }));
  const firstPageByUpdate = new Map<string, number>();
  pages.forEach((page, index) => {
    if (page.updateId && !firstPageByUpdate.has(page.updateId)) {
      firstPageByUpdate.set(page.updateId, index);
    }
  });
  const moments = grouped.map((group) => ({
    assetIds: group.assetIds,
    date: group.date,
    firstPageIndex: firstPageByUpdate.get(group.updateId) ?? 0,
    title: group.title,
    updateId: group.updateId,
  }));

  return {
    document: { ...document, pages, pageCount: pages.length },
    moments,
  };
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
  const [settingsDraft, setSettingsDraft] = useState<PhotobookSettings | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [coverAssetLimit, setCoverAssetLimit] = useState(12);
  const [interestOpen, setInterestOpen] = useState(false);
  const openedEventSent = useRef(false);
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
  const settingsDirty = Boolean(
    settingsDraft && serverSettings && JSON.stringify(settingsDraft) !== JSON.stringify(serverSettings),
  );

  usePageMeta({
    title: sourceDocument ? `${sourceDocument.cover.title} — Bouwboek` : "Bouwboek — Buildy",
    description: "Bekijk hoe je Bouwboek vanzelf groeit met ieder Bouwmoment.",
    path: validProjectId ? `/project/${id}/bouwboek` : undefined,
    noIndex: true,
  });

  useEffect(() => {
    if (!user || !validProjectId || openedEventSent.current) return;
    openedEventSent.current = true;
    void recordProductEvent({
      eventName: "photobook_opened",
      properties: { schemaVersion: 1 },
    }).catch(() => undefined);
  }, [user, validProjectId]);

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

  const currentPage = document?.pages[activePage];
  const currentMoment = currentPage?.updateId
    ? moments.find((moment) => moment.updateId === currentPage.updateId)
    : undefined;
  const currentPhotoOrder = useMemo(() => {
    if (!currentMoment || !settingsDraft) return currentMoment?.assetIds ?? [];
    const configured = settingsDraft.preferences.photoOrderByUpdate[currentMoment.updateId] ?? [];
    const available = new Set(currentMoment.assetIds);
    const ordered = configured.filter((assetId) => available.has(assetId));
    const orderedSet = new Set(ordered);
    return [...ordered, ...currentMoment.assetIds.filter((assetId) => !orderedSet.has(assetId))];
  }, [currentMoment, settingsDraft]);
  const updateIds = moments.map((moment) => moment.updateId);
  const layoutChoice = updateIds.length > 0 && updateIds.every(
    (updateId) => settingsDraft?.preferences.layoutByPage[updateId] === "one",
  ) ? "one" : "auto";

  const setLayoutChoice = (value: "auto" | "one") => {
    updateSettingsDraft((settings) => {
      const layoutByPage = { ...settings.preferences.layoutByPage };
      updateIds.forEach((updateId) => { layoutByPage[updateId] = value; });
      return {
        ...settings,
        preferences: { ...settings.preferences, layoutByPage },
      };
    });
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

  return (
    <main className="min-h-screen bg-[#F7F2E9] text-[#26231F] dark:bg-background dark:text-foreground">
      <header className="border-b border-[#D8CFC1] bg-[#FFFDF8]/95 dark:border-border dark:bg-card/95">
        <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-5 sm:px-6 lg:px-8">
          <Button asChild aria-label="Terug naar verbouwing" className="mt-1" size="icon" variant="ghost">
            <Link to={`/project/${id}`}><ArrowLeft aria-hidden="true" /></Link>
          </Button>
          <div className="min-w-0">
            <p className="eyebrow">Jouw verbouwingsverhaal</p>
            <h1 className="mt-1 max-w-3xl font-serif text-3xl leading-none sm:text-5xl">
              Je Bouwboek groeit met je verbouwing mee
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#655F57] dark:text-muted-foreground">
              Ieder Bouwmoment krijgt automatisch een plek. Jij kiest alleen wat je wilt bewaren.
            </p>
          </div>
        </div>
      </header>

      {moments.length === 0 ? (
        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20" aria-labelledby="empty-book-title">
          <div className="relative overflow-hidden rounded-2xl border border-[#D8CFC1] bg-[#FFFDF8] px-6 py-14 text-center shadow-[0_28px_70px_rgba(38,35,31,0.10)] dark:border-border dark:bg-card sm:px-12">
            <div className="absolute inset-y-0 left-0 w-2 bg-[#A94E36]" aria-hidden="true" />
            <BookOpen className="mx-auto h-10 w-10 text-[#A94E36]" aria-hidden="true" />
            <h2 className="mt-5 font-serif text-4xl" id="empty-book-title">Je eerste bladzijde begint met een Bouwmoment</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#655F57] dark:text-muted-foreground">
              Er staan nog geen Bouwmomenten in dit boek. Voeg een foto en een paar woorden toe; daarna verschijnt hier echt jouw verhaal.
            </p>
            <Button asChild className="mt-7" size="lg">
              <Link to={`/project/${id}`}>Naar je verbouwing</Link>
            </Button>
          </div>
        </section>
      ) : (
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Blader door je verhaal</p>
                <h2 className="mt-1 font-serif text-3xl">{sourceDocument.cover.title}</h2>
              </div>
              <Badge className="border-[#D8CFC1] bg-transparent text-[#655F57] dark:border-border dark:text-muted-foreground" variant="outline">
                {moments.length} {moments.length === 1 ? "Bouwmoment" : "Bouwmomenten"}
              </Badge>
            </div>

            <PhotobookViewer
              activePage={activePage}
              document={document}
              onActivePageChange={setActivePage}
            />

            <section className="relative mt-8 overflow-hidden rounded-2xl bg-[#26372F] px-6 py-8 text-[#FFFDF8] sm:px-9" aria-labelledby="print-interest-title">
              <div className="absolute -right-10 -top-14 h-44 w-44 rounded-full border border-white/10" aria-hidden="true" />
              <BookHeart className="h-7 w-7 text-[#E5B29F]" aria-hidden="true" />
              <h2 className="mt-4 max-w-lg font-serif text-3xl" id="print-interest-title">Dit verhaal verdient misschien ooit papier</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
                Het digitale Bouwboek is gratis. We onderzoeken rustig of mensen hun verhaal later ook als echt boek willen bewaren.
              </p>
              <Button
                className="mt-6 border-white/30 bg-transparent text-white hover:bg-white hover:text-[#26372F]"
                onClick={() => setInterestOpen(true)}
                type="button"
                variant="outline"
              >
                Ik wil dit later laten drukken
              </Button>
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start" aria-label="Bouwboek aanpassen">
            <section className="rounded-xl border border-[#D8CFC1] bg-[#FFFDF8] p-5 dark:border-border dark:bg-card" aria-labelledby="cover-title">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">De voorkant</p>
                  <h2 className="mt-1 font-serif text-2xl" id="cover-title">Cover</h2>
                </div>
                <Button
                  disabled={!settingsDirty || settingsMutation.isPending}
                  onClick={saveSettings}
                  size="sm"
                  type="button"
                >
                  {settingsMutation.isPending
                    ? <Loader2 className="animate-spin" aria-hidden="true" />
                    : <Save aria-hidden="true" />}
                  Opslaan
                </Button>
              </div>
              <div className="mt-4 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="photobook-title">Titel op de cover</Label>
                  <Input
                    id="photobook-title"
                    maxLength={160}
                    onChange={(event) => updateSettingsDraft((settings) => ({
                      ...settings,
                      title: event.target.value.trimStart() || null,
                    }))}
                    value={settingsDraft.title ?? ""}
                  />
                </div>
                <div>
                  <Label>Coverfoto</Label>
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                    <button
                      aria-label="Kies automatisch een coverfoto"
                      aria-pressed={settingsDraft.coverMediaAssetId === null}
                      className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md border-2 border-[#D8CFC1] px-2 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-[#A94E36] aria-pressed:bg-[#A94E36]/5 dark:border-border"
                      onClick={() => updateSettingsDraft((settings) => ({
                        ...settings,
                        coverMediaAssetId: null,
                        preferences: { ...settings.preferences, coverCrop: null },
                      }))}
                      type="button"
                    >
                      <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" /> Automatisch
                    </button>
                    {sourceDocument.sourceAssets.slice(0, coverAssetLimit).map((asset, index) => (
                      <button
                        aria-label={`Kies foto ${index + 1} als cover`}
                        aria-pressed={settingsDraft.coverMediaAssetId === asset.id}
                        className="h-16 w-20 shrink-0 overflow-hidden rounded-md border-2 border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-[#A94E36]"
                        key={asset.id}
                        onClick={() => updateSettingsDraft((settings) => ({
                          ...settings,
                          coverMediaAssetId: asset.id,
                          preferences: {
                            ...settings.preferences,
                            coverCrop: settings.preferences.cropByAsset[asset.id] ?? {
                              fit: "cover", focusX: 0.5, focusY: 0.5, zoom: 1,
                            },
                          },
                        }))}
                        type="button"
                      >
                        <ResilientImage
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          src={photobookMediaProxyPath(asset.id, "small")}
                        />
                      </button>
                    ))}
                    {coverAssetLimit < sourceDocument.sourceAssets.length ? (
                      <button
                        className="h-16 w-20 shrink-0 rounded-md border border-dashed border-[#D8CFC1] px-2 text-[10px] text-[#655F57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-border dark:text-muted-foreground"
                        onClick={() => setCoverAssetLimit((count) =>
                          Math.min(sourceDocument.sourceAssets.length, count + 12))}
                        type="button"
                      >
                        Meer foto’s
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              {settingsDirty ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-[#655F57] dark:text-muted-foreground" role="status">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#A94E36]" aria-hidden="true" />
                  Sla op om je voorbeeld bij te werken.
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Alles is bewaard.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-[#D8CFC1] bg-[#FFFDF8] p-5 dark:border-border dark:bg-card" aria-labelledby="layout-title">
              <p className="eyebrow">De bladspiegel</p>
              <h2 className="mt-1 font-serif text-2xl" id="layout-title">Indeling</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {([
                  { value: "auto", label: "Afwisselend", icon: "▥" },
                  { value: "one", label: "Foto groot", icon: "▰" },
                ] as const).map((option) => (
                  <button
                    aria-pressed={layoutChoice === option.value}
                    className="rounded-lg border border-[#D8CFC1] p-3 text-left transition hover:border-[#A94E36]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-[#A94E36] aria-pressed:bg-[#A94E36]/5 dark:border-border"
                    key={option.value}
                    onClick={() => setLayoutChoice(option.value)}
                    type="button"
                  >
                    <span className="block text-xl text-[#A94E36]" aria-hidden="true">{option.icon}</span>
                    <span className="mt-1 block text-xs font-semibold">{option.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <details className="group rounded-xl border border-[#D8CFC1] bg-[#FFFDF8] p-5 dark:border-border dark:bg-card">
              <summary className="cursor-pointer list-none font-serif text-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Inhoud kiezen
                <span className="float-right mt-1 text-sm font-sans text-[#655F57] group-open:rotate-180" aria-hidden="true">⌄</span>
              </summary>
              <p className="mt-2 text-xs leading-5 text-[#655F57] dark:text-muted-foreground">
                Verberg alleen momenten die je niet in dit verhaal wilt bewaren.
              </p>
              <ul className="mt-4 max-h-60 space-y-2 overflow-y-auto pr-1">
                {moments.map((moment) => (
                  <li className="flex items-center gap-2 rounded-md border border-[#E5DDD1] p-2 dark:border-border" key={moment.updateId}>
                    <button
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setActivePage(moment.firstPageIndex)}
                      type="button"
                    >
                      <span className="block truncate text-xs font-semibold">{moment.title}</span>
                      <span className="block truncate text-[10px] text-[#655F57] dark:text-muted-foreground">{moment.date}</span>
                    </button>
                    <Button
                      aria-label={`${moment.title} verbergen`}
                      disabled={exclusionsMutation.isPending || settingsDirty}
                      onClick={() => hideMoment(moment.updateId)}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <EyeOff aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
              {draft.exclusions.length > 0 ? (
                <div className="mt-4 border-t border-[#E5DDD1] pt-4 dark:border-border">
                  <p className="text-xs font-semibold">Verborgen inhoud</p>
                  <ul className="mt-2 space-y-1">
                    {draft.exclusions.map((exclusion, index) => (
                      <li className="flex items-center justify-between gap-2 text-xs" key={JSON.stringify(exclusion)}>
                        <span>{exclusionLabel(exclusion, index)}</span>
                        <Button
                          aria-label={`${exclusionLabel(exclusion, index)} terugzetten`}
                          disabled={exclusionsMutation.isPending || settingsDirty}
                          onClick={() => restoreExclusion(exclusion)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <RotateCcw aria-hidden="true" /> Terugzetten
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>

            {currentMoment && currentPhotoOrder.length > 1 ? (
              <section className="rounded-xl border border-[#D8CFC1] bg-[#FFFDF8] p-5 dark:border-border dark:bg-card" aria-labelledby="photo-order-title">
                <p className="eyebrow">Huidig Bouwmoment</p>
                <h2 className="mt-1 font-serif text-2xl" id="photo-order-title">Fotovolgorde</h2>
                <p className="mt-1 truncate text-xs text-[#655F57] dark:text-muted-foreground">{currentMoment.title}</p>
                <ol className="mt-3 space-y-1.5">
                  {currentPhotoOrder.map((assetId, index) => (
                    <li className="flex items-center gap-2 rounded-md border border-[#E5DDD1] p-1.5 dark:border-border" key={assetId}>
                      <span className="w-4 text-center text-[10px] tabular-nums text-[#655F57] dark:text-muted-foreground">{index + 1}</span>
                      <ResilientImage
                        alt=""
                        className="h-10 w-12 rounded object-cover"
                        loading="lazy"
                        src={photobookMediaProxyPath(assetId, "small")}
                      />
                      <span className="flex-1 text-xs">Foto {index + 1}</span>
                      <Button
                        aria-label={`Foto ${index + 1} eerder plaatsen`}
                        disabled={index === 0}
                        onClick={() => movePhoto(assetId, -1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={`Foto ${index + 1} later plaatsen`}
                        disabled={index === currentPhotoOrder.length - 1}
                        onClick={() => movePhoto(assetId, 1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </aside>
        </div>
      )}

      <Dialog open={interestOpen} onOpenChange={setInterestOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Vertel ons wat een gedrukt Bouwboek nodig heeft</DialogTitle>
            <DialogDescription>
              Met drie korte antwoorden weten we wat voor jou telt. Je zit nergens aan vast.
            </DialogDescription>
          </DialogHeader>
          <FeedbackForm intent="print-interest" />
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Photobook;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Crop,
  FileCheck2,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  RefreshCcw,
  Save,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  PhotobookCrop,
  PhotobookExclusion,
  PhotobookLayout,
  PhotobookSettings,
} from "../../shared/contracts/photobooks";
import { PhotobookProofViewer } from "@/components/photobook/PhotobookProofViewer";
import { PhotobookViewer } from "@/components/photobook/PhotobookViewer";
import { PhotobookCheckoutDialog } from "@/components/photobook/PhotobookCheckoutDialog";
import { ResilientImage } from "@/components/ResilientMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import {
  useApprovePhotobookProof,
  usePhotobookDraft,
  useReplacePhotobookExclusions,
  useRequestPhotobookProof,
  useUpdatePhotobookSettings,
} from "@/hooks/usePhotobook";
import { ApiClientError } from "@/lib/apiClient";
import { useAppFeatures } from "@/lib/appFeatures";
import {
  createPhotobookIdempotencyKey,
  type LoadedPhotobookProof,
  photobookMediaProxyPath,
} from "@/lib/photobookApi";
import { hasExactPhotobookProof } from "@/lib/photobookPreview";
import { recordProductEvent } from "@/lib/betaApi";
import { Link, useNavigate, useParams } from "@/lib/router";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_PROOF_STATUSES = new Set(["ready", "approved", "locked"]);
const LAYOUT_OPTIONS: Array<{ value: PhotobookLayout; label: string }> = [
  { value: "auto", label: "Automatisch" },
  { value: "one", label: "Eén foto" },
  { value: "two", label: "Twee naast elkaar" },
  { value: "three", label: "Drie in compositie" },
  { value: "grid", label: "Raster van vier" },
];

type ApprovalTarget = {
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
};

function exclusionKey(exclusion: PhotobookExclusion): string {
  if (exclusion.targetType === "update") return `update:${exclusion.updateId}`;
  if (exclusion.targetType === "media") return `media:${exclusion.mediaAssetId}`;
  return `chapter:${exclusion.chapterKey}`;
}

function exclusionLabel(exclusion: PhotobookExclusion): string {
  if (exclusion.targetType === "update") return `Bouwmoment ${exclusion.updateId.slice(0, 8)}`;
  if (exclusion.targetType === "media") return `Foto ${exclusion.mediaAssetId.slice(0, 8)}`;
  return `Hoofdstuk ${exclusion.chapterKey.slice(0, 24)}`;
}

function proofStatusLabel(status: string | undefined): string {
  switch (status) {
    case "draft": return "Concept";
    case "rendering": return "Printproof wordt opgebouwd";
    case "ready": return "Klaar voor controle";
    case "approved": return "Goedgekeurd";
    case "locked": return "Vergrendeld";
    case "invalidated": return "Verouderd door wijzigingen";
    case "failed": return "Opbouwen mislukt";
    default: return "Nog geen printproof";
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function nextCommandKey(
  reference: React.MutableRefObject<{ signature: string; key: string } | null>,
  signature: string,
): string {
  if (reference.current?.signature !== signature) {
    reference.current = { signature, key: createPhotobookIdempotencyKey() };
  }
  return reference.current.key;
}

const Photobook = () => {
  const { id = "" } = useParams<{ id: string }>();
  const { loading: authLoading, user } = useAuth();
  const { checkoutEnabled } = useAppFeatures();
  const navigate = useNavigate();
  const validProjectId = UUID.test(id);
  const draftQuery = usePhotobookDraft(id, Boolean(user) && validProjectId);
  const settingsMutation = useUpdatePhotobookSettings(id);
  const exclusionsMutation = useReplacePhotobookExclusions(id);
  const proofMutation = useRequestPhotobookProof(id);
  const approvalMutation = useApprovePhotobookProof(id);
  const [settingsDraft, setSettingsDraft] = useState<PhotobookSettings | null>(null);
  const openedEventSent = useRef(false);

  useEffect(() => {
    if (!user || !validProjectId || openedEventSent.current) return;
    openedEventSent.current = true;
    void recordProductEvent({
      eventName: "photobook_opened",
      properties: { schemaVersion: 1 },
    }).catch(() => undefined);
  }, [user, validProjectId]);
  const [activePage, setActivePage] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [coverAssetLimit, setCoverAssetLimit] = useState(12);
  const [approvalTarget, setApprovalTarget] = useState<ApprovalTarget | null>(null);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [viewedProof, setViewedProof] = useState<LoadedPhotobookProof | null>(null);
  const proofCommand = useRef<{ signature: string; key: string } | null>(null);
  const approvalCommand = useRef<{ signature: string; key: string } | null>(null);
  const appliedSettingsVersion = useRef<number | null>(null);

  const draft = draftQuery.data;
  const document = draft?.document;
  const serverSettings = draft?.settings;
  const settingsDirty = Boolean(
    settingsDraft && serverSettings && JSON.stringify(settingsDraft) !== JSON.stringify(serverSettings),
  );

  usePageMeta({
    title: document ? `${document.cover.title} — Bouwboek` : "Bouwboek — Buildy",
    description: "Controleer het canonical Bouwboek en laat een beveiligde printproof opbouwen.",
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

  const documentChecksum = document?.checksumSha256;
  const documentPageCount = document?.pageCount;
  const proofRevisionId = draft?.proof?.revisionId;
  useEffect(() => {
    if (!documentPageCount) return;
    setActivePage((current) => Math.min(current, documentPageCount - 1));
  }, [documentChecksum, documentPageCount]);

  useEffect(() => {
    setCheckoutOpen(false);
  }, [documentChecksum, proofRevisionId]);

  const currentPage = document?.pages[activePage] ?? document?.pages[0];
  const currentPhotoBlocks = useMemo(
    () => currentPage?.blocks.filter((block) => block.type === "photo") ?? [],
    [currentPage],
  );
  const currentUpdatePhotoIds = useMemo(() => {
    if (!currentPage?.updateId || !document) return [];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const page of document.pages) {
      if (page.updateId !== currentPage.updateId) continue;
      for (const block of page.blocks) {
        if (block.type !== "photo" || seen.has(block.assetId)) continue;
        seen.add(block.assetId);
        ids.push(block.assetId);
      }
    }
    return ids;
  }, [currentPage?.updateId, document]);
  const orderedUpdatePhotoIds = useMemo(() => {
    const updateId = currentPage?.updateId;
    if (!updateId || !settingsDraft) return currentUpdatePhotoIds;
    const order = new Map(
      (settingsDraft.preferences.photoOrderByUpdate[updateId] ?? [])
        .map((assetId, index) => [assetId, index] as const),
    );
    return [...currentUpdatePhotoIds].sort((left, right) => {
      const leftOrder = order.get(left);
      const rightOrder = order.get(right);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return currentUpdatePhotoIds.indexOf(left) - currentUpdatePhotoIds.indexOf(right);
    });
  }, [currentPage?.updateId, currentUpdatePhotoIds, settingsDraft]);

  useEffect(() => {
    if (currentPhotoBlocks.length === 0) {
      setSelectedAssetId(null);
      return;
    }
    if (!currentPhotoBlocks.some((block) => block.type === "photo" && block.assetId === selectedAssetId)) {
      const first = currentPhotoBlocks[0];
      setSelectedAssetId(first?.type === "photo" ? first.assetId : null);
    }
  }, [currentPhotoBlocks, selectedAssetId]);

  const selectedPhoto = currentPhotoBlocks.find(
    (block) => block.type === "photo" && block.assetId === selectedAssetId,
  );
  const selectedIsCover = Boolean(
    selectedPhoto?.type === "photo" &&
    currentPage?.kind === "cover" &&
    selectedPhoto.assetId === document?.cover.mediaAssetId,
  );
  const selectedCrop = selectedPhoto?.type === "photo" && settingsDraft
    ? selectedIsCover
      ? settingsDraft.preferences.coverCrop ?? selectedPhoto.crop
      : settingsDraft.preferences.cropByAsset[selectedPhoto.assetId] ?? selectedPhoto.crop
    : null;

  const updateSettingsDraft = useCallback((change: (settings: PhotobookSettings) => PhotobookSettings) => {
    setSettingsDraft((current) => current ? change(current) : current);
  }, []);

  const updateSelectedCrop = (crop: PhotobookCrop) => {
    if (!selectedPhoto || selectedPhoto.type !== "photo") return;
    updateSettingsDraft((settings) => selectedIsCover
      ? {
          ...settings,
          preferences: { ...settings.preferences, coverCrop: crop },
        }
      : {
          ...settings,
          preferences: {
            ...settings.preferences,
            cropByAsset: { ...settings.preferences.cropByAsset, [selectedPhoto.assetId]: crop },
          },
        });
  };

  const moveUpdatePhoto = (assetId: string, direction: -1 | 1) => {
    const updateId = currentPage?.updateId;
    if (!updateId || orderedUpdatePhotoIds.length > 100) {
      if (orderedUpdatePhotoIds.length > 100) {
        toast.error("Een Bouwmoment kan maximaal 100 handmatig geordende foto’s bevatten");
      }
      return;
    }
    const index = orderedUpdatePhotoIds.indexOf(assetId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedUpdatePhotoIds.length) return;
    const reordered = [...orderedUpdatePhotoIds];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    const visible = new Set(reordered);
    const hiddenConfigured = (settingsDraft?.preferences.photoOrderByUpdate[updateId] ?? [])
      .filter((id) => !visible.has(id));
    const nextOrder = [...reordered, ...hiddenConfigured];
    if (nextOrder.length > 100) {
      toast.error("Deze bewaarde fotovolgorde is te groot om veilig aan te passen");
      return;
    }
    updateSettingsDraft((settings) => ({
      ...settings,
      preferences: {
        ...settings.preferences,
        photoOrderByUpdate: {
          ...settings.preferences.photoOrderByUpdate,
          [updateId]: nextOrder,
        },
      },
    }));
  };

  const saveSettings = async () => {
    if (!settingsDraft || settingsMutation.isPending) return;
    try {
      await settingsMutation.mutateAsync(settingsDraft);
      toast.success("Bouwboekinstellingen opgeslagen");
    } catch (error) {
      console.error("Photobook settings update failed", error);
      toast.error(errorMessage(error, "Instellingen opslaan mislukt"));
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
      toast.success("Inhoud van het Bouwboek bijgewerkt");
    } catch (error) {
      console.error("Photobook exclusions update failed", error);
      toast.error(errorMessage(error, "Inhoud bijwerken mislukt"));
    }
  };

  const addExclusion = (exclusion: PhotobookExclusion) => {
    if (!draft) return;
    const key = exclusionKey(exclusion);
    if (draft.exclusions.some((item) => exclusionKey(item) === key)) return;
    void replaceExclusions([...draft.exclusions, exclusion]);
  };

  const removeExclusion = (exclusion: PhotobookExclusion) => {
    if (!draft) return;
    const key = exclusionKey(exclusion);
    void replaceExclusions(draft.exclusions.filter((item) => exclusionKey(item) !== key));
  };

  const requestProof = async () => {
    if (!draft || settingsDirty || proofMutation.isPending) return;
    const signature = `${draft.version}:${draft.document.checksumSha256}`;
    try {
      await proofMutation.mutateAsync({
        idempotencyKey: nextCommandKey(proofCommand, signature),
        expectedDraftVersion: draft.version,
        expectedDocumentSha256: draft.document.checksumSha256,
      });
      proofCommand.current = null;
      toast.success("De echte printproof wordt opgebouwd");
    } catch (error) {
      console.error("Photobook proof request failed", error);
      toast.error(errorMessage(error, "Printproof opbouwen mislukt"));
    }
  };

  const approveProof = async () => {
    if (!approvalTarget || !approvalConfirmed || approvalMutation.isPending) return;
    const signature = `${approvalTarget.revisionId}:${approvalTarget.documentSha256}:${approvalTarget.pdfSha256}`;
    try {
      await approvalMutation.mutateAsync({
        revisionId: approvalTarget.revisionId,
        input: {
          idempotencyKey: nextCommandKey(approvalCommand, signature),
          documentSha256: approvalTarget.documentSha256,
          pdfSha256: approvalTarget.pdfSha256,
          proofViewed: true,
        },
      });
      approvalCommand.current = null;
      setApprovalTarget(null);
      setApprovalConfirmed(false);
      toast.success("Deze exacte printproof is goedgekeurd");
    } catch (error) {
      console.error("Photobook proof approval failed", error);
      toast.error(errorMessage(error, "Printproof goedkeuren mislukt"));
    }
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
            Dit Bouwboek bestaat niet, is niet van jou of kan momenteel niet veilig worden geladen.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {validProjectId && (
              <Button onClick={() => draftQuery.refetch()} type="button" variant="outline">
                <RefreshCcw aria-hidden="true" /> Opnieuw proberen
              </Button>
            )}
            <Button asChild variant="ghost"><Link to="/">Terug naar overzicht</Link></Button>
          </div>
        </div>
      </main>
    );
  }

  if (draftQuery.isPending || !draft || !document || !settingsDraft || !currentPage) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center" role="status">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Canonical Bouwboek opbouwen…</span>
      </main>
    );
  }

  const blockingWarnings = document.warnings.filter((warning) => warning.severity === "blocking");
  const proof = draft.proof;
  const proofHasExactAssets = hasExactPhotobookProof(proof, document);
  const exactViewedProof = proofHasExactAssets && proof?.pdfSha256 && viewedProof?.revisionId === proof.revisionId
    && viewedProof.documentSha256 === document.checksumSha256
    && viewedProof.pdfSha256 === proof.pdfSha256
    ? viewedProof
    : null;
  const proofCanBeApproved = proof?.status === "ready" && proofHasExactAssets && !settingsDirty && Boolean(exactViewedProof);
  const proofFinal = (proof?.status === "approved" || proof?.status === "locked") && proofHasExactAssets;
  const canRequestProof = !settingsDirty && blockingWarnings.length === 0 &&
    (!proof || ["draft", "invalidated", "failed"].includes(proof.status));
  const chapter = currentPage.chapterId
    ? document.chapters.find((item) => item.id === currentPage.chapterId)
    : null;
  const currentLayout = settingsDraft.preferences.layoutByPage[currentPage.id] ?? "auto";

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/95">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild aria-label="Terug naar verbouwing" size="icon" variant="ghost">
              <Link to={`/project/${id}`}><ArrowLeft aria-hidden="true" /></Link>
            </Button>
            <div className="min-w-0">
              <p className="eyebrow">Bouwboek</p>
              <h1 className="truncate font-serif text-2xl sm:text-3xl">{document.cover.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to={PRODUCT_ROUTES.orders}><ShoppingBag aria-hidden="true" /> Mijn bestellingen</Link>
            </Button>
            <Badge variant="outline">{document.pageCount} pagina’s</Badge>
            {settingsDirty && <Badge variant="secondary">Niet opgeslagen</Badge>}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-6 px-4 py-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {proofHasExactAssets && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100" role="status">
              <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
              <strong>Dit is je echte printproof</strong>
              <span className="text-xs opacity-80">Pagina’s en uitsneden horen bij de hashes rechts.</span>
            </div>
          )}

          {proofHasExactAssets && proof?.pdfSha256 && (
            <PhotobookProofViewer
              documentSha256={document.checksumSha256}
              onViewed={setViewedProof}
              pageCount={proof.pageCount ?? document.pageCount}
              pdfSha256={proof.pdfSha256}
              revisionId={proof.revisionId}
              thumbnailPaths={proof.thumbnailPaths}
            />
          )}

          <PhotobookViewer
            activePage={activePage}
            document={document}
            onActivePageChange={setActivePage}
          />

          <section aria-labelledby="warnings-title" className="mt-6 rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-serif text-2xl" id="warnings-title">
                <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" /> Printcontrole
              </h2>
              <Badge variant={blockingWarnings.length > 0 ? "destructive" : "secondary"}>
                {blockingWarnings.length} blokkerend
              </Badge>
            </div>
            {document.warnings.length === 0 ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Geen printwaarschuwingen.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {document.warnings.map((warning, index) => (
                  <li className={`rounded-md border px-3 py-2 text-sm ${
                    warning.severity === "blocking"
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-amber-500/30 bg-amber-500/5"
                  }`} key={`${warning.code}:${warning.pageNumber ?? "all"}:${warning.assetId ?? index}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p>{warning.message}</p>
                      {warning.pageNumber && (
                        <Button
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => setActivePage(warning.pageNumber! - 1)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Pagina {warning.pageNumber}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start" aria-label="Bouwboekinstellingen">
          <section className="rounded-xl border bg-card p-5" aria-labelledby="sku-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Lanceerformaat</p>
                <h2 className="mt-1 font-serif text-2xl" id="sku-title">A4 liggend hardcover</h2>
              </div>
              <Badge>Één SKU</Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              297 × 210 mm · RGB · printdoel 300 DPI. Andere formaten worden niet stilzwijgend aangeboden.
            </p>
          </section>

          <section className="rounded-xl border bg-card p-5" aria-labelledby="settings-title">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-2xl" id="settings-title">Boekinstellingen</h2>
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
                <Label htmlFor="photobook-title">Titel</Label>
                <Input
                  id="photobook-title"
                  maxLength={160}
                  onChange={(event) => updateSettingsDraft((settings) => ({
                    ...settings,
                    title: event.target.value || null,
                  }))}
                  value={settingsDraft.title ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="photobook-subtitle">Ondertitel</Label>
                <Input
                  id="photobook-subtitle"
                  maxLength={240}
                  onChange={(event) => updateSettingsDraft((settings) => ({
                    ...settings,
                    subtitle: event.target.value || null,
                  }))}
                  value={settingsDraft.subtitle ?? ""}
                />
              </div>
              <div>
                <Label>Coverfoto</Label>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                  <button
                    aria-pressed={settingsDraft.coverMediaAssetId === null}
                    className={`flex h-16 w-20 shrink-0 items-center justify-center rounded-md border-2 text-[10px] ${
                      settingsDraft.coverMediaAssetId === null ? "border-accent" : "border-border"
                    }`}
                    onClick={() => updateSettingsDraft((settings) => ({
                      ...settings,
                      coverMediaAssetId: null,
                      preferences: { ...settings.preferences, coverCrop: null },
                    }))}
                    type="button"
                  >
                    Automatisch
                  </button>
                  {document.sourceAssets.slice(0, coverAssetLimit).map((asset) => (
                    <button
                      aria-label={`Kies foto ${asset.id.slice(0, 8)} als cover`}
                      aria-pressed={settingsDraft.coverMediaAssetId === asset.id}
                      className={`h-16 w-20 shrink-0 overflow-hidden rounded-md border-2 ${
                        settingsDraft.coverMediaAssetId === asset.id ? "border-accent" : "border-transparent"
                      }`}
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
                  {coverAssetLimit < document.sourceAssets.length && (
                    <button
                      className="h-16 w-20 shrink-0 rounded-md border border-dashed px-2 text-[10px] text-muted-foreground"
                      onClick={() => setCoverAssetLimit((count) => Math.min(document.sourceAssets.length, count + 12))}
                      type="button"
                    >
                      Meer foto’s
                    </button>
                  )}
                </div>
              </div>
              {settingsDirty && (
                <p className="text-xs text-muted-foreground" role="status">
                  De canonical preview verandert pas nadat de server deze instellingen heeft opgeslagen en doorgerekend.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-xl border bg-card p-5" aria-labelledby="page-settings-title">
            <h2 className="font-serif text-2xl" id="page-settings-title">Pagina {currentPage.number}</h2>
            {currentPage.kind === "photos" && (
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="photobook-layout">Fotolayout</Label>
                <Select
                  onValueChange={(value: PhotobookLayout) => updateSettingsDraft((settings) => ({
                    ...settings,
                    preferences: {
                      ...settings.preferences,
                      layoutByPage: { ...settings.preferences.layoutByPage, [currentPage.id]: value },
                    },
                  }))}
                  value={currentLayout}
                >
                  <SelectTrigger id="photobook-layout"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LAYOUT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {currentPhotoBlocks.length > 0 && (
              <div className="mt-4">
                <Label>Foto en uitsnede</Label>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
                  {currentPhotoBlocks.map((block) => block.type === "photo" && (
                    <button
                      aria-label={`Bewerk uitsnede van foto ${block.assetId.slice(0, 8)}`}
                      aria-pressed={selectedAssetId === block.assetId}
                      className={`h-14 w-16 shrink-0 overflow-hidden rounded border-2 ${
                        selectedAssetId === block.assetId ? "border-accent" : "border-transparent"
                      }`}
                      key={block.id}
                      onClick={() => setSelectedAssetId(block.assetId)}
                      type="button"
                    >
                      <ResilientImage
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        src={photobookMediaProxyPath(block.assetId, "small")}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentPage.kind === "photos" && orderedUpdatePhotoIds.length > 1 && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <Label>Volgorde binnen dit Bouwmoment</Label>
                  <span className="text-[10px] text-muted-foreground">Sla op om pagina’s opnieuw te verdelen</span>
                </div>
                <ol className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
                  {orderedUpdatePhotoIds.map((assetId, index) => (
                    <li className="flex items-center gap-2 rounded-md border bg-muted/20 p-1.5" key={assetId}>
                      <span className="w-5 text-center text-[10px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <ResilientImage
                        alt=""
                        className="h-10 w-12 rounded object-cover"
                        loading="lazy"
                        src={photobookMediaProxyPath(assetId, "small")}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{assetId.slice(0, 8)}</span>
                      <Button
                        aria-label={`Foto ${index + 1} eerder plaatsen`}
                        disabled={index === 0}
                        onClick={() => moveUpdatePhoto(assetId, -1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        aria-label={`Foto ${index + 1} later plaatsen`}
                        disabled={index === orderedUpdatePhotoIds.length - 1}
                        onClick={() => moveUpdatePhoto(assetId, 1)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {selectedCrop && (
              <div className="mt-4 space-y-4 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Crop className="h-4 w-4" aria-hidden="true" /> Canonical uitsnede
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crop-fit">Passend maken</Label>
                  <Select
                    onValueChange={(value: "cover" | "contain") => updateSelectedCrop({
                      ...selectedCrop,
                      fit: value,
                      zoom: value === "contain" ? 1 : selectedCrop.zoom,
                    })}
                    value={selectedCrop.fit}
                  >
                    <SelectTrigger id="crop-fit"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">Vullend uitsnijden</SelectItem>
                      <SelectItem value="contain">Volledig tonen</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><Label>Focus horizontaal</Label><span>{Math.round(selectedCrop.focusX * 100)}%</span></div>
                  <Slider
                    aria-label="Horizontale focus van de foto"
                    disabled={selectedCrop.fit === "contain"}
                    max={100}
                    onValueChange={([value]) => updateSelectedCrop({ ...selectedCrop, focusX: (value ?? 50) / 100 })}
                    step={1}
                    value={[Math.round(selectedCrop.focusX * 100)]}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><Label>Focus verticaal</Label><span>{Math.round(selectedCrop.focusY * 100)}%</span></div>
                  <Slider
                    aria-label="Verticale focus van de foto"
                    disabled={selectedCrop.fit === "contain"}
                    max={100}
                    onValueChange={([value]) => updateSelectedCrop({ ...selectedCrop, focusY: (value ?? 50) / 100 })}
                    step={1}
                    value={[Math.round(selectedCrop.focusY * 100)]}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><Label>Zoom</Label><span>{selectedCrop.zoom.toFixed(1)}×</span></div>
                  <Slider
                    aria-label="Zoom van de foto-uitsnede"
                    disabled={selectedCrop.fit === "contain"}
                    max={40}
                    min={10}
                    onValueChange={([value]) => updateSelectedCrop({ ...selectedCrop, zoom: (value ?? 10) / 10 })}
                    step={1}
                    value={[Math.round(selectedCrop.zoom * 10)]}
                  />
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Uitsluiten</p>
              {currentPage.updateId && (
                <Button
                  className="w-full justify-start"
                  disabled={exclusionsMutation.isPending || settingsDirty}
                  onClick={() => addExclusion({ targetType: "update", updateId: currentPage.updateId! })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <X aria-hidden="true" /> Dit Bouwmoment uitsluiten
                </Button>
              )}
              {chapter && (
                <Button
                  className="w-full justify-start"
                  disabled={exclusionsMutation.isPending || settingsDirty}
                  onClick={() => addExclusion({ targetType: "chapter", chapterKey: chapter.key })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <X aria-hidden="true" /> Hoofdstuk ‘{chapter.title}’ uitsluiten
                </Button>
              )}
              {selectedPhoto?.type === "photo" && (
                <Button
                  className="w-full justify-start"
                  disabled={exclusionsMutation.isPending || settingsDirty}
                  onClick={() => addExclusion({ targetType: "media", mediaAssetId: selectedPhoto.assetId })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ImageIcon aria-hidden="true" /> Geselecteerde foto uitsluiten
                </Button>
              )}
            </div>

            {draft.exclusions.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Uitgesloten inhoud</p>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {draft.exclusions.map((exclusion) => (
                    <li className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-xs" key={exclusionKey(exclusion)}>
                      <span className="truncate">{exclusionLabel(exclusion)}</span>
                      <Button
                        aria-label={`${exclusionLabel(exclusion)} terugplaatsen`}
                        disabled={exclusionsMutation.isPending || settingsDirty}
                        onClick={() => removeExclusion(exclusion)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <RefreshCcw aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-card p-5" aria-labelledby="proof-title">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Serverproof</p>
                <h2 className="mt-1 font-serif text-2xl" id="proof-title">Printproof</h2>
              </div>
              {proof?.status === "rendering" ? (
                <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden="true" />
              ) : proofFinal ? (
                <LockKeyhole className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              ) : (
                <FileCheck2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <p className="mt-2 text-sm font-medium" role="status">{proofStatusLabel(proof?.status)}</p>
            {proof?.status === "rendering" && (
              <p className="mt-1 text-xs text-muted-foreground">De status wordt automatisch vernieuwd.</p>
            )}
            {proof && EXACT_PROOF_STATUSES.has(proof.status) && !proofHasExactAssets && (
              <p className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs" role="alert">
                De proofmetadata komt niet exact overeen met dit document. Goedkeuren blijft geblokkeerd.
              </p>
            )}

            <dl className="mt-4 space-y-3 text-xs">
              {proof && (
                <div>
                  <dt className="font-semibold text-muted-foreground">Proofrevisie</dt>
                  <dd className="mt-1 break-all rounded bg-muted/50 p-2 font-mono">{proof.revisionId}</dd>
                </div>
              )}
              <div>
                <dt className="font-semibold text-muted-foreground">Document SHA-256</dt>
                <dd className="mt-1 break-all rounded bg-muted/50 p-2 font-mono">{document.checksumSha256}</dd>
              </div>
              {proof?.pdfSha256 && (
                <div>
                  <dt className="font-semibold text-muted-foreground">PDF SHA-256</dt>
                  <dd className="mt-1 break-all rounded bg-muted/50 p-2 font-mono">{proof.pdfSha256}</dd>
                </div>
              )}
              {proof?.pageCount && (
                <div>
                  <dt className="font-semibold text-muted-foreground">Proofpagina’s</dt>
                  <dd className="mt-1 tabular-nums">{proof.pageCount}</dd>
                </div>
              )}
            </dl>

            {blockingWarnings.length > 0 && (
              <p className="mt-4 text-xs text-destructive" role="alert">
                Los eerst alle blokkerende printwaarschuwingen op.
              </p>
            )}
            {settingsDirty && (
              <p className="mt-4 text-xs text-muted-foreground">Sla wijzigingen op voordat je een proof maakt.</p>
            )}
            {proof?.status === "ready" && proofHasExactAssets && !exactViewedProof && (
              <p className="mt-4 text-xs text-muted-foreground" role="status">
                Laad en controleer eerst de echte private PDF-proof hierboven. Goedkeuren blijft dicht tot de volledige PDF en checksum in deze browser zijn gecontroleerd.
              </p>
            )}

            {canRequestProof && (
              <Button
                className="mt-4 w-full"
                disabled={proofMutation.isPending}
                onClick={requestProof}
                type="button"
              >
                {proofMutation.isPending
                  ? <Loader2 className="animate-spin" aria-hidden="true" />
                  : <FileCheck2 aria-hidden="true" />}
                Echte printproof opbouwen
              </Button>
            )}
            {proofCanBeApproved && proof?.pdfSha256 && (
              <Button
                className="mt-4 w-full bg-emerald-700 text-white hover:bg-emerald-800"
                onClick={() => {
                  if (!exactViewedProof) return;
                  setApprovalConfirmed(false);
                  setApprovalTarget({
                    revisionId: proof.revisionId,
                    documentSha256: document.checksumSha256,
                    pdfSha256: proof.pdfSha256,
                  });
                }}
                type="button"
              >
                <ShieldCheck aria-hidden="true" /> Exacte proof goedkeuren
              </Button>
            )}
            {proofFinal && (
              <>
                <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Deze exacte proof is goedgekeurd.
                </p>
                {checkoutEnabled ? (
                  <>
                    <Button className="mt-4 w-full" onClick={() => setCheckoutOpen(true)} type="button">
                      <ShoppingBag aria-hidden="true" /> Bouwboek bestellen
                    </Button>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Een exacte prijs verschijnt pas nadat de server je afleveradres en aantal heeft gecontroleerd.
                    </p>
                  </>
                ) : (
                  <p className="mt-4 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    Bestellen is nog niet beschikbaar. Je goedgekeurde proof blijft bewaard.
                  </p>
                )}
              </>
            )}
          </section>

        </aside>
      </div>

      <Dialog
        open={Boolean(approvalTarget)}
        onOpenChange={(open) => {
          if (!open && !approvalMutation.isPending) {
            setApprovalTarget(null);
            setApprovalConfirmed(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exacte printproof goedkeuren</DialogTitle>
            <DialogDescription>
              Deze actie legt precies onderstaande document- en PDF-hash vast. Latere inhoudswijzigingen vereisen een nieuwe proof.
            </DialogDescription>
          </DialogHeader>
          {approvalTarget && (
            <div className="space-y-3 text-xs">
              <div><p className="font-semibold">Document SHA-256</p><code className="mt-1 block break-all rounded bg-muted p-2">{approvalTarget.documentSha256}</code></div>
              <div><p className="font-semibold">PDF SHA-256</p><code className="mt-1 block break-all rounded bg-muted p-2">{approvalTarget.pdfSha256}</code></div>
              <div className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox
                  aria-describedby="proof-confirm-description"
                  checked={approvalConfirmed}
                  id="proof-confirm"
                  onCheckedChange={(checked) => setApprovalConfirmed(checked === true)}
                />
                <Label className="leading-relaxed" htmlFor="proof-confirm" id="proof-confirm-description">
                  Ik heb deze echte printproof pagina voor pagina gecontroleerd en keur exact deze hashes goed.
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button disabled={approvalMutation.isPending} onClick={() => setApprovalTarget(null)} type="button" variant="outline">Annuleren</Button>
            <Button disabled={!approvalConfirmed || approvalMutation.isPending} onClick={approveProof} type="button">
              {approvalMutation.isPending
                ? <Loader2 className="animate-spin" aria-hidden="true" />
                : <ShieldCheck aria-hidden="true" />}
              Goedkeuren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {checkoutEnabled && proofFinal && proof?.pdfSha256 && (
        <PhotobookCheckoutDialog
          documentSha256={document.checksumSha256}
          onOpenChange={setCheckoutOpen}
          open={checkoutOpen}
          pageCount={document.pageCount}
          pdfSha256={proof.pdfSha256}
          revisionId={proof.revisionId}
        />
      )}
    </main>
  );
};

export default Photobook;

import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInDays } from "date-fns";
import {
  BookOpen,
  Flag,
  Hammer,
  Images,
  LayoutGrid,
  Loader2,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import AddStepDialog from "@/components/AddStepDialog";
import AllPhotosTab from "@/components/AllPhotosTab";
import BlueprintTimeline from "@/components/BlueprintTimeline";
import EditStepDialog from "@/components/EditStepDialog";
import ProgressControl from "@/components/ProgressControl";
import ReportDialog from "@/components/moderation/ReportDialog";
import { ResilientImage } from "@/components/ResilientMedia";
import PrivacyBadge from "@/components/app/PrivacyBadge";
import { FloorplanBoard } from "@/components/project/FloorplanBoard";
import { ShareLinkDialog } from "@/components/project/ShareLinkDialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useDeleteProjectMutation, useProject, useUpdateProjectMutation } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import { useAppFeatures } from "@/lib/appFeatures";
import { createClientIdempotencyKey } from "@/lib/clientIdempotency";
import { LANDING_PHOTO_INTENT } from "@/lib/landingPhotoHandoffStore";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { recordProductEvent } from "@/lib/betaApi";
import { Link, Navigate, useLocation, useNavigate, useParams } from "@/lib/router";
import type { ProjectUpdate, ProjectVisibility } from "../../shared/contracts/projects";

const PROJECT_VISIBILITY_OPTIONS: ReadonlyArray<{
  value: ProjectVisibility;
  label: string;
}> = [
  { value: "private", label: "Alleen ik" },
  { value: "followers", label: "Mijn volgers" },
  { value: "unlisted", label: "Alleen via deellink" },
  { value: "public", label: "Openbaar" },
];

function visibilityShareText(visibility: ProjectVisibility): string {
  switch (visibility) {
    case "private":
      return "Deze verbouwing is alleen voor de eigenaar zichtbaar.";
    case "followers":
      return "Bekijk deze verbouwing op Buildy. Je moet het profiel van de maker actief volgen.";
    case "unlisted":
      return "Bekijk deze verbouwing via een tijdelijke Buildy-deellink.";
    case "public":
      return "Bekijk deze verbouwing op Buildy.";
  }
}

function isAccessError(error: unknown): boolean {
  return error instanceof ApiClientError && [401, 403, 404].includes(error.status);
}

function updateLabel(title: string | null, room: string | null): string {
  return title?.trim() || room?.trim() || "Bouwmoment";
}

const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const projectId = id ?? "";
  const appFeatures = useAppFeatures();
  const mediaFeaturesEnabled = appFeatures.mediaFeaturesEnabled;
  const photobooksEnabled = appFeatures.photobooksEnabled;
  const navigate = useNavigate();
  const { hash, search } = useLocation();
  const { overviewQuery, timelineQuery } = useProject(projectId, Boolean(projectId));
  const deleteProject = useDeleteProjectMutation(projectId);
  const updateProject = useUpdateProjectMutation(projectId);
  const [showAddUpdate, setShowAddUpdate] = useState(false);
  const [importLandingPhoto, setImportLandingPhoto] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<ProjectUpdate | null>(null);
  const [activeTab, setActiveTab] = useState("timeline");
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" || navigator.onLine
  ));
  const deletionKey = useRef<string | null>(null);
  const composerRequestHandled = useRef<string | null>(null);

  const project = overviewQuery.data;
  const updates = useMemo(() => {
    const byId = new Map(
      (timelineQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((update) => [update.id, update] as const),
    );
    return [...byId.values()];
  }, [timelineQuery.data]);

  useEffect(() => {
    if (!editingUpdate) return;
    const latest = updates.find((update) => update.id === editingUpdate.id);
    if (latest && latest.version !== editingUpdate.version) setEditingUpdate(latest);
  }, [editingUpdate, updates]);

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const coverFallback = useMemo(
    () => updates.flatMap((update) => update.media).find((media) => (
      media.contentType !== "application/pdf" && !media.contentType?.startsWith("video/")
    ))?.proxyPath,
    [updates],
  );
  const pageCover = project?.cover?.proxyPath ?? coverFallback;

  useEffect(() => {
    if (!project || composerRequestHandled.current === project.id) return;
    const query = new URLSearchParams(search);
    if (query.get("update") !== "nieuw") return;

    composerRequestHandled.current = project.id;
    if (project.viewerAccess === "owner" && project.canEdit) {
      setActiveTab("timeline");
      setImportLandingPhoto(query.get("intent") === LANDING_PHOTO_INTENT);
      setShowAddUpdate(true);
    }

    query.delete("update");
    query.delete("intent");
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    navigate(`${PRODUCT_ROUTES.project(project.id)}${suffix}${hash}`, { replace: true });
  }, [hash, navigate, project, search]);

  usePageMeta({
    title: project?.title ? `${project.title} — Buildy` : "Verbouwing — Buildy",
    description: project?.description
      ? `${project.description.slice(0, 145)}${project.description.length > 145 ? "..." : ""}`
      : "Bekijk de Bouwmomenten, foto's, fases en mijlpalen van deze verbouwing op Buildy.",
    image: pageCover,
    imageAlt: project?.title ? `Verbouwing ${project.title} op Buildy` : "Verbouwing op Buildy",
    path: projectId ? PRODUCT_ROUTES.project(projectId) : undefined,
    noIndex: Boolean(project && project.visibility !== "public"),
    type: "article",
  });

  const handleShare = async () => {
    if (project?.visibility === "private") return;
    if (project?.visibility === "unlisted") {
      if (project.viewerAccess === "owner") setShareDialogOpen(true);
      return;
    }
    const url = window.location.href;
    const shareData = {
      title: project?.title ? `${project.title} op Buildy` : "Verbouwing op Buildy",
      text: project ? visibilityShareText(project.visibility) : "Bekijk deze verbouwing op Buildy.",
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        void recordProductEvent({
          eventName: "project_shared",
          properties: {
            schemaVersion: 1,
            visibility: project?.visibility ?? "private",
          },
        }).catch(() => undefined);
        toast.success("Verbouwing gedeeld");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Native project share failed", error);
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard fallback failed");
      }
      toast.success("Link naar de verbouwing gekopieerd");
      void recordProductEvent({
        eventName: "project_shared",
        properties: {
          schemaVersion: 1,
          visibility: project?.visibility ?? "private",
        },
      }).catch(() => undefined);
    } catch (error) {
      console.error("Project share failed", error);
      toast.error("Delen mislukt. Kopieer de link uit je adresbalk.");
    }
  };

  const handleVisibilityChange = async (visibility: ProjectVisibility) => {
    if (!project || project.viewerAccess !== "owner" || visibility === project.visibility) return;
    try {
      await updateProject.mutateAsync({
        expectedVersion: project.version,
        visibility,
      });
      toast.success(`Zichtbaarheid ingesteld op ${PROJECT_VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.label ?? visibility}`);
    } catch (error) {
      console.error("Project visibility update failed", error);
      toast.error(error instanceof ApiClientError ? error.message : "Zichtbaarheid aanpassen lukt nu niet.");
    }
  };

  const handleProjectDeletion = async () => {
    if (!project || deleteConfirmation !== "VERWIJDER VERBOUWING" || deleteProject.isPending) return;
    deletionKey.current ??= createClientIdempotencyKey("project-deletion");
    try {
      await deleteProject.mutateAsync({
        confirmation: "VERWIJDER VERBOUWING",
        expectedVersion: project.version,
        idempotencyKey: deletionKey.current,
      });
      toast.success("Verwijdering van de verbouwing gestart");
      navigate(PRODUCT_ROUTES.projects, { replace: true });
    } catch (error) {
      console.error("Project deletion request failed", error);
      const message = error instanceof ApiClientError && error.status === 409
        ? error.message
        : "De verbouwing verwijderen lukt nu niet. Probeer dezelfde aanvraag opnieuw.";
      toast.error(message);
    }
  };

  // Compatibility-only normalization for historic update deeplinks. New UI,
  // notifications and copied links exclusively emit the `update` query key.
  const legacyQuery = new URLSearchParams(search);
  const legacyUpdateId = legacyQuery.get("step");
  if (legacyUpdateId) {
    legacyQuery.delete("step");
    if (
      !legacyQuery.has("update")
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(legacyUpdateId)
    ) {
      legacyQuery.set("update", legacyUpdateId);
    }
    const suffix = legacyQuery.size > 0 ? `?${legacyQuery.toString()}` : "";
    return <Navigate to={`${PRODUCT_ROUTES.project(projectId)}${suffix}${hash}`} replace />;
  }

  if (!projectId) {
    return (
      <main className="container py-20 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Verbouwing niet gevonden</h1>
        <p className="mt-2 text-muted-foreground">De link naar deze verbouwing is niet geldig.</p>
        <Button asChild variant="outline" className="mt-6 min-h-11">
          <Link to={PRODUCT_ROUTES.discover}>Terug naar overzicht</Link>
        </Button>
      </main>
    );
  }

  if (overviewQuery.isPending) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center" aria-busy="true">
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Verbouwing laden…
        </p>
      </main>
    );
  }

  // A denied timeline also fails the entire page closed: cached overview data
  // must not remain visible after project access has been revoked.
  if (isAccessError(overviewQuery.error) || isAccessError(timelineQuery.error)) {
    return (
      <main className="container py-20 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Verbouwing niet gevonden</h1>
        <p className="mt-2 text-muted-foreground">Deze link naar de verbouwing is niet beschikbaar.</p>
        <Button asChild variant="outline" className="mt-6 min-h-11">
          <Link to={PRODUCT_ROUTES.discover}>Terug naar overzicht</Link>
        </Button>
      </main>
    );
  }

  if (overviewQuery.isError || !project) {
    return (
      <main className="container py-20 text-center" role="alert">
        <h1 className="text-2xl font-semibold">Verbouwing kon niet worden geladen</h1>
        <p className="mt-2 text-muted-foreground">
          {isOnline
            ? "Er ging iets mis bij het ophalen van deze verbouwing. Probeer het opnieuw."
            : "Je bent offline. Maak opnieuw verbinding en probeer het daarna nog een keer."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            onClick={() => void overviewQuery.refetch()}
            className="min-h-11 gap-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link to={PRODUCT_ROUTES.discover}>Terug naar overzicht</Link>
          </Button>
        </div>
      </main>
    );
  }

  const isOwner = project.viewerAccess === "owner";
  const canEditProject = isOwner && project.canEdit;
  const visibleUpdates = milestonesOnly
    ? updates.filter((update) => update.isMilestone)
    : updates;
  const milestones = updates.filter((update) => update.isMilestone).length;
  const mediaCount = updates.reduce(
    (count, update) => count + update.media.filter((media) => media.contentType !== "application/pdf").length,
    0,
  );
  const endDate = project.expectedEndDate ? new Date(project.expectedEndDate) : new Date();
  const days = project.startDate
    ? Math.max(1, differenceInDays(endDate, new Date(project.startDate)) + 1)
    : null;
  const privacyLevel = project.visibility === "public"
    ? "public"
    : project.visibility === "private"
      ? "private"
      : "shared";
  const availableUpdates = updates.map((update) => ({
    id: update.id,
    label: updateLabel(update.title, update.room),
  }));

  return (
    <main className="min-h-screen">
      <section className="border-b border-border bg-background" aria-labelledby="project-title">
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 md:pt-6 lg:px-8">
          {pageCover && (
            <figure className="relative aspect-[4/3] max-h-[34rem] w-full overflow-hidden bg-muted sm:aspect-[16/8] lg:aspect-[16/7]">
              <ResilientImage
                src={pageCover}
                alt={`Omslagfoto van ${project.title}`}
                fallbackLabel="Omslagfoto niet beschikbaar"
                className="h-full w-full object-cover"
              />
            </figure>
          )}

          <div className={`grid gap-7 py-7 md:py-9 ${
            pageCover
              ? "lg:grid-cols-[minmax(0,1fr)_auto]"
              : "border-t-2 border-accent lg:grid-cols-[minmax(0,1fr)_auto]"
          }`}>
            <div className="min-w-0 max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {project.projectType && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                    {project.projectType}
                  </span>
                )}
                <PrivacyBadge
                  level={privacyLevel}
                  label={project.visibility === "followers"
                    ? "Mijn volgers"
                    : project.visibility === "unlisted"
                      ? "Deellink"
                      : undefined}
                />
                {isOwner && (
                  <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-semibold" aria-label="Eigenaarsweergave">
                    Jouw verbouwing
                  </span>
                )}
              </div>
              <h1 id="project-title" className="break-words text-3xl font-semibold leading-[1.04] tracking-tight sm:text-4xl md:text-5xl">
                {project.title}
              </h1>
              <p className="mt-4 text-sm text-muted-foreground">
                door{" "}
                <Link
                  to={PRODUCT_ROUTES.profile(project.owner.slug)}
                  className="inline-flex min-h-11 items-center font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-accent"
                >
                  {project.owner.displayName}
                </Link>
              </p>
              {project.description && (
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {project.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap content-start gap-2 lg:max-w-md lg:justify-end">
              {canEditProject ? (
                <Button
                  type="button"
                  onClick={() => setShowAddUpdate(true)}
                  className="min-h-11 flex-1 gap-2 bg-accent text-accent-foreground hover:bg-accent/90 sm:flex-none"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Bouwmoment toevoegen
                </Button>
              ) : null}
              {project.visibility !== "private" && (project.visibility !== "unlisted" || isOwner) ? (
                <Button type="button" variant="outline" onClick={() => void handleShare()} className="min-h-11 gap-2">
                  <Share2 className="h-4 w-4" aria-hidden="true" /> {project.visibility === "unlisted" ? "Deellink" : "Delen"}
                </Button>
              ) : null}
              {!isOwner ? (
                <ReportDialog
                  compact
                  targetType="project"
                  targetId={project.id}
                  targetLabel={`Verbouwing ${project.title}`}
                />
              ) : null}
              {isOwner && (
                <>
                  <Select
                    value={project.visibility}
                    onValueChange={(value) => void handleVisibilityChange(value as ProjectVisibility)}
                    disabled={updateProject.isPending}
                  >
                    <SelectTrigger className="min-h-11 w-full sm:w-48" aria-label="Zichtbaarheid van de verbouwing">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_VISIBILITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button asChild variant="outline" className="min-h-11 gap-2">
                    <Link to={PRODUCT_ROUTES.projectBudget(project.id)}>
                      <Wallet className="h-4 w-4" aria-hidden="true" /> Budget
                    </Link>
                  </Button>
                  {photobooksEnabled ? (
                    <Button asChild variant="outline" className="min-h-11 gap-2">
                      <Link to={PRODUCT_ROUTES.projectPhotobook(project.id)}>
                        <BookOpen className="h-4 w-4" aria-hidden="true" /> Bouwboek
                      </Link>
                    </Button>
                  ) : null}
                  <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
                    if (deleteProject.isPending) return;
                    setDeleteDialogOpen(open);
                    if (!open) setDeleteConfirmation("");
                  }}>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" className="min-h-11 gap-2 text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Verwijderen
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Verbouwing definitief verwijderen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Buildy verbergt de verbouwing direct en verwijdert de privébestanden via een controleerbare achtergrondtaak. Een actieve Bouwboekbestelling blokkeert dit. Bewijs van afgeronde bestellingen blijft volgens het bewaarbeleid beschermd.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="space-y-2">
                        <label htmlFor="delete-project-confirmation" className="text-sm font-medium">
                          Typ VERWIJDER VERBOUWING om te bevestigen
                        </label>
                        <Input
                          id="delete-project-confirmation"
                          autoComplete="off"
                          value={deleteConfirmation}
                          onChange={(event) => setDeleteConfirmation(event.target.value)}
                          disabled={deleteProject.isPending}
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel type="button" disabled={deleteProject.isPending}>
                          Annuleren
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={deleteConfirmation !== "VERWIJDER VERBOUWING" || deleteProject.isPending}
                          onClick={(event) => {
                            event.preventDefault();
                            void handleProjectDeletion();
                          }}
                        >
                          {deleteProject.isPending ? "Verwijdering starten…" : "Verbouwing verwijderen"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>

            <div className="lg:col-span-2">
              <dl className="grid grid-cols-4 border-y border-border">
                {[
                  ["Bouwmomenten", project.updateCount],
                  ["Media", mediaCount],
                  ["Dagen", days ?? "—"],
                  ["Mijlpalen", milestones],
                ].map(([label, value]) => (
                  <div key={label} className="border-l border-border px-2 py-4 first:border-l-0 first:pl-0 sm:px-4 sm:first:pl-0">
                    <dt className="truncate text-[9px] font-semibold uppercase tracking-[0.11em] text-muted-foreground sm:text-[10px] sm:tracking-[0.16em]">
                      {label}
                    </dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 max-w-xl">
                <ProgressControl
                  projectId={project.id}
                  expectedVersion={project.version}
                  isOwner={canEditProject}
                  progressPercentage={project.progressPercentage}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-background" aria-label="Inhoud van de verbouwing">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value);
              if (value !== "timeline") setMilestonesOnly(false);
            }}
            className="pt-5 md:pt-7"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <TabsList className="h-auto max-w-full justify-start overflow-x-auto bg-transparent p-0" aria-label="Weergave van de verbouwing">
                <TabsTrigger value="timeline" className="min-h-11 gap-1.5 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent">
                  <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> Verhaal
                </TabsTrigger>
                {mediaFeaturesEnabled ? (
                  <TabsTrigger value="floorplan" className="min-h-11 gap-1.5 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent">
                    <MapIcon className="h-3.5 w-3.5" aria-hidden="true" /> Plattegrond
                  </TabsTrigger>
                ) : null}
                {mediaFeaturesEnabled ? (
                  <TabsTrigger value="photos" className="min-h-11 gap-1.5 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent">
                    <Images className="h-3.5 w-3.5" aria-hidden="true" /> Alle foto&apos;s
                  </TabsTrigger>
                ) : null}
              </TabsList>
              {milestones > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant={milestonesOnly ? "default" : "outline"}
                  aria-pressed={milestonesOnly}
                  onClick={() => {
                    if (activeTab !== "timeline") {
                      setActiveTab("timeline");
                      setMilestonesOnly(true);
                      return;
                    }
                    setMilestonesOnly((current) => !current);
                  }}
                  className={`min-h-11 gap-1.5 ${
                    milestonesOnly ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Mijlpalen
                </Button>
              )}
            </div>

            <TabsContent value="timeline">
              {milestonesOnly && (
                <div className="mb-4 flex items-center justify-between border-l-2 border-accent bg-accent/5 px-4 py-2 text-sm" role="status">
                  <span>Alleen mijlpalen worden getoond</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMilestonesOnly(false)} className="min-h-11">
                    Filter wissen
                  </Button>
                </div>
              )}

              {timelineQuery.isPending ? (
                <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-busy="true">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Bouwmomenten laden…
                </p>
              ) : timelineQuery.isError ? (
                <div className="border-y border-border py-14 text-center" role="alert">
                  <p className="text-muted-foreground">
                    {isOnline
                      ? "De Bouwmomenten konden niet worden geladen."
                      : "Je bent offline. Maak opnieuw verbinding om de Bouwmomenten te laden."}
                  </p>
                  <Button type="button" variant="outline" onClick={() => void timelineQuery.refetch()} className="mt-4 min-h-11 gap-2">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
                  </Button>
                </div>
              ) : visibleUpdates.length === 0 ? (
                <div className="border-y border-border py-16 text-center text-muted-foreground">
                  <Hammer className="mx-auto mb-3 h-12 w-12 opacity-40" aria-hidden="true" />
                  <p className="text-lg">{milestonesOnly ? "Geen mijlpalen gevonden." : "Nog geen Bouwmomenten."}</p>
                  {canEditProject && !milestonesOnly && (
                    <>
                      <p className="mt-1 text-sm">Begin met een foto van de huidige situatie.</p>
                      <Button
                        type="button"
                        onClick={() => setShowAddUpdate(true)}
                        className="mt-5 min-h-11 bg-accent text-accent-foreground hover:bg-accent/90"
                      >
                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Eerste Bouwmoment toevoegen
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <BlueprintTimeline
                  updates={visibleUpdates}
                  projectId={project.id}
                  canEdit={canEditProject}
                  canEngage={project.viewerAccess !== "link"}
                  canCopyUpdateLink={project.visibility === "followers" || project.visibility === "public"}
                  onEdit={setEditingUpdate}
                />
              )}

              {timelineQuery.hasNextPage && !milestonesOnly && (
                <div className="flex justify-center pb-8">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={timelineQuery.isFetchingNextPage}
                    onClick={() => void timelineQuery.fetchNextPage()}
                    className="min-h-11 gap-2"
                  >
                    {timelineQuery.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {timelineQuery.isFetchingNextPage ? "Meer Bouwmomenten laden…" : "Oudere Bouwmomenten laden"}
                  </Button>
                </div>
              )}
            </TabsContent>

            {mediaFeaturesEnabled ? (
              <TabsContent value="floorplan">
                <FloorplanBoard
                  projectId={project.id}
                  availableUpdates={availableUpdates}
                />
              </TabsContent>
            ) : null}

            {mediaFeaturesEnabled ? (
              <TabsContent value="photos">
                <AllPhotosTab projectId={project.id} updates={updates} />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      </section>

      {showAddUpdate && (
        <AddStepDialog
          projectId={project.id}
          importLandingPhoto={importLandingPhoto}
          onClose={() => {
            setShowAddUpdate(false);
            setImportLandingPhoto(false);
          }}
          onAdded={() => {
            setImportLandingPhoto(false);
            void Promise.all([overviewQuery.refetch(), timelineQuery.refetch()]).catch((error) => {
              console.error("Refresh project after update failed", error);
            });
          }}
        />
      )}
      {canEditProject && editingUpdate && (
        <EditStepDialog
          key={`${editingUpdate.id}:${editingUpdate.version}`}
          projectId={project.id}
          update={editingUpdate}
          onClose={() => setEditingUpdate(null)}
          onUpdated={() => setEditingUpdate(null)}
          onDeleted={() => setEditingUpdate(null)}
        />
      )}
      {isOwner && project.visibility === "unlisted" && shareDialogOpen ? (
        <ShareLinkDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          onCopied={() => {
            void recordProductEvent({
              eventName: "project_shared",
              properties: { schemaVersion: 1, visibility: "unlisted" },
            }).catch(() => undefined);
          }}
          projectId={project.id}
          projectTitle={project.title}
        />
      ) : null}
    </main>
  );
};

export default TripDetail;

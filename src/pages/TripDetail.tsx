import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Hammer,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
} from "lucide-react";
import { toast } from "sonner";

import AddStepDialog from "@/components/AddStepDialog";
import BlueprintTimeline from "@/components/BlueprintTimeline";
import EditStepDialog from "@/components/EditStepDialog";
import ProgressControl from "@/components/ProgressControl";
import ReportDialog from "@/components/moderation/ReportDialog";
import { ResilientImage } from "@/components/ResilientMedia";
import PrivacyBadge from "@/components/app/PrivacyBadge";
import { ShareLinkDialog } from "@/components/project/ShareLinkDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuth } from "@/hooks/useAuth";
import { useProject, useUpdateProjectMutation } from "@/hooks/useProjectApi";
import { ApiClientError } from "@/lib/apiClient";
import { useAppFeatures } from "@/lib/appFeatures";
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

const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const projectId = id ?? "";
  const { user } = useAuth();
  const appFeatures = useAppFeatures();
  const photobooksEnabled = appFeatures.photobooksEnabled;
  const navigate = useNavigate();
  const { hash, search } = useLocation();
  const { overviewQuery, timelineQuery } = useProject(projectId, Boolean(projectId));
  const updateProject = useUpdateProjectMutation(projectId);
  const [showAddUpdate, setShowAddUpdate] = useState(false);
  const [importLandingPhoto, setImportLandingPhoto] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<ProjectUpdate | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" || navigator.onLine
  ));
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
    if (!project) return;
    if (project.visibility === "private") {
      if (project.viewerAccess !== "owner") return;
      try {
        await updateProject.mutateAsync({
          expectedVersion: project.version,
          visibility: "unlisted",
        });
        setShareDialogOpen(true);
        toast.success("Delen via een beveiligde link staat aan");
      } catch (error) {
        console.error("Enable project share link failed", error);
        toast.error(error instanceof ApiClientError ? error.message : "Delen aanzetten lukt nu niet.");
      }
      return;
    }
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
          <Link to={PRODUCT_ROUTES.landing}>Naar Buildy</Link>
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
          <Link to={PRODUCT_ROUTES.landing}>Naar Buildy</Link>
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
            <Link to={PRODUCT_ROUTES.landing}>Naar Buildy</Link>
          </Button>
        </div>
      </main>
    );
  }

  const isOwner = project.viewerAccess === "owner";
  const canEditProject = isOwner && project.canEdit;
  const privacyLevel = project.visibility === "public"
    ? "public"
    : project.visibility === "private"
      ? "private"
      : "shared";
  const projectPeriod = project.startDate
    ? new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(new Date(project.startDate))
    : null;
  const currentPhase = [...updates]
    .sort((left, right) => right.updateDate.localeCompare(left.updateDate))
    .find((update) => update.phase)?.phase?.name ?? null;

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
              {isOwner || (project.visibility !== "private" && project.visibility !== "unlisted") ? (
                <Button type="button" variant="outline" onClick={() => void handleShare()} className="min-h-11 gap-2">
                  <Share2 className="h-4 w-4" aria-hidden="true" /> {isOwner ? "Deel je verbouwing" : "Delen"}
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
                  {photobooksEnabled ? (
                    <Button asChild variant="outline" className="min-h-11 gap-2">
                      <Link to={PRODUCT_ROUTES.projectPhotobook(project.id)}>
                        <BookOpen className="h-4 w-4" aria-hidden="true" /> Bouwboek
                      </Link>
                    </Button>
                  ) : null}
                </>
              )}
            </div>

            <div className="border-t border-border pt-5 lg:col-span-2 lg:flex lg:items-start lg:justify-between lg:gap-10">
              <p className="text-sm text-muted-foreground">
                {project.updateCount} {project.updateCount === 1 ? "Bouwmoment" : "Bouwmomenten"}
                {currentPhase ? ` · ${currentPhase}` : ""}
                {projectPeriod ? ` · begonnen in ${projectPeriod}` : ""}
              </p>
              <div className="mt-5 w-full max-w-xl lg:mt-0">
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

      <section className="bg-[#FFFDF8]" aria-labelledby="story-title">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 md:py-16 lg:px-8">
          <div className="mb-10 border-b border-[#D8CFC1] pb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#A94E36]">Het Verhaal</p>
            <h2 id="story-title" className="mt-2 font-serif text-4xl leading-none text-[#26231F] sm:text-5xl">
              Van eerste foto tot thuis.
            </h2>
          </div>

          {timelineQuery.isPending ? (
            <p className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Bouwmomenten laden…
            </p>
          ) : timelineQuery.isError ? (
            <div className="border-y border-[#D8CFC1] py-14 text-center" role="alert">
              <p className="text-muted-foreground">
                {isOnline
                  ? "De Bouwmomenten konden niet worden geladen."
                  : "Je bent offline. Probeer het opnieuw zodra je verbinding terug is."}
              </p>
              <Button type="button" variant="outline" onClick={() => void timelineQuery.refetch()} className="mt-4 min-h-11 gap-2">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Opnieuw proberen
              </Button>
            </div>
          ) : updates.length === 0 ? (
            <div className="border-y border-[#D8CFC1] py-16 text-center text-[#655F57]">
              <Hammer className="mx-auto mb-4 h-10 w-10 text-[#A94E36]" strokeWidth={1.5} aria-hidden="true" />
              <p className="font-serif text-3xl text-[#26231F]">Je verbouwverhaal begint hier.</p>
              <p className="mt-2 text-sm">Eén foto is genoeg om te beginnen.</p>
              {canEditProject ? (
                <Button
                  type="button"
                  onClick={() => setShowAddUpdate(true)}
                  className="mt-6 min-h-11 bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Bouwmoment toevoegen
                </Button>
              ) : null}
            </div>
          ) : (
            <BlueprintTimeline
              updates={updates}
              projectId={project.id}
              canEdit={canEditProject}
              canEngage={project.viewerAccess !== "link" || Boolean(user)}
              canCopyUpdateLink={project.visibility === "followers" || project.visibility === "public"}
              onEdit={setEditingUpdate}
            />
          )}

          {timelineQuery.hasNextPage ? (
            <div className="flex justify-center pt-10">
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
          ) : null}
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

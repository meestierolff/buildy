import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, Image as ImageIcon, Link2, MessageCircle, Pencil, Star } from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";

import type { ProjectUpdate } from "../../shared/contracts/projects";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import CommentsSheet from "@/components/CommentsSheet";
import MediaLightbox, { type LightboxItem } from "@/components/MediaLightbox";
import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";
import ReportDialog from "@/components/moderation/ReportDialog";
import { phaseColor } from "@/components/PhaseSelect";
import ReactionBar from "@/components/ReactionBar";
import { Button } from "@/components/ui/button";

interface Props {
  updates: readonly ProjectUpdate[];
  projectId: string;
  canEdit?: boolean;
  canEngage?: boolean;
  canCopyUpdateLink?: boolean;
  onEdit?: (update: ProjectUpdate) => void;
}

function updateLabel(update: ProjectUpdate): string {
  return update.title?.trim() || update.room?.trim() || "Bouwmoment";
}

function isPdf(contentType: string | null): boolean {
  return contentType === "application/pdf";
}

function isVideo(contentType: string | null): boolean {
  return contentType?.startsWith("video/") ?? false;
}

const BlueprintTimeline = ({
  updates,
  projectId,
  canEdit = false,
  canEngage = true,
  canCopyUpdateLink = true,
  onEdit,
}: Props) => {
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [activeUpdateId, setActiveUpdateId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialPositionedRef = useRef(false);

  const chronologicalUpdates = useMemo(
    () => [...updates].sort((a, b) => (
      a.updateDate.localeCompare(b.updateDate)
      || a.sortOrder - b.sortOrder
      || a.id.localeCompare(b.id)
    )),
    [updates],
  );

  useEffect(() => {
    initialPositionedRef.current = false;
    setActiveUpdateId(null);
    setExpandedId(null);
  }, [projectId]);

  // A deeplink opens its update. A normal visit starts at the oldest loaded
  // entry without forcing a large card open.
  useEffect(() => {
    if (chronologicalUpdates.length === 0 || initialPositionedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get("update");
    const hasDeeplink = Boolean(
      requestedId && chronologicalUpdates.some((update) => update.id === requestedId),
    );
    const target = hasDeeplink ? requestedId : chronologicalUpdates[0]?.id;
    if (!target) return;

    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`update-${target}`);
      const scroller = scrollerRef.current;
      if (!element || !scroller) return;
      const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollTo({
        left: Math.min(Math.max(0, element.offsetLeft - 16), maxScrollLeft),
        behavior: "auto",
      });
      setActiveUpdateId(target);
      setExpandedId(hasDeeplink ? target : null);
      initialPositionedRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chronologicalUpdates]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || chronologicalUpdates.length === 0 || typeof IntersectionObserver === "undefined") return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-update-id]"));
    if (cards.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const updateId = (entry.target as HTMLElement).dataset.updateId;
        if (updateId) visibility.set(updateId, entry.intersectionRatio);
      });
      const best = [...visibility.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) setActiveUpdateId(best[0]);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [chronologicalUpdates]);

  useEffect(() => {
    if (!activeUpdateId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("update") === activeUpdateId) return;
    params.set("update", activeUpdateId);
    const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [activeUpdateId]);

  const copyUpdateLink = async (updateId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("update", updateId);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link gekopieerd");
    } catch (error) {
      console.error("Copy update link failed", error);
      toast.error("Kopiëren mislukt", { description: url });
    }
  };

  const openLightboxForUpdate = (update: ProjectUpdate, mediaId: string) => {
    const visualMedia = [...update.media]
      .filter((media) => !isPdf(media.contentType))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const items: LightboxItem[] = visualMedia.map((media) => ({
      id: media.id,
      url: media.proxyPath,
      type: isVideo(media.contentType) ? "video" : "image",
      updateId: update.id,
      updateTitle: updateLabel(update),
      updateDate: update.updateDate,
      phase: update.phase?.name ?? null,
    }));
    const index = visualMedia.findIndex((media) => media.id === mediaId);
    if (index >= 0) setLightbox({ items, index });
  };

  const firstDate = chronologicalUpdates[0]
    ? new Date(chronologicalUpdates[0].updateDate)
    : null;

  return (
    <div className="relative pb-10">
      <div
        ref={scrollerRef}
        className="-mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-4 px-4 pb-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        {chronologicalUpdates.map((update) => {
          const sortedMedia = [...update.media].sort((a, b) => a.sortOrder - b.sortOrder);
          const before = sortedMedia.find((media) => (
            media.role === "before" && !isPdf(media.contentType) && !isVideo(media.contentType)
          ));
          const after = sortedMedia.find((media) => (
            media.role === "after" && !isPdf(media.contentType) && !isVideo(media.contentType)
          ));
          const hasComparison = Boolean(before && after);
          const visualMedia = sortedMedia.filter((media) => (
            !isPdf(media.contentType)
            && !(hasComparison && (media.id === before?.id || media.id === after?.id))
          ));
          const previewMedia = visualMedia[0] ?? before ?? after;
          const documents = sortedMedia.filter((media) => isPdf(media.contentType));
          const label = updateLabel(update);
          const updateDate = new Date(update.updateDate);
          const dayNumber = firstDate
            ? Math.max(1, differenceInCalendarDays(updateDate, firstDate) + 1)
            : 1;
          const isActive = activeUpdateId === update.id;
          const isExpanded = expandedId === update.id;

          return (
            <div
              key={update.id}
              id={`update-${update.id}`}
              data-update-id={update.id}
              className="flex w-[calc(100vw-2rem)] max-w-[42rem] shrink-0 snap-start scroll-mx-4 flex-col"
            >
              <div className="border-l-2 border-accent pb-3 pl-3">
                <button
                  type="button"
                  onClick={() => {
                    const scroller = scrollerRef.current;
                    const element = document.getElementById(`update-${update.id}`);
                    if (scroller && element) {
                      const scrollerBounds = scroller.getBoundingClientRect();
                      const elementBounds = element.getBoundingClientRect();
                      scroller.scrollTo({
                        left: scroller.scrollLeft + (elementBounds.left - scrollerBounds.left),
                        behavior: "smooth",
                      });
                    }
                    setExpandedId((current) => current === update.id ? null : update.id);
                  }}
                  className={`group flex min-h-11 items-center gap-3 px-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={`Spring naar ${label}`}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
                    Dag {dayNumber}
                  </span>
                  <time className="text-xs font-medium">
                    {format(updateDate, "EEE d MMM", { locale: nl })}
                  </time>
                </button>
              </div>

              <article className={`flex flex-col overflow-hidden border-y bg-background ${
                isExpanded ? "border-accent" : "border-border"
              }`}>
                <div className="group w-full text-left">
                  {isExpanded && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="min-h-11 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                      aria-expanded="true"
                      aria-label={`${label} inklappen`}
                    >
                      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <time className="text-[11px] font-medium text-muted-foreground">
                            {format(updateDate, "d MMM yyyy", { locale: nl })}
                          </time>
                          {update.phase && (
                            <span className={`border-l-2 border-current px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${phaseColor(update.phase.name)}`}>
                              {update.phase.name}
                            </span>
                          )}
                          {update.isMilestone && (
                            <span className="flex items-center gap-1 border-l-2 border-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                              <Star className="h-2.5 w-2.5" aria-hidden="true" /> Mijlpaal
                            </span>
                          )}
                          {update.status === "draft" && (
                            <span className="border-l-2 border-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                              Concept
                            </span>
                          )}
                        </div>
                        <ChevronDown className="h-4 w-4 shrink-0 rotate-180 text-muted-foreground" aria-hidden="true" />
                      </div>
                      <div className="px-4 pb-3">
                        <h3 className="font-sans text-lg font-bold leading-tight transition-colors group-hover:text-accent">
                          {label}
                        </h3>
                      </div>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(update.id);
                      if (previewMedia) openLightboxForUpdate(update, previewMedia.id);
                    }}
                    className="relative block min-h-11 w-full overflow-hidden bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    style={{ aspectRatio: "4/3" }}
                    aria-label={previewMedia ? `Open media van ${label}` : `${label} uitklappen`}
                    data-testid="timeline-primary-media"
                  >
                    {previewMedia ? (
                      isVideo(previewMedia.contentType) ? (
                        <ResilientVideo src={previewMedia.proxyPath} className="h-full w-full object-cover" />
                      ) : (
                        <ResilientImage
                          src={previewMedia.proxyPath}
                          alt={`Foto bij ${label}`}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                      )
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
                      </div>
                    )}
                  </button>

                  {!isExpanded && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(update.id)}
                      className="block min-h-11 w-full border-t border-border/40 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                      aria-expanded="false"
                      aria-label={`${label} uitklappen`}
                    >
                      <h3 className="font-sans text-lg font-bold leading-tight text-foreground transition-colors group-hover:text-accent">
                        {label}
                      </h3>
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <>
                    <div className="flex items-center justify-end border-b border-border/60 px-3 py-1">
                      {canCopyUpdateLink ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          onClick={() => void copyUpdateLink(update.id)}
                          title="Kopieer link naar dit Bouwmoment"
                          aria-label="Link naar Bouwmoment kopiëren"
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                      {canEdit && onEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="min-h-11 gap-2"
                          onClick={() => onEdit(update)}
                          aria-label={`${label} bewerken`}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Bewerken
                        </Button>
                      )}
                      {!canEdit ? (
                        <ReportDialog
                          compact
                          targetType="update"
                          targetId={update.id}
                          targetLabel={`Bouwmoment ${label}`}
                        />
                      ) : null}
                    </div>

                    {hasComparison && before && after && (
                      <div className="px-4 pb-3 pt-2">
                        <div className="[&_button]:min-h-11 [&_button]:min-w-11">
                          <BeforeAfterSlider
                            beforeUrl={before.proxyPath}
                            afterUrl={after.proxyPath}
                            onBeforeClick={() => openLightboxForUpdate(update, before.id)}
                            onAfterClick={() => openLightboxForUpdate(update, after.id)}
                          />
                        </div>
                      </div>
                    )}

                    {visualMedia.length > 1 && (
                      <div className={`mt-0.5 grid gap-0.5 ${
                        visualMedia.length === 2
                          ? "grid-cols-1"
                          : visualMedia.length === 3
                            ? "grid-cols-2"
                            : "grid-cols-3"
                      }`}>
                        {visualMedia.slice(1, 4).map((media, mediaIndex) => {
                          const isOverflow = mediaIndex === 2 && visualMedia.length > 4;
                          return (
                            <button
                              key={media.id}
                              type="button"
                              onClick={() => openLightboxForUpdate(update, media.id)}
                              aria-label={`Open media ${mediaIndex + 2} van ${label}`}
                              className="relative min-h-11 overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                              style={{ aspectRatio: "1" }}
                            >
                              {isVideo(media.contentType) ? (
                                <ResilientVideo src={media.proxyPath} className="absolute inset-0 h-full w-full object-cover" />
                              ) : (
                                <ResilientImage
                                  src={media.proxyPath}
                                  alt=""
                                  className="absolute inset-0 h-full w-full object-cover transition-opacity hover:opacity-90"
                                  loading="lazy"
                                />
                              )}
                              {isOverflow && (
                                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold text-white">
                                  +{visualMedia.length - 3}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="space-y-2 px-4 py-3">
                      {update.description && (
                        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">
                          {update.description}
                        </p>
                      )}
                      {documents.length > 0 && (
                        <div className="space-y-1.5">
                          {documents.map((media, index) => (
                            <a
                              key={media.id}
                              href={media.proxyPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex min-h-11 items-center gap-2 border bg-secondary/30 px-3 py-2 text-sm transition-colors hover:bg-secondary"
                            >
                              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                              <span className="flex-1 truncate">{media.caption || `Document ${index + 1}`}</span>
                              <span className="text-xs text-muted-foreground">PDF</span>
                            </a>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2">
                        <div className="[&_button]:min-h-11 [&_button]:min-w-11">
                          <ReactionBar
                            projectId={projectId}
                            updateId={update.id}
                            canReact={canEngage}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenComments(update.id)}
                          aria-label="Reacties openen"
                          className="flex min-h-11 items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-accent"
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" />
                          <span className="text-xs">Reacties</span>
                        </button>
                      </div>
                    </div>

                    <CommentsSheet
                      projectId={projectId}
                      updateId={update.id}
                      canComment={canEngage}
                      open={openComments === update.id}
                      onOpenChange={(open) => setOpenComments(open ? update.id : null)}
                    />
                  </>
                )}
              </article>
            </div>
          );
        })}
      </div>

      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndex={(index) => setLightbox((current) => current ? { ...current, index } : null)}
          onClose={() => setLightbox(null)}
          projectId={projectId}
        />
      )}
    </div>
  );
};

export default BlueprintTimeline;

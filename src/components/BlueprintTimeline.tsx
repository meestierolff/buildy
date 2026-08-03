import { useEffect, useRef, useState } from "react";
import { ChevronDown, Heart, Image as ImageIcon, Link2, MessageCircle, Pencil, Trash2, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { format, differenceInCalendarDays } from "date-fns";
import { nl } from "date-fns/locale";
import ReactionBar from "@/components/ReactionBar";
import CommentsSheet from "@/components/CommentsSheet";
import MediaLightbox, { LightboxItem } from "@/components/MediaLightbox";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import { phaseColor } from "@/components/PhaseSelect";

interface StepMedia {
  id: string;
  media_url: string;
  media_type: string;
  compare_role?: "before" | "after" | null;
  sort_order?: number | null;
}

interface Step {
  id: string;
  location_name: string;
  description: string | null;
  step_date: string;
  phase: string | null;
  is_milestone: boolean | null;
  step_media: StepMedia[];
  like_count: number;
  comment_count: number;
  user_liked: boolean;
  contractor_name?: string | null;
}

interface Props {
  steps: Step[];
  onLike?: (stepId: string) => void;
  onEdit?: (step: Step) => void;
  onDelete?: (stepId: string) => void;
  onReorderMedia?: (stepId: string, orderedMediaIds: string[]) => void;
  isOwner?: boolean;
  tripId?: string;
}

const BlueprintTimeline = ({ steps, onLike, onEdit, onDelete, onReorderMedia, isOwner, tripId }: Props) => {
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; idx: number } | null>(null);
  const [mediaDrafts, setMediaDrafts] = useState<Record<string, StepMedia[]>>({});
  const [draggingMedia, setDraggingMedia] = useState<{ stepId: string; mediaId: string } | null>(null);
  const [dragOverMediaId, setDragOverMediaId] = useState<string | null>(null);
  const [reorderOpenFor, setReorderOpenFor] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialPositionedRef = useRef(false);

  // Initial focus: use ?step deeplink when present, otherwise land on the most recent update.
  useEffect(() => {
    if (steps.length === 0 || initialPositionedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const targetFromUrl = params.get("step");
    const target = targetFromUrl && steps.some((s) => s.id === targetFromUrl)
      ? targetFromUrl
      : steps[steps.length - 1]?.id;
    if (!target) return;

    requestAnimationFrame(() => {
      const el = document.getElementById(`step-${target}`);
      const scroller = scrollerRef.current;
      if (el && scroller) {
        const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        const nextLeft = Math.min(Math.max(0, el.offsetLeft - 16), maxScrollLeft);
        scroller.scrollTo({ left: nextLeft, behavior: "auto" });
        setActiveStepId(target);
        setExpandedId(target);
        initialPositionedRef.current = true;
      }
    });
  }, [steps]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || steps.length === 0) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-step-id]"));
    if (cards.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.stepId;
          if (!id) continue;
          visibility.set(id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visibility) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId && bestRatio > 0) setActiveStepId(bestId);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [steps]);

  // Sync ?step=<id> met actieve step (zonder history-spam)
  useEffect(() => {
    if (!activeStepId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("step") === activeStepId) return;
    params.set("step", activeStepId);
    const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [activeStepId]);

  const copyStepLink = async (stepId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("step", stepId);
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link gekopieerd");
    } catch {
      toast.error("Kopiëren mislukt", { description: url });
    }
  };




  const cc = (id: string, base: number) => commentCounts[id] ?? base;

  const openLightboxForStep = (step: Step, mediaId: string) => {
    const orderedMedia = mediaDrafts[step.id] ?? [...step.step_media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const visualMedia = orderedMedia.filter((m) => m.media_type !== "pdf");
    const items: LightboxItem[] = visualMedia.map((m) => ({
      id: m.id,
      url: m.media_url,
      type: m.media_type,
      stepId: step.id,
      stepTitle: step.location_name,
      stepDate: step.step_date,
      phase: step.phase,
    }));
    const index = visualMedia.findIndex((media) => media.id === mediaId);
    if (index < 0) return;
    setLightbox({ items, idx: index });
  };

  const reorderMedia = (step: Step, targetMediaId: string) => {
    if (!draggingMedia || draggingMedia.stepId !== step.id || draggingMedia.mediaId === targetMediaId) return;
    const current = mediaDrafts[step.id] ?? [...step.step_media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const next = [...current];
    const from = next.findIndex((m) => m.id === draggingMedia.mediaId);
    const to = next.findIndex((m) => m.id === targetMediaId);
    if (from < 0 || to < 0) return;

    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setMediaDrafts((drafts) => ({ ...drafts, [step.id]: next }));
    onReorderMedia?.(step.id, next.filter((m) => m.media_type !== "pdf").map((m) => m.id));
  };

  // Earliest step date = Dag 1
  const sortedByDate = [...steps].sort(
    (a, b) => new Date(a.step_date).getTime() - new Date(b.step_date).getTime()
  );
  const firstDate = sortedByDate.length > 0 ? new Date(sortedByDate[0].step_date) : null;

  return (
    <div className="relative pb-16">
      <div ref={scrollerRef} className="flex gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory pb-4 -mx-2 px-2 scroll-smooth">
      {steps.map((step) => {
        // Sort media by sort_order to match edit dialog order
        const sortedMedia = mediaDrafts[step.id] ?? [...step.step_media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const before = sortedMedia.find((m) => m.compare_role === "before");
        const after = sortedMedia.find((m) => m.compare_role === "after");
        const hasCompare = !!before && !!after;
        const visuals = sortedMedia.filter(
          (m) => m.media_type !== "pdf" && !(hasCompare && (m.id === before!.id || m.id === after!.id))
        );
        const previewMedia = visuals[0] ?? before ?? after;
        const pdfs = sortedMedia.filter((m) => m.media_type === "pdf");

        const stepDate = new Date(step.step_date);
        const dayNumber = firstDate
          ? Math.max(1, differenceInCalendarDays(stepDate, firstDate) + 1)
          : 1;
        const isActive = activeStepId === step.id;
        const isExpanded = expandedId === step.id;
        

        return (
          <div
            key={step.id}
            id={`step-${step.id}`}
            data-step-id={step.id}
            className="snap-start shrink-0 w-[320px] sm:w-[360px] flex flex-col scroll-mx-4"
          >
            {/* Tijdlijn-label: Dag N + datum + marker (klikbaar) */}
            <div className="relative flex flex-col items-center pb-4">
              {/* Horizontale tijdlijn-lijn achter de marker */}
              <div className={`pointer-events-none absolute left-0 right-0 bottom-[7px] h-px transition-colors ${isActive ? "bg-accent/70" : "bg-accent/40"}`} />
              <button
                type="button"
                onClick={() => {
                  const scroller = scrollerRef.current;
                  const el = document.getElementById(`step-${step.id}`);
                  if (scroller && el) {
                    const scrollerRect = scroller.getBoundingClientRect();
                    const elRect = el.getBoundingClientRect();
                    scroller.scrollTo({ left: scroller.scrollLeft + (elRect.left - scrollerRect.left), behavior: "smooth" });
                  }
                  setExpandedId((cur) => (cur === step.id ? null : step.id));
                }}
                className={`group relative flex flex-col items-center rounded-md px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${isActive ? "bg-accent/10" : "hover:bg-accent/5"}`}
                aria-label={`Spring naar ${step.location_name}`}
                aria-current={isActive ? "step" : undefined}
                title={`Spring naar ${step.location_name}`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${isActive ? "text-accent" : "text-accent/70"}`}>
                  Dag {dayNumber}
                </span>
                <time className="mt-0.5 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                  {format(stepDate, "EEE d MMM", { locale: nl })}
                </time>
                <span className={`mt-2 rounded-full bg-accent ring-4 ring-background shadow-sm transition-all ${isActive ? "h-4 w-4 scale-110" : "h-3.5 w-3.5 group-hover:scale-110"}`} />

              </button>
            </div>


            <article className={`flex flex-col overflow-hidden rounded-md border bg-card/95 shadow-sm backdrop-blur-sm transition-shadow ${isExpanded ? "border-accent/40 shadow-md" : "border-border/50 hover:shadow-md"}`}>

            {/* The update toggle and primary media are separate controls: a
                photo click always opens the gallery, including by keyboard. */}
            <div className="text-left w-full group">
              {isExpanded && (
                <button
                  type="button"
                  onClick={() => setExpandedId((cur) => (cur === step.id ? null : step.id))}
                  className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                  aria-expanded={isExpanded}
                  aria-label={`${step.location_name} inklappen`}
                >
                <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <time className="text-[11px] font-medium text-muted-foreground">
                      {format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}
                    </time>
                    {step.phase && (
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${phaseColor(step.phase)}`}>
                        {step.phase}
                      </span>
                    )}
                    {step.is_milestone && (
                      <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-accent/15 text-accent">
                        <Star className="h-2.5 w-2.5" /> Mijlpaal
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} />
                </div>
                <div className="px-4 pb-3">
                  <h3 className="font-bold text-lg leading-tight group-hover:text-accent transition-colors">{step.location_name}</h3>
                </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (!isExpanded) {
                    setExpandedId(step.id);
                    return;
                  }
                  if (previewMedia) openLightboxForStep(step, previewMedia.id);
                }}
                className="relative block w-full overflow-hidden bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                style={{ aspectRatio: "4/3" }}
                aria-label={isExpanded
                  ? (previewMedia ? `Open media van ${step.location_name}` : step.location_name)
                  : `${step.location_name} uitklappen`}
                data-testid="timeline-primary-media"
              >
                {previewMedia ? (
                  previewMedia.media_type === "video" ? (
                    <video src={previewMedia.media_url} className="w-full h-full object-cover" />
                  ) : (
                    <img
                      src={previewMedia.media_url}
                      alt={`Foto bij ${step.location_name}`}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700"
                      loading="lazy"
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
              </button>
              {!isExpanded && (
                <button
                  type="button"
                  onClick={() => setExpandedId(step.id)}
                  className="block w-full px-4 py-3 text-left border-t border-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                  aria-expanded={false}
                  aria-label={`${step.location_name} uitklappen`}
                >
                  <h3 className="font-bold text-foreground text-lg leading-tight group-hover:text-accent transition-colors">{step.location_name}</h3>
                </button>
              )}
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <>
                {/* Owner actions row */}
                <div className="flex items-center justify-end gap-0.5 px-3 pt-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => copyStepLink(step.id)}
                    title="Kopieer link naar deze step"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                  {isOwner && (
                    <>
                      {sortedMedia.filter((m) => m.media_type !== "pdf").length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 ${reorderOpenFor === step.id ? "text-accent" : ""}`}
                          onClick={() => setReorderOpenFor(reorderOpenFor === step.id ? null : step.id)}
                          title="Foto's verslepen"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit?.(step)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => onDelete?.(step.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>

                {/* Before/After slider */}
                {hasCompare && (
                  <div className="px-4 pt-2 pb-3">
                    <BeforeAfterSlider
                      beforeUrl={before!.media_url}
                      afterUrl={after!.media_url}
                      onBeforeClick={() => before && openLightboxForStep(step, before.id)}
                      onAfterClick={() => after && openLightboxForStep(step, after.id)}
                    />
                  </div>
                )}

                {/* Thumbnail strip for extra photos */}
                {visuals.length > 1 && (
                  <div className={`grid gap-0.5 mt-0.5 ${visuals.length === 2 ? "grid-cols-1" : visuals.length === 3 ? "grid-cols-2" : "grid-cols-3"}`}>
                    {visuals.slice(1, 4).map((m, mi) => {
                      const isOverflow = mi === 2 && visuals.length > 4;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => openLightboxForStep(step, m.id)}
                          aria-label={`Open media ${mi + 2} van ${step.location_name}`}
                          className="relative bg-muted overflow-hidden"
                          style={{ aspectRatio: "1" }}
                        >
                          {m.media_type === "video" ? (
                            <video src={m.media_url} className="absolute inset-0 w-full h-full object-cover" />
                          ) : (
                            <img src={m.media_url} alt="" className="absolute inset-0 w-full h-full object-cover hover:opacity-90 transition-opacity" loading="lazy" />
                          )}
                          {isOverflow && (
                            <div className="absolute inset-0 bg-black/60 text-white text-sm font-semibold flex items-center justify-center">
                              +{visuals.length - 3}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {isOwner && sortedMedia.filter((m) => m.media_type !== "pdf").length > 1 && reorderOpenFor === step.id && (
                  <div className="border-t border-border/60 bg-secondary/30 px-3 py-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Foto's verslepen</p>
                      <button
                        type="button"
                        onClick={() => setReorderOpenFor(null)}
                        className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                      >
                        Sluiten
                      </button>
                    </div>
                    <p className="mb-2 text-[10px] text-muted-foreground">Sleep de foto’s om de volgorde in de tijdlijn te wijzigen.</p>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {sortedMedia.filter((m) => m.media_type !== "pdf").map((m) => {
                        const isDragging = draggingMedia?.mediaId === m.id;
                        const isOver = dragOverMediaId === m.id && !isDragging;
                        return (
                          <div
                            key={m.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              setDraggingMedia({ stepId: step.id, mediaId: m.id });
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              setDragOverMediaId(m.id);
                            }}
                            onDragLeave={() => setDragOverMediaId(null)}
                            onDrop={() => {
                              reorderMedia(step, m.id);
                              setDraggingMedia(null);
                              setDragOverMediaId(null);
                            }}
                            onDragEnd={() => {
                              setDraggingMedia(null);
                              setDragOverMediaId(null);
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`relative h-14 w-14 shrink-0 cursor-grab overflow-hidden rounded-md border bg-background active:cursor-grabbing [-webkit-touch-callout:none] ${isDragging ? "opacity-40" : ""} ${isOver ? "border-accent ring-2 ring-accent/35" : "border-border"}`}
                            title="Sleep om te verplaatsen"
                          >
                            {m.media_type === "video" ? (
                              <video src={m.media_url} className="h-full w-full object-cover" />
                            ) : (
                              <img src={m.media_url} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
                            )}
                            {m.compare_role && (
                              <span className="absolute bottom-1 left-1 rounded bg-accent px-1 text-[8px] font-bold uppercase tracking-wider text-accent-foreground">
                                {m.compare_role === "before" ? "Voor" : "Na"}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Description + PDFs + reactions */}
                <div className="px-4 py-3 space-y-2">
                  {step.description && (
                    <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{step.description}</p>
                  )}
                  {step.contractor_name && (
                    <p className="text-[11px] text-muted-foreground font-medium">🔧 {step.contractor_name}</p>
                  )}
                  {pdfs.length > 0 && (
                    <div className="space-y-1.5">
                      {pdfs.map((m) => {
                        const name = decodeURIComponent(m.media_url.split("/").pop() || "document.pdf");
                        return (
                          <a
                            key={m.id}
                            href={m.media_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 rounded-md border bg-secondary/40 hover:bg-secondary px-3 py-2 text-sm transition-colors"
                          >
                            <span className="text-lg">📄</span>
                            <span className="truncate flex-1">{name}</span>
                            <span className="text-xs text-muted-foreground">PDF</span>
                          </a>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <ReactionBar stepId={step.id} />
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => onLike?.(step.id)}
                        aria-label={`${step.user_liked ? "Like verwijderen" : "Update liken"}, ${step.like_count} likes`}
                        className={`flex items-center gap-1.5 text-sm transition-colors ${step.user_liked ? "text-accent" : "text-muted-foreground hover:text-accent"}`}
                      >
                        <Heart className={`h-4 w-4 ${step.user_liked ? "fill-current" : ""}`} />
                        <span className="text-xs">{step.like_count}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenComments(step.id)}
                        aria-label={`Reacties openen, ${cc(step.id, step.comment_count)} reacties`}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors"
                      >
                        <MessageCircle className="h-4 w-4" />
                        <span className="text-xs">{cc(step.id, step.comment_count)}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <CommentsSheet
                  stepId={step.id}
                  open={openComments === step.id}
                  onOpenChange={(o) => setOpenComments(o ? step.id : null)}
                  onCountChange={(d) =>
                    setCommentCounts((p) => ({ ...p, [step.id]: cc(step.id, step.comment_count) + d }))
                  }
                  canModerate={!!isOwner}
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
          index={lightbox.idx}
          onIndex={(i) => setLightbox({ ...lightbox, idx: i })}
          onClose={() => setLightbox(null)}
          tripId={tripId}
        />
      )}
    </div>
  );
};

export default BlueprintTimeline;

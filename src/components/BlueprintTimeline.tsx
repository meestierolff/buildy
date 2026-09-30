import { useEffect, useMemo, useState } from "react";
import { FileText, Images, Link2, MessageCircle, Pencil, Play, Star } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";

import type { ProjectUpdate } from "../../shared/contracts/projects";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import CommentsSheet from "@/components/CommentsSheet";
import MediaLightbox, { type LightboxItem } from "@/components/MediaLightbox";
import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";
import ReportDialog from "@/components/moderation/ReportDialog";
import ReactionBar from "@/components/ReactionBar";
import { Button } from "@/components/ui/button";
import { useLocation } from "@/lib/router";

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
  const { hash, search } = useLocation();

  const chronologicalUpdates = useMemo(
    () => [...updates].sort((a, b) => (
      a.updateDate.localeCompare(b.updateDate)
      || a.sortOrder - b.sortOrder
      || a.id.localeCompare(b.id)
    )),
    [updates],
  );

  useEffect(() => {
    const requestedId = new URLSearchParams(search).get("update");
    if (!requestedId || !chronologicalUpdates.some((update) => update.id === requestedId)) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`update-${requestedId}`)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chronologicalUpdates, hash, projectId, search]);

  const copyUpdateLink = async (updateId: string) => {
    const params = new URLSearchParams(search);
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

  return (
    <div className="relative mx-auto min-w-0 max-w-3xl">
      <div className="absolute bottom-0 left-1.5 top-4 w-px bg-border sm:left-2" aria-hidden="true" />
      <ol className="space-y-7 sm:space-y-9">
        {chronologicalUpdates.map((update) => {
          const sortedMedia = [...update.media].sort((a, b) => a.sortOrder - b.sortOrder);
          const before = sortedMedia.find((media) => media.role === "before" && !isPdf(media.contentType) && !isVideo(media.contentType));
          const after = sortedMedia.find((media) => media.role === "after" && !isPdf(media.contentType) && !isVideo(media.contentType));
          const hasComparison = Boolean(before && after);
          const visualMedia = sortedMedia.filter((media) => !isPdf(media.contentType)
            && !(hasComparison && (media.id === before?.id || media.id === after?.id)));
          const documents = sortedMedia.filter((media) => isPdf(media.contentType));
          const label = updateLabel(update);
          const updateDate = new Date(`${update.updateDate}T12:00:00`);

          return (
            <li key={update.id} id={`update-${update.id}`} data-update-id={update.id} className="relative min-w-0 scroll-mt-24 pl-6 sm:pl-8">
              <span className={`absolute left-0 top-2.5 h-3.5 w-3.5 rounded-full border-[3px] border-background ring-1 sm:left-0.5 ${update.isMilestone ? "bg-accent ring-accent/50" : "bg-primary ring-primary/25"}`} aria-hidden="true" />
              <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <time dateTime={update.updateDate} className="font-semibold text-foreground">{format(updateDate, "d MMMM yyyy", { locale: nl })}</time>
                {update.isMilestone ? <span className="flex items-center gap-1 font-semibold text-accent"><Star className="h-3.5 w-3.5" aria-hidden="true" /> Mijlpaal</span> : null}
                {update.phase ? <span className="text-muted-foreground">{update.phase.name}</span> : null}
                {update.status === "draft" ? <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">Concept</span> : null}
              </div>

              <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                {hasComparison && before && after ? (
                  <div>
                    <BeforeAfterSlider className="rounded-none" beforeUrl={before.proxyPath} afterUrl={after.proxyPath}
                      onBeforeClick={() => openLightboxForUpdate(update, before.id)} onAfterClick={() => openLightboxForUpdate(update, after.id)} />
                    <div className="flex justify-between gap-2 border-b border-border px-3">
                      <Button type="button" variant="ghost" className="min-h-11 text-xs" onClick={() => openLightboxForUpdate(update, before.id)}>Voorfoto bekijken</Button>
                      <Button type="button" variant="ghost" className="min-h-11 text-xs" onClick={() => openLightboxForUpdate(update, after.id)}>Nafoto bekijken</Button>
                    </div>
                  </div>
                ) : null}

                {visualMedia.length > 0 ? (
                  <div className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain" role="group" aria-label={`Beelden bij ${label}`}>
                    {visualMedia.map((media, index) => (
                      <button key={media.id} type="button" onClick={() => openLightboxForUpdate(update, media.id)}
                        className="group relative block aspect-[4/3] min-h-11 w-full shrink-0 snap-center overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-label={index === 0 ? `Open media van ${label}` : `Open media ${index + 1} van ${label}`}
                        data-testid={index === 0 ? "timeline-primary-media" : undefined}>
                        {isVideo(media.contentType) ? (
                          <>
                            <ResilientVideo src={media.proxyPath} muted playsInline preload={index === 0 ? "metadata" : "none"} className="absolute inset-0 h-full w-full object-cover" />
                            <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card/90 text-primary shadow-sm" aria-hidden="true"><Play className="h-5 w-5 fill-current" /></span>
                          </>
                        ) : (
                          <ResilientImage src={media.proxyPath} alt={media.caption || (index === 0 ? `Foto bij ${label}` : `Foto ${index + 1} bij ${label}`)}
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015] motion-reduce:transform-none" loading="lazy" />
                        )}
                        {visualMedia.length > 1 ? <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium tabular-nums text-white"><Images className="h-3.5 w-3.5" aria-hidden="true" />{index + 1} / {visualMedia.length}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
                  <header className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words pt-2 font-sans text-lg font-semibold leading-snug tracking-tight text-foreground sm:text-[22px]">{label}</h3>
                    <div className="-mr-2 flex shrink-0 items-center">
                      {canCopyUpdateLink ? (
                        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full text-muted-foreground" onClick={() => void copyUpdateLink(update.id)} title="Kopieer link naar dit Bouwmoment" aria-label="Link naar Bouwmoment kopiëren"><Link2 className="h-4 w-4" aria-hidden="true" /></Button>
                      ) : null}
                      {canEdit && onEdit ? (
                        <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full text-muted-foreground" onClick={() => onEdit(update)} aria-label={`${label} bewerken`}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                      ) : <ReportDialog compact targetType="update" targetId={update.id} targetLabel={`Bouwmoment ${label}`} />}
                    </div>
                  </header>
                  {update.description ? <p className="mt-2 max-w-[65ch] whitespace-pre-line break-words text-sm leading-6 text-foreground/80 sm:text-base sm:leading-7">{update.description}</p> : null}
                  {visualMedia.length > 1 ? <p className="mt-3 text-xs text-muted-foreground">Veeg door {visualMedia.length} beelden · tik om groot te bekijken</p> : null}

                  {documents.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {documents.map((media, index) => (
                        <a key={media.id} href={media.proxyPath} target="_blank" rel="noopener noreferrer"
                          className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="flex-1 truncate">{media.caption || `Document ${index + 1}`}</span><span className="text-xs text-muted-foreground">PDF</span>
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border pt-2">
                    <ReactionBar projectId={projectId} updateId={update.id} canReact={canEngage} />
                    <button type="button" onClick={() => setOpenComments(update.id)} aria-label="Opmerkingen openen"
                      className="flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Opmerkingen</button>
                  </div>
                </div>
                <CommentsSheet projectId={projectId} updateId={update.id} canComment={canEngage} open={openComments === update.id} onOpenChange={(open) => setOpenComments(open ? update.id : null)} />
              </article>
            </li>
          );
        })}
      </ol>
      {lightbox ? <MediaLightbox items={lightbox.items} index={lightbox.index} onIndex={(index) => setLightbox((current) => current ? { ...current, index } : null)} onClose={() => setLightbox(null)} projectId={projectId} /> : null}
    </div>
  );
};

export default BlueprintTimeline;

import { useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, Link2, MessageCircle, Pencil, Star } from "lucide-react";
import { format } from "date-fns";
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
    <div className="relative mx-auto max-w-3xl">
      <div className="absolute bottom-0 left-[0.44rem] top-2 w-px bg-[#D8CFC1] sm:left-[1.44rem]" aria-hidden="true" />
      <ol className="space-y-14">
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
          const documents = sortedMedia.filter((media) => isPdf(media.contentType));
          const label = updateLabel(update);
          const updateDate = new Date(update.updateDate);
          const primaryMedia = visualMedia[0] ?? before ?? after;
          const secondaryMedia = visualMedia.slice(1, 5);

          return (
            <li
              key={update.id}
              id={`update-${update.id}`}
              data-update-id={update.id}
              className="relative scroll-mt-28 pl-7 sm:pl-14"
            >
              <span className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-[3px] border-[#F7F2E9] bg-[#A94E36] ring-1 ring-[#A94E36] sm:left-4" aria-hidden="true" />
              <article className="overflow-hidden border-b border-[#D8CFC1] pb-10">
                <header className="mb-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[#655F57]">
                      <time className="font-semibold uppercase tracking-[0.12em] text-[#A94E36]">
                        {format(updateDate, "d MMMM yyyy", { locale: nl })}
                      </time>
                      {update.phase ? (
                        <span className={`border-l-2 border-current px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${phaseColor(update.phase.name)}`}>
                          {update.phase.name}
                        </span>
                      ) : null}
                      {update.isMilestone ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#A94E36]">
                          <Star className="h-3 w-3" aria-hidden="true" /> Mijlpaal
                        </span>
                      ) : null}
                      {update.status === "draft" ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Concept</span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 font-serif text-4xl leading-[0.95] text-[#26231F] sm:text-5xl">{label}</h3>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {canCopyUpdateLink ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-[#655F57]"
                        onClick={() => void copyUpdateLink(update.id)}
                        title="Kopieer link naar dit Bouwmoment"
                        aria-label="Link naar Bouwmoment kopiëren"
                      >
                        <Link2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                    {canEdit && onEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 gap-2 text-[#655F57]"
                        onClick={() => onEdit(update)}
                        aria-label={`${label} bewerken`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Bewerken</span>
                      </Button>
                    ) : (
                      <ReportDialog compact targetType="update" targetId={update.id} targetLabel={`Bouwmoment ${label}`} />
                    )}
                  </div>
                </header>

                {primaryMedia ? (
                  <button
                    type="button"
                    onClick={() => openLightboxForUpdate(update, primaryMedia.id)}
                    className="group relative block aspect-[4/3] min-h-11 w-full overflow-hidden rounded-[1.25rem] bg-[#D8CFC1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A94E36] focus-visible:ring-offset-4"
                    aria-label={`Open media van ${label}`}
                    data-testid="timeline-primary-media"
                  >
                    {isVideo(primaryMedia.contentType) ? (
                      <ResilientVideo src={primaryMedia.proxyPath} className="h-full w-full object-cover" />
                    ) : (
                      <ResilientImage
                        src={primaryMedia.proxyPath}
                        alt={`Foto bij ${label}`}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.015] motion-reduce:transition-none"
                        loading="lazy"
                      />
                    )}
                  </button>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center rounded-[1.25rem] bg-[#E9E1D5]">
                    <ImageIcon className="h-10 w-10 text-[#655F57]/40" aria-hidden="true" />
                  </div>
                )}

                {hasComparison && before && after ? (
                  <div className="mt-3 overflow-hidden rounded-[1.25rem]">
                    <BeforeAfterSlider
                      beforeUrl={before.proxyPath}
                      afterUrl={after.proxyPath}
                      onBeforeClick={() => openLightboxForUpdate(update, before.id)}
                      onAfterClick={() => openLightboxForUpdate(update, after.id)}
                    />
                  </div>
                ) : null}

                {secondaryMedia.length > 0 ? (
                  <div className={`mt-3 grid gap-3 ${secondaryMedia.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                    {secondaryMedia.map((media, index) => (
                      <button
                        key={media.id}
                        type="button"
                        onClick={() => openLightboxForUpdate(update, media.id)}
                        aria-label={`Open media ${index + 2} van ${label}`}
                        className="relative aspect-square min-h-11 overflow-hidden rounded-[1rem] bg-[#D8CFC1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A94E36] focus-visible:ring-offset-2"
                      >
                        {isVideo(media.contentType) ? (
                          <ResilientVideo src={media.proxyPath} className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <ResilientImage src={media.proxyPath} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}

                {update.description ? (
                  <p className="mt-6 max-w-[65ch] whitespace-pre-line text-base leading-7 text-[#49443E]">
                    {update.description}
                  </p>
                ) : null}

                {documents.length > 0 ? (
                  <div className="mt-5 space-y-2">
                    {documents.map((media, index) => (
                      <a
                        key={media.id}
                        href={media.proxyPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center gap-2 border-y border-[#D8CFC1] py-2 text-sm text-[#26231F] transition-colors hover:text-[#A94E36]"
                      >
                        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="flex-1 truncate">{media.caption || `Document ${index + 1}`}</span>
                        <span className="text-xs text-[#655F57]">PDF</span>
                      </a>
                    ))}
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#D8CFC1] pt-4">
                  <ReactionBar projectId={projectId} updateId={update.id} canReact={canEngage} />
                  <button
                    type="button"
                    onClick={() => setOpenComments(update.id)}
                    aria-label="Opmerkingen openen"
                    className="flex min-h-11 items-center justify-center gap-2 text-sm font-medium text-[#655F57] transition-colors hover:text-[#A94E36]"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" /> Opmerkingen
                  </button>
                </div>

                <CommentsSheet
                  projectId={projectId}
                  updateId={update.id}
                  canComment={canEngage}
                  open={openComments === update.id}
                  onOpenChange={(open) => setOpenComments(open ? update.id : null)}
                />
              </article>
            </li>
          );
        })}
      </ol>

      {lightbox ? (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndex={(index) => setLightbox((current) => current ? { ...current, index } : null)}
          onClose={() => setLightbox(null)}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
};

export default BlueprintTimeline;

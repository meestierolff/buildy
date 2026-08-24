import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "@/lib/router";
import { ChevronLeft, ChevronRight, X, ExternalLink, Flag } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import ReportDialog from "@/components/moderation/ReportDialog";
import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";

export interface LightboxItem {
  id: string;
  url: string;
  type: string;
  updateId: string;
  updateTitle: string;
  updateDate: string;
  phase?: string | null;
}

interface Props {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  projectId?: string;
}

const MediaLightbox = ({ items, index, onClose, onIndex, projectId }: Props) => {
  const item = items[index];
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [dragX, setDragX] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (reportOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, items.length, onClose, onIndex, reportOpen]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  if (!item) return null;

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - (touchStartY.current ?? 0);
    if (Math.abs(dx) > Math.abs(dy)) setDragX(dx);
  };
  const onTouchEnd = () => {
    const dx = dragX;
    setDragX(0);
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0 && index < items.length - 1) onIndex(index + 1);
    if (dx > 0 && index > 0) onIndex(index - 1);
  };

  const closeFromBackdrop = (e: MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/95 flex flex-col"
      onClick={closeFromBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Media van ${item.updateTitle}`}
      data-testid="media-lightbox"
    >
      <div className="flex items-center justify-between p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm opacity-70">{index + 1} / {items.length}</span>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Lightbox sluiten" className="p-2 rounded-full hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden touch-pan-y"
        onClick={closeFromBackdrop}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {index > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }}
            type="button"
            aria-label="Vorige media"
            className="hidden sm:flex absolute left-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 z-10"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div
          className="w-full h-full flex items-center justify-center transition-transform"
          style={{ transform: `translateX(${dragX}px)` }}
          onClick={(event) => event.stopPropagation()}
        >
          {item.type === "video" ? (
            <ResilientVideo src={item.url} controls className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
          ) : (
            <ResilientImage
              src={item.url}
              alt={item.updateTitle}
              draggable={false}
              className="max-h-full max-w-full object-contain select-none"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
        {index < items.length - 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }}
            type="button"
            aria-label="Volgende media"
            className="hidden sm:flex absolute right-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 z-10"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2" onClick={(e) => e.stopPropagation()}>
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/40"}`}
            />
          ))}
        </div>
      )}


      <div className="p-4 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-end justify-between gap-3 max-w-2xl mx-auto">
          <div className="min-w-0">
            {item.phase && (
              <span className="text-[10px] uppercase tracking-widest text-accent font-bold">{item.phase}</span>
            )}
            <h3 className="font-semibold truncate">{item.updateTitle}</h3>
            <p className="text-xs opacity-70">{format(new Date(item.updateDate), "d MMM yyyy", { locale: nl })}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ReportDialog
              elevated
              targetType="media"
              targetId={item.id}
              targetLabel={`Media bij ${item.updateTitle}`}
              onOpenChange={setReportOpen}
              trigger={(
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Melden
                </button>
              )}
            />
            {projectId && (
              <Link
                to={`${PRODUCT_ROUTES.projectUpdate(projectId, item.updateId)}#update-${item.updateId}`}
                onClick={onClose}
                className="flex min-h-11 items-center gap-1 rounded-full bg-white/10 px-3 text-xs hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Spring naar update <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MediaLightbox;

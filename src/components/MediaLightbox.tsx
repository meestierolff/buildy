import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, X, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

export interface LightboxItem {
  id: string;
  url: string;
  type: string;
  stepId: string;
  stepTitle: string;
  stepDate: string;
  phase?: string | null;
}

interface Props {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  tripId?: string;
}

const MediaLightbox = ({ items, index, onClose, onIndex, tripId }: Props) => {
  const item = items[index];
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [dragX, setDragX] = useState(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, items.length, onClose, onIndex]);

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

  return (
    <div className="fixed inset-0 z-[1200] bg-black/95 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm opacity-70">{index + 1} / {items.length}</span>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        className="flex-1 flex items-center justify-center relative overflow-hidden touch-pan-y"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {index > 0 && (
          <button
            onClick={() => onIndex(index - 1)}
            className="hidden sm:flex absolute left-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 z-10"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div
          className="w-full h-full flex items-center justify-center transition-transform"
          style={{ transform: `translateX(${dragX}px)` }}
        >
          {item.type === "video" ? (
            <video src={item.url} controls className="max-h-full max-w-full" />
          ) : (
            <img
              src={item.url}
              alt={item.stepTitle}
              draggable={false}
              className="max-h-full max-w-full object-contain select-none"
            />
          )}
        </div>
        {index < items.length - 1 && (
          <button
            onClick={() => onIndex(index + 1)}
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
            <h3 className="font-semibold truncate">{item.stepTitle}</h3>
            <p className="text-xs opacity-70">{format(new Date(item.stepDate), "d MMM yyyy", { locale: nl })}</p>
          </div>
          {tripId && (
            <Link
              to={`/trip/${tripId}#step-${item.stepId}`}
              onClick={onClose}
              className="flex items-center gap-1 text-xs bg-white/10 px-2.5 py-1.5 rounded-full hover:bg-white/20"
            >
              Spring naar update <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaLightbox;

import { useEffect } from "react";
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

  return (
    <div className="fixed inset-0 z-[1200] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm opacity-70">{index + 1} / {items.length}</span>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            onClick={() => onIndex(index - 1)}
            className="absolute left-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {item.type === "video" ? (
          <video src={item.url} controls className="max-h-full max-w-full" />
        ) : (
          <img src={item.url} alt={item.stepTitle} className="max-h-full max-w-full object-contain" />
        )}
        {index < items.length - 1 && (
          <button
            onClick={() => onIndex(index + 1)}
            className="absolute right-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

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

import { useMemo, useState } from "react";
import MediaLightbox, { LightboxItem } from "./MediaLightbox";
import { phaseColor } from "./PhaseSelect";
import { ImageOff } from "lucide-react";

interface Step {
  id: string;
  location_name: string;
  step_date: string;
  phase: string | null;
  step_media: { id: string; media_url: string; media_type: string }[];
}

interface Props {
  tripId: string;
  steps: Step[];
}

const AllPhotosTab = ({ tripId, steps }: Props) => {
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const items: LightboxItem[] = useMemo(() => {
    const arr: LightboxItem[] = [];
    [...steps]
      .sort((a, b) => +new Date(b.step_date) - +new Date(a.step_date))
      .forEach((s) => {
        if (phaseFilter && s.phase !== phaseFilter) return;
        s.step_media.forEach((m) => {
          arr.push({
            id: m.id,
            url: m.media_url,
            type: m.media_type,
            stepId: s.id,
            stepTitle: s.location_name,
            stepDate: s.step_date,
            phase: s.phase,
          });
        });
      });
    return arr;
  }, [steps, phaseFilter]);

  const phases = useMemo(() => {
    const set = new Set<string>();
    steps.forEach((s) => s.phase && set.add(s.phase));
    return Array.from(set);
  }, [steps]);

  if (items.length === 0 && !phaseFilter) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <ImageOff className="h-10 w-10 mx-auto mb-2 opacity-40" />
        <p>Nog geen foto's geüpload.</p>
      </div>
    );
  }

  return (
    <div className="py-4">
      {phases.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setPhaseFilter(null)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              phaseFilter === null ? "bg-accent text-accent-foreground border-accent" : "border-border hover:border-accent"
            }`}
          >
            Alle ({steps.reduce((n, s) => n + s.step_media.length, 0)})
          </button>
          {phases.map((p) => (
            <button
              key={p}
              onClick={() => setPhaseFilter(p)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                phaseFilter === p ? "bg-accent text-accent-foreground border-accent" : `border-border ${phaseColor(p)}`
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5">
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setLightboxIdx(i)}
            className="relative aspect-square overflow-hidden rounded-md group bg-muted"
          >
            {it.type === "video" ? (
              <video src={it.url} className="w-full h-full object-cover" />
            ) : (
              <img src={it.url} alt={it.stepTitle} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            )}
          </button>
        ))}
      </div>

      {lightboxIdx !== null && (
        <MediaLightbox
          items={items}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onIndex={setLightboxIdx}
          tripId={tripId}
        />
      )}
    </div>
  );
};

export default AllPhotosTab;

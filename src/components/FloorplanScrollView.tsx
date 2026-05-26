import { useState } from "react";
import { Hammer, X } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { phaseColor } from "./PhaseSelect";
import type { FloorInfo } from "./FloorplanView";

interface Step {
  id: string;
  location_name: string;
  description: string | null;
  step_date: string;
  phase: string | null;
  floorplan_x: number | null;
  floorplan_y: number | null;
  floorplan_id: string | null;
  step_media: { id: string; media_url: string; media_type: string }[];
}

interface Props {
  floorplans: FloorInfo[];
  steps: Step[];
}

const FloorplanScrollView = ({ floorplans, steps }: Props) => {
  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (floorplans.length === 0) return null;

  const activeFloor = floorplans[activeFloorIdx];
  const pinned = steps.filter(
    (s) =>
      s.floorplan_x != null &&
      s.floorplan_y != null &&
      (s.floorplan_id === activeFloor.id ||
        (activeFloor.id === "__legacy__" && s.floorplan_id == null))
  );
  const active = pinned.find((s) => s.id === activeId) || null;

  return (
    <div className="py-6">
      {floorplans.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {floorplans.map((f, idx) => (
            <button
              key={f.id}
              onClick={() => { setActiveFloorIdx(idx); setActiveId(null); }}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${activeFloorIdx === idx ? "bg-accent text-accent-foreground border-accent font-medium" : "bg-muted border-border hover:border-accent"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative w-full bg-muted rounded-xl overflow-hidden border-2 border-border">
        <img src={activeFloor.url} alt="Plattegrond" className="w-full h-auto block" />
        {pinned.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              onClick={() => setActiveId(isActive ? null : s.id)}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all"
              style={{ left: `${s.floorplan_x}%`, top: `${s.floorplan_y}%`, zIndex: isActive ? 10 : 1 }}
              aria-label={s.location_name}
            >
              <div
                className={`rounded-full flex items-center justify-center shadow-lg transition-all ${
                  isActive
                    ? "bg-accent text-accent-foreground scale-125 ring-4 ring-accent/30 p-2"
                    : "bg-primary text-primary-foreground p-1.5 hover:scale-110"
                }`}
              >
                <Hammer className={isActive ? "h-4 w-4" : "h-3 w-3"} />
              </div>
            </button>
          );
        })}

        {active && (
          <div
            className="absolute z-20 w-64 max-w-[80%] bg-card rounded-lg shadow-2xl border-2 border-accent p-3"
            style={{
              left: `${Math.min(Math.max(active.floorplan_x ?? 50, 15), 85)}%`,
              top: `${Math.min((active.floorplan_y ?? 50) + 4, 92)}%`,
              transform: "translateX(-50%)",
            }}
          >
            <button
              onClick={() => setActiveId(null)}
              className="absolute -top-2 -right-2 bg-background border rounded-full p-0.5 hover:bg-muted"
              aria-label="Sluiten"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="flex items-center gap-2 mb-1">
              {active.phase && (
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${phaseColor(active.phase)}`}>
                  {active.phase}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(active.step_date), "d MMM yyyy", { locale: nl })}
              </span>
            </div>
            <h3 className="font-bold text-sm mb-1.5">{active.location_name}</h3>
            {active.step_media.length > 0 && (
              <img
                src={active.step_media[0].media_url}
                alt=""
                loading="lazy"
                className="w-full h-24 object-cover rounded mb-1.5"
              />
            )}
            {active.description && (
              <p className="text-xs text-foreground/80 line-clamp-3 whitespace-pre-line">{active.description}</p>
            )}
          </div>
        )}
      </div>

      {pinned.length === 0 && (
        <p className="text-center text-sm text-muted-foreground mt-4">
          Nog geen pins op de plattegrond. Pin updates via "Pinnen beheren".
        </p>
      )}
    </div>
  );
};

export default FloorplanScrollView;

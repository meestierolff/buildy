import { useEffect, useRef, useState } from "react";
import { Hammer, MapPin } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { phaseColor } from "./PhaseSelect";

interface Step {
  id: string;
  location_name: string;
  description: string | null;
  step_date: string;
  phase: string | null;
  floorplan_x: number | null;
  floorplan_y: number | null;
  step_media: { id: string; media_url: string; media_type: string }[];
}

interface Props {
  floorplanUrl: string;
  steps: Step[];
}

const FloorplanScrollView = ({ floorplanUrl, steps }: Props) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pinned = steps.filter((s) => s.floorplan_x != null && s.floorplan_y != null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveId(visible[0].target.getAttribute("data-step-id"));
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.5, 1] }
    );
    refs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [steps]);

  const scrollTo = (stepId: string) => {
    const el = refs.current.get(stepId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div>
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border">
        <div className="relative w-full max-h-[40vh] overflow-hidden">
          <img src={floorplanUrl} alt="Plattegrond" className="w-full h-auto max-h-[40vh] object-contain mx-auto block" />
          {pinned.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 transition-all"
                style={{
                  left: `${s.floorplan_x}%`,
                  top: `${s.floorplan_y}%`,
                  zIndex: isActive ? 10 : 1,
                }}
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
        </div>
      </div>

      <div className="space-y-6 py-6">
        {steps.map((s) => (
          <div
            key={s.id}
            id={`step-${s.id}`}
            data-step-id={s.id}
            ref={(el) => {
              if (el) refs.current.set(s.id, el);
              else refs.current.delete(s.id);
            }}
            className={`mx-auto max-w-xl bg-card rounded-xl border-2 transition-all ${
              activeId === s.id ? "border-accent shadow-lg shadow-accent/20" : "border-border"
            }`}
          >
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                {s.phase && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${phaseColor(s.phase)}`}>
                    {s.phase}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {format(new Date(s.step_date), "d MMM yyyy", { locale: nl })}
                </span>
                {s.floorplan_x == null && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Geen pin
                  </span>
                )}
              </div>
              <h3 className="font-bold text-base mb-2">{s.location_name}</h3>
              {s.step_media.length > 0 && (
                <div className="grid grid-cols-2 gap-1 mb-3 rounded-lg overflow-hidden">
                  {s.step_media.slice(0, 4).map((m) => (
                    <img key={m.id} src={m.media_url} alt="" loading="lazy" className="w-full h-32 object-cover" />
                  ))}
                </div>
              )}
              {s.description && <p className="text-sm text-foreground/80 whitespace-pre-line">{s.description}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FloorplanScrollView;

import { cn } from "@/lib/utils";

const PHASES = [
  "Aankoop",
  "Voorbereiding/Design",
  "Sloop",
  "Ruwbouw",
  "Installatie",
  "Afbouw",
  "Afwerking",
  "Inrichting",
  "Oplevering",
];

interface PhaseProgressBarProps {
  /** phases that have at least one step */
  activePhases: string[];
  className?: string;
}

export function PhaseProgressBar({ activePhases, className }: PhaseProgressBarProps) {
  if (activePhases.length === 0) return null;

  const activeSet = new Set(activePhases);

  // Find the furthest active phase index so we can show partial fill
  const lastIdx = PHASES.reduce((max, p, i) => (activeSet.has(p) ? i : max), -1);

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Fases</p>
      <div className="flex gap-0.5 items-end">
        {PHASES.map((phase, i) => {
          const active = activeSet.has(phase);
          const inProgress = !active && i === lastIdx + 1;
          return (
            <div key={phase} className="flex-1 flex flex-col items-center gap-1 group">
              {/* bar segment */}
              <div
                className={cn(
                  "w-full rounded-sm transition-all duration-300",
                  active
                    ? "bg-accent h-2"
                    : inProgress
                      ? "bg-accent/30 h-1.5"
                      : "bg-border h-1"
                )}
              />
              {/* label — only show on md+ to avoid overflow */}
              <span
                className={cn(
                  "hidden md:block text-[9px] leading-tight text-center truncate w-full",
                  active ? "text-accent font-semibold" : "text-muted-foreground/60"
                )}
              >
                {phase.split("/")[0]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

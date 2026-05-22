import { Camera, Calendar, Hammer, Flag } from "lucide-react";

interface Props {
  totalUpdates: number;
  totalPhotos: number;
  daysActive: number | null;
  milestones: number;
  onMilestonesClick?: () => void;
  milestonesActive?: boolean;
}

const ProjectStats = ({ totalUpdates, totalPhotos, daysActive, milestones, onMilestonesClick, milestonesActive }: Props) => {
  const items = [
    { key: "updates", icon: Hammer, label: "Updates", value: totalUpdates, onClick: undefined as undefined | (() => void), active: false },
    { key: "photos", icon: Camera, label: "Foto's", value: totalPhotos, onClick: undefined, active: false },
    { key: "days", icon: Calendar, label: "Dagen", value: daysActive ?? "—", onClick: undefined, active: false },
    { key: "milestones", icon: Flag, label: "Mijlpalen", value: milestones, onClick: onMilestonesClick, active: !!milestonesActive },
  ];
  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      {items.map((it) => {
        const Comp: any = it.onClick ? "button" : "div";
        return (
          <Comp
            key={it.label}
            onClick={it.onClick}
            className={`rounded-lg px-2 py-2 text-center backdrop-blur-sm transition-colors ${
              it.active
                ? "bg-accent/30 ring-1 ring-accent"
                : "bg-primary-foreground/10"
            } ${it.onClick ? "hover:bg-primary-foreground/20 cursor-pointer" : ""}`}
            title={it.key === "milestones" && it.onClick ? (it.active ? "Filter uit" : "Toon alleen mijlpalen") : undefined}
          >
            <it.icon className="h-3.5 w-3.5 mx-auto text-accent mb-1" />
            <div className="text-base font-bold leading-none">{it.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-primary-foreground/70 mt-0.5">{it.label}</div>
          </Comp>
        );
      })}
    </div>
  );
};

export default ProjectStats;

import { Camera, Calendar, Hammer, Flag } from "lucide-react";

interface Props {
  totalUpdates: number;
  totalPhotos: number;
  daysActive: number | null;
  milestones: number;
}

const ProjectStats = ({ totalUpdates, totalPhotos, daysActive, milestones }: Props) => {
  const items = [
    { icon: Hammer, label: "Updates", value: totalUpdates },
    { icon: Camera, label: "Foto's", value: totalPhotos },
    { icon: Calendar, label: "Dagen", value: daysActive ?? "—" },
    { icon: Flag, label: "Mijlpalen", value: milestones },
  ];
  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      {items.map((it) => (
        <div key={it.label} className="bg-primary-foreground/10 rounded-lg px-2 py-2 text-center backdrop-blur-sm">
          <it.icon className="h-3.5 w-3.5 mx-auto text-accent mb-1" />
          <div className="text-base font-bold leading-none">{it.value}</div>
          <div className="text-[10px] uppercase tracking-wider text-primary-foreground/70 mt-0.5">{it.label}</div>
        </div>
      ))}
    </div>
  );
};

export default ProjectStats;

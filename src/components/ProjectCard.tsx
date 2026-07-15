import { Link } from "react-router-dom";
import { Home, type LucideIcon } from "lucide-react";

interface ProjectCardProps {
  id: string;
  title: string;
  projectType?: string | null;
  progressPercentage?: number | null;
  coverUrl?: string | null;
  coverMediaType?: string | null;
  profileName?: string | null;
  stepCount?: number;
  placeholderIcon?: LucideIcon;
}

const looksLikeVideo = (url: string | null | undefined, mediaType: string | null | undefined) =>
  mediaType === "video" || /\.(mp4|mov|webm)(\?|#|$)/i.test(url ?? "");

const ProjectCard = ({
  id,
  title,
  projectType,
  progressPercentage,
  coverUrl,
  coverMediaType,
  profileName,
  stepCount = 0,
  placeholderIcon: PlaceholderIcon = Home,
}: ProjectCardProps) => {
  const pct = Math.max(0, Math.min(100, progressPercentage ?? 0));
  const videoCover = looksLikeVideo(coverUrl, coverMediaType);

  return (
    <Link to={`/trip/${id}`} className="group block" aria-label={`${title} bekijken`}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-muted mb-5">
        {coverUrl ? (
          videoCover ? (
            <video
              src={coverUrl}
              muted
              playsInline
              aria-hidden="true"
              preload="metadata"
              className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
            />
          ) : (
            <img
              src={coverUrl}
              alt={title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center blueprint-grid">
            <PlaceholderIcon className="h-12 w-12 text-muted-foreground/40" strokeWidth={1.5} />
          </div>
        )}
        {projectType && (
          <div className="absolute top-5 left-5">
            <span className="bg-background/95 backdrop-blur-md px-3 py-1.5 rounded-sm text-[9px] font-bold uppercase tracking-[0.2em] text-foreground shadow-sm">
              {projectType}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="flex justify-between items-baseline gap-3">
          <h3 className="font-serif italic text-2xl leading-tight truncate">{title}</h3>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest tabular-nums shrink-0">{pct}%</span>
        </div>
        <div
          className="w-full h-0.5 bg-muted"
          role="progressbar"
          aria-label={`Voortgang van ${title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
        {(profileName || stepCount > 0) && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-muted-foreground font-medium truncate">
              {profileName ? `door ${profileName}` : ""}
            </span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground shrink-0">
              {stepCount} {stepCount === 1 ? "update" : "updates"}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
};

export default ProjectCard;

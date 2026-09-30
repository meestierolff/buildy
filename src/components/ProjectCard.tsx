import { Home, type LucideIcon } from "lucide-react";

import PrivacyBadge from "@/components/app/PrivacyBadge";
import { Link } from "@/lib/router";
import { ResilientImage, ResilientVideo } from "@/components/ResilientMedia";
import { PRODUCT_ROUTES } from "@/lib/productNavigation";
import { cn } from "@/lib/utils";
import type { ProjectVisibility } from "../../shared/contracts/projects";

interface ProjectCardProps {
  id: string;
  title: string;
  projectType?: string | null;
  progressPercentage?: number | null;
  coverUrl?: string | null;
  coverMediaType?: string | null;
  profileName?: string | null;
  updateCount?: number;
  visibility?: ProjectVisibility | null;
  variant?: "standard" | "feature";
  placeholderIcon?: LucideIcon;
}

const looksLikeVideo = (url: string | null | undefined, mediaType: string | null | undefined) =>
  (mediaType === "video" || mediaType?.startsWith("video/")) || /\.(mp4|mov|webm)(\?|#|$)/i.test(url ?? "");

const ProjectCard = ({
  id,
  title,
  projectType,
  progressPercentage,
  coverUrl,
  coverMediaType,
  profileName,
  updateCount = 0,
  visibility,
  variant = "standard",
  placeholderIcon: PlaceholderIcon = Home,
}: ProjectCardProps) => {
  const progress = Math.max(0, Math.min(100, progressPercentage ?? 0));
  const videoCover = looksLikeVideo(coverUrl, coverMediaType);
  const visibilityLabel = visibility === undefined || visibility === null
    ? ""
    : ` ${{
        private: "Alleen voor de eigenaar.",
        followers: "Zichtbaar voor toegelaten profielvolgers.",
        unlisted: "Alleen zichtbaar met een actieve tijdelijke deellink.",
        public: "Openbare verbouwing.",
      }[visibility]}`;
  const privacyLevel = visibility === "public"
    ? "public"
    : visibility === "private"
      ? "private"
      : "shared";

  return (
    <Link
      to={PRODUCT_ROUTES.project(id)}
      className="group block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      aria-label={`${title} bekijken.${visibilityLabel}`}
    >
      <article className="h-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow group-hover:shadow-md motion-reduce:transition-none">
        <div
          className="relative aspect-[4/3] overflow-hidden bg-muted"
        >
          {coverUrl ? (
            videoCover ? (
              <ResilientVideo
                src={coverUrl}
                muted
                playsInline
                aria-hidden="true"
                preload="metadata"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.015] motion-reduce:transform-none"
              />
            ) : (
              <ResilientImage
                src={coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                sizes={variant === "feature" ? "(min-width: 1024px) 55vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"}
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.015] motion-reduce:transform-none"
              />
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-secondary/70 px-6 text-center text-muted-foreground">
              <PlaceholderIcon className="h-10 w-10" strokeWidth={1.25} aria-hidden="true" />
              <span className="font-sans text-sm font-medium">Foto volgt</span>
            </div>
          )}

          {visibility !== undefined && visibility !== null ? (
            <PrivacyBadge
              level={privacyLevel}
              label={visibility === "followers"
                ? "Profielvolgers"
                : visibility === "unlisted"
                  ? "Deellink"
                  : undefined}
              className="absolute left-3 top-3 border-white/60 bg-card/95 shadow-sm"
            />
          ) : null}

        </div>

        <div className="p-4 sm:p-5">
          {projectType ? <p className="mb-1.5 text-xs font-medium text-muted-foreground">{projectType}</p> : null}
          <h3 className={cn("break-words font-sans font-semibold leading-snug tracking-tight text-foreground", variant === "feature" ? "text-xl sm:text-2xl" : "text-lg")}>
            {title}
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
            {profileName ? <><span className="min-w-0 truncate">{profileName}</span><span aria-hidden="true">·</span></> : null}
            <span>{updateCount === 1 ? "1 Bouwmoment" : `${updateCount} Bouwmomenten`}</span>
          </div>
          {progress > 0 ? (
            <div className="mt-4 flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`Voortgang van ${title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{progress}%</span>
            </div>
          ) : null}
        </div>
      </article>
    </Link>
  );
};

export default ProjectCard;

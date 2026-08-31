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
  mediaType === "video" || /\.(mp4|mov|webm)(\?|#|$)/i.test(url ?? "");

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
        followers: "Zichtbaar voor profielvolgers.",
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
      className="group block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      aria-label={`${title} bekijken.${visibilityLabel}`}
    >
      <article>
        <div
          className={cn(
            "relative mb-4 overflow-hidden rounded-sm border border-border bg-muted",
            variant === "feature" ? "aspect-[16/10]" : "aspect-[4/5]",
          )}
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
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-secondary px-6 text-center text-muted-foreground">
              <PlaceholderIcon className="h-10 w-10" strokeWidth={1.25} aria-hidden="true" />
              <span className="font-sans text-xs font-semibold uppercase tracking-[0.16em]">Foto volgt</span>
            </div>
          )}

          {visibility !== undefined && visibility !== null ? (
            <PrivacyBadge
              level={privacyLevel}
              label={visibility === "followers"
                ? "Mijn volgers"
                : visibility === "unlisted"
                  ? "Deellink"
                  : undefined}
              className="absolute left-3 top-3 bg-background/95 shadow-sm"
            />
          ) : null}

          <div className="absolute inset-x-0 bottom-0 h-1 bg-background/75" aria-hidden="true">
            <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {projectType ? (
                <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {projectType}
                </p>
              ) : null}
              <h3 className={cn("font-serif leading-[1.05] text-foreground", variant === "feature" ? "text-3xl md:text-4xl" : "text-2xl")}>
                {title}
              </h3>
            </div>
            <span className="shrink-0 pt-0.5 font-sans text-xs font-semibold tabular-nums text-foreground">
              {progress}%
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-sans text-xs leading-5 text-muted-foreground">
            <span>{profileName ? `Door ${profileName}` : "Buildy-verbouwing"}</span>
            <span>{updateCount === 1 ? "1 Bouwmoment" : `${updateCount} Bouwmomenten`}</span>
          </div>

          <div
            className="sr-only"
            role="progressbar"
            aria-label={`Voortgang van ${title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          />
        </div>
      </article>
    </Link>
  );
};

export default ProjectCard;

import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";

import type { ProjectUpdate } from "../../shared/contracts/projects";
import MediaLightbox, { type LightboxItem } from "./MediaLightbox";
import { phaseColor } from "./PhaseSelect";

interface Props {
  projectId: string;
  updates: readonly ProjectUpdate[];
}

function isVisualMedia(contentType: string | null): boolean {
  return contentType !== "application/pdf";
}

function lightboxMediaType(contentType: string | null): "image" | "video" {
  return contentType?.startsWith("video/") ? "video" : "image";
}

function updateLabel(update: ProjectUpdate): string {
  return update.title?.trim() || update.room?.trim() || "Projectupdate";
}

const AllPhotosTab = ({ projectId, updates }: Props) => {
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const items = useMemo<LightboxItem[]>(() => {
    const result: LightboxItem[] = [];
    [...updates]
      .sort((a, b) => b.updateDate.localeCompare(a.updateDate) || b.sortOrder - a.sortOrder)
      .forEach((update) => {
        if (phaseFilter && update.phase?.id !== phaseFilter) return;
        [...update.media]
          .filter((media) => isVisualMedia(media.contentType))
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .forEach((media) => {
            result.push({
              id: media.id,
              url: media.proxyPath,
              type: lightboxMediaType(media.contentType),
              updateId: update.id,
              updateTitle: updateLabel(update),
              updateDate: update.updateDate,
              phase: update.phase?.name ?? null,
            });
          });
      });
    return result;
  }, [phaseFilter, updates]);

  const phases = useMemo(() => {
    const unique = new Map<string, string>();
    updates.forEach((update) => {
      if (update.phase) unique.set(update.phase.id, update.phase.name);
    });
    return [...unique.entries()].map(([id, name]) => ({ id, name }));
  }, [updates]);

  const totalVisuals = useMemo(
    () => updates.reduce(
      (count, update) => count + update.media.filter((media) => isVisualMedia(media.contentType)).length,
      0,
    ),
    [updates],
  );

  if (items.length === 0 && !phaseFilter) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <ImageOff className="mx-auto mb-2 h-10 w-10 opacity-40" aria-hidden="true" />
        <p>Nog geen foto&apos;s of video&apos;s toegevoegd.</p>
      </div>
    );
  }

  return (
    <div className="py-4">
      {phases.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter media op fase">
          <button
            type="button"
            onClick={() => setPhaseFilter(null)}
            aria-pressed={phaseFilter === null}
            className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
              phaseFilter === null
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border hover:border-accent"
            }`}
          >
            Alle ({totalVisuals})
          </button>
          {phases.map((phase) => (
            <button
              key={phase.id}
              type="button"
              onClick={() => setPhaseFilter(phase.id)}
              aria-pressed={phaseFilter === phase.id}
              className={`min-h-11 rounded-full border px-3 text-xs transition-colors ${
                phaseFilter === phase.id
                  ? "border-accent bg-accent text-accent-foreground"
                  : `border-border ${phaseColor(phase.name)}`
              }`}
            >
              {phase.name}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground" role="status">
          Geen media in deze fase.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLightboxIndex(index)}
              aria-label={`Open media van ${item.updateTitle}`}
              className="group relative aspect-square min-h-11 overflow-hidden rounded-md bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {item.type === "video" ? (
                <video src={item.url} className="h-full w-full object-cover" />
              ) : (
                <img
                  src={item.url}
                  alt={item.updateTitle}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              )}
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <MediaLightbox
          items={items}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
          projectId={projectId}
        />
      )}
    </div>
  );
};

export default AllPhotosTab;

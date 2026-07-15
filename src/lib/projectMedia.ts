import { supabase } from "@/integrations/supabase/client";
import { hydrateMediaUrls, resolvePrivateStoragePath } from "@/lib/mediaUrl";

export interface ProjectMediaSummary {
  stepCount: number;
  mediaCount: number;
  coverUrl: string | null;
  coverMediaType: string | null;
}

interface StepMediaRow {
  media_url: string;
  storage_path?: string | null;
  media_type: string | null;
  sort_order: number | null;
}

interface StepWithMedia {
  trip_id: string;
  step_media?: StepMediaRow[] | StepMediaRow | null;
}

export interface ProjectWithMediaFields {
  id: string;
  cover_image_url: string | null;
  cover_storage_path?: string | null;
  cover_media_type?: string | null;
  step_count?: number;
}

const emptySummary = (): ProjectMediaSummary => ({
  stepCount: 0,
  mediaCount: 0,
  coverUrl: null,
  coverMediaType: null,
});

const isPrintableVisual = (media: StepMediaRow) => media.media_type !== "pdf";
const isVideo = (media: StepMediaRow) => media.media_type === "video";

export const loadProjectMediaSummaries = async (tripIds: string[]) => {
  const summaries = new Map<string, ProjectMediaSummary>();
  tripIds.forEach((id) => summaries.set(id, emptySummary()));
  if (tripIds.length === 0) return summaries;

  const [{ data, error }, { data: coverRows, error: coverError }] = await Promise.all([
    supabase
      .from("steps")
      .select("trip_id, step_date, step_order, step_media(media_url, storage_path, media_type, sort_order)")
      .in("trip_id", tripIds)
      .order("step_date", { ascending: true })
      .order("step_order", { ascending: true }),
    supabase
      .from("trips")
      .select("id, cover_storage_path")
      .in("id", tripIds),
  ]);

  // Keep the frontend usable during the intentional migration-first rollout.
  // PostgREST 42703 means the live database has not received the new private
  // cover column yet; the legacy cover fallback below remains functional.
  if (coverError && coverError.code !== "42703") {
    console.error("Project cover paths load failed:", coverError);
  }
  await Promise.all((coverRows || []).map(async (row) => {
    if (!row.cover_storage_path) return;
    const url = await resolvePrivateStoragePath(row.cover_storage_path);
    const summary = summaries.get(row.id);
    if (url && summary) {
      summary.coverUrl = url;
      summary.coverMediaType = "image";
    }
  }));

  if (error || !data) return summaries;

  // Sign private-bucket URLs in one batched pass.
  const allMedia = (data as StepWithMedia[]).flatMap((s) =>
    Array.isArray(s.step_media) ? s.step_media : s.step_media ? [s.step_media] : [],
  );
  await hydrateMediaUrls(allMedia);


  const fallbackVideos = new Map<string, StepMediaRow>();

  (data as StepWithMedia[]).forEach((step) => {
    const summary = summaries.get(step.trip_id) ?? emptySummary();
    summary.stepCount += 1;

    const media = Array.isArray(step.step_media)
      ? [...step.step_media]
      : step.step_media
      ? [step.step_media]
      : [];

    media
      .filter(isPrintableVisual)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .forEach((item) => {
        summary.mediaCount += 1;

        if (!summary.coverUrl && !isVideo(item)) {
          summary.coverUrl = item.media_url;
          summary.coverMediaType = item.media_type ?? "image";
        } else if (!fallbackVideos.has(step.trip_id) && isVideo(item)) {
          fallbackVideos.set(step.trip_id, item);
        }
      });

    summaries.set(step.trip_id, summary);
  });

  fallbackVideos.forEach((video, tripId) => {
    const summary = summaries.get(tripId);
    if (summary && !summary.coverUrl) {
      summary.coverUrl = video.media_url;
      summary.coverMediaType = video.media_type ?? "video";
    }
  });

  return summaries;
};

export const applyProjectMediaSummaries = <T extends ProjectWithMediaFields>(
  projects: T[],
  summaries: Map<string, ProjectMediaSummary>,
) =>
  projects.map((project) => {
    const summary = summaries.get(project.id);
    const fallbackUrl = summary?.coverUrl ?? null;
    const hasPrivateCover = !!project.cover_storage_path;
    const hasExplicitCover = hasPrivateCover ? !!fallbackUrl : !!project.cover_image_url;

    return {
      ...project,
      cover_image_url: hasPrivateCover ? fallbackUrl : (project.cover_image_url || fallbackUrl),
      cover_media_type: hasExplicitCover ? "image" : summary?.coverMediaType ?? null,
      step_count: project.step_count ?? summary?.stepCount ?? 0,
    };
  });

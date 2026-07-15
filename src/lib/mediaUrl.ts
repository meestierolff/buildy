import { supabase } from "@/integrations/supabase/client";
import { serializeFloorAssets, type FloorAssetLike } from "@/lib/floorAssets";

export { serializeFloorAssets };
export type { FloorAssetLike };

// Signed-URL TTL for private media. Keep comfortably above any single page session.
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
// Refresh signed URLs slightly before they expire to avoid mid-render 401s.
const CACHE_TTL_MS = (SIGNED_URL_TTL_SECONDS - 60) * 1000;

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const SIGN_BATCH_SIZE = 100;

const cachedUrl = (path: string) => {
  const cached = cache.get(path);
  return cached && cached.expiresAt > Date.now() ? cached.url : null;
};

const rememberSignedUrl = (path: string, url: string) => {
  cache.set(path, { url, expiresAt: Date.now() + CACHE_TTL_MS });
};

export interface MediaLike {
  media_url?: string | null;
  storage_path?: string | null;
}

export interface TripAssetLike {
  cover_image_url?: string | null;
  cover_storage_path?: string | null;
  floorplan_url?: string | null;
  floorplan_storage_path?: string | null;
  floorplans?: unknown;
}

export async function resolvePrivateStoragePath(path: string): Promise<string | null> {
  const cached = cachedUrl(path);
  if (cached) return cached;
  const { data, error } = await supabase.storage
    .from("trip-private")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    if (error) console.error("Signed URL error", path, error);
    return null;
  }
  rememberSignedUrl(path, data.signedUrl);
  return data.signedUrl;
}

/**
 * Replaces stable private asset paths with short-lived signed URLs in memory.
 * Signed URLs are deliberately never the durable source of truth.
 */
export async function hydrateTripAssets<T extends TripAssetLike>(trips: T[] | null | undefined): Promise<T[]> {
  if (!trips || trips.length === 0) return trips ?? [];

  await Promise.all(trips.map(async (trip) => {
    const [coverUrl, floorplanUrl] = await Promise.all([
      trip.cover_storage_path ? resolvePrivateStoragePath(trip.cover_storage_path) : null,
      trip.floorplan_storage_path ? resolvePrivateStoragePath(trip.floorplan_storage_path) : null,
    ]);
    if (trip.cover_storage_path) trip.cover_image_url = coverUrl;
    if (trip.floorplan_storage_path) trip.floorplan_url = floorplanUrl;

    if (!Array.isArray(trip.floorplans)) return;
    const floors = trip.floorplans.filter(
      (floor): floor is FloorAssetLike => !!floor && typeof floor === "object",
    );
    await Promise.all(floors.map(async (floor) => {
      if (!floor.storage_path) return;
      const url = await resolvePrivateStoragePath(floor.storage_path);
      floor.url = url;
    }));
    // Preserve durable paths when signing temporarily fails. Rendering may
    // omit an unresolved image, but a later edit must not delete its metadata.
    trip.floorplans = floors;
  }));

  return trips;
}

/**
 * Mutates each row so that `media_url` resolves to a signed URL when the row
 * was uploaded to the private bucket. Legacy public-bucket rows are untouched.
 */
export async function hydrateMediaUrls<T extends MediaLike>(rows: T[] | null | undefined): Promise<T[]> {
  if (!rows || rows.length === 0) return rows ?? [];
  const needsSigning = rows.filter((r) => r.storage_path);
  // Deduplicate and sign uncached paths in bounded batches. A Bouwboek can
  // contain hundreds of photos, so one HTTP request per photo is too costly.
  const uniquePaths = Array.from(new Set(needsSigning.map((r) => r.storage_path as string)));
  const map = new Map<string, string | null>();
  const uncached: string[] = [];
  uniquePaths.forEach((path) => {
    const url = cachedUrl(path);
    if (url) map.set(path, url);
    else uncached.push(path);
  });

  for (let index = 0; index < uncached.length; index += SIGN_BATCH_SIZE) {
    const paths = uncached.slice(index, index + SIGN_BATCH_SIZE);
    const { data, error } = await supabase.storage
      .from("trip-private")
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (error) {
      console.error("Signed URL batch error", error);
      paths.forEach((path) => map.set(path, null));
      continue;
    }
    const rowsByPath = new Map((data || []).map((item) => [item.path, item]));
    paths.forEach((path) => {
      const signedUrl = rowsByPath.get(path)?.signedUrl ?? null;
      if (signedUrl) rememberSignedUrl(path, signedUrl);
      map.set(path, signedUrl);
    });
  }
  for (const row of needsSigning) {
    const signedUrl = map.get(row.storage_path as string);
    if (signedUrl) row.media_url = signedUrl;
  }
  return rows;
}

/**
 * Walks a list of steps and hydrates the nested step_media rows in place.
 */
export async function hydrateStepsMedia<T extends { step_media?: MediaLike[] | null }>(steps: T[] | null | undefined): Promise<T[]> {
  if (!steps || steps.length === 0) return steps ?? [];
  const allMedia = steps.flatMap((s) => s.step_media ?? []);
  await hydrateMediaUrls(allMedia);
  return steps;
}

/**
 * Resolves a single media row's URL, signing on demand. Safe to call from event handlers.
 */
export async function resolveMediaUrl(row: MediaLike): Promise<string | null> {
  if (row.storage_path) return resolvePrivateStoragePath(row.storage_path);
  return row.media_url ?? null;
}

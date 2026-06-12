import { supabase } from "@/integrations/supabase/client";

// Signed-URL TTL for private media. Keep comfortably above any single page session.
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
// Refresh signed URLs slightly before they expire to avoid mid-render 401s.
const CACHE_TTL_MS = (SIGNED_URL_TTL_SECONDS - 60) * 1000;

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export interface MediaLike {
  media_url?: string | null;
  storage_path?: string | null;
}

async function signOne(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await supabase.storage
    .from("trip-private")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    if (error) console.error("Signed URL error", path, error);
    return null;
  }
  cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.signedUrl;
}

/**
 * Mutates each row so that `media_url` resolves to a signed URL when the row
 * was uploaded to the private bucket. Legacy public-bucket rows are untouched.
 */
export async function hydrateMediaUrls<T extends MediaLike>(rows: T[] | null | undefined): Promise<T[]> {
  if (!rows || rows.length === 0) return rows ?? [];
  const needsSigning = rows.filter((r) => r.storage_path);
  // Deduplicate paths so we issue one signed-URL request per file.
  const uniquePaths = Array.from(new Set(needsSigning.map((r) => r.storage_path as string)));
  const signed = await Promise.all(uniquePaths.map((p) => signOne(p).then((url) => [p, url] as const)));
  const map = new Map<string, string | null>(signed);
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
  if (row.storage_path) return signOne(row.storage_path);
  return row.media_url ?? null;
}

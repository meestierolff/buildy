const PUBLIC_TRIP_MEDIA_MARKERS = [
  "/storage/v1/object/public/trip-media/",
  "/storage/v1/render/image/public/trip-media/",
] as const;
const PUBLIC_AVATAR_MARKERS = [
  "/storage/v1/object/public/avatars/",
  "/storage/v1/render/image/public/avatars/",
] as const;

const safeSegments = (path: string) => {
  if (!path || path.includes("\\")) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments;
};

/**
 * Extract a legacy public trip-media object path only when it belongs to the
 * expected owner folder. This keeps client cleanup from becoming an arbitrary
 * storage delete primitive.
 */
const getOwnedPublicPath = (
  url: string | null | undefined,
  ownerId: string,
  markers: readonly string[],
) => {
  if (!url) return null;
  const marker = markers.find((candidate) => url.includes(candidate));
  if (!marker) return null;
  const encodedPath = url.slice(url.indexOf(marker) + marker.length).split(/[?#]/, 1)[0];
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  const segments = safeSegments(path);
  if (!segments || segments[0] !== ownerId || segments.length < 2) return null;
  return segments.join("/");
};

export function getOwnedPublicTripMediaPath(url: string | null | undefined, ownerId: string) {
  return getOwnedPublicPath(url, ownerId, PUBLIC_TRIP_MEDIA_MARKERS);
}

export function getOwnedPublicAvatarPath(url: string | null | undefined, ownerId: string) {
  const path = getOwnedPublicPath(url, ownerId, PUBLIC_AVATAR_MARKERS);
  if (!path) return null;
  const segments = path.split("/");
  if (segments.length !== 2 || !/^avatar-[ab]\.(jpe?g|png|webp|gif)$/i.test(segments[1])) return null;
  return path;
}

export function getOwnedPrivatePath(path: string | null | undefined, ownerId: string) {
  if (!path) return null;
  const segments = safeSegments(path);
  if (!segments || segments[0] !== ownerId || segments.length < 2) return null;
  return segments.join("/");
}

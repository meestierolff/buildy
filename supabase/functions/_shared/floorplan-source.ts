const PUBLIC_TRIP_MEDIA_MARKER = "/storage/v1/object/public/trip-media/";

export type FloorplanSourceResult =
  | {
      ok: true;
      bucket: "trip-media" | "trip-private";
      objectPath: string;
      tripId: string | null;
    }
  | { ok: false; status: 400 | 403; error: string };

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const invalidSource = (): FloorplanSourceResult => ({
  ok: false,
  status: 400,
  error: "Ongeldige plattegrond.",
});

const forbiddenSource = (): FloorplanSourceResult => ({
  ok: false,
  status: 403,
  error: "Geen toegang tot deze plattegrond.",
});

export const getOwnedFloorplanSource = (
  input: { imageUrl?: unknown; storagePath?: unknown },
  userId: string,
): FloorplanSourceResult => {
  if (input.storagePath !== undefined) {
    if (
      typeof input.storagePath !== "string"
      || input.storagePath.length === 0
      || input.storagePath.length > 4096
    ) {
      return invalidSource();
    }

    const segments = input.storagePath.split("/");
    const [ownerId, assetFolder, tripId, mediaFolder, ...fileSegments] = segments;
    if (ownerId !== userId) return forbiddenSource();
    if (
      assetFolder !== "trip-assets"
      || !isUuid(tripId || "")
      || mediaFolder !== "floorplans"
      || fileSegments.length === 0
      || fileSegments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      return invalidSource();
    }

    return {
      ok: true,
      bucket: "trip-private",
      objectPath: input.storagePath,
      tripId,
    };
  }

  if (
    typeof input.imageUrl !== "string"
    || input.imageUrl.length === 0
    || input.imageUrl.length > 4096
  ) {
    return invalidSource();
  }

  let objectPath = "";
  try {
    const parsedImageUrl = new URL(input.imageUrl);
    if (!parsedImageUrl.pathname.startsWith(PUBLIC_TRIP_MEDIA_MARKER)) {
      throw new Error("Unsupported storage URL");
    }
    objectPath = decodeURIComponent(
      parsedImageUrl.pathname.slice(PUBLIC_TRIP_MEDIA_MARKER.length),
    );
  } catch {
    return invalidSource();
  }

  const ownerPrefix = `${userId}/floorplans/`;
  if (!objectPath.startsWith(ownerPrefix) || objectPath.includes("..")) {
    return forbiddenSource();
  }

  return {
    ok: true,
    bucket: "trip-media",
    objectPath,
    tripId: null,
  };
};

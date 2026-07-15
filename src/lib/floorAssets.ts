export interface FloorAssetLike {
  id?: string;
  label?: string;
  url?: string | null;
  storage_path?: string | null;
}

/** Strip expiring signed URLs before floorplan metadata is persisted. */
export function serializeFloorAssets(floors: FloorAssetLike[]) {
  return floors.map((floor) => ({
    ...floor,
    url: floor.storage_path ? null : (floor.url ?? null),
  }));
}

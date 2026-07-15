import { describe, expect, it } from "vitest";
import { serializeFloorAssets } from "@/lib/floorAssets";

describe("serializeFloorAssets", () => {
  it("never persists an expiring signed URL when a stable private path exists", () => {
    expect(serializeFloorAssets([{
      id: "ground",
      label: "Begane grond",
      url: "https://example.supabase.co/storage/v1/object/sign/trip-private/path?token=secret",
      storage_path: "user/trip-assets/trip/floorplans/ground.png",
    }])).toEqual([{
      id: "ground",
      label: "Begane grond",
      url: null,
      storage_path: "user/trip-assets/trip/floorplans/ground.png",
    }]);
  });

  it("preserves a legacy public URL when no private path exists", () => {
    expect(serializeFloorAssets([{
      id: "legacy",
      label: "Begane grond",
      url: "https://example.supabase.co/storage/v1/object/public/trip-media/legacy.png",
    }])[0].url).toContain("/public/trip-media/");
  });
});

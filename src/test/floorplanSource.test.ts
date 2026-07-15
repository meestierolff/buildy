import { describe, expect, it } from "vitest";
import { getOwnedFloorplanSource } from "../../supabase/functions/_shared/floorplan-source";

const userId = "1b8b63e1-0135-4e8b-985c-21745fd21329";

describe("getOwnedFloorplanSource", () => {
  it("extracts an authenticated user's floorplan storage path", () => {
    expect(
      getOwnedFloorplanSource(
        { imageUrl: `https://project.supabase.co/storage/v1/object/public/trip-media/${userId}/floorplans/beneden%20nieuw.jpg` },
        userId,
      ),
    ).toEqual({
      ok: true,
      bucket: "trip-media",
      objectPath: `${userId}/floorplans/beneden nieuw.jpg`,
      tripId: null,
    });
  });

  it("accepts an owned private trip floorplan path", () => {
    const tripId = "b0b77859-2f3e-49b6-b6d4-9bbd2eb5e5a7";
    expect(
      getOwnedFloorplanSource(
        { storagePath: `${userId}/trip-assets/${tripId}/floorplans/begane-grond.png` },
        userId,
      ),
    ).toEqual({
      ok: true,
      bucket: "trip-private",
      objectPath: `${userId}/trip-assets/${tripId}/floorplans/begane-grond.png`,
      tripId,
    });
  });

  it("rejects arbitrary external image URLs", () => {
    expect(getOwnedFloorplanSource({ imageUrl: "https://example.com/floorplan.jpg" }, userId)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("rejects another user's storage object", () => {
    expect(
      getOwnedFloorplanSource(
        { imageUrl: "https://project.supabase.co/storage/v1/object/public/trip-media/another-user/floorplans/plan.jpg" },
        userId,
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects encoded path traversal", () => {
    expect(
      getOwnedFloorplanSource(
        { imageUrl: `https://project.supabase.co/storage/v1/object/public/trip-media/${userId}/floorplans/%2E%2E/private.jpg` },
        userId,
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a private path outside the authenticated user's trip assets", () => {
    expect(
      getOwnedFloorplanSource(
        { storagePath: "other-user/trip-assets/b0b77859-2f3e-49b6-b6d4-9bbd2eb5e5a7/floorplans/plan.jpg" },
        userId,
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });
});

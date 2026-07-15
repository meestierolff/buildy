import { describe, expect, it } from "vitest";
import { getOwnedPrivatePath, getOwnedPublicAvatarPath, getOwnedPublicTripMediaPath } from "@/lib/storagePaths";

const ownerId = "af842993-4095-47f7-91e8-a05575ceb70b";

describe("owned storage path parsing", () => {
  it("extracts an owned legacy public media path", () => {
    expect(getOwnedPublicTripMediaPath(
      `https://example.supabase.co/storage/v1/object/public/trip-media/${ownerId}/step/photo%201.jpg?download=1`,
      ownerId,
    )).toBe(`${ownerId}/step/photo 1.jpg`);
    expect(getOwnedPublicTripMediaPath(
      `https://example.supabase.co/storage/v1/render/image/public/trip-media/${ownerId}/step/photo.jpg?width=640`,
      ownerId,
    )).toBe(`${ownerId}/step/photo.jpg`);
  });

  it("rejects another owner's or traversing public path", () => {
    expect(getOwnedPublicTripMediaPath(
      "https://example.supabase.co/storage/v1/object/public/trip-media/other/step/photo.jpg",
      ownerId,
    )).toBeNull();
    expect(getOwnedPublicTripMediaPath(
      `https://example.supabase.co/storage/v1/object/public/trip-media/${ownerId}/%2E%2E/private.jpg`,
      ownerId,
    )).toBeNull();
  });

  it("accepts only normalized private paths in the owner's folder", () => {
    expect(getOwnedPrivatePath(`${ownerId}/step/photo.jpg`, ownerId)).toBe(`${ownerId}/step/photo.jpg`);
    expect(getOwnedPrivatePath(`${ownerId}/../other/photo.jpg`, ownerId)).toBeNull();
  });

  it("accepts only one of the two managed public avatar slots", () => {
    expect(getOwnedPublicAvatarPath(
      `https://example.supabase.co/storage/v1/object/public/avatars/${ownerId}/avatar-a.webp?v=1`,
      ownerId,
    )).toBe(`${ownerId}/avatar-a.webp`);
    expect(getOwnedPublicAvatarPath(
      `https://example.supabase.co/storage/v1/object/public/avatars/${ownerId}/anything.png`,
      ownerId,
    )).toBeNull();
  });
});

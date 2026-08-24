import { describe, expect, it } from "vitest";

import {
  landingPhotoHandoffFile,
  normalizeLandingPhotoHandoff,
} from "@/lib/landingPhotoHandoffStore";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = Date.parse("2026-08-23T10:00:00.000Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: ID,
    contentType: "image/png",
    bytes: new Blob(["synthetic-photo"], { type: "image/png" }),
    savedAt: "2026-08-23T09:55:00.000Z",
    ...overrides,
  };
}

describe("lokale startfoto-overdracht", () => {
  it("herstelt exacte bytes met een neutrale bestandsnaam", async () => {
    const normalized = normalizeLandingPhotoHandoff(record(), NOW);

    expect(normalized).not.toBeNull();
    const file = landingPhotoHandoffFile(normalized!);
    expect(file.name).toBe("eerste-bouwmoment.png");
    expect(file.type).toBe("image/png");
    await expect(file.text()).resolves.toBe("synthetic-photo");
    expect(JSON.stringify(normalized)).not.toContain("straat");
  });

  it("herstelt WebKit-vriendelijke ArrayBuffer-opslag als getypeerde Blob", async () => {
    const bytes = new TextEncoder().encode("synthetic-photo").buffer;
    const normalized = normalizeLandingPhotoHandoff(record({ bytes }), NOW);

    expect(normalized?.bytes).toBeInstanceOf(Blob);
    expect(normalized?.bytes.type).toBe("image/png");
    await expect(normalized?.bytes.text()).resolves.toBe("synthetic-photo");
  });

  it("weigert verlopen, toekomstige, beschadigde en niet-ondersteunde records", () => {
    expect(normalizeLandingPhotoHandoff(record({
      savedAt: "2026-08-22T09:54:59.000Z",
    }), NOW)).toBeNull();
    expect(normalizeLandingPhotoHandoff(record({
      savedAt: "2026-08-23T10:05:01.000Z",
    }), NOW)).toBeNull();
    expect(normalizeLandingPhotoHandoff(record({
      id: "../../../ander-account",
    }), NOW)).toBeNull();
    expect(normalizeLandingPhotoHandoff(record({
      contentType: "image/svg+xml",
    }), NOW)).toBeNull();
    expect(normalizeLandingPhotoHandoff(record({
      bytes: new Blob(["synthetic-photo"], { type: "image/jpeg" }),
    }), NOW)).toBeNull();
  });
});

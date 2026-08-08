import { describe, expect, it } from "vitest";

import { normalizeStoredUpdateDraft } from "@/lib/updateComposerDraftStore";

const UPDATE_KEY = "update-create:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    title: "De keuken is leeg",
    phaseId: "",
    isMilestone: false,
    description: "Een herstelbaar, volledig synthetisch concept.",
    updateDate: "2026-08-05",
    files: [],
    updateIdempotencyKey: UPDATE_KEY,
    pendingCommand: null,
    savedAt: "2026-08-05T10:00:00.000Z",
    ...overrides,
  };
}

describe("private update draft normalization", () => {
  it("accepts a scoped draft with an exact original Blob", () => {
    const bytes = new Blob(["exact-source"], { type: "image/jpeg" });
    const normalized = normalizeStoredUpdateDraft(draft({
      files: [{
        id: "media-upload:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "keuken.jpg",
        contentType: "image/jpeg",
        lastModified: 1_786_000_000_000,
        bytes,
        compareRole: "before",
      }],
    }));

    expect(normalized?.files[0]?.bytes).toBe(bytes);
    expect(normalized?.updateIdempotencyKey).toBe(UPDATE_KEY);
  });

  it("rejects corrupt dates, commands and injected asset identifiers", () => {
    expect(normalizeStoredUpdateDraft(draft({ updateDate: "morgen" }))).toBeNull();
    expect(normalizeStoredUpdateDraft(draft({ pendingCommand: { publish: true } }))).toBeNull();
    expect(normalizeStoredUpdateDraft(draft({
      files: [{
        id: "media-upload:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "keuken.jpg",
        contentType: "image/jpeg",
        lastModified: 1,
        bytes: new Blob(["x"]),
        compareRole: null,
        assetId: "../../../ander-account",
      }],
    }))).toBeNull();
  });
});

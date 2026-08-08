import { describe, expect, it } from "vitest";

import { getUpdateComposerCloseIntent } from "@/lib/updateComposerState";

describe("update composer close intent", () => {
  it("sluit een leeg concept direct", () => {
    expect(getUpdateComposerCloseIntent({ isDirty: false, isSaving: false })).toBe("close");
  });

  it("vraagt bevestiging voordat een concept met invoer verdwijnt", () => {
    expect(getUpdateComposerCloseIntent({ isDirty: true, isSaving: false })).toBe("confirm-discard");
  });

  it("negeert onbedoeld sluiten tijdens opslaan of uploaden", () => {
    expect(getUpdateComposerCloseIntent({ isDirty: true, isSaving: true })).toBe("ignore");
    expect(getUpdateComposerCloseIntent({ isDirty: false, isSaving: true })).toBe("ignore");
  });
});

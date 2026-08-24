// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { PhotobookDocument } from "../../shared/contracts/photobooks";
import { engagementRequestHash } from "../../server/engagement/idempotency";
import { mediaRequestHash } from "../../server/media/idempotency";
import { submissionRequestHash } from "../../server/moderation/idempotency";
import { photobookProofRequestHash } from "../../server/photobooks/repository";
import { planningRequestHash } from "../../server/planning/idempotency";
import { profileRequestHash } from "../../server/profiles/idempotency";
import { projectRequestHash } from "../../server/projects/idempotency";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";

const PRIMARY = new PrivacyBlindIndex(Buffer.alloc(32, 21).toString("base64"));
const ROTATED = new PrivacyBlindIndex(Buffer.alloc(32, 22).toString("base64"));
const PRIVATE_TEXT = "Keizersgracht 42, 1015 CS — bel Mila na 18:00";
const PRIVATE_CHECKSUM = "a".repeat(64);

describe("keyed request-hash privacy", () => {
  it("uses revocable key material and domain separation for every content-bearing command family", () => {
    const builders = [
      (index: PrivacyBlindIndex) => projectRequestHash(
        "project.create",
        { privateDetails: { addressLine1: PRIVATE_TEXT } },
        index,
      ),
      (index: PrivacyBlindIndex) => profileRequestHash(
        "profile.update",
        { displayName: "Mila", bio: PRIVATE_TEXT },
        index,
      ),
      (index: PrivacyBlindIndex) => engagementRequestHash(
        "comment.create",
        { body: PRIVATE_TEXT },
        index,
      ),
      (index: PrivacyBlindIndex) => planningRequestHash(
        "budget-item.create",
        { description: PRIVATE_TEXT },
        index,
      ),
      (index: PrivacyBlindIndex) => mediaRequestHash(
        { checksumSha256Base64: Buffer.from(PRIVATE_CHECKSUM, "hex").toString("base64") },
        index,
      ),
      (index: PrivacyBlindIndex) => photobookProofRequestHash(index, {
        checksumSha256: PRIVATE_CHECKSUM,
      } as PhotobookDocument),
      (index: PrivacyBlindIndex) => submissionRequestHash(
        "support.submit",
        { message: PRIVATE_TEXT },
        index,
      ),
    ];

    const primaryHashes = builders.map((builder) => builder(PRIMARY));
    const rotatedHashes = builders.map((builder) => builder(ROTATED));

    expect(primaryHashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(new Set(primaryHashes).size).toBe(builders.length);
    expect(primaryHashes.every((hash, index) => hash !== rotatedHashes[index])).toBe(true);
    expect(builders.map((builder) => builder(PRIMARY))).toEqual(primaryHashes);
    expect(JSON.stringify(primaryHashes)).not.toContain(PRIVATE_TEXT);
    expect(JSON.stringify(primaryHashes)).not.toContain(PRIVATE_CHECKSUM);
  });
});

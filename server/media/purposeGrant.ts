import { createHmac, timingSafeEqual } from "node:crypto";
import type { OriginalMediaPurpose } from "../../shared/contracts/media.js";

const TOKEN = /^v1\.([1-9][0-9]{0,12})\.([A-Za-z0-9_-]{43})$/;
const MAX_TTL_SECONDS = 5 * 60;

export interface OriginalMediaPurposeGrants {
  issue(input: {
    actorId: string;
    assetId: string;
    purpose: OriginalMediaPurpose;
  }): { token: string; expiresAt: string };
  verify(input: {
    actorId: string;
    assetId: string;
    purpose: OriginalMediaPurpose;
    token: string;
  }): boolean;
}

function signature(
  secret: string,
  actorId: string,
  assetId: string,
  purpose: OriginalMediaPurpose,
  expiresAtSeconds: number,
): Buffer {
  return createHmac("sha256", secret)
    .update("buildy-original-media-grant:v1\0")
    .update(actorId)
    .update("\0")
    .update(assetId)
    .update("\0")
    .update(purpose)
    .update("\0")
    .update(String(expiresAtSeconds))
    .digest();
}

export class HmacOriginalMediaPurposeGrants implements OriginalMediaPurposeGrants {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
    private readonly ttlSeconds = MAX_TTL_SECONDS,
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("Mediagrant-secret is te kort.");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error("Mediagrant-vervaltijd is ongeldig.");
    }
  }

  issue(input: {
    actorId: string;
    assetId: string;
    purpose: OriginalMediaPurpose;
  }): { token: string; expiresAt: string } {
    const expiresAtSeconds = Math.floor(this.now() / 1_000) + this.ttlSeconds;
    const digest = signature(
      this.secret,
      input.actorId,
      input.assetId,
      input.purpose,
      expiresAtSeconds,
    );
    return {
      token: `v1.${expiresAtSeconds}.${digest.toString("base64url")}`,
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    };
  }

  verify(input: {
    actorId: string;
    assetId: string;
    purpose: OriginalMediaPurpose;
    token: string;
  }): boolean {
    const match = TOKEN.exec(input.token);
    if (!match) return false;
    const expiresAtSeconds = Number(match[1]);
    if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds * 1_000 < this.now()) return false;
    const actual = Buffer.from(match[2], "base64url");
    const expected = signature(
      this.secret,
      input.actorId,
      input.assetId,
      input.purpose,
      expiresAtSeconds,
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

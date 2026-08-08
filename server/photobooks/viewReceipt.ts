import { createHmac, timingSafeEqual } from "node:crypto";

const RECEIPT = /^v1\.([1-9][0-9]{0,12})\.([A-Za-z0-9_-]{43})$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TTL_SECONDS = 15 * 60;

export type PhotobookProofViewIdentity = {
  actorId: string;
  revisionId: string;
  documentSha256: string;
  pdfSha256: string;
};

export interface PhotobookProofViewReceipts {
  issue(identity: PhotobookProofViewIdentity): { token: string; expiresAt: string };
  verify(identity: PhotobookProofViewIdentity & { token: string }): boolean;
}

function isValidIdentity(identity: PhotobookProofViewIdentity): boolean {
  return UUID.test(identity.actorId)
    && UUID.test(identity.revisionId)
    && SHA256.test(identity.documentSha256)
    && SHA256.test(identity.pdfSha256);
}

function signature(
  secret: string,
  identity: PhotobookProofViewIdentity,
  expiresAtSeconds: number,
): Buffer {
  return createHmac("sha256", secret)
    .update("buildy-photobook-proof-view:v1\0")
    .update(identity.actorId.toLowerCase())
    .update("\0")
    .update(identity.revisionId.toLowerCase())
    .update("\0")
    .update(identity.documentSha256)
    .update("\0")
    .update(identity.pdfSha256)
    .update("\0")
    .update(String(expiresAtSeconds))
    .digest();
}

export class HmacPhotobookProofViewReceipts implements PhotobookProofViewReceipts {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
    private readonly ttlSeconds = MAX_TTL_SECONDS,
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("Printproofreceipt-secret is te kort.");
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error("Printproofreceipt-vervaltijd is ongeldig.");
    }
  }

  issue(identity: PhotobookProofViewIdentity): { token: string; expiresAt: string } {
    if (!isValidIdentity(identity)) throw new Error("Printproofreceipt-identiteit is ongeldig.");
    const expiresAtSeconds = Math.floor(this.now() / 1_000) + this.ttlSeconds;
    const digest = signature(this.secret, identity, expiresAtSeconds);
    return {
      token: `v1.${expiresAtSeconds}.${digest.toString("base64url")}`,
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    };
  }

  verify(identity: PhotobookProofViewIdentity & { token: string }): boolean {
    if (!isValidIdentity(identity)) return false;
    const match = RECEIPT.exec(identity.token);
    if (!match) return false;
    const expiresAtSeconds = Number(match[1]);
    if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds * 1_000 < this.now()) return false;
    const actual = Buffer.from(match[2], "base64url");
    const expected = signature(this.secret, identity, expiresAtSeconds);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

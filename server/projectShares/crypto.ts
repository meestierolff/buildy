import { createHmac, timingSafeEqual } from "node:crypto";

import { projectShareTokenSchema } from "../../shared/contracts/projectShares.js";

const KEY_BYTES = 32;

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new TypeError("De deellink-HMAC-sleutel moet exact 256 bits zijn.");
  }
  return key;
}

function framed(parts: readonly string[]): Buffer {
  return Buffer.from(parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("|"), "utf8");
}

/** Domain-separated opaque capabilities backed by PII_BLIND_INDEX_KEY. */
export class HmacProjectShareTokens {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    this.key = decodeKey(encodedKey);
  }

  private hmac(domain: string, parts: readonly string[]): Buffer {
    return createHmac("sha256", this.key)
      .update(`buildy:${domain}:v1`, "utf8")
      .update("\0", "utf8")
      .update(framed(parts))
      .digest();
  }

  issueToken(input: {
    actorId: string;
    projectId: string;
    operation: "create" | "rotate";
    idempotencyKey: string;
  }): string {
    return this.hmac("project-share-token", [
      input.operation,
      input.actorId,
      input.projectId,
      input.idempotencyKey,
    ]).toString("base64url");
  }

  tokenHash(rawToken: string): string {
    return this.hmac("project-share-token-hash", [projectShareTokenSchema.parse(rawToken)]).toString("hex");
  }

  mutationHash(input: {
    actorId: string;
    projectId: string;
    operation: "create" | "rotate" | "revoke";
    idempotencyKey: string;
  }): string {
    return this.hmac("project-share-idempotency", [
      input.operation,
      input.actorId,
      input.projectId,
      input.idempotencyKey,
    ]).toString("hex");
  }

  requestHash(parts: readonly string[]): string {
    return this.hmac("project-share-request", parts).toString("hex");
  }

  grantSignature(linkId: string, expiresAtEpochSeconds: number): string {
    return this.hmac("project-share-cookie-grant", [linkId, String(expiresAtEpochSeconds)]).toString("base64url");
  }

  grantMatches(linkId: string, expiresAtEpochSeconds: number, signature: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
    return timingSafeEqual(
      Buffer.from(this.grantSignature(linkId, expiresAtEpochSeconds), "base64url"),
      Buffer.from(signature, "base64url"),
    );
  }

  matches(rawToken: string, expectedHash: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
    return timingSafeEqual(
      Buffer.from(this.tokenHash(rawToken), "hex"),
      Buffer.from(expectedHash, "hex"),
    );
  }
}

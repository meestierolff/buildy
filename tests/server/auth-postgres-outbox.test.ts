import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildProtectedAuthEmailRecord } from "../../server/auth/postgresOutbox";
import {
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../../server/security/dataProtection";

const encryptionKey = randomBytes(32).toString("base64");
const blindIndexKey = randomBytes(32).toString("base64");
const keyring = new DataProtectionKeyring({ currentVersion: 1, keys: { 1: encryptionKey } });
const blindIndex = new PrivacyBlindIndex(blindIndexKey);

describe("durable auth e-mail outbox", () => {
  it("stores recipient, action token and auth identity only in protected form", () => {
    const record = buildProtectedAuthEmailRecord({
      authUserId: "auth-user-secret",
      idempotencyKey: `auth-email:v1:verify_email:${"a".repeat(64)}`,
      kind: "verify_email",
      recipient: "bouwer@example.test",
      url: "https://app.buildy.test/api/auth/verify-email?token=secret-token",
    }, keyring, blindIndex);
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain("bouwer@example.test");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("auth-user-secret");
    expect(record.aggregateId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.payload.authUserIdHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives a stable aggregate for retries while using fresh authenticated ciphertext", () => {
    const message = {
      idempotencyKey: `auth-email:v1:magic_link:${"b".repeat(64)}`,
      kind: "magic_link" as const,
      recipient: "bouwer@example.test",
      url: "https://app.buildy.test/api/auth/magic-link/verify?token=secret-token",
    };
    const first = buildProtectedAuthEmailRecord(message, keyring, blindIndex);
    const second = buildProtectedAuthEmailRecord(message, keyring, blindIndex);

    expect(first.aggregateId).toBe(second.aggregateId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.payload.recipientCiphertext).not.toBe(second.payload.recipientCiphertext);
  });
});

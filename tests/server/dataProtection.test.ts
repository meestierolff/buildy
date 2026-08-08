import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DataProtectionError,
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../../server/security/dataProtection";

const key = () => randomBytes(32).toString("base64");

describe("PII data protection", () => {
  it("round-trips AES-GCM ciphertext only with the bound resource context", () => {
    const keyring = new DataProtectionKeyring({ currentVersion: 2, keys: { 1: key(), 2: key() } });
    const encrypted = keyring.encrypt("bouwer@example.test", "order:9d061f28:customer-email");

    expect(encrypted).not.toContain("bouwer@example.test");
    expect(keyring.decrypt(encrypted, "order:9d061f28:customer-email")).toBe("bouwer@example.test");
    expect(() => keyring.decrypt(encrypted, "order:different:customer-email")).toThrow(DataProtectionError);
  });

  it("decrypts historical ciphertext while encrypting with the current key", () => {
    const versionOne = key();
    const versionTwo = key();
    const oldKeyring = new DataProtectionKeyring({ currentVersion: 1, keys: { 1: versionOne } });
    const historical = oldKeyring.encrypt("oude waarde", "profile:1:private");
    const rotated = new DataProtectionKeyring({ currentVersion: 2, keys: { 1: versionOne, 2: versionTwo } });

    expect(rotated.decrypt(historical, "profile:1:private")).toBe("oude waarde");
    expect(rotated.encrypt("nieuwe waarde", "profile:1:private")).toMatch(/^v1\.2\./);
  });

  it("creates normalized keyed blind indexes", () => {
    const index = new PrivacyBlindIndex(key());
    const hash = index.create("email", "  Bouwer@Example.Test ");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(index.matches("email", "bouwer@example.test", hash)).toBe(true);
    expect(index.matches("email", "ander@example.test", hash)).toBe(false);
  });

  it("rejects malformed keys and envelopes", () => {
    expect(() => new DataProtectionKeyring({ currentVersion: 1, keys: { 1: "short" } })).toThrow(DataProtectionError);
    const keyring = new DataProtectionKeyring({ currentVersion: 1, keys: { 1: key() } });
    expect(() => keyring.decrypt("plaintext", "profile:1:private")).toThrow(DataProtectionError);
  });
});

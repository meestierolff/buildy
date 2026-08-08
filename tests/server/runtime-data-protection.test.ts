// @vitest-environment node

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../../server/config/runtime";
import { AuthUnavailableError } from "../../server/auth/errors";
import { resolveRuntimeDataProtection } from "../../server/security/runtimeDataProtection";

function runtime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const encryptionKey = randomBytes(32).toString("base64");
  return {
    APP_ENV: "test",
    APP_ORIGIN: "https://app.buildy.test",
    CHECKOUT_ENABLED: false,
    NODE_ENV: "test",
    PII_BLIND_INDEX_KEY: randomBytes(32).toString("base64"),
    PII_ENCRYPTION_CURRENT_VERSION: 2,
    PII_ENCRYPTION_KEYS: JSON.stringify({ 1: encryptionKey, 2: encryptionKey }),
    ...overrides,
  };
}

describe("runtime data protection", () => {
  it("loads versioned encryption and blind-index keys without exposing them", () => {
    const protection = resolveRuntimeDataProtection(runtime());
    const envelope = protection.keyring.encrypt("privé", "test:field");

    expect(envelope).toMatch(/^v1\.2\./);
    expect(protection.keyring.decrypt(envelope, "test:field")).toBe("privé");
    expect(protection.blindIndex.create("email", "Bouwer@example.test")).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    { PII_ENCRYPTION_KEYS: undefined },
    { PII_ENCRYPTION_KEYS: "not-json" },
    { PII_ENCRYPTION_KEYS: "[]" },
    { PII_ENCRYPTION_KEYS: JSON.stringify({ 0: "invalid" }) },
    { PII_ENCRYPTION_CURRENT_VERSION: 3 },
    { PII_BLIND_INDEX_KEY: "too-short" },
  ])("fails closed for missing or invalid key material: %o", (overrides) => {
    expect(() => resolveRuntimeDataProtection(runtime(overrides))).toThrow(AuthUnavailableError);
  });
});

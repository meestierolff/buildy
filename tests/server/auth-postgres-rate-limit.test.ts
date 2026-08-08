// @vitest-environment node

import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { BuildyDatabase } from "../../server/db/client";
import {
  PostgresAuthRateLimitStorage,
  authRateLimitKeyHash,
  rateLimitRetryAfter,
} from "../../server/auth/postgresRateLimitStorage";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";

const blindIndex = new PrivacyBlindIndex(randomBytes(32).toString("base64"));

function consumeDatabase(result: { count: number; windowStartedAtMs: number }) {
  let insertedValue: unknown;
  const builder = {
    values: vi.fn((value: unknown) => {
      insertedValue = value;
      return builder;
    }),
    onConflictDoUpdate: vi.fn(() => builder),
    returning: vi.fn(async () => [result]),
  };
  const database = { insert: vi.fn(() => builder) } as unknown as BuildyDatabase;
  return { database, builder, insertedValue: () => insertedValue };
}

describe("PostgreSQL auth rate-limit storage", () => {
  it("blind-indexes request-derived keys before persistence", async () => {
    const rawKey = "198.51.100.24:/sign-in/email";
    const fake = consumeDatabase({ count: 1, windowStartedAtMs: 1_700_000_000_000 });
    const storage = new PostgresAuthRateLimitStorage(
      fake.database,
      blindIndex,
      () => 1_700_000_000_000,
    );

    await expect(storage.consume(rawKey, { max: 3, window: 60 })).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });

    const serialized = JSON.stringify(fake.insertedValue());
    expect(serialized).not.toContain(rawKey);
    expect(serialized).toContain(authRateLimitKeyHash(rawKey, blindIndex));
    expect(fake.builder.onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it("fails closed once the atomic database result is above the maximum", async () => {
    const now = 1_700_000_030_250;
    const windowStartedAtMs = 1_700_000_000_000;
    const fake = consumeDatabase({ count: 4, windowStartedAtMs });
    const storage = new PostgresAuthRateLimitStorage(fake.database, blindIndex, () => now);

    await expect(storage.consume("key", { max: 3, window: 60 })).resolves.toEqual({
      allowed: false,
      retryAfter: 30,
    });
  });

  it("validates bounded rules and never returns a non-positive retry delay", async () => {
    const fake = consumeDatabase({ count: 1, windowStartedAtMs: 1_000 });
    const storage = new PostgresAuthRateLimitStorage(fake.database, blindIndex, () => 2_000);

    await expect(storage.consume("key", { max: 0, window: 60 })).rejects.toThrow(/regel/);
    expect(rateLimitRetryAfter(1_000, 1, 9_000)).toBe(1);
  });
});

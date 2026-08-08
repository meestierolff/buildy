import { eq, sql } from "drizzle-orm";
import { authRateLimits } from "../../db/schema/auth.js";
import type { BuildyDatabase } from "../db/client.js";
import { PrivacyBlindIndex } from "../security/dataProtection.js";
import type { AuthRateLimitStorage } from "./factory.js";

const RATE_LIMIT_KEY_NAMESPACE = "auth-rate-limit";
const MAX_KEY_BYTES = 4_096;
const MAX_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_REQUESTS_PER_WINDOW = 10_000;
const LEGACY_ROW_RETENTION_MS = 24 * 60 * 60 * 1_000;

type RateLimitRule = { window: number; max: number };

function assertKey(key: string): void {
  const byteLength = Buffer.byteLength(key, "utf8");
  if (byteLength < 1 || byteLength > MAX_KEY_BYTES) {
    throw new Error("Auth-rate-limitsleutel heeft een ongeldige lengte.");
  }
}

function assertRule(rule: RateLimitRule): void {
  if (
    !Number.isSafeInteger(rule.window) ||
    rule.window < 1 ||
    rule.window > MAX_WINDOW_SECONDS ||
    !Number.isSafeInteger(rule.max) ||
    rule.max < 1 ||
    rule.max > MAX_REQUESTS_PER_WINDOW
  ) {
    throw new Error("Auth-rate-limitregel is ongeldig.");
  }
}

function assertLegacyValue(value: { count: number; lastRequest: number }): void {
  if (
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    value.count > MAX_REQUESTS_PER_WINDOW + 1 ||
    !Number.isSafeInteger(value.lastRequest) ||
    value.lastRequest < 1
  ) {
    throw new Error("Auth-rate-limitwaarde is ongeldig.");
  }
}

export function authRateLimitKeyHash(key: string, blindIndex: PrivacyBlindIndex): string {
  assertKey(key);
  return blindIndex.create(RATE_LIMIT_KEY_NAMESPACE, key);
}

export function rateLimitRetryAfter(
  windowStartedAtMs: number,
  windowSeconds: number,
  nowMs: number,
): number {
  return Math.max(1, Math.ceil((windowStartedAtMs + windowSeconds * 1_000 - nowMs) / 1_000));
}

/**
 * A process-safe Better Auth rate-limit store backed by one atomic PostgreSQL
 * upsert. Denied requests cap the counter at max + 1 and do not move the
 * window, preventing concurrent bypasses and attacker-controlled lockout drift.
 */
export class PostgresAuthRateLimitStorage implements AuthRateLimitStorage {
  constructor(
    private readonly database: BuildyDatabase,
    private readonly blindIndex: PrivacyBlindIndex,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string): Promise<{ key: string; count: number; lastRequest: number } | null> {
    const nowMs = this.now();
    const keyHash = authRateLimitKeyHash(key, this.blindIndex);
    const [row] = await this.database
      .select({
        count: authRateLimits.count,
        expiresAt: authRateLimits.expiresAt,
        lastRequestAtMs: authRateLimits.lastRequestAtMs,
      })
      .from(authRateLimits)
      .where(eq(authRateLimits.keyHash, keyHash))
      .limit(1);

    if (!row || row.expiresAt.getTime() <= nowMs) return null;
    return { key, count: row.count, lastRequest: row.lastRequestAtMs };
  }

  async set(
    key: string,
    value: { key: string; count: number; lastRequest: number },
    _update?: boolean,
  ): Promise<void> {
    assertLegacyValue(value);
    const keyHash = authRateLimitKeyHash(key, this.blindIndex);
    const expiresAt = new Date(value.lastRequest + LEGACY_ROW_RETENTION_MS);

    await this.database
      .insert(authRateLimits)
      .values({
        keyHash,
        count: value.count,
        windowStartedAtMs: value.lastRequest,
        lastRequestAtMs: value.lastRequest,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: authRateLimits.keyHash,
        set: {
          count: value.count,
          windowStartedAtMs: value.lastRequest,
          lastRequestAtMs: value.lastRequest,
          expiresAt,
          updatedAt: new Date(this.now()),
        },
      });
  }

  async consume(
    key: string,
    rule: RateLimitRule,
  ): Promise<{ allowed: boolean; retryAfter: number | null }> {
    assertRule(rule);
    const nowMs = this.now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 1) {
      throw new Error("Auth-rate-limitklok is ongeldig.");
    }

    const keyHash = authRateLimitKeyHash(key, this.blindIndex);
    const windowMs = rule.window * 1_000;
    const expiresAt = new Date(nowMs + windowMs);
    const windowExpired = sql<boolean>`
      ${authRateLimits.windowStartedAtMs} + ${windowMs} <= ${nowMs}
    `;
    const belowLimit = sql<boolean>`${authRateLimits.count} < ${rule.max}`;

    const [row] = await this.database
      .insert(authRateLimits)
      .values({
        keyHash,
        count: 1,
        windowStartedAtMs: nowMs,
        lastRequestAtMs: nowMs,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: authRateLimits.keyHash,
        set: {
          count: sql<number>`CASE
            WHEN ${windowExpired} THEN 1
            WHEN ${belowLimit} THEN ${authRateLimits.count} + 1
            ELSE ${rule.max + 1}
          END`,
          windowStartedAtMs: sql<number>`CASE
            WHEN ${windowExpired} THEN ${nowMs}
            ELSE ${authRateLimits.windowStartedAtMs}
          END`,
          lastRequestAtMs: sql<number>`CASE
            WHEN ${windowExpired} OR ${belowLimit} THEN ${nowMs}
            ELSE ${authRateLimits.lastRequestAtMs}
          END`,
          expiresAt: sql<Date>`CASE
            WHEN ${windowExpired} THEN ${expiresAt}
            ELSE ${authRateLimits.expiresAt}
          END`,
          updatedAt: new Date(nowMs),
        },
      })
      .returning({
        count: authRateLimits.count,
        windowStartedAtMs: authRateLimits.windowStartedAtMs,
      });

    if (!row) throw new Error("Auth-rate-limitbeslissing ontbreekt.");
    if (row.count <= rule.max) return { allowed: true, retryAfter: null };

    return {
      allowed: false,
      retryAfter: rateLimitRetryAfter(row.windowStartedAtMs, rule.window, nowMs),
    };
  }
}

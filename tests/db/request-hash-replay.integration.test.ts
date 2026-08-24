// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createBuildyDatabase } from "../../server/db/client";
import { PostgresProfileRepository } from "../../server/profiles/repository";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webDatabaseUrl = process.env.DATABASE_SECURITY_WEB_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && webDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (
    !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)
    || !/(?:test|tmp|ci)/i.test(databaseName)
  ) throw new Error("Request-hashreplaytests mogen alleen op een lokale tijdelijke database draaien.");
}

describeWithDatabase("request-hash replay PostgreSQL boundary", () => {
  it("fails closed instead of replaying a pre-v2 profile fingerprint", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(webDatabaseUrl!);
    const actorId = randomUUID();
    const clientKey = randomUUID();
    const idempotencyKey = `profile-command:v1:profile.update:${randomUUID().replaceAll("-", "").repeat(2)}`;
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const resources = createBuildyDatabase(webDatabaseUrl!, {
      applicationName: "buildy-request-hash-replay-test",
      maxConnections: 1,
    });
    const repository = new PostgresProfileRepository(resources.database);
    await admin.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [actorId]);
      await admin.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private)
        VALUES ($1, 'Legacy profiel', $2, true)
      `, [actorId, `legacy-${actorId}`]);
      await admin.query(`
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, idempotency_key, payload
        ) VALUES (
          'profile', $1, 'profile.updated.v1', $2,
          jsonb_build_object(
            'schemaVersion', 1,
            'requestHash', $3::text,
            'profileVersion', 1
          )
        )
      `, [actorId, idempotencyKey, "a".repeat(64)]);

      await expect(repository.updateOwnProfile({
        actorId,
        idempotencyKey,
        requestHash: "a".repeat(64),
        input: {
          idempotencyKey: clientKey,
          expectedVersion: 1,
          displayName: "Legacy profiel",
        },
      })).rejects.toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });

      const profile = await admin.query<{ display_name: string; version: number }>(`
        SELECT display_name, version FROM profiles WHERE user_id = $1
      `, [actorId]);
      expect(profile.rows).toEqual([{ display_name: "Legacy profiel", version: 1 }]);
    } finally {
      await admin.query("DELETE FROM outbox_events WHERE idempotency_key = $1", [idempotencyKey])
        .catch(() => undefined);
      await admin.query("DELETE FROM profiles WHERE user_id = $1", [actorId]).catch(() => undefined);
      await admin.query("DELETE FROM app_users WHERE id = $1", [actorId]).catch(() => undefined);
      await resources.pool.end();
      await admin.end();
    }
  });
});

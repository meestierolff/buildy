// @vitest-environment node

import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

const ids = {
  viewer: "51000000-0000-4000-8000-000000000001",
  publicUser: "52000000-0000-4000-8000-000000000002",
  followedPrivate: "53000000-0000-4000-8000-000000000003",
  unrelatedPrivate: "54000000-0000-4000-8000-000000000004",
  blockedUser: "55000000-0000-4000-8000-000000000005",
  suspendedUser: "56000000-0000-4000-8000-000000000006",
  readyAvatar: "61000000-0000-4000-8000-000000000001",
  processingAvatar: "62000000-0000-4000-8000-000000000002",
  otherAvatar: "63000000-0000-4000-8000-000000000003",
} as const;

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Profiel-RLS-tests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

async function setActor(client: Client, role: string, actorId: string): Promise<void> {
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
}

let savepointSequence = 0;
async function expectDatabaseError(
  client: Client,
  statement: string,
  parameters: unknown[],
  expectedCode: string,
): Promise<void> {
  savepointSequence += 1;
  const savepoint = `profile_boundary_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught: unknown;
  try {
    await client.query(statement, parameters);
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  expect(caught).toBeDefined();
  expect(
    typeof caught === "object" && caught !== null && "code" in caught
      ? String(caught.code)
      : undefined,
  ).toBe(expectedCode);
}

describeWithDatabase("profile PostgreSQL RLS boundary", () => {
  it("enforces lifecycle, privacy, IDOR, slug, version and avatar boundaries as the web role", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`
        INSERT INTO app_users (id, status) VALUES
          ($1, 'active'), ($2, 'active'), ($3, 'active'),
          ($4, 'active'), ($5, 'active'), ($6, 'suspended')
      `, [
        ids.viewer,
        ids.publicUser,
        ids.followedPrivate,
        ids.unrelatedPrivate,
        ids.blockedUser,
        ids.suspendedUser,
      ]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Kijker', 'profile-kijker', true),
          ($2, 'Openbaar', 'profile-openbaar', false),
          ($3, 'Gevolgd privé', 'profile-gevolgd', true),
          ($4, 'Onbekend privé', 'profile-onbekend', true),
          ($5, 'Geblokkeerd', 'profile-geblokkeerd', false),
          ($6, 'Geschorst', 'profile-geschorst', false)
      `, [
        ids.viewer,
        ids.publicUser,
        ids.followedPrivate,
        ids.unrelatedPrivate,
        ids.blockedUser,
        ids.suspendedUser,
      ]);
      await client.query(`
        INSERT INTO user_relationships (
          source_user_id, target_user_id, kind, status, decided_at
        ) VALUES
          ($1, $2, 'follow', 'active', now()),
          ($1, $3, 'block', 'active', now())
      `, [ids.viewer, ids.followedPrivate, ids.blockedUser]);
      await client.query(`
        INSERT INTO media_assets (
          id, owner_id, purpose, status, storage_provider, bucket, object_key,
          upload_idempotency_key, detected_content_type, size_bytes, sha256,
          width_pixels, height_pixels, exif_stripped, ready_at
        ) VALUES
          ($1, $2, 'avatar', 'ready', 'r2', 'test-assets', 'originals/ready.webp',
           'profile-ready-avatar', 'image/webp', 1024, $6, 640, 640, true, now()),
          ($3, $2, 'avatar', 'processing', 'r2', 'test-assets', 'avatars/processing.webp',
           'profile-processing-avatar', NULL, 1024, $6, NULL, NULL, false, NULL),
          ($4, $5, 'avatar', 'ready', 'r2', 'test-assets', 'originals/other.webp',
           'profile-other-avatar', 'image/webp', 1024, $6, 640, 640, true, now())
      `, [
        ids.readyAvatar,
        ids.viewer,
        ids.processingAvatar,
        ids.otherAvatar,
        ids.publicUser,
        "a".repeat(64),
      ]);

      await setActor(client, webRole!, ids.viewer);

      const visibleProfiles = await client.query<{ user_id: string }>(`
        SELECT user_id FROM profiles
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id
      `, [[
        ids.viewer,
        ids.publicUser,
        ids.followedPrivate,
        ids.unrelatedPrivate,
        ids.blockedUser,
        ids.suspendedUser,
      ]]);
      expect(visibleProfiles.rows.map((row) => row.user_id)).toEqual([
        ids.viewer,
        ids.publicUser,
        ids.followedPrivate,
      ]);

      expect((await client.query(`
        UPDATE profiles
        SET display_name = 'IDOR', version = version + 1
        WHERE user_id = $1
      `, [ids.publicUser])).rowCount).toBe(0);

      await expectDatabaseError(client, `
        UPDATE profiles
        SET avatar_asset_id = $1, version = version + 1
        WHERE user_id = $2
      `, [ids.otherAvatar, ids.viewer], "42501");
      await expectDatabaseError(client, `
        UPDATE profiles
        SET avatar_asset_id = $1, version = version + 1
        WHERE user_id = $2
      `, [ids.processingAvatar, ids.viewer], "42501");
      await expectDatabaseError(client, `
        UPDATE profiles
        SET slug = 'profile-openbaar', version = version + 1
        WHERE user_id = $1
      `, [ids.viewer], "23505");
      await expectDatabaseError(client, `
        UPDATE profiles
        SET is_pro = true, version = version + 1
        WHERE user_id = $1
      `, [ids.viewer], "42501");

      const linked = await client.query<{ avatar_asset_id: string; version: number }>(`
        UPDATE profiles
        SET avatar_asset_id = $1, version = version + 1
        WHERE user_id = $2 AND version = 1
        RETURNING avatar_asset_id, version
      `, [ids.readyAvatar, ids.viewer]);
      expect(linked.rows[0]).toEqual({ avatar_asset_id: ids.readyAvatar, version: 2 });

      const onboarded = await client.query<{ onboarded_at: Date; version: number }>(`
        UPDATE profiles
        SET onboarded_at = now(), version = version + 1
        WHERE user_id = $1 AND version = 2
        RETURNING onboarded_at, version
      `, [ids.viewer]);
      expect(onboarded.rows[0]?.onboarded_at).toBeInstanceOf(Date);
      expect(onboarded.rows[0]?.version).toBe(3);
      await expectDatabaseError(client, `
        UPDATE profiles
        SET onboarded_at = now() + interval '1 hour', version = version + 1
        WHERE user_id = $1
      `, [ids.viewer], "42501");

      await client.query("RESET ROLE");
      const onboardingEvents = await client.query<{ event_name: string; properties: unknown }>(`
        SELECT event_name, properties
        FROM product_events
        WHERE event_key = 'product-event:onboarding-completed:' || $1::text
      `, [ids.viewer]);
      expect(onboardingEvents.rows).toEqual([{
        event_name: "onboarding_completed",
        properties: { schemaVersion: 1 },
      }]);
      await setActor(client, webRole!, ids.viewer);

      expect((await client.query(`
        UPDATE profiles
        SET display_name = 'Verouderde write', version = version + 1
        WHERE user_id = $1 AND version = 1
      `, [ids.viewer])).rowCount).toBe(0);
      await expectDatabaseError(client, `
        UPDATE media_assets SET status = 'failed', version = version + 1 WHERE id = $1
      `, [ids.readyAvatar], "23514");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

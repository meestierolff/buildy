// @vitest-environment node

import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

const ids = {
  owner: "11111111-1111-4111-8111-111111111111",
  viewer: "22222222-2222-4222-8222-222222222222",
  blockedActor: "33333333-3333-4333-8333-333333333333",
  suspended: "44444444-4444-4444-8444-444444444444",
  publicProject: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  privateProject: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  publicUpdate: "a1111111-1111-4111-8111-111111111111",
  draftUpdate: "a2222222-2222-4222-8222-222222222222",
  privateUpdate: "a3333333-3333-4333-8333-333333333333",
  privateDraft: "a4444444-4444-4444-8444-444444444444",
  sourceComment: "c1111111-1111-4111-8111-111111111111",
  deleteComment: "c2222222-2222-4222-8222-222222222222",
  blockedComment: "c3333333-3333-4333-8333-333333333333",
  blockedReaction: "d1111111-1111-4111-8111-111111111111",
  visibleNotification: "e1111111-1111-4111-8111-111111111111",
  draftNotification: "e2222222-2222-4222-8222-222222222222",
  blockedNotification: "e3333333-3333-4333-8333-333333333333",
  otherNotification: "e4444444-4444-4444-8444-444444444444",
} as const;

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error(
      "Engagement-RLS-tests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.",
    );
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
  const savepoint = `engagement_boundary_${savepointSequence}`;
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

describeWithDatabase("engagement PostgreSQL RLS boundary", () => {
  it("enforces publication, block, recipient and forged-write boundaries as the web role", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`
        INSERT INTO app_users (id, status) VALUES
          ($1, 'active'), ($2, 'active'), ($3, 'active'), ($4, 'suspended')
      `, [ids.owner, ids.viewer, ids.blockedActor, ids.suspended]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Eigenaar', 'rls-eigenaar', false),
          ($2, 'Kijker', 'rls-kijker', true),
          ($3, 'Geblokkeerd', 'rls-geblokkeerd', false),
          ($4, 'Geschorst', 'rls-geschorst', false)
      `, [ids.owner, ids.viewer, ids.blockedActor, ids.suspended]);
      await client.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, published_at
        ) VALUES
          ($1, $2, 'rls-openbaar', 'Openbaar project', 'public', 'active', now()),
          ($3, $2, 'rls-volgers', 'Project voor volgers', 'followers', 'active', now())
      `, [ids.publicProject, ids.owner, ids.privateProject]);
      await client.query(`
        INSERT INTO updates (
          id, project_id, project_owner_id, author_id, update_date, status, published_at
        ) VALUES
          ($1, $2, $3, $3, current_date, 'published', now()),
          ($4, $2, $3, $3, current_date, 'draft', NULL),
          ($5, $6, $3, $3, current_date, 'published', now()),
          ($7, $6, $3, $3, current_date, 'draft', NULL)
      `, [
        ids.publicUpdate,
        ids.publicProject,
        ids.owner,
        ids.draftUpdate,
        ids.privateUpdate,
        ids.privateProject,
        ids.privateDraft,
      ]);
      await client.query(`
        INSERT INTO user_relationships (
          source_user_id, target_user_id, kind, status, decided_at
        ) VALUES
          ($1, $2, 'follow', 'active', now()),
          ($1, $3, 'block', 'active', now())
      `, [ids.viewer, ids.owner, ids.blockedActor]);
      await client.query(`
        INSERT INTO comments (id, project_id, update_id, author_id, body, status) VALUES
          ($1, $2, $3, $4, 'Bronreactie', 'published'),
          ($5, $2, $3, $4, 'Te verwijderen', 'published'),
          ($6, $2, $3, $7, 'Verborgen door blokkade', 'published')
      `, [
        ids.sourceComment,
        ids.publicProject,
        ids.publicUpdate,
        ids.viewer,
        ids.deleteComment,
        ids.blockedComment,
        ids.blockedActor,
      ]);
      await client.query(`
        INSERT INTO reactions (
          id, project_id, update_id, actor_id, target, emoji
        ) VALUES ($1, $2, $3, $4, 'update', '👍')
      `, [ids.blockedReaction, ids.publicProject, ids.publicUpdate, ids.blockedActor]);
      await client.query(`
        INSERT INTO notifications (
          id, recipient_id, actor_id, project_id, update_id, type, dedupe_key, payload
        ) VALUES
          ($1, $2, $3, $4, $5, 'seed.visible', 'rls-visible', '{"schemaVersion":1}'),
          ($6, $2, $3, $4, $7, 'seed.draft', 'rls-draft', '{"schemaVersion":1}'),
          ($8, $2, $9, $4, $5, 'seed.blocked', 'rls-blocked', '{"schemaVersion":1}'),
          ($10, $9, $3, $4, $5, 'seed.other', 'rls-other', '{"schemaVersion":1}')
      `, [
        ids.visibleNotification,
        ids.viewer,
        ids.owner,
        ids.publicProject,
        ids.publicUpdate,
        ids.draftNotification,
        ids.draftUpdate,
        ids.blockedNotification,
        ids.blockedActor,
        ids.otherNotification,
      ]);

      await setActor(client, webRole!, ids.viewer);

      const appUsers = await client.query<{ id: string }>("SELECT id FROM app_users ORDER BY id");
      expect(appUsers.rows.map((row) => row.id)).toEqual([ids.viewer]);

      const profiles = await client.query<{ user_id: string }>(`
        SELECT user_id FROM profiles
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id
      `, [[ids.owner, ids.viewer, ids.blockedActor, ids.suspended]]);
      expect(profiles.rows.map((row) => row.user_id)).toEqual([ids.owner, ids.viewer]);

      const updates = await client.query<{ id: string }>(`
        SELECT id FROM updates
        WHERE id = ANY($1::uuid[])
        ORDER BY id
      `, [[ids.publicUpdate, ids.draftUpdate, ids.privateUpdate, ids.privateDraft]]);
      expect(updates.rows.map((row) => row.id)).toEqual([
        ids.publicUpdate,
        ids.privateUpdate,
      ]);

      const comments = await client.query<{ id: string }>(`
        SELECT id FROM comments
        WHERE id = ANY($1::uuid[])
        ORDER BY id
      `, [[ids.sourceComment, ids.deleteComment, ids.blockedComment]]);
      expect(comments.rows.map((row) => row.id)).toEqual([
        ids.sourceComment,
        ids.deleteComment,
      ]);
      expect((await client.query("SELECT id FROM reactions")).rowCount).toBe(0);

      const notifications = await client.query<{ id: string }>(
        "SELECT id FROM notifications ORDER BY id",
      );
      expect(notifications.rows.map((row) => row.id)).toEqual([ids.visibleNotification]);
      const unread = await client.query<{ unread_count: number }>(`
        SELECT count(*)::integer AS unread_count
        FROM notifications
        WHERE recipient_id = $1
          AND status = 'unread'
      `, [ids.viewer]);
      expect(unread.rows[0]?.unread_count).toBe(1);

      await expectDatabaseError(
        client,
        "UPDATE comments SET body = 'vervalst', version = version + 1 WHERE id = $1",
        [ids.sourceComment],
        "42501",
      );
      const deleted = await client.query<{ id: string }>(`
        UPDATE comments
        SET status = 'deleted', deleted_at = now(), body = '[verwijderd]', version = version + 1
        WHERE id = $1
        RETURNING id
      `, [ids.deleteComment]);
      expect(deleted.rows[0]?.id).toBe(ids.deleteComment);
      expect((await client.query<{ id: string; status: string }>(`
        SELECT id, status FROM comments WHERE id = $1
      `, [ids.deleteComment])).rows).toEqual([
        { id: ids.deleteComment, status: "deleted" },
      ]);

      expect((await client.query(`
        UPDATE notifications
        SET status = 'read', read_at = now(), updated_at = now()
        WHERE recipient_id = $1
          AND status = 'unread'
      `, [ids.viewer])).rowCount).toBe(1);
      expect((await client.query(`
        UPDATE notifications
        SET status = 'read', read_at = now()
        WHERE id = $1
      `, [ids.visibleNotification])).rowCount).toBe(1);
      expect((await client.query(`
        UPDATE notifications
        SET status = 'archived', read_at = now()
        WHERE id = $1
      `, [ids.visibleNotification])).rowCount).toBe(1);
      await expectDatabaseError(
        client,
        "UPDATE notifications SET status = 'unread', read_at = NULL WHERE id = $1",
        [ids.visibleNotification],
        "42501",
      );
      expect((await client.query(
        "UPDATE notifications SET status = 'read', read_at = now() WHERE id = $1",
        [ids.otherNotification],
      )).rowCount).toBe(0);

      await expectDatabaseError(client, `
        INSERT INTO notifications (
          recipient_id, actor_id, project_id, update_id, type, dedupe_key, payload
        ) VALUES ($1, $2, $3, $4, 'forged', 'rls-forged', '{}')
      `, [ids.viewer, ids.viewer, ids.publicProject, ids.publicUpdate], "42501");
      await expectDatabaseError(client, `
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, idempotency_key, payload
        ) VALUES ('notification', $1, 'forged.v1', 'rls-forged-outbox', '{}')
      `, [ids.visibleNotification], "42501");
      await expectDatabaseError(
        client,
        "SELECT app_enqueue_engagement_notification($1, 'comment.created', $2)",
        [ids.blockedActor, ids.sourceComment],
        "42501",
      );
      await expectDatabaseError(
        client,
        "SELECT app_enqueue_engagement_notification($1, 'forged.type', $2)",
        [ids.owner, ids.sourceComment],
        "22023",
      );

      const generated = await client.query<{ notification_id: string }>(`
        SELECT app_enqueue_engagement_notification(
          $1, 'comment.created', $2
        ) AS notification_id
      `, [ids.owner, ids.sourceComment]);
      const generatedId = generated.rows[0]?.notification_id;
      expect(generatedId).toMatch(/^[0-9a-f-]{36}$/);

      const generatedReplay = await client.query<{ notification_id: string }>(`
        SELECT app_enqueue_engagement_notification(
          $1, 'comment.created', $2
        ) AS notification_id
      `, [ids.owner, ids.sourceComment]);
      expect(generatedReplay.rows[0]?.notification_id).toBe(generatedId);

      const socialGenerated = await client.query<{ notification_id: string }>(`
        SELECT app_enqueue_social_notification(
          $1, 'profile.followed', NULL
        ) AS notification_id
      `, [ids.owner]);
      const socialGeneratedId = socialGenerated.rows[0]?.notification_id;
      expect(socialGeneratedId).toMatch(/^[0-9a-f-]{36}$/);
      const socialReplay = await client.query<{ notification_id: string }>(`
        SELECT app_enqueue_social_notification(
          $1, 'profile.followed', NULL
        ) AS notification_id
      `, [ids.owner]);
      expect(socialReplay.rows[0]?.notification_id).toBe(socialGeneratedId);

      await client.query("RESET ROLE");
      const stored = await client.query<{
        actor_id: string;
        dedupe_key: string;
        outbox_payload: Record<string, unknown>;
        recipient_id: string;
        notification_payload: Record<string, unknown>;
        source_aggregate_id: string;
      }>(`
        SELECT
          notification.actor_id,
          notification.recipient_id,
          notification.dedupe_key,
          notification.source_aggregate_id,
          notification.payload AS notification_payload,
          event.payload AS outbox_payload
        FROM notifications notification
        JOIN outbox_events event
          ON event.aggregate_type = 'notification'
         AND event.aggregate_id = notification.id
        WHERE notification.id = $1
      `, [generatedId]);
      expect(stored.rows[0]).toEqual({
        actor_id: ids.viewer,
        dedupe_key: expect.stringMatching(
          /^engagement-notification:v2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        recipient_id: ids.owner,
        notification_payload: { schemaVersion: 1 },
        outbox_payload: { schemaVersion: 1 },
        source_aggregate_id: ids.sourceComment,
      });

      const socialStored = await client.query<{
        dedupe_key: string;
        relationship_id: string;
        relationship_version: number;
        source_aggregate_id: string;
        source_version: number;
      }>(`
        SELECT
          notification.dedupe_key,
          notification.source_aggregate_id,
          notification.source_version,
          relationship.id AS relationship_id,
          relationship.version AS relationship_version
        FROM notifications notification
        JOIN user_relationships relationship
          ON relationship.source_user_id = notification.actor_id
         AND relationship.target_user_id = notification.recipient_id
         AND relationship.kind = 'follow'
        WHERE notification.id = $1
      `, [socialGeneratedId]);
      const socialRow = socialStored.rows[0];
      expect(socialRow).toMatchObject({
        dedupe_key: expect.stringMatching(
          /^social-notification:v2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      });
      expect(socialRow?.source_aggregate_id).toBe(socialRow?.relationship_id);
      expect(socialRow?.source_version).toBe(socialRow?.relationship_version);

      await setActor(client, webRole!, ids.owner);
      await expectDatabaseError(
        client,
        "UPDATE notifications SET source_aggregate_id = $1 WHERE id = $2",
        [ids.deleteComment, generatedId],
        "42501",
      );

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

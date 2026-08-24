// @vitest-environment node

import { createHash } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

const ids = {
  owner: "71111111-1111-4111-8111-111111111111",
  viewer: "72222222-2222-4222-8222-222222222222",
  project: "73333333-3333-4333-8333-333333333333",
  update: "74444444-4444-4444-8444-444444444444",
  comment: "75555555-5555-4555-8555-555555555555",
  reaction: "76666666-6666-4666-8666-666666666666",
  updateMedia: "77777777-7777-4777-8777-777777777777",
  floorplanMedia: "78888888-8888-4888-8888-888888888888",
  floorplan: "79999999-9999-4999-8999-999999999999",
  pin: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  link1: "7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  link2: "7ccccccc-cccc-4ccc-8ccc-cccccccccccc",
  link3: "7ddddddd-dddd-4ddd-8ddd-dddddddddddd",
  link4: "7eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  link5: "7fffffff-ffff-4fff-8fff-ffffffffffff",
  link6: "70000000-0000-4000-8000-000000000006",
} as const;

function hash(label: string): string {
  return createHash("sha256").update(`project-share-test:${label}`).digest("hex");
}

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)
      || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Deellink-RLS-tests mogen alleen op een lokale tijdelijke testdatabase draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

async function setContext(
  client: Client,
  role: string,
  actorId: string | null,
  shareLinkId: string | null,
): Promise<void> {
  await client.query("RESET ROLE");
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId ?? ""]);
  await client.query("SELECT set_config('app.share_link_id', $1, true)", [shareLinkId ?? ""]);
}

async function surfaceCounts(client: Client): Promise<Record<string, number>> {
  const result = await client.query<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM projects WHERE id = $1)::text AS projects,
      (SELECT count(*) FROM updates WHERE id = $2)::text AS updates,
      (SELECT count(*) FROM comments WHERE id = $3)::text AS comments,
      (SELECT count(*) FROM reactions WHERE id = $4)::text AS reactions,
      (SELECT count(*) FROM media_assets WHERE id = ANY($5::uuid[]))::text AS media,
      (SELECT count(*) FROM update_media WHERE update_id = $2)::text AS attachments,
      (SELECT count(*) FROM floorplans WHERE id = $6)::text AS floorplans,
      (SELECT count(*) FROM floorplan_pins WHERE id = $7)::text AS pins
  `, [
    ids.project,
    ids.update,
    ids.comment,
    ids.reaction,
    [ids.updateMedia, ids.floorplanMedia],
    ids.floorplan,
    ids.pin,
  ]);
  return Object.fromEntries(
    Object.entries(result.rows[0] ?? {}).map(([name, value]) => [name, Number(value)]),
  );
}

async function issueLink(
  client: Client,
  role: string,
  linkId: string,
  operation: "create" | "rotate",
  expectedVersion: number | null,
  label: string,
): Promise<{ id: string; replayed: boolean; version: number }> {
  await setContext(client, role, ids.owner, null);
  const result = await client.query<{ id: string; replayed: boolean; version: number }>(`
    SELECT id, replayed, version
    FROM app_issue_project_share_link(
      $1, $2, $3, now() + interval '7 days', $4,
      $5, $6, $7, $8
    )
  `, [
    ids.project,
    linkId,
    operation,
    expectedVersion,
    hash(`${label}:token`),
    hash(`${label}:idempotency`),
    hash(`${label}:request`),
    "70000000-0000-4000-8000-000000000099",
  ]);
  return result.rows[0];
}

describeWithDatabase("project share-link PostgreSQL boundary", () => {
  it("revalidates one read-only grant across every project surface and invalidation event", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')", [
        ids.owner,
        ids.viewer,
      ]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Deellink-eigenaar', 'deellink-eigenaar', false),
          ($2, 'Deellink-kijker', 'deellink-kijker', false)
      `, [ids.owner, ids.viewer]);
      await client.query(`
        INSERT INTO projects (id, owner_id, slug, title, visibility, lifecycle_status, published_at)
        VALUES ($1, $2, 'deellink-rls', 'Deellink RLS', 'unlisted', 'active', now())
      `, [ids.project, ids.owner]);
      await client.query(`
        INSERT INTO updates (
          id, project_id, project_owner_id, author_id, title, update_date, status, published_at
        ) VALUES ($1, $2, $3, $3, 'Zichtbaar Bouwmoment', current_date, 'published', now())
      `, [ids.update, ids.project, ids.owner]);
      await client.query(`
        INSERT INTO media_assets (
          id, owner_id, project_id, purpose, status, storage_provider, bucket,
          object_key, upload_idempotency_key, detected_content_type, size_bytes,
          sha256, width_pixels, height_pixels, exif_stripped, ready_at
        ) VALUES
          ($1, $3, $4, 'project_media', 'ready', 'vercel_blob', 'buildy-private-test',
           $5, $6, 'image/webp', 512, $7, 1200, 800, true, now()),
          ($2, $3, $4, 'floorplan', 'ready', 'vercel_blob', 'buildy-private-test',
           $8, $9, 'image/png', 512, $10, 1200, 800, true, now())
      `, [
        ids.updateMedia,
        ids.floorplanMedia,
        ids.owner,
        ids.project,
        `projects/${ids.project}/${ids.updateMedia}.webp`,
        `project-share-media:${ids.updateMedia}`,
        hash("update-media"),
        `projects/${ids.project}/${ids.floorplanMedia}.png`,
        `project-share-media:${ids.floorplanMedia}`,
        hash("floorplan-media"),
      ]);
      await client.query(`
        INSERT INTO update_media (update_id, project_id, media_asset_id, role, sort_order)
        VALUES ($1, $2, $3, 'gallery', 0)
      `, [ids.update, ids.project, ids.updateMedia]);
      await client.query(`
        INSERT INTO floorplans (id, project_id, owner_id, media_asset_id, name)
        VALUES ($1, $2, $3, $4, 'Begane grond')
      `, [ids.floorplan, ids.project, ids.owner, ids.floorplanMedia]);
      await client.query(`
        INSERT INTO floorplan_pins (id, project_id, floorplan_id, update_id, x, y, label)
        VALUES ($1, $2, $3, $4, 0.25, 0.75, 'Keuken')
      `, [ids.pin, ids.project, ids.floorplan, ids.update]);
      await client.query(`
        INSERT INTO comments (id, project_id, update_id, author_id, body, status)
        VALUES ($1, $2, $3, $4, 'Zichtbare reactie', 'published')
      `, [ids.comment, ids.project, ids.update, ids.owner]);
      await client.query(`
        INSERT INTO reactions (id, project_id, update_id, actor_id, target, emoji)
        VALUES ($1, $2, $3, $4, 'update', '🔨')
      `, [ids.reaction, ids.project, ids.update, ids.owner]);

      const created = await issueLink(client, webRole!, ids.link1, "create", null, "create-1");
      expect(created).toMatchObject({ id: ids.link1, replayed: false, version: 1 });

      await setContext(client, webRole!, null, null);
      expect(await surfaceCounts(client)).toEqual({
        projects: 0, updates: 0, comments: 0, reactions: 0,
        media: 0, attachments: 0, floorplans: 0, pins: 0,
      });
      await setContext(client, webRole!, null, ids.link1);
      expect(await surfaceCounts(client)).toEqual({
        projects: 1, updates: 1, comments: 1, reactions: 1,
        media: 2, attachments: 1, floorplans: 1, pins: 1,
      });
      const deniedEdit = await client.query("UPDATE projects SET title = 'Niet toegestaan' WHERE id = $1 RETURNING id", [ids.project]);
      expect(deniedEdit.rowCount).toBe(0);

      await client.query("RESET ROLE");
      await client.query(`
        INSERT INTO user_relationships (source_user_id, target_user_id, kind, status, decided_at)
        VALUES ($1, $2, 'block', 'active', now())
      `, [ids.viewer, ids.owner]);
      await setContext(client, webRole!, ids.viewer, ids.link1);
      expect((await surfaceCounts(client)).projects).toBe(0);
      await client.query("RESET ROLE");
      await client.query(`
        UPDATE user_relationships SET status = 'revoked', revoked_at = now(), version = version + 1
        WHERE source_user_id = $1 AND target_user_id = $2 AND kind = 'block'
      `, [ids.viewer, ids.owner]);

      const rotated = await issueLink(client, webRole!, ids.link2, "rotate", 1, "rotate-2");
      expect(rotated).toMatchObject({ id: ids.link2, replayed: false, version: 1 });
      const replayed = await issueLink(client, webRole!, ids.link2, "rotate", 1, "rotate-2");
      expect(replayed).toMatchObject({ id: ids.link2, replayed: true });
      await setContext(client, webRole!, null, ids.link1);
      expect((await surfaceCounts(client)).projects).toBe(0);
      await setContext(client, webRole!, null, ids.link2);
      expect((await surfaceCounts(client)).projects).toBe(1);

      await setContext(client, webRole!, ids.owner, null);
      await client.query(`
        SELECT * FROM app_revoke_project_share_link($1, 1, $2, $3, $4)
      `, [
        ids.project,
        hash("revoke-2:idempotency"),
        hash("revoke-2:request"),
        "70000000-0000-4000-8000-000000000098",
      ]);
      await setContext(client, webRole!, null, ids.link2);
      expect((await surfaceCounts(client)).projects).toBe(0);

      await client.query("RESET ROLE");
      await client.query(`
        INSERT INTO project_share_links (
          id, project_id, owner_id, token_hash, issue_idempotency_hash,
          issue_request_hash, created_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, now() - interval '2 hours', now() - interval '1 hour')
      `, [
        ids.link3,
        ids.project,
        ids.owner,
        hash("expired:token"),
        hash("expired:idempotency"),
        hash("expired:request"),
      ]);
      await setContext(client, webRole!, null, ids.link3);
      expect((await surfaceCounts(client)).projects).toBe(0);
      const expired = await client.query<{ status: string }>(
        "SELECT status FROM app_redeem_project_share_link($1)",
        [hash("expired:token")],
      );
      expect(expired.rows[0]?.status).toBe("expired");

      await client.query("RESET ROLE");
      await client.query("UPDATE projects SET visibility = 'private', version = version + 1 WHERE id = $1", [ids.project]);
      await client.query("UPDATE projects SET visibility = 'unlisted', version = version + 1 WHERE id = $1", [ids.project]);
      await issueLink(client, webRole!, ids.link4, "create", null, "create-4");
      await client.query("RESET ROLE");
      await client.query("UPDATE projects SET visibility = 'private', version = version + 1 WHERE id = $1", [ids.project]);
      await setContext(client, webRole!, null, ids.link4);
      expect((await surfaceCounts(client)).projects).toBe(0);

      await client.query("RESET ROLE");
      await client.query("UPDATE projects SET visibility = 'unlisted', version = version + 1 WHERE id = $1", [ids.project]);
      await issueLink(client, webRole!, ids.link5, "create", null, "create-5");
      await client.query("RESET ROLE");
      await client.query("UPDATE app_users SET status = 'deletion_pending', deletion_requested_at = now() WHERE id = $1", [ids.owner]);
      await setContext(client, webRole!, null, ids.link5);
      expect((await surfaceCounts(client)).projects).toBe(0);

      await client.query("RESET ROLE");
      await client.query("UPDATE app_users SET status = 'active', deletion_requested_at = NULL WHERE id = $1", [ids.owner]);
      await issueLink(client, webRole!, ids.link6, "create", null, "create-6");
      await client.query("RESET ROLE");
      await client.query("UPDATE app_users SET status = 'deleted', deleted_at = now() WHERE id = $1", [ids.owner]);
      const remainingLinks = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM project_share_links WHERE owner_id = $1",
        [ids.owner],
      );
      expect(Number(remainingLinks.rows[0]?.count)).toBe(0);

      const columns = await client.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_share_links'
      `);
      expect(columns.rows.map((row) => row.column_name)).not.toEqual(
        expect.arrayContaining(["raw_token", "share_token", "token"]),
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

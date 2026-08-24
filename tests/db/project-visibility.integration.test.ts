// @vitest-environment node

import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

const ids = {
  owner: "51111111-1111-4111-8111-111111111111",
  follower: "52222222-2222-4222-8222-222222222222",
  stranger: "53333333-3333-4333-8333-333333333333",
  blocked: "54444444-4444-4444-8444-444444444444",
  privateProject: "a1000000-0000-4000-8000-000000000001",
  followersProject: "a2000000-0000-4000-8000-000000000002",
  unlistedProject: "a3000000-0000-4000-8000-000000000003",
  publicProject: "a4000000-0000-4000-8000-000000000004",
  privateUpdate: "b1000000-0000-4000-8000-000000000001",
  followersUpdate: "b2000000-0000-4000-8000-000000000002",
  unlistedUpdate: "b3000000-0000-4000-8000-000000000003",
  publicUpdate: "b4000000-0000-4000-8000-000000000004",
  shareLink: "c3000000-0000-4000-8000-000000000003",
} as const;

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Zichtbaarheidstests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

async function visibleIds(
  client: Client,
  role: string,
  actorId: string | null,
  shareLinkId: string | null = null,
): Promise<{
  projects: string[];
  updates: string[];
}> {
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId ?? ""]);
  await client.query("SELECT set_config('app.share_link_id', $1, true)", [shareLinkId ?? ""]);
  const projects = await client.query<{ id: string }>(`
    SELECT id FROM projects
    WHERE owner_id = $1
    ORDER BY id
  `, [ids.owner]);
  const updates = await client.query<{ id: string }>(`
    SELECT id FROM updates
    WHERE project_owner_id = $1
    ORDER BY id
  `, [ids.owner]);
  await client.query("RESET ROLE");
  return {
    projects: projects.rows.map((row) => row.id),
    updates: updates.rows.map((row) => row.id),
  };
}

describeWithDatabase("four-mode project visibility PostgreSQL boundary", () => {
  it("revokes private and follower-only content immediately while keeping link and public modes distinct", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`
        INSERT INTO app_users (id, status) VALUES
          ($1, 'active'), ($2, 'active'), ($3, 'active'), ($4, 'active')
      `, [ids.owner, ids.follower, ids.stranger, ids.blocked]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Eigenaar', 'zichtbaarheid-eigenaar', false),
          ($2, 'Volger', 'zichtbaarheid-volger', false),
          ($3, 'Onbekende', 'zichtbaarheid-onbekende', false),
          ($4, 'Geblokkeerde', 'zichtbaarheid-geblokkeerde', false)
      `, [ids.owner, ids.follower, ids.stranger, ids.blocked]);
      await client.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, published_at
        ) VALUES
          ($1, $5, 'zichtbaarheid-prive', 'Alleen ik', 'private', 'active', NULL),
          ($2, $5, 'zichtbaarheid-volgers', 'Mijn volgers', 'followers', 'active', now()),
          ($3, $5, 'zichtbaarheid-link', 'Iedereen met link', 'unlisted', 'active', now()),
          ($4, $5, 'zichtbaarheid-openbaar', 'Openbaar', 'public', 'active', now())
      `, [
        ids.privateProject,
        ids.followersProject,
        ids.unlistedProject,
        ids.publicProject,
        ids.owner,
      ]);
      await client.query(`
        INSERT INTO project_share_links (
          id, project_id, owner_id, token_hash, issue_idempotency_hash,
          issue_request_hash, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')
      `, [ids.shareLink, ids.unlistedProject, ids.owner, "a".repeat(64), "b".repeat(64), "c".repeat(64)]);
      await client.query(`
        INSERT INTO updates (
          id, project_id, project_owner_id, author_id, update_date, status, published_at
        ) VALUES
          ($1, $5, $9, $9, current_date, 'published', now()),
          ($2, $6, $9, $9, current_date, 'published', now()),
          ($3, $7, $9, $9, current_date, 'published', now()),
          ($4, $8, $9, $9, current_date, 'published', now())
      `, [
        ids.privateUpdate,
        ids.followersUpdate,
        ids.unlistedUpdate,
        ids.publicUpdate,
        ids.privateProject,
        ids.followersProject,
        ids.unlistedProject,
        ids.publicProject,
        ids.owner,
      ]);
      await client.query(`
        INSERT INTO user_relationships (
          source_user_id, target_user_id, kind, status, decided_at
        ) VALUES
          ($1, $2, 'follow', 'active', now()),
          ($2, $3, 'block', 'active', now())
      `, [ids.follower, ids.owner, ids.blocked]);
      await client.query(`
        INSERT INTO project_access_requests (
          project_id, project_owner_id, requester_id, status, decided_by_id, decided_at
        ) VALUES ($1, $2, $3, 'accepted', $2, now())
      `, [ids.privateProject, ids.owner, ids.stranger]);

      expect(await visibleIds(client, webRole!, ids.owner)).toEqual({
        projects: [
          ids.privateProject,
          ids.followersProject,
          ids.unlistedProject,
          ids.publicProject,
        ],
        updates: [
          ids.privateUpdate,
          ids.followersUpdate,
          ids.unlistedUpdate,
          ids.publicUpdate,
        ],
      });
      expect(await visibleIds(client, webRole!, ids.follower)).toEqual({
        projects: [ids.followersProject, ids.publicProject],
        updates: [ids.followersUpdate, ids.publicUpdate],
      });
      expect(await visibleIds(client, webRole!, ids.stranger)).toEqual({
        projects: [ids.publicProject],
        updates: [ids.publicUpdate],
      });
      expect(await visibleIds(client, webRole!, null)).toEqual({
        projects: [ids.publicProject],
        updates: [ids.publicUpdate],
      });
      expect(await visibleIds(client, webRole!, null, ids.shareLink)).toEqual({
        projects: [ids.unlistedProject, ids.publicProject],
        updates: [ids.unlistedUpdate, ids.publicUpdate],
      });
      expect(await visibleIds(client, webRole!, ids.stranger, ids.shareLink)).toEqual({
        projects: [ids.unlistedProject, ids.publicProject],
        updates: [ids.unlistedUpdate, ids.publicUpdate],
      });
      expect(await visibleIds(client, webRole!, ids.blocked, ids.shareLink)).toEqual({
        projects: [],
        updates: [],
      });

      await client.query(`
        UPDATE user_relationships
        SET status = 'revoked', revoked_at = now(), version = version + 1
        WHERE source_user_id = $1 AND target_user_id = $2 AND kind = 'follow'
      `, [ids.follower, ids.owner]);
      expect(await visibleIds(client, webRole!, ids.follower)).toEqual({
        projects: [ids.publicProject],
        updates: [ids.publicUpdate],
      });

      await client.query("RESET ROLE");
      await client.query(`
        UPDATE project_share_links SET revoked_at = now(), version = version + 1
        WHERE id = $1
      `, [ids.shareLink]);
      expect(await visibleIds(client, webRole!, null, ids.shareLink)).toEqual({
        projects: [ids.publicProject],
        updates: [ids.publicUpdate],
      });

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

async function withDatabase(run: (client: Client) => Promise<void>): Promise<void> {
  const url = new URL(databaseUrl!);
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)
      || !/(?:test|tmp|ci)/i.test(decodeURIComponent(url.pathname.slice(1)))
      || !/^[a-z_][a-z0-9_]{0,62}$/.test(webRole!)) {
    throw new Error("Project follow tests require a local disposable database and web role.");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await run(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function actor(client: Client, id: string | null): Promise<void> {
  await client.query(`SET LOCAL ROLE "${webRole}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [id ?? ""]);
}

async function admin(client: Client): Promise<void> {
  await client.query("RESET ROLE");
  await client.query("SELECT set_config('app.actor_id', '', true)");
}

async function errorCode(client: Client, statement: string, values: unknown[]): Promise<string | undefined> {
  await client.query("SAVEPOINT rejected_follow");
  try {
    await client.query(statement, values);
    return undefined;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT rejected_follow");
    await client.query("RELEASE SAVEPOINT rejected_follow");
  }
}

async function fixture(client: Client, visibility = "public") {
  const owner = randomUUID();
  const viewer = randomUUID();
  const other = randomUUID();
  const muted = randomUUID();
  const project = randomUUID();
  const secondProject = randomUUID();
  await client.query("INSERT INTO app_users (id, status) SELECT unnest($1::uuid[]), 'active'", [
    [owner, viewer, other, muted],
  ]);
  await client.query(`
    INSERT INTO projects (id, owner_id, slug, title, visibility, lifecycle_status, published_at)
    VALUES ($1::uuid, $3, $1::uuid::text, 'Deze verbouwing', $4::project_visibility, 'active', now()),
           ($2::uuid, $3, $2::uuid::text, 'Andere verbouwing', 'public', 'active', now())
  `, [project, secondProject, owner, visibility]);
  return { owner, viewer, other, muted, project, secondProject };
}

const setFollow = "SELECT * FROM app_set_project_follow($1, $2)";
const summary = "SELECT * FROM app_project_follow_summary($1)";

describeWithDatabase("project-specific following PostgreSQL boundary", () => {
  it("persists only the selected subscription, replays safely and aggregates without exposing participant rows", async () => {
    await withDatabase(async (client) => {
      const data = await fixture(client);
      await actor(client, data.viewer);
      expect((await client.query(setFollow, [data.project, true])).rows).toEqual([
        { replayed: false, state: "following" },
      ]);
      expect((await client.query(setFollow, [data.project, true])).rows).toEqual([
        { replayed: true, state: "following" },
      ]);
      expect((await client.query(summary, [data.secondProject])).rows).toEqual([
        { follower_count: 0, viewer_follow_status: "none" },
      ]);
      await admin(client);
      expect((await client.query(`
        SELECT id FROM user_relationships WHERE source_user_id = $1
      `, [data.viewer])).rowCount).toBe(0);
      expect((await client.query(`
        SELECT id FROM notifications WHERE project_id = $1 AND type = 'project.followed'
      `, [data.project])).rowCount).toBe(1);
      await client.query(`
        INSERT INTO project_followers (project_id, project_owner_id, follower_id, status)
        VALUES ($1, $2, $3, 'active'), ($1, $2, $4, 'muted')
      `, [data.project, data.owner, data.other, data.muted]);
      await actor(client, data.viewer);
      expect((await client.query(summary, [data.project])).rows).toEqual([
        { follower_count: 3, viewer_follow_status: "following" },
      ]);
      expect((await client.query("SELECT follower_id FROM project_followers WHERE project_id = $1", [data.project])).rows)
        .toEqual([{ follower_id: data.viewer }]);
      await actor(client, data.owner);
      expect((await client.query(summary, [data.project])).rows[0]?.viewer_follow_status).toBe("self");
      expect(await errorCode(client, setFollow, [data.project, true])).toBe("42501");
      await actor(client, null);
      expect(await errorCode(client, setFollow, [data.project, true])).toBe("42501");

      // Exactly this project's active followers receive publication messages.
      await admin(client);
      await client.query(`
        INSERT INTO user_relationships (source_user_id, target_user_id, kind, status, decided_at)
        VALUES ($1, $2, 'follow', 'active', now())
      `, [data.muted, data.owner]);
      const firstUpdate = randomUUID();
      const secondUpdate = randomUUID();
      await client.query(`
        INSERT INTO updates (id, project_id, project_owner_id, author_id, title, update_date, status, published_at)
        VALUES ($1, $3, $5, $5, 'Gekozen project', current_date, 'published', now()),
               ($2, $4, $5, $5, 'Niet gevolgd', current_date, 'published', now())
      `, [firstUpdate, secondUpdate, data.project, data.secondProject, data.owner]);
      const recipients = (await client.query<{ recipient_id: string; update_id: string }>(`
        SELECT recipient_id, update_id FROM notifications WHERE update_id = ANY($1::uuid[])
      `, [[firstUpdate, secondUpdate]])).rows;
      expect(recipients.map((row) => row.recipient_id).sort()).toEqual([data.viewer, data.other].sort());
      expect(recipients.every((row) => row.update_id === firstUpdate)).toBe(true);
    });
  });

  it("requires a current share grant to follow and lets its participant unfollow after revocation without restoring access", async () => {
    await withDatabase(async (client) => {
      const data = await fixture(client, "unlisted");
      const link = randomUUID();
      await client.query(`
        INSERT INTO project_share_links (
          id, project_id, owner_id, token_hash, issue_idempotency_hash, issue_request_hash, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 day')
      `, [link, data.project, data.owner, "a".repeat(64), "b".repeat(64), "c".repeat(64)]);
      await actor(client, data.viewer);
      expect((await client.query(summary, [data.project])).rows).toEqual([]);
      expect(await errorCode(client, setFollow, [data.project, true])).toBe("42501");
      await client.query("SELECT set_config('app.share_link_id', $1, true)", [link]);
      expect((await client.query(setFollow, [data.project, true])).rows[0]?.state).toBe("following");
      await admin(client);
      await client.query("UPDATE project_share_links SET revoked_at = now(), version = version + 1 WHERE id = $1", [link]);
      await actor(client, data.viewer);
      expect((await client.query("SELECT app_can_view_project($1) AS visible", [data.project])).rows[0]?.visible).toBe(false);
      expect((await client.query(summary, [data.project])).rows).toEqual([]);
      expect((await client.query("SELECT project_id FROM project_followers WHERE project_id = $1", [data.project])).rows).toEqual([]);
      expect((await client.query(setFollow, [data.project, false])).rows).toEqual([{ replayed: false, state: "none" }]);
      expect((await client.query(setFollow, [data.project, false])).rows).toEqual([{ replayed: true, state: "none" }]);
      expect((await client.query(setFollow, [randomUUID(), false])).rows).toEqual([{ replayed: true, state: "none" }]);
      expect(await errorCode(client, setFollow, [data.project, true])).toBe("42501");
      expect((await client.query("SELECT id FROM projects WHERE id = $1", [data.project])).rows).toEqual([]);
      await admin(client);
      expect((await client.query("SELECT status FROM project_followers WHERE project_id = $1", [data.project])).rows)
        .toEqual([{ status: "revoked" }]);
    });
  });

  it("revokes active and muted subscriptions after a block and rejects third-party revocation", async () => {
    await withDatabase(async (client) => {
      const data = await fixture(client);
      await client.query(`
        INSERT INTO project_followers (project_id, project_owner_id, follower_id, status)
        VALUES ($1, $3, $4, 'active'), ($2, $3, $4, 'muted'), ($1, $3, $5, 'active')
      `, [data.project, data.secondProject, data.owner, data.viewer, data.other]);
      await client.query(`
        INSERT INTO project_access_requests (project_id, project_owner_id, requester_id, status, decided_at)
        VALUES ($1, $3, $4, 'pending', NULL), ($2, $3, $4, 'accepted', now()),
               ($1, $3, $5, 'pending', NULL)
      `, [data.project, data.secondProject, data.owner, data.viewer, data.other]);
      await actor(client, data.muted);
      expect(await errorCode(client, "SELECT app_revoke_project_follows($1, $2)", [data.viewer, data.owner])).toBe("42501");
      await actor(client, data.owner);
      await client.query(`
        INSERT INTO user_relationships (source_user_id, target_user_id, kind, status, decided_at)
        VALUES ($1, $2, 'block', 'active', now())
      `, [data.owner, data.viewer]);
      await actor(client, data.viewer);
      expect((await client.query("SELECT project_id FROM project_followers WHERE follower_id = $1", [data.viewer])).rows)
        .toEqual([]);
      await actor(client, data.owner);
      expect((await client.query("SELECT app_revoke_project_follows($1, $2) AS changed", [data.viewer, data.owner])).rows)
        .toEqual([{ changed: 2 }]);
      expect((await client.query("SELECT app_revoke_project_follows($1, $2) AS changed", [data.viewer, data.owner])).rows)
        .toEqual([{ changed: 0 }]);
      await admin(client);
      await client.query(`
        UPDATE user_relationships SET status = 'revoked', revoked_at = now(), version = version + 1
        WHERE source_user_id = $1 AND target_user_id = $2 AND kind = 'block'
      `, [data.owner, data.viewer]);
      await actor(client, data.viewer);
      expect((await client.query(summary, [data.project])).rows)
        .toEqual([{ follower_count: 1, viewer_follow_status: "none" }]);
      expect((await client.query(summary, [data.secondProject])).rows)
        .toEqual([{ follower_count: 0, viewer_follow_status: "none" }]);
      await admin(client);
      const statuses = (await client.query<{ status: string }>("SELECT status FROM project_followers WHERE follower_id = $1", [data.viewer])).rows;
      expect(statuses).toHaveLength(2);
      expect(statuses.every((row) => row.status === "revoked")).toBe(true);
      expect((await client.query(`
        SELECT status, decided_by_id, version FROM project_access_requests WHERE requester_id = $1
      `, [data.viewer])).rows).toEqual([
        { status: "revoked", decided_by_id: data.owner, version: 2 },
        { status: "revoked", decided_by_id: data.owner, version: 2 },
      ]);
      expect((await client.query(`
        SELECT status, version FROM project_access_requests WHERE requester_id = $1
      `, [data.other])).rows).toEqual([{ status: "pending", version: 1 }]);
    });
  });
});

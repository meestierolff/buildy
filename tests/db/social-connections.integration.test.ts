// @vitest-environment node

import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

const ids = {
  actor: "91000000-0000-4000-8000-000000000001",
  blocked: "91000000-0000-4000-8000-000000000002",
  follower: "91000000-0000-4000-8000-000000000003",
  followingA: "91000000-0000-4000-8000-000000000004",
  followingB: "91000000-0000-4000-8000-000000000005",
  incoming: "91000000-0000-4000-8000-000000000006",
  outgoing: "91000000-0000-4000-8000-000000000007",
} as const;

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Social-connectiontests mogen alleen op een lokale tijdelijke database draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

async function setWebActor(client: Client, role: string, actorId: string | null): Promise<void> {
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId ?? ""]);
}

async function queryErrorCode(
  client: Client,
  statement: string,
  parameters: unknown[],
): Promise<string | undefined> {
  await client.query("SAVEPOINT social_connections_error");
  try {
    await client.query(statement, parameters);
    return undefined;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT social_connections_error");
    await client.query("RELEASE SAVEPOINT social_connections_error");
  }
}

describeWithDatabase("canonical social connections PostgreSQL boundary", () => {
  it("lists every actor-owned state canonically and keeps private search details hidden", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`
        INSERT INTO app_users (id, status) VALUES
          ($1, 'active'), ($2, 'active'), ($3, 'active'), ($4, 'active'),
          ($5, 'active'), ($6, 'active'), ($7, 'active')
      `, Object.values(ids));
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, bio, location, is_private) VALUES
          ($1, 'Acteur', 'social-acteur', 'eigen bio', 'Utrecht', false),
          ($2, 'Geblokkeerde bouwer', 'social-geblokkeerd', 'verborgen bio', 'Groningen', true),
          ($3, 'Privévolger', 'social-privevolger', 'verborgen bio', 'Leiden', true),
          ($4, 'Gevolgd A', 'social-gevolgd-a', 'open bio', 'Breda', false),
          ($5, 'Gevolgd B', 'social-gevolgd-b', 'open bio', 'Delft', false),
          ($6, 'Inkomend privé', 'social-inkomend', 'verborgen bio', 'Zwolle', true),
          ($7, 'Uitgaand privé', 'social-uitgaand', 'verborgen bio', 'Arnhem', true)
      `, Object.values(ids));
      await client.query(`
        INSERT INTO user_relationships (
          source_user_id, target_user_id, kind, status, decided_at, created_at, updated_at
        ) VALUES
          ($1, $4, 'follow', 'active', now(), now() - interval '1 minute', now() - interval '1 minute'),
          ($1, $5, 'follow', 'active', now(), now() - interval '2 minutes', now() - interval '2 minutes'),
          ($3, $1, 'follow', 'active', now(), now(), now()),
          ($6, $1, 'follow', 'pending', NULL, now(), now()),
          ($1, $7, 'follow', 'pending', NULL, now(), now()),
          ($1, $2, 'block', 'active', now(), now(), now())
      `, Object.values(ids));

      await setWebActor(client, webRole!, ids.actor);

      const expectedByView = {
        blocked: [ids.blocked],
        followers: [ids.follower],
        incoming: [ids.incoming],
        outgoing: [ids.outgoing],
      } as const;
      for (const [view, expected] of Object.entries(expectedByView)) {
        const result = await client.query<{ total_count: string; user_id: string }>(`
          SELECT user_id, total_count
          FROM app_list_profile_connections($1, NULL, NULL, 10)
        `, [view]);
        expect(result.rows.map((row) => row.user_id)).toEqual(expected);
        expect(result.rows[0]?.total_count).toBe("1");
      }

      const firstFollowing = await client.query<{
        relationship_at: Date;
        total_count: string;
        user_id: string;
      }>(`
        SELECT user_id, relationship_at, total_count
        FROM app_list_profile_connections('following', NULL, NULL, 1)
      `);
      expect(firstFollowing.rows).toHaveLength(1);
      expect(firstFollowing.rows[0]?.total_count).toBe("2");
      const secondFollowing = await client.query<{ total_count: string; user_id: string }>(`
        SELECT user_id, total_count
        FROM app_list_profile_connections('following', $1, $2, 1)
      `, [firstFollowing.rows[0]?.relationship_at, firstFollowing.rows[0]?.user_id]);
      expect(secondFollowing.rows).toHaveLength(1);
      expect(secondFollowing.rows[0]?.user_id).not.toBe(firstFollowing.rows[0]?.user_id);
      expect(secondFollowing.rows[0]?.total_count).toBe("2");

      const privateSearch = await client.query<{
        avatar_id: string | null;
        bio: string | null;
        follower_count: number;
        location: string | null;
        user_id: string;
        viewer_access: string;
        viewer_follow_status: string;
      }>(`
        SELECT user_id, bio, location, avatar_id, follower_count,
               viewer_access, viewer_follow_status
        FROM app_search_profile_identities('inkomend', NULL, NULL, 10)
      `);
      expect(privateSearch.rows).toEqual([{
        avatar_id: null,
        bio: null,
        follower_count: 0,
        location: null,
        user_id: ids.incoming,
        viewer_access: "requestable",
        viewer_follow_status: "none",
      }]);
      expect((await client.query(
        "SELECT user_id FROM profiles WHERE user_id = $1",
        [ids.incoming],
      )).rowCount).toBe(0);
      expect((await client.query(
        "SELECT * FROM app_search_profile_identities('geblokkeerde', NULL, NULL, 10)",
      )).rowCount).toBe(0);

      await client.query("RESET ROLE");
      await setWebActor(client, webRole!, null);
      expect((await client.query(
        "SELECT user_id FROM app_search_profile_identities('inkomend', NULL, NULL, 10)",
      )).rowCount).toBe(0);
      expect(await queryErrorCode(
        client,
        "SELECT * FROM app_list_profile_connections('following', NULL, NULL, 10)",
        [],
      )).toBe("42501");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import { projectOverviewResponseSchema, followingFeedResponseSchema } from "../../shared/contracts/projects";
import { PostgresProjectRepository } from "../../server/projects/repository";
import { ProjectService } from "../../server/projects/service";
import { PostgresSocialRepository } from "../../server/social/repository";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

function assertLocalDisposableDatabase(): void {
  const url = new URL(databaseUrl!);
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname)
      || !/(?:test|tmp|ci)/i.test(decodeURIComponent(url.pathname.slice(1)))
      || !/^[a-z_][a-z0-9_]{0,62}$/.test(webRole!)) {
    throw new Error("Project-follow tests require a local disposable database and a restricted web role.");
  }
}

describeWithDatabase("project-follow repository under real PostgreSQL RLS", () => {
  it("keeps subscriptions project-specific, carries share grants and revokes follows across blocking", async () => {
    assertLocalDisposableDatabase();
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const rollback = new Error("Roll back synthetic project-follow repository fixture");
    const [ownerId, viewerId, otherViewerId, projectA, projectB, sharedProject, shareId] =
      Array.from({ length: 7 }, () => randomUUID());
    const viewer = { kind: "authenticated" as const, appUserId: viewerId };
    const sharedViewer = { ...viewer, shareLinkId: shareId };
    try {
      await drizzle(client, { schema }).transaction(async (transaction) => {
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("INSERT INTO app_users (id,status) VALUES ($1,'active'),($2,'active'),($3,'active')", [
          ownerId, viewerId, otherViewerId,
        ]);
        for (const id of [ownerId, viewerId, otherViewerId]) {
          await client.query("INSERT INTO profiles (user_id,display_name,slug,is_private) VALUES ($1,'Synthetic follower',$2,false)", [
            id, `follow-repository-${id}`,
          ]);
        }
        for (const [projectId, visibility] of [[projectA, "public"], [projectB, "public"], [sharedProject, "unlisted"]]) {
          await client.query(`
            INSERT INTO projects (id,owner_id,slug,title,visibility,lifecycle_status,published_at)
            VALUES ($1,$2,$3,'Synthetic project',$4,'active',now())
          `, [projectId, ownerId, `follow-repository-${projectId}`, visibility]);
          await client.query(`
            INSERT INTO updates (id,project_id,project_owner_id,author_id,title,update_date,status,published_at)
            VALUES ($1,$2,$3,$3,'Synthetic Bouwmoment',current_date,'published',now())
          `, [randomUUID(), projectId, ownerId]);
        }
        const hash = (value: string) => createHash("sha256").update(value).digest("hex");
        await client.query(`
          INSERT INTO project_share_links (id,project_id,owner_id,token_hash,issue_idempotency_hash,issue_request_hash,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,now()+interval '1 day')
        `, [shareId, sharedProject, ownerId, hash(shareId), hash(`${shareId}:issue`), hash(`${shareId}:request`)]);
        const asWeb = () => client.query(`SET LOCAL ROLE "${webRole}"`);
        await asWeb();
        const repository = new PostgresProjectRepository(transaction);
        const service = new ProjectService(repository, {
          currentKeyVersion: 1,
          protect: () => { throw new Error("Following must not create project private details"); },
        }, new PrivacyBlindIndex(Buffer.alloc(32, 17).toString("base64")));

        await expect(service.setProjectFollow(viewer, projectA, true))
          .resolves.toEqual({ state: "following", replayed: false });
        await expect(service.setProjectFollow(viewer, projectA, true))
          .resolves.toEqual({ state: "following", replayed: true });
        const overview = await service.overview(viewer, projectA);
        expect(overview).toMatchObject({ followerCount: 1, viewerFollowStatus: "following", canEdit: false });
        expect(() => projectOverviewResponseSchema.parse({ data: overview, meta: { requestId: randomUUID() } })).not.toThrow();
        expect(await service.overview({ kind: "authenticated", appUserId: otherViewerId }, projectA))
          .toMatchObject({ followerCount: 1, viewerFollowStatus: "none" });
        expect(await service.overview({ kind: "authenticated", appUserId: ownerId }, projectA))
          .toMatchObject({ followerCount: 1, viewerFollowStatus: "self" });
        await client.query("RESET ROLE");
        expect((await client.query("SELECT 1 FROM user_relationships WHERE source_user_id=$1 AND target_user_id=$2", [viewerId, ownerId])).rowCount)
          .toBe(0);
        // A retained profile permission must not silently subscribe the second renovation.
        await client.query("INSERT INTO user_relationships(source_user_id,target_user_id,kind,status,decided_at) VALUES($1,$2,'follow','active',now())", [viewerId, ownerId]);
        await asWeb();
        const feed = await service.following(viewer, {});
        expect(feed.projects.map((project) => project.id)).toEqual([projectA]);
        expect(feed.activity.map((item) => item.project.id)).toEqual([projectA]);
        expect(() => followingFeedResponseSchema.parse({ data: feed, meta: { requestId: randomUUID() } })).not.toThrow();

        await expect(service.setProjectFollow(viewer, sharedProject, true))
          .rejects.toMatchObject({ reason: "PROJECT_NOT_FOUND" });
        await expect(service.setProjectFollow(sharedViewer, sharedProject, true))
          .resolves.toEqual({ state: "following", replayed: false });
        expect((await service.following(viewer, {})).projects.map((project) => project.id)).toEqual([projectA]);
        expect((await service.following(sharedViewer, {})).projects.map((project) => project.id).sort())
          .toEqual([projectA, sharedProject].sort());

        await client.query("RESET ROLE");
        await client.query("UPDATE project_share_links SET revoked_at=now(),version=version+1 WHERE id=$1", [shareId]);
        await asWeb();
        await expect(service.overview(sharedViewer, sharedProject)).rejects.toMatchObject({ reason: "PROJECT_NOT_FOUND" });
        expect((await service.following(sharedViewer, {})).projects.map((project) => project.id)).toEqual([projectA]);
        await expect(service.setProjectFollow(sharedViewer, sharedProject, true)).rejects.toMatchObject({ reason: "PROJECT_NOT_FOUND" });
        await expect(service.setProjectFollow(viewer, sharedProject, false))
          .resolves.toEqual({ state: "none", replayed: false });
        await expect(service.setProjectFollow(viewer, sharedProject, false))
          .resolves.toEqual({ state: "none", replayed: true });

        const social = new PostgresSocialRepository(transaction);
        await social.blockProfile(viewerId, ownerId, new Date());
        expect(await service.following(viewer, {})).toEqual({ projects: [], activity: [] });
        await social.unblockProfile(viewerId, ownerId, new Date());
        expect(await service.overview(viewer, projectA)).toMatchObject({ viewerFollowStatus: "none", followerCount: 0 });
        expect(await service.following(viewer, {})).toEqual({ projects: [], activity: [] });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await client.end();
    }
  });
});

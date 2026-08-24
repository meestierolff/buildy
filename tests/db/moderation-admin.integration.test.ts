// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const describeWithDatabase = databaseUrl && webRole ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string, role: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Moderatiebeheer-tests mogen uitsluitend op een lokale tijdelijke testdatabase draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function receipt(id: string): string {
  return `MELD-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function seedAccount(
  client: Client,
  appUserId: string,
  authSubject: string,
  label: string,
): Promise<void> {
  await client.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [appUserId]);
  await client.query(`
    INSERT INTO auth_users (id, name, email, email_verified)
    VALUES ($1, $2, $3, true)
  `, [authSubject, label, `${label}@invalid.test`]);
  await client.query(`
    INSERT INTO auth_identity_mappings (
      app_user_id, auth_user_id, migration_status, linked_at
    ) VALUES ($1, $2, 'linked', statement_timestamp())
  `, [appUserId, authSubject]);
  await client.query(`
    INSERT INTO profiles (user_id, display_name, slug, is_private)
    VALUES ($1, $2, $3, false)
  `, [appUserId, label, `${label}-${appUserId.replaceAll("-", "")}`]);
}

async function seedReport(
  client: Client,
  reportId: string,
  targetType: "profile" | "project",
  targetId: string,
): Promise<void> {
  await client.query(`
    INSERT INTO moderation_reports (
      id, target_type, target_id, reason, urgency, status,
      details_ciphertext, target_snapshot_ciphertext, policy_version,
      source_fingerprint_hash, receipt_code
    ) VALUES (
      $1, $2, $3, 'privacy', 'high', 'open',
      'v1.1.encrypted-details', 'v1.1.encrypted-target-snapshot',
      'content-policy-test', $4, $5
    )
  `, [reportId, targetType, targetId, digest(`source:${reportId}`), receipt(reportId)]);
}

type ActionInput = {
  reportId: string;
  actionId: string;
  kind: "hide" | "restore" | "suspend" | "block";
  expectedVersion: number;
  replayKey: string;
  reverseActionId?: string;
};

async function applyAction(client: Client, input: ActionInput): Promise<{
  action_id: string;
  report_status: string;
  report_version: number;
  replayed: boolean;
}> {
  const requestHash = digest(JSON.stringify({
    reportId: input.reportId,
    kind: input.kind,
    expectedVersion: input.expectedVersion,
    reverseActionId: input.reverseActionId ?? null,
  }));
  const result = await client.query<{
    action_id: string;
    report_status: string;
    report_version: number;
    replayed: boolean;
  }>(`
    SELECT action_id, report_status::text, report_version, replayed
    FROM app_admin_apply_moderation_action(
      $1, $2, $3, 'v1.1.encrypted-moderator-reason', $4, $5, $6, $7, $8
    )
  `, [
    input.reportId,
    input.actionId,
    input.kind,
    `moderation-admin-command:v1:${digest(input.replayKey)}`,
    requestHash,
    input.expectedVersion,
    input.reverseActionId ?? null,
    randomUUID(),
  ]);
  return result.rows[0]!;
}

async function setWebActor(client: Client, role: string, actorId: string): Promise<void> {
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
}

describeWithDatabase("moderation admin PostgreSQL boundary", () => {
  it("keeps queue reads PII-free and makes hide/replay/restore authoritative across RLS", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const adminId = randomUUID();
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const projectId = randomUUID();
    const reportId = randomUUID();
    const hideActionId = randomUUID();
    const restoreActionId = randomUUID();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await seedAccount(client, adminId, `admin-${adminId}`, "moderation-admin");
      await seedAccount(client, ownerId, `owner-${ownerId}`, "moderation-owner");
      await seedAccount(client, viewerId, `viewer-${viewerId}`, "moderation-viewer");
      await client.query(`
        INSERT INTO app_role_grants (
          id, app_user_id, role, operator_reference, reason_code
        ) VALUES ($1, $2, 'admin', 'ci:moderation', 'integration_test')
      `, [randomUUID(), adminId]);
      await client.query(`
        INSERT INTO projects (id, owner_id, slug, title, visibility, published_at)
        VALUES ($1, $2, $3, 'Afgeschermd testproject', 'public', statement_timestamp())
      `, [projectId, ownerId, `moderation-${projectId.replaceAll("-", "")}`]);
      await client.query(`
        INSERT INTO project_private_details (
          project_id, owner_id, city_ciphertext, country_code
        ) VALUES ($1, $2, 'v1.1.encrypted-city', 'NL')
      `, [projectId, ownerId]);
      await seedReport(client, reportId, "project", projectId);

      await client.query("SELECT set_config('app.actor_id', $1, true)", [adminId]);
      const actor = await client.query<{ app_user_id: string; role: string }>(`
        SELECT app_user_id, role::text
        FROM app_resolve_moderation_actor($1)
      `, [`admin-${adminId}`]);
      expect(actor.rows[0]).toEqual({ app_user_id: adminId, role: "admin" });

      const queue = await client.query<{ payload: Record<string, unknown> }>(`
        SELECT to_jsonb(item) AS payload
        FROM app_admin_list_moderation_reports('open', NULL, NULL, NULL, NULL, 20) item
        WHERE item.id = $1
      `, [reportId]);
      expect(queue.rows[0]?.payload).toMatchObject({
        id: reportId,
        receipt_code: receipt(reportId),
        target_type: "project",
        target_id: projectId,
        target_hidden: false,
      });
      expect(queue.rows[0]?.payload).not.toHaveProperty("details_ciphertext");
      expect(queue.rows[0]?.payload).not.toHaveProperty("reporter_contact_ciphertext");

      const hidden = await applyAction(client, {
        reportId,
        actionId: hideActionId,
        kind: "hide",
        expectedVersion: 1,
        replayKey: `hide:${reportId}`,
      });
      expect(hidden).toMatchObject({
        action_id: hideActionId,
        report_status: "investigating",
        report_version: 2,
        replayed: false,
      });
      const replay = await applyAction(client, {
        reportId,
        actionId: hideActionId,
        kind: "hide",
        expectedVersion: 1,
        replayKey: `hide:${reportId}`,
      });
      expect(replay.replayed).toBe(true);
      expect((await client.query(
        "SELECT id FROM moderation_actions WHERE report_id = $1 AND kind = 'hide'",
        [reportId],
      )).rowCount).toBe(1);

      await setWebActor(client, webRole!, viewerId);
      expect((await client.query("SELECT id FROM projects WHERE id = $1", [projectId])).rowCount).toBe(0);
      await client.query("RESET ROLE");
      await setWebActor(client, webRole!, ownerId);
      expect((await client.query("SELECT id FROM projects WHERE id = $1", [projectId])).rowCount).toBe(0);
      expect((await client.query(
        "SELECT project_id FROM project_private_details WHERE project_id = $1",
        [projectId],
      )).rowCount).toBe(0);

      await client.query("RESET ROLE");
      await client.query("SELECT set_config('app.actor_id', $1, true)", [adminId]);
      const restored = await applyAction(client, {
        reportId,
        actionId: restoreActionId,
        kind: "restore",
        expectedVersion: 2,
        replayKey: `restore:${reportId}`,
        reverseActionId: hideActionId,
      });
      expect(restored).toMatchObject({ report_version: 3, replayed: false });

      await setWebActor(client, webRole!, viewerId);
      expect((await client.query("SELECT id FROM projects WHERE id = $1", [projectId])).rowCount).toBe(1);
      await client.query("RESET ROLE");
      await setWebActor(client, webRole!, ownerId);
      expect((await client.query("SELECT id FROM projects WHERE id = $1", [projectId])).rowCount).toBe(1);
      expect((await client.query(
        "SELECT project_id FROM project_private_details WHERE project_id = $1",
        [projectId],
      )).rowCount).toBe(1);

      await client.query("RESET ROLE");
      const audits = await client.query<{ action: string; metadata: Record<string, unknown> }>(`
        SELECT action, metadata FROM audit_events
        WHERE resource_id = $1 AND action LIKE 'moderation.action.%'
        ORDER BY created_at, id
      `, [reportId]);
      expect(audits.rows.map((row) => row.action)).toEqual([
        "moderation.action.hide",
        "moderation.action.restore",
      ]);
      expect(JSON.stringify(audits.rows)).not.toContain("encrypted-moderator-reason");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });

  it("deletes sessions and fails active-user resolution for suspension and blocking", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const adminId = randomUUID();
    const suspendedId = randomUUID();
    const blockedId = randomUUID();
    const suspendedSubject = `suspended-${suspendedId}`;
    const blockedSubject = `blocked-${blockedId}`;
    const suspendedReportId = randomUUID();
    const blockedReportId = randomUUID();
    const suspendActionId = randomUUID();
    const blockActionId = randomUUID();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await seedAccount(client, adminId, `admin-${adminId}`, "restriction-admin");
      await seedAccount(client, suspendedId, suspendedSubject, "restriction-suspended");
      await seedAccount(client, blockedId, blockedSubject, "restriction-blocked");
      await client.query(`
        INSERT INTO app_role_grants (
          id, app_user_id, role, operator_reference, reason_code
        ) VALUES ($1, $2, 'admin', 'ci:moderation', 'integration_test')
      `, [randomUUID(), adminId]);
      await client.query(`
        INSERT INTO auth_sessions (id, token, user_id, expires_at)
        VALUES
          ($1, $2, $3, statement_timestamp() + interval '1 hour'),
          ($4, $5, $6, statement_timestamp() + interval '1 hour')
      `, [
        `session-${suspendedId}`,
        `token-${suspendedId}`,
        suspendedSubject,
        `session-${blockedId}`,
        `token-${blockedId}`,
        blockedSubject,
      ]);
      await seedReport(client, suspendedReportId, "profile", suspendedId);
      await seedReport(client, blockedReportId, "profile", blockedId);
      await client.query("SELECT set_config('app.actor_id', $1, true)", [adminId]);

      await applyAction(client, {
        reportId: suspendedReportId,
        actionId: suspendActionId,
        kind: "suspend",
        expectedVersion: 1,
        replayKey: `suspend:${suspendedReportId}`,
      });
      await applyAction(client, {
        reportId: blockedReportId,
        actionId: blockActionId,
        kind: "block",
        expectedVersion: 1,
        replayKey: `block:${blockedReportId}`,
      });

      const restrictions = await client.query<{ app_user_id: string; kind: string }>(`
        SELECT app_user_id, kind::text FROM moderation_account_restrictions
        WHERE app_user_id = ANY($1::uuid[])
        ORDER BY app_user_id
      `, [[suspendedId, blockedId]]);
      expect(new Map(restrictions.rows.map((row) => [row.app_user_id, row.kind]))).toEqual(new Map([
        [suspendedId, "suspended"],
        [blockedId, "blocked"],
      ]));
      expect((await client.query(
        "SELECT id FROM auth_sessions WHERE user_id = ANY($1::text[])",
        [[suspendedSubject, blockedSubject]],
      )).rowCount).toBe(0);
      const resolved = await client.query<{ suspended: string | null; blocked: string | null }>(`
        SELECT
          app_resolve_active_user($1) AS suspended,
          app_resolve_active_user($2) AS blocked
      `, [suspendedSubject, blockedSubject]);
      expect(resolved.rows[0]).toEqual({ suspended: null, blocked: null });

      const audits = await client.query<{ action: string; metadata: Record<string, unknown> }>(`
        SELECT action, metadata FROM audit_events
        WHERE resource_id = ANY($1::uuid[])
        ORDER BY action
      `, [[suspendedReportId, blockedReportId]]);
      expect(audits.rows.map((row) => row.action)).toEqual([
        "moderation.action.block",
        "moderation.action.suspend",
      ]);
      expect(JSON.stringify(audits.rows)).not.toContain("encrypted-moderator-reason");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  });
});

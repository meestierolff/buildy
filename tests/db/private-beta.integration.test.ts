// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { Client, type QueryResult } from "pg";
import { describe, expect, it } from "vitest";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webRole = process.env.DATABASE_SECURITY_WEB_ROLE?.trim();
const webDatabaseUrl = process.env.DATABASE_SECURITY_WEB_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && webRole && webDatabaseUrl
  ? describe.sequential
  : describe.skip;

const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

interface ReservationRow {
  redemption_id: string;
  replayed: boolean;
  reservation_expires_at: Date;
}

interface CompletionRow {
  app_user_id: string;
  replayed: boolean;
}

interface IdentityFixture {
  appUserId: string;
  authUserId: string;
  email: string;
}

interface InviteFixture {
  code: string;
  codeHash: string;
  id: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertLocalDisposableDatabase(rawUrl: string, label: string): URL {
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (
    !new Set(["postgres:", "postgresql:"]).has(url.protocol)
    || !localHosts.has(url.hostname)
    || !/(?:test|tmp|ci)/i.test(databaseName)
  ) {
    throw new Error(
      `${label} mag uitsluitend naar een lokale tijdelijke PostgreSQL-testdatabase wijzen.`,
    );
  }
  return url;
}

function assertExactWebBoundary(adminUrl: string, runtimeUrl: string, role: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
  const admin = assertLocalDisposableDatabase(adminUrl, "DATABASE_SECURITY_TEST_URL");
  const web = assertLocalDisposableDatabase(runtimeUrl, "DATABASE_SECURITY_WEB_URL");
  if (admin.host !== web.host || admin.pathname !== web.pathname) {
    throw new Error("Admin- en web-URL moeten exact dezelfde databasehost en -naam gebruiken.");
  }
  if (decodeURIComponent(web.username) !== role) {
    throw new Error("DATABASE_SECURITY_WEB_URL moet als DATABASE_SECURITY_WEB_ROLE verbinden.");
  }
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(postgresCode(caught)).toBe(expectedCode);
}

async function createInvite(
  admin: Client,
  options: { emailHash?: string | null; maxUses?: number } = {},
): Promise<InviteFixture> {
  const id = randomUUID();
  const code = `buildy-beta-${randomUUID()}-secret`;
  const codeHash = sha256(code);
  const result = await admin.query<{ id: string }>(`
    SELECT id
    FROM public.app_create_beta_invite($1, $2, $3, $4, $5, $6, $7)
  `, [
    id,
    codeHash,
    options.emailHash ?? null,
    options.maxUses ?? 1,
    new Date(Date.now() + 24 * 60 * 60 * 1_000),
    "integration",
    `beta-test:${randomUUID()}`,
  ]);
  expect(result.rows).toEqual([{ id }]);
  return { code, codeHash, id };
}

async function createIdentity(admin: Client, requestedEmail?: string): Promise<IdentityFixture> {
  const appUserId = randomUUID();
  const authUserId = `beta-auth-${randomUUID()}`;
  const email = requestedEmail ?? `beta-${randomUUID()}@example.test`;
  await admin.query("INSERT INTO public.app_users (id, status) VALUES ($1, 'active')", [
    appUserId,
  ]);
  await admin.query(`
    INSERT INTO public.auth_users (id, name, email, email_verified)
    VALUES ($1, 'Beta integratietester', $2, true)
  `, [authUserId, email]);
  await admin.query(`
    INSERT INTO public.auth_identity_mappings (
      app_user_id, auth_user_id, migration_status, linked_at
    ) VALUES ($1, $2, 'linked', clock_timestamp())
  `, [appUserId, authUserId]);
  return { appUserId, authUserId, email };
}

function reservationInput(
  invite: InviteFixture,
  emailHash: string | null,
): {
  codeHash: string;
  emailHash: string | null;
  idempotencyKey: string;
  provider: "email" | "google";
  requestHash: string;
  token: string;
  tokenHash: string;
} {
  const token = `beta-reservation-${randomUUID()}`;
  const idempotencyKey = `beta-reservation:v1:${randomUUID()}`;
  return {
    codeHash: invite.codeHash,
    emailHash,
    idempotencyKey,
    provider: emailHash ? "email" : "google",
    requestHash: sha256(`${invite.codeHash}:${emailHash ?? "google"}:${idempotencyKey}`),
    token,
    tokenHash: sha256(token),
  };
}

async function reserve(
  web: Client,
  input: ReturnType<typeof reservationInput>,
): Promise<QueryResult<ReservationRow>> {
  return web.query<ReservationRow>(`
    SELECT * FROM public.app_reserve_beta_invite($1, $2, $3, $4, $5, $6)
  `, [
    input.codeHash,
    input.emailHash,
    input.tokenHash,
    input.provider,
    input.idempotencyKey,
    input.requestHash,
  ]);
}

async function complete(
  web: Client,
  input: ReturnType<typeof reservationInput>,
  identity: IdentityFixture,
  emailHash = sha256(identity.email),
): Promise<QueryResult<CompletionRow>> {
  return web.query<CompletionRow>(`
    SELECT * FROM public.app_complete_beta_signup($1, $2, $3, $4)
  `, [input.tokenHash, emailHash, identity.authUserId, input.provider]);
}

async function connectPair(): Promise<{ admin: Client; web: Client }> {
  assertExactWebBoundary(adminDatabaseUrl!, webDatabaseUrl!, webRole!);
  const admin = new Client({ connectionString: adminDatabaseUrl });
  const web = new Client({ connectionString: webDatabaseUrl });
  await Promise.all([admin.connect(), web.connect()]);
  await Promise.all([
    admin.query("SET statement_timeout = '10s'"),
    web.query("SET statement_timeout = '10s'"),
  ]);
  return { admin, web };
}

describeWithDatabase("private beta PostgreSQL boundaries", () => {
  it("uses the exact web host and RLS boundary without ever persisting a plaintext invite", async () => {
    const { admin, web } = await connectPair();
    try {
      const [adminTarget, webTarget] = await Promise.all([
        admin.query<{
          database_name: string;
          server_address: string;
          server_port: number;
        }>(`
          SELECT current_database() AS database_name,
            inet_server_addr()::text AS server_address,
            inet_server_port() AS server_port
        `),
        web.query<{
          beta_rls: boolean;
          current_role: string;
          database_name: string;
          product_events_rls: boolean;
          server_address: string;
          server_port: number;
        }>(`
          SELECT current_user AS current_role,
            current_database() AS database_name,
            inet_server_addr()::text AS server_address,
            inet_server_port() AS server_port,
            row_security_active('public.beta_invites'::regclass) AS beta_rls,
            row_security_active('public.product_events'::regclass) AS product_events_rls
        `),
      ]);
      expect(webTarget.rows[0]).toMatchObject({
        ...adminTarget.rows[0],
        beta_rls: true,
        current_role: webRole,
        product_events_rls: true,
      });

      const invite = await createInvite(admin);
      const input = reservationInput(invite, sha256("invite-owner@example.test"));
      expect((await reserve(web, input)).rows).toMatchObject([{ replayed: false }]);

      expect((await web.query(
        "SELECT id FROM public.beta_invites WHERE id = $1",
        [invite.id],
      )).rowCount).toBe(0);
      expect((await web.query(
        "SELECT id FROM public.beta_invite_redemptions WHERE invite_id = $1",
        [invite.id],
      )).rowCount).toBe(0);
      expect((await web.query("SELECT id FROM public.product_events LIMIT 1")).rowCount).toBe(0);

      await expectDatabaseError(
        web.query(`
          INSERT INTO public.beta_invites (
            id, code_hash, status, max_uses, use_count, expires_at
          ) VALUES ($1, $2, 'active', 1, 0, clock_timestamp() + interval '1 day')
        `, [randomUUID(), sha256("forged-code")]),
        "42501",
      );
      await expectDatabaseError(
        web.query(
          "SELECT * FROM public.app_create_beta_invite($1, $2, NULL, 1, $3, $4, $5)",
          [
            randomUUID(),
            sha256("web-owned-code"),
            new Date(Date.now() + 24 * 60 * 60 * 1_000),
            "integration",
            `web-test:${randomUUID()}`,
          ],
        ),
        "42501",
      );
      await expectDatabaseError(
        web.query("SELECT public.app_revoke_beta_invite($1, $2)", [
          invite.codeHash,
          `web-test:${randomUUID()}`,
        ]),
        "42501",
      );

      const columns = await admin.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'beta_invites'
      `);
      expect(columns.rows.map((row) => row.column_name)).toContain("code_hash");
      expect(columns.rows.map((row) => row.column_name)).not.toContain("code");
      const persisted = await admin.query(`
        SELECT
          (SELECT to_jsonb(invite) FROM public.beta_invites invite WHERE invite.id = $1) AS invite,
          (SELECT coalesce(jsonb_agg(to_jsonb(redemption)), '[]'::jsonb)
            FROM public.beta_invite_redemptions redemption WHERE redemption.invite_id = $1) AS redemptions,
          (SELECT coalesce(jsonb_agg(to_jsonb(event)), '[]'::jsonb)
            FROM public.audit_events event
            WHERE event.resource_id = $1
              OR event.resource_id IN (
                SELECT redemption.id
                FROM public.beta_invite_redemptions redemption
                WHERE redemption.invite_id = $1
              )) AS audit_events
      `, [invite.id]);
      const persistedText = JSON.stringify(persisted.rows);
      expect(persistedText).toContain(invite.codeHash);
      expect(persistedText).not.toContain(invite.code);
      expect(persistedText).not.toContain(input.token);
    } finally {
      await Promise.all([admin.end(), web.end()]);
    }
  });

  it("enforces expiry, email allowlisting, usage and exact idempotent replay", async () => {
    const { admin, web } = await connectPair();
    try {
      const allowedEmail = `allowed-${randomUUID()}@example.test`;
      const allowedEmailHash = sha256(allowedEmail);
      const invite = await createInvite(admin, { emailHash: allowedEmailHash });
      const wrongInput = reservationInput(invite, sha256("wrong@example.test"));
      expect((await reserve(web, wrongInput)).rowCount).toBe(0);

      const input = reservationInput(invite, allowedEmailHash);
      const reserved = await reserve(web, input);
      expect(reserved.rows).toMatchObject([{ replayed: false }]);
      const replayedReservation = await reserve(web, input);
      expect(replayedReservation.rows).toEqual([{
        ...reserved.rows[0]!,
        replayed: true,
      }]);

      await expectDatabaseError(
        reserve(web, {
          ...input,
          tokenHash: sha256("a-different-token"),
        }),
        "23505",
      );

      const identity = await createIdentity(admin, allowedEmail);
      expect((await complete(web, input, identity, sha256("wrong@example.test"))).rowCount).toBe(0);
      const completed = await complete(web, input, identity, allowedEmailHash);
      expect(completed.rows).toEqual([{ app_user_id: identity.appUserId, replayed: false }]);
      expect((await complete(web, input, identity, allowedEmailHash)).rows).toEqual([{
        app_user_id: identity.appUserId,
        replayed: true,
      }]);

      const spentInput = reservationInput(invite, allowedEmailHash);
      expect((await reserve(web, spentInput)).rowCount).toBe(0);
      expect((await admin.query(`
        SELECT status, use_count
        FROM public.beta_invites
        WHERE id = $1
      `, [invite.id])).rows).toEqual([{ status: "exhausted", use_count: 1 }]);

      const expiredInvite = await createInvite(admin);
      await admin.query(`
        UPDATE public.beta_invites
        SET expires_at = clock_timestamp() - interval '1 second'
        WHERE id = $1
      `, [expiredInvite.id]);
      expect((await reserve(web, reservationInput(expiredInvite, null))).rowCount).toBe(0);
    } finally {
      await Promise.all([admin.end(), web.end()]);
    }
  });

  it("serializes concurrent reservations and completions without over-redemption", async () => {
    assertExactWebBoundary(adminDatabaseUrl!, webDatabaseUrl!, webRole!);
    const admin = new Client({ connectionString: adminDatabaseUrl });
    const firstWeb = new Client({ connectionString: webDatabaseUrl });
    const secondWeb = new Client({ connectionString: webDatabaseUrl });
    await Promise.all([admin.connect(), firstWeb.connect(), secondWeb.connect()]);
    await Promise.all([
      admin.query("SET statement_timeout = '10s'"),
      firstWeb.query("SET statement_timeout = '10s'"),
      secondWeb.query("SET statement_timeout = '10s'"),
    ]);
    try {
      const invite = await createInvite(admin, { maxUses: 1 });
      const [firstIdentity, secondIdentity] = await Promise.all([
        createIdentity(admin),
        createIdentity(admin),
      ]);
      const firstInput = reservationInput(invite, null);
      const secondInput = reservationInput(invite, null);

      const reservations = await Promise.all([
        reserve(firstWeb, firstInput),
        reserve(secondWeb, secondInput),
      ]);
      expect(reservations.flatMap((result) => result.rows)).toHaveLength(2);
      expect(reservations.flatMap((result) => result.rows).every((row) => !row.replayed)).toBe(true);

      const completions = await Promise.all([
        complete(firstWeb, firstInput, firstIdentity),
        complete(secondWeb, secondInput, secondIdentity),
      ]);
      const completedRows = completions.flatMap((result) => result.rows);
      expect(completedRows).toHaveLength(1);
      expect(completedRows[0]?.replayed).toBe(false);

      const state = await admin.query<{
        completed_count: number;
        reserved_count: number;
        status: string;
        use_count: number;
      }>(`
        SELECT invite.status,
          invite.use_count,
          count(*) FILTER (WHERE redemption.status = 'completed')::integer AS completed_count,
          count(*) FILTER (WHERE redemption.status = 'reserved')::integer AS reserved_count
        FROM public.beta_invites invite
        JOIN public.beta_invite_redemptions redemption ON redemption.invite_id = invite.id
        WHERE invite.id = $1
        GROUP BY invite.id
      `, [invite.id]);
      expect(state.rows).toEqual([{
        completed_count: 1,
        reserved_count: 1,
        status: "exhausted",
        use_count: 1,
      }]);

      const winningAppUserId = completedRows[0]!.app_user_id;
      const winning = winningAppUserId === firstIdentity.appUserId
        ? { client: firstWeb, identity: firstIdentity, input: firstInput }
        : { client: secondWeb, identity: secondIdentity, input: secondInput };
      expect((await complete(winning.client, winning.input, winning.identity)).rows).toEqual([{
        app_user_id: winningAppUserId,
        replayed: true,
      }]);
    } finally {
      await Promise.all([admin.end(), firstWeb.end(), secondWeb.end()]);
    }
  });

  it("keeps an existing linked login usable without an invite or redemption", async () => {
    const { admin, web } = await connectPair();
    try {
      const identity = await createIdentity(admin);
      const candidateId = randomUUID();
      expect((await web.query<{ app_user_id: string }>(`
        SELECT public.app_resolve_active_user($1) AS app_user_id
      `, [identity.authUserId])).rows).toEqual([{ app_user_id: identity.appUserId }]);
      expect((await web.query<{ app_user_id: string }>(`
        SELECT public.app_provision_auth_identity($1, $2, true) AS app_user_id
      `, [identity.authUserId, candidateId])).rows).toEqual([{ app_user_id: identity.appUserId }]);

      const state = await admin.query<{
        candidate_count: number;
        last_authenticated_at: Date | null;
        redemption_count: number;
      }>(`
        SELECT app_user.last_authenticated_at,
          (SELECT count(*)::integer FROM public.app_users WHERE id = $2) AS candidate_count,
          (SELECT count(*)::integer
            FROM public.beta_invite_redemptions redemption
            WHERE redemption.app_user_id = app_user.id) AS redemption_count
        FROM public.app_users app_user
        WHERE app_user.id = $1
      `, [identity.appUserId, candidateId]);
      expect(state.rows[0]).toMatchObject({ candidate_count: 0, redemption_count: 0 });
      expect(state.rows[0]?.last_authenticated_at).toBeInstanceOf(Date);
    } finally {
      await Promise.all([admin.end(), web.end()]);
    }
  });

  it("allows only the client event vocabulary, rejects PII and remains append-only", async () => {
    const { admin, web } = await connectPair();
    try {
      const identity = await createIdentity(admin);
      const anonymousSubjectHash = sha256(`anonymous-${randomUUID()}`);
      const signupEventId = randomUUID();
      const errorEventId = randomUUID();
      const sharedEventId = randomUUID();
      const photobookEventId = randomUUID();

      const signup = await web.query<{
        accepted: boolean;
        replayed: boolean;
      }>(`
        SELECT * FROM public.app_record_client_product_event($1, $2, $3, $4::jsonb)
      `, [
        signupEventId,
        "signup_started",
        anonymousSubjectHash,
        JSON.stringify({ schemaVersion: 1, method: "email" }),
      ]);
      expect(signup.rows).toEqual([{ accepted: true, replayed: false }]);
      expect((await web.query(`
        SELECT * FROM public.app_record_client_product_event($1, $2, $3, $4::jsonb)
      `, [
        signupEventId,
        "signup_started",
        anonymousSubjectHash,
        JSON.stringify({ schemaVersion: 1, method: "email" }),
      ])).rows).toEqual([{ accepted: true, replayed: true }]);

      expect((await web.query(`
        SELECT * FROM public.app_record_client_product_event($1, $2, $3, $4::jsonb)
      `, [
        errorEventId,
        "error_encountered",
        anonymousSubjectHash,
        JSON.stringify({ schemaVersion: 1, category: "validation" }),
      ])).rows).toEqual([{ accepted: true, replayed: false }]);

      await web.query("SELECT set_config('app.actor_id', $1, false)", [identity.appUserId]);
      expect((await web.query(`
        SELECT * FROM public.app_record_client_product_event($1, $2, NULL, $3::jsonb)
      `, [
        sharedEventId,
        "project_shared",
        JSON.stringify({ schemaVersion: 1, visibility: "private" }),
      ])).rows).toEqual([{ accepted: true, replayed: false }]);
      expect((await web.query(`
        SELECT * FROM public.app_record_client_product_event($1, $2, NULL, $3::jsonb)
      `, [
        photobookEventId,
        "photobook_opened",
        JSON.stringify({ schemaVersion: 1 }),
      ])).rows).toEqual([{ accepted: true, replayed: false }]);

      const serverOnlyEvents = [
        "signup_completed",
        "onboarding_completed",
        "project_created",
        "first_update_created",
        "photo_upload_completed",
        "follow_requested",
        "follow_accepted",
        "comment_created",
        "photobook_draft_generated",
        "proof_generated",
        "proof_approved",
        "checkout_started",
        "checkout_completed",
        "feedback_submitted",
      ];
      for (const eventName of serverOnlyEvents) {
        await expectDatabaseError(
          web.query(`
            SELECT * FROM public.app_record_client_product_event($1, $2, NULL, $3::jsonb)
          `, [randomUUID(), eventName, JSON.stringify({ schemaVersion: 1 })]),
          "22023",
        );
      }

      const forbiddenProperties = [
        "accessToken",
        "address",
        "caption",
        "comment",
        "email",
        "name",
        "pdfPath",
        "photoUrl",
        "signedUrl",
      ];
      for (const property of forbiddenProperties) {
        await expectDatabaseError(
          web.query(`
            SELECT * FROM public.app_record_client_product_event($1, $2, NULL, $3::jsonb)
          `, [
            randomUUID(),
            "signup_started",
            JSON.stringify({ schemaVersion: 1, method: "email", [property]: "private" }),
          ]),
          "22023",
        );
      }

      const validEventIds = [signupEventId, errorEventId, sharedEventId, photobookEventId];
      expect((await web.query(`
        SELECT id FROM public.product_events
        WHERE event_key = ANY($1::text[])
      `, [validEventIds.map((id) => `product-event:client:${id}`)])).rowCount).toBe(0);
      await expectDatabaseError(
        web.query(`
          INSERT INTO public.product_events (event_name, event_key, subject_hash, properties)
          VALUES ('photobook_opened', $1, $2, '{"schemaVersion":1}'::jsonb)
        `, [`product-event:forged:${randomUUID()}`, anonymousSubjectHash]),
        "42501",
      );

      const stored = await admin.query<{
        event_name: string;
        id: string;
        properties: Record<string, unknown>;
        subject_hash: string;
      }>(`
        SELECT id, event_name, subject_hash, properties
        FROM public.product_events
        WHERE event_key = ANY($1::text[])
        ORDER BY event_name
      `, [validEventIds.map((id) => `product-event:client:${id}`)]);
      expect(stored.rows).toHaveLength(4);
      expect(stored.rows.map((row) => row.event_name).sort()).toEqual([
        "error_encountered",
        "photobook_opened",
        "project_shared",
        "signup_started",
      ]);
      for (const row of stored.rows) {
        for (const property of forbiddenProperties) {
          expect(Object.hasOwn(row.properties, property)).toBe(false);
        }
      }

      const eventId = stored.rows[0]!.id;
      await expectDatabaseError(
        admin.query(
          "UPDATE public.product_events SET occurred_at = occurred_at WHERE id = $1",
          [eventId],
        ),
        "55000",
      );
      await expectDatabaseError(
        admin.query("DELETE FROM public.product_events WHERE id = $1", [eventId]),
        "55000",
      );
    } finally {
      await Promise.all([admin.end(), web.end()]);
    }
  });
});

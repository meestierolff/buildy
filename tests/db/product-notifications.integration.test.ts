// @vitest-environment node

import { randomUUID } from "node:crypto";
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
    throw new Error("Productnotificatietests mogen alleen op een lokale tijdelijke database draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

async function resetDatabaseActor(client: Client): Promise<void> {
  await client.query("RESET ROLE");
  await client.query("SELECT set_config('app.actor_id', '', true)");
}

async function setWebActor(client: Client, role: string, actorId: string): Promise<void> {
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
}

async function hideModerationTarget(
  client: Client,
  moderatorId: string,
  targetType: "project" | "update",
  targetId: string,
): Promise<void> {
  const reportId = randomUUID();
  const actionId = randomUUID();
  await client.query(`
    INSERT INTO moderation_reports (id, reporter_id, target_type, target_id, reason)
    VALUES ($1, $2, $3, $4, 'integration_test')
  `, [reportId, moderatorId, targetType, targetId]);
  await client.query(`
    INSERT INTO moderation_actions (
      id, report_id, actor_id, kind, target_type, target_id, reason, actor_role
    ) VALUES ($1, $2, $3, 'hide', $4, $5, 'integration test', 'moderator')
  `, [actionId, reportId, moderatorId, targetType, targetId]);
  await client.query(`
    INSERT INTO moderation_target_states (
      target_type, target_id, state, current_action_id, hidden_at
    ) VALUES ($1, $2, 'hidden', $3, now())
  `, [targetType, targetId, actionId]);
}

describeWithDatabase("product notifications PostgreSQL boundary", () => {
  it("notifies only current eligible followers once and rechecks access on every read", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const ownerId = randomUUID();
    const followerId = randomUUID();
    const blockedFollowerId = randomUUID();
    const suspendedFollowerId = randomUUID();
    const moderatorId = randomUUID();
    const publicProjectId = randomUUID();
    const followersProjectId = randomUUID();
    const privateProjectId = randomUUID();
    const unlistedProjectId = randomUUID();
    const publicUpdateId = randomUUID();
    const followersUpdateId = randomUUID();
    const privateUpdateId = randomUUID();
    const unlistedUpdateId = randomUUID();
    const hiddenUpdateId = randomUUID();

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(`
        INSERT INTO app_users (id, status) VALUES
          ($1, 'active'), ($2, 'active'), ($3, 'active'),
          ($4, 'suspended'), ($5, 'active')
      `, [ownerId, followerId, blockedFollowerId, suspendedFollowerId, moderatorId]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Eigenaar', $6, false),
          ($2, 'Volger', $7, false),
          ($3, 'Geblokkeerde volger', $8, false),
          ($4, 'Geschorste volger', $9, false),
          ($5, 'Moderator', $10, true)
      `, [
        ownerId,
        followerId,
        blockedFollowerId,
        suspendedFollowerId,
        moderatorId,
        `product-owner-${ownerId.replaceAll("-", "")}`,
        `product-follower-${followerId.replaceAll("-", "")}`,
        `product-blocked-${blockedFollowerId.replaceAll("-", "")}`,
        `product-suspended-${suspendedFollowerId.replaceAll("-", "")}`,
        `product-moderator-${moderatorId.replaceAll("-", "")}`,
      ]);
      await client.query(`
        INSERT INTO user_relationships (
          source_user_id, target_user_id, kind, status, decided_at
        ) VALUES
          ($1, $4, 'follow', 'active', now()),
          ($2, $4, 'follow', 'active', now()),
          ($3, $4, 'follow', 'active', now()),
          ($2, $4, 'block', 'active', now())
      `, [followerId, blockedFollowerId, suspendedFollowerId, ownerId]);
      await client.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, published_at
        ) VALUES
          ($1, $5, $6, 'Openbaar', 'public', 'active', now()),
          ($2, $5, $7, 'Voor volgers', 'followers', 'active', now()),
          ($3, $5, $8, 'Privé', 'private', 'active', NULL),
          ($4, $5, $9, 'Met link', 'unlisted', 'active', now())
      `, [
        publicProjectId,
        followersProjectId,
        privateProjectId,
        unlistedProjectId,
        ownerId,
        `product-public-${publicProjectId.replaceAll("-", "")}`,
        `product-followers-${followersProjectId.replaceAll("-", "")}`,
        `product-private-${privateProjectId.replaceAll("-", "")}`,
        `product-unlisted-${unlistedProjectId.replaceAll("-", "")}`,
      ]);
      await hideModerationTarget(client, moderatorId, "update", hiddenUpdateId);
      await client.query(`
        INSERT INTO updates (
          id, project_id, project_owner_id, author_id, title,
          update_date, status, published_at
        ) VALUES
          ($1, $6, $5, $5, 'Concept wordt gepubliceerd', current_date, 'draft', NULL),
          ($2, $7, $5, $5, 'Alleen volgers', current_date, 'published', now()),
          ($3, $8, $5, $5, 'Privé', current_date, 'published', now()),
          ($4, $9, $5, $5, 'Alleen met link', current_date, 'published', now()),
          ($10, $6, $5, $5, 'Gemodereerd', current_date, 'published', now())
      `, [
        publicUpdateId,
        followersUpdateId,
        privateUpdateId,
        unlistedUpdateId,
        ownerId,
        publicProjectId,
        followersProjectId,
        privateProjectId,
        unlistedProjectId,
        hiddenUpdateId,
      ]);
      await client.query(`
        UPDATE updates
        SET status = 'published', published_at = now(), version = version + 1
        WHERE id = $1
      `, [publicUpdateId]);
      await client.query(`
        UPDATE updates
        SET title = 'Een gewone edit na publicatie', version = version + 1
        WHERE id = $1
      `, [publicUpdateId]);

      const created = await client.query<{
        actor_id: string | null;
        dedupe_key: string;
        order_id: string | null;
        payload: Record<string, unknown>;
        recipient_id: string;
        update_id: string;
      }>(`
        SELECT recipient_id, actor_id, update_id, order_id, dedupe_key, payload
        FROM notifications
        WHERE type = 'update.published'
          AND update_id = ANY($1::uuid[])
        ORDER BY update_id, recipient_id
      `, [[publicUpdateId, followersUpdateId, privateUpdateId, unlistedUpdateId, hiddenUpdateId]]);
      expect(created.rows).toHaveLength(2);
      expect(created.rows.map((row) => row.recipient_id)).toEqual([followerId, followerId]);
      expect(created.rows.map((row) => row.update_id).sort()).toEqual(
        [publicUpdateId, followersUpdateId].sort(),
      );
      for (const row of created.rows) {
        expect(row).toMatchObject({
          actor_id: ownerId,
          order_id: null,
          payload: { schemaVersion: 1 },
        });
        expect(row.dedupe_key).toMatch(
          /^product-notification:v2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(row.dedupe_key).not.toContain(row.recipient_id);
        expect(row.dedupe_key).not.toContain(ownerId);
      }
      const outbox = await client.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM outbox_events event
        JOIN notifications notification ON notification.id = event.aggregate_id
        WHERE notification.type = 'update.published'
          AND notification.update_id = ANY($1::uuid[])
          AND event.event_type = 'product.notification.created.v1'
          AND event.payload = '{"schemaVersion": 1}'::jsonb
      `, [[publicUpdateId, followersUpdateId, privateUpdateId, unlistedUpdateId, hiddenUpdateId]]);
      expect(outbox.rows[0]?.count).toBe(2);

      await setWebActor(client, webRole!, followerId);
      expect((await client.query(
        "SELECT id FROM notifications WHERE update_id = ANY($1::uuid[])",
        [[publicUpdateId, followersUpdateId]],
      )).rows)
        .toHaveLength(2);

      await resetDatabaseActor(client);
      await client.query("SAVEPOINT block_suppresses_existing_notifications");
      await client.query(`
        INSERT INTO user_relationships (
          source_user_id, target_user_id, kind, status, decided_at
        ) VALUES ($1, $2, 'block', 'active', now())
      `, [followerId, ownerId]);
      await setWebActor(client, webRole!, followerId);
      expect((await client.query(
        "SELECT id FROM notifications WHERE update_id = ANY($1::uuid[])",
        [[publicUpdateId, followersUpdateId]],
      )).rows)
        .toHaveLength(0);
      await resetDatabaseActor(client);
      await client.query("ROLLBACK TO SAVEPOINT block_suppresses_existing_notifications");

      await client.query("SAVEPOINT privacy_suppresses_existing_notification");
      await client.query(`
        UPDATE projects
        SET visibility = 'private', version = version + 1
        WHERE id = $1
      `, [publicProjectId]);
      await setWebActor(client, webRole!, followerId);
      expect((await client.query<{ update_id: string }>(`
        SELECT update_id FROM notifications
        WHERE update_id = ANY($1::uuid[])
      `, [[publicUpdateId, followersUpdateId]])).rows.map((row) => row.update_id))
        .toEqual([followersUpdateId]);
      await resetDatabaseActor(client);
      await client.query("ROLLBACK TO SAVEPOINT privacy_suppresses_existing_notification");

      await client.query("SAVEPOINT moderation_suppresses_existing_notification");
      await hideModerationTarget(client, moderatorId, "update", publicUpdateId);
      await setWebActor(client, webRole!, followerId);
      expect((await client.query<{ update_id: string }>(`
        SELECT update_id FROM notifications
        WHERE update_id = ANY($1::uuid[])
      `, [[publicUpdateId, followersUpdateId]])).rows.map((row) => row.update_id))
        .toEqual([followersUpdateId]);
      await resetDatabaseActor(client);
      await client.query("ROLLBACK TO SAVEPOINT moderation_suppresses_existing_notification");

      await client.query("SAVEPOINT account_erasure_suppresses_existing_notifications");
      await client.query(`
        UPDATE app_users
        SET status = 'deletion_pending', deletion_requested_at = now(),
          authz_version = authz_version + 1, version = version + 1
        WHERE id = $1
      `, [followerId]);
      await setWebActor(client, webRole!, followerId);
      expect((await client.query(
        "SELECT id FROM notifications WHERE update_id = ANY($1::uuid[])",
        [[publicUpdateId, followersUpdateId]],
      )).rows)
        .toHaveLength(0);
      await resetDatabaseActor(client);
      await client.query("ROLLBACK TO SAVEPOINT account_erasure_suppresses_existing_notifications");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });

  it("maps semantic order events exactly once without copying order PII", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const ownerId = randomUUID();
    const outsiderId = randomUUID();
    const projectId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const documentSha = "1".repeat(64);
    const pdfSha = "2".repeat(64);

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(
        "INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')",
        [ownerId, outsiderId],
      );
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private) VALUES
          ($1, 'Bouwboekklant', $3, true),
          ($2, 'Andere gebruiker', $4, true)
      `, [
        ownerId,
        outsiderId,
        `order-owner-${ownerId.replaceAll("-", "")}`,
        `order-outsider-${outsiderId.replaceAll("-", "")}`,
      ]);
      await client.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision
        ) VALUES ($1, $2, $3, 'Privé Bouwboek', 'private', 'active', 1)
      `, [projectId, ownerId, `product-order-${projectId.replaceAll("-", "")}`]);
      await client.query(`
        INSERT INTO media_assets (
          id, owner_id, project_id, purpose, status, bucket, object_key,
          upload_idempotency_key, claimed_content_type, detected_content_type,
          size_bytes, sha256, exif_stripped, ready_at
        ) VALUES (
          $1, $2, $3, 'photobook_pdf', 'ready', 'test-assets', $4,
          $5, 'application/pdf', 'application/pdf', 8192, $6, false, now()
        )
      `, [
        pdfAssetId,
        ownerId,
        projectId,
        `photobook-pdfs/${pdfAssetId}`,
        `product-order-pdf-${pdfAssetId}`,
        pdfSha,
      ]);
      const document = JSON.stringify({
        version: 1,
        selectedFormat: "a4-landscape-hardcover-v1",
        pageCount: 24,
        warnings: [],
      });
      await client.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES ($1, $2, $3, 'ready', 1, 1, $4::jsonb, $5, 24, 'a4-landscape-hardcover-v1')
      `, [draftId, projectId, ownerId, document, documentSha]);
      await client.query(`
        INSERT INTO photobook_revisions (
          id, draft_id, project_id, owner_id, revision_number, status,
          schema_version, project_revision, document, document_sha256,
          asset_set, asset_set_sha256, pdf_asset_id, pdf_sha256, pdf_size_bytes,
          page_count, render_engine, render_version, font_set_sha256,
          approved_by_id, approved_at
        ) VALUES (
          $1, $2, $3, $4, 1, 'approved', 1, 1, $5::jsonb, $6,
          '[]'::jsonb, $7, $8, $9, 8192, 24, 'buildy-pdfkit', 'integration-v1',
          $10, $4, now()
        )
      `, [
        revisionId,
        draftId,
        projectId,
        ownerId,
        document,
        documentSha,
        "3".repeat(64),
        pdfAssetId,
        pdfSha,
        "4".repeat(64),
      ]);
      await client.query(`
        INSERT INTO photobook_orders (
          id, order_number, merchant_reference, project_id, owner_id,
          proof_revision_id, idempotency_key, status, payment_status,
          fulfilment_status, currency, quantity, subtotal_minor, shipping_minor,
          tax_minor, total_minor, shipping_country, customer_email_ciphertext,
          shipping_details_ciphertext, pii_encryption_key_version,
          checkout_snapshot, seller_snapshot, terms_version, legal_accepted_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'awaiting_payment', 'unpaid', 'unclaimed',
          'EUR', 1, 5000, 695, 1055, 6750, 'NL', 'v1.1.private-email',
          'v1.1.private-shipping-address', 1,
          '{"schemaVersion":1,"projectTitle":"Geheim huis"}'::jsonb,
          '{"legalName":"Buildy test B.V."}'::jsonb, 'terms-test-v1', now()
        )
      `, [
        orderId,
        `BLD-NOTIFY-${orderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
        `buildy:${orderId}`,
        projectId,
        ownerId,
        revisionId,
        `product-order-checkout-${orderId}`,
      ]);

      const semanticEvents: Array<[string, Record<string, unknown>]> = [
        ["order.payment_succeeded.v1", { outcome: "paid" }],
        ["order.payment_failed.v1", { outcome: "payment_failed" }],
        ["order.checkout_expired.v1", { outcome: "expired" }],
        ["order.checkout_reservation_expired.v1", { outcome: "expired" }],
        ["order.refund_recorded.v1", { outcome: "partially_refunded" }],
        ["order.refund_recorded.v1", { outcome: "refunded" }],
        ["order.payment_succeeded_manual_review.v1", { outcome: "manual_review" }],
        ["order.stripe_reconciliation_failed.v1", { outcome: "manual_review" }],
        ["order.refund_reconciliation_failed.v1", { outcome: "manual_review" }],
        ["order.refund_out_of_order.v1", { outcome: "manual_review" }],
        ["manual_fulfilment.manual_review.v1", { schemaVersion: 1 }],
        ["manual_fulfilment.ordered_manually.v1", { schemaVersion: 1 }],
        ["manual_fulfilment.mark_in_production.v1", { schemaVersion: 1 }],
        ["manual_fulfilment.mark_shipped.v1", { schemaVersion: 1 }],
        ["manual_fulfilment.mark_completed.v1", { schemaVersion: 1 }],
        ["manual_fulfilment.cancel.v1", { schemaVersion: 1 }],
        ["manual_fulfilment.refund_review.v1", { schemaVersion: 1 }],
      ];
      const ignoredEvents: Array<[string, Record<string, unknown>]> = [
        ["order.payment_processing.v1", { outcome: "processing" }],
        ["order.stripe_event_ignored.v1", { outcome: "ignored" }],
        ["manual_fulfilment.update_details.v1", { schemaVersion: 1 }],
      ];
      for (const [eventType, payload] of [...semanticEvents, ...ignoredEvents]) {
        const eventId = randomUUID();
        await client.query(`
          INSERT INTO photobook_order_events (
            id, order_id, source, event_type, idempotency_key, payload_summary
          ) VALUES ($1, $2, 'system', $3, $4, $5::jsonb)
        `, [eventId, orderId, eventType, `product-notification-event:${eventId}`, JSON.stringify(payload)]);
      }

      const notifications = await client.query<{
        actor_id: string | null;
        dedupe_key: string;
        order_id: string;
        payload: Record<string, unknown>;
        type: string;
      }>(`
        SELECT type, actor_id, order_id, dedupe_key, payload
        FROM notifications
        WHERE order_id = $1
        ORDER BY created_at, id
      `, [orderId]);
      expect(notifications.rows).toHaveLength(semanticEvents.length);
      expect(notifications.rows.map((row) => row.type)).toEqual(expect.arrayContaining([
        "order.payment.succeeded",
        "order.payment.failed",
        "order.payment.expired",
        "order.payment.partially_refunded",
        "order.payment.refunded",
        "order.manual_review",
        "order.fulfilment.ordered",
        "order.fulfilment.in_production",
        "order.fulfilment.shipped",
        "order.fulfilment.completed",
        "order.fulfilment.cancelled",
        "order.fulfilment.refund_review",
      ]));
      for (const row of notifications.rows) {
        expect(row).toMatchObject({
          actor_id: null,
          order_id: orderId,
          payload: { schemaVersion: 1 },
        });
        expect(row.dedupe_key).toMatch(/^product-notification:v2:[0-9a-f]{64}$/);
        expect(row.dedupe_key).not.toContain(ownerId);
        expect(JSON.stringify(row)).not.toMatch(
          /private-email|private-shipping-address|geheim huis|customer|shipping/i,
        );
      }
      expect(new Set(notifications.rows.map((row) => row.dedupe_key)).size)
        .toBe(semanticEvents.length);

      const outbox = await client.query<{ count: number }>(`
        SELECT count(*)::integer AS count
        FROM outbox_events event
        JOIN notifications notification ON notification.id = event.aggregate_id
        WHERE notification.order_id = $1
          AND event.aggregate_type = 'notification'
          AND event.event_type = 'product.notification.created.v1'
          AND event.payload = '{"schemaVersion": 1}'::jsonb
      `, [orderId]);
      expect(outbox.rows[0]?.count).toBe(semanticEvents.length);

      await setWebActor(client, webRole!, ownerId);
      expect((await client.query("SELECT id FROM notifications WHERE order_id = $1", [orderId])).rows)
        .toHaveLength(semanticEvents.length);
      await resetDatabaseActor(client);
      await setWebActor(client, webRole!, outsiderId);
      expect((await client.query("SELECT id FROM notifications WHERE order_id = $1", [orderId])).rows)
        .toHaveLength(0);
      await resetDatabaseActor(client);

      await client.query("SAVEPOINT owner_erasure_suppresses_order_notifications");
      await client.query(`
        UPDATE app_users
        SET status = 'deletion_pending', deletion_requested_at = now(),
          authz_version = authz_version + 1, version = version + 1
        WHERE id = $1
      `, [ownerId]);
      const suppressedEventId = randomUUID();
      await client.query(`
        INSERT INTO photobook_order_events (
          id, order_id, source, event_type, idempotency_key, payload_summary
        ) VALUES ($1, $2, 'system', 'order.payment_failed.v1', $3, '{"outcome":"payment_failed"}')
      `, [suppressedEventId, orderId, `product-notification-event:${suppressedEventId}`]);
      expect((await client.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM notifications WHERE order_id = $1
      `, [orderId])).rows[0]?.count).toBe(semanticEvents.length);
      await setWebActor(client, webRole!, ownerId);
      expect((await client.query("SELECT id FROM notifications WHERE order_id = $1", [orderId])).rows)
        .toHaveLength(0);
      await resetDatabaseActor(client);
      await client.query("ROLLBACK TO SAVEPOINT owner_erasure_suppresses_order_notifications");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

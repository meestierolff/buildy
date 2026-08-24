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
    throw new Error("Handmatige fulfilmenttests mogen alleen op een lokale tijdelijke database draaien.");
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new Error("DATABASE_SECURITY_WEB_ROLE bevat een ongeldige PostgreSQL-rolnaam.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function setWebActor(client: Client, role: string, actorId: string): Promise<void> {
  await client.query(`SET LOCAL ROLE "${role}"`);
  await client.query("SELECT set_config('app.actor_id', $1, true)", [actorId]);
}

describeWithDatabase("manual fulfilment PostgreSQL boundary", () => {
  it("queues paid proofs, enforces admin RBAC and records idempotent manual transitions", async () => {
    assertLocalDisposableDatabase(databaseUrl!, webRole!);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const adminId = randomUUID();
    const ownerId = randomUUID();
    const projectId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const requestId = randomUUID();
    const orderNumber = `BLD-MANUAL-${orderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    const pdfSha = "2".repeat(64);
    const documentSha = "1".repeat(64);
    const checkoutSnapshot = {
      schemaVersion: 1,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      projectTitle: "Handmatige printtest",
      pageCount: 24,
      personalisedProduct: true,
    };
    const sellerSnapshot = {
      legalName: "Buildy test B.V.",
      tradeName: "Buildy test",
      registrationNumber: "TEST-12345678",
      vatNumber: null,
      address: "TESTADRES — NIET BEZORGEN",
      countryCode: "NL",
      supportEmail: "support@example.test",
    };

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')", [
        adminId,
        ownerId,
      ]);
      await client.query(`
        INSERT INTO profiles (user_id, display_name, slug, is_private)
        VALUES
          ($1, 'Buildy beheer', $3, true),
          ($2, 'Bouwboekklant', $4, true)
      `, [
        adminId,
        ownerId,
        `manual-admin-${adminId.replaceAll("-", "")}`,
        `manual-owner-${ownerId.replaceAll("-", "")}`,
      ]);
      await client.query(`
        INSERT INTO app_role_grants (id, app_user_id, role, operator_reference, reason_code)
        VALUES ($1, $2, 'admin', 'ci:manual-fulfilment', 'integration_test')
      `, [randomUUID(), adminId]);
      await client.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status,
          content_revision, published_at
        ) VALUES ($1, $2, $3, 'Handmatige printtest', 'private', 'active', 1, now())
      `, [projectId, ownerId, `manual-print-${projectId.replaceAll("-", "")}`]);
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
        `manual-pdf-${pdfAssetId}`,
        pdfSha,
      ]);
      await client.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES ($1, $2, $3, 'ready', 1, 1, $4::jsonb, $5, 24, 'a4-landscape-hardcover-v1')
      `, [draftId, projectId, ownerId, JSON.stringify({
        version: 1,
        selectedFormat: "a4-landscape-hardcover-v1",
        pageCount: 24,
        warnings: [],
      }), documentSha]);
      await client.query(`
        INSERT INTO photobook_revisions (
          id, draft_id, project_id, owner_id, revision_number, status,
          schema_version, project_revision, document, document_sha256,
          asset_set, asset_set_sha256, pdf_asset_id, pdf_sha256, pdf_size_bytes,
          page_count, render_engine, render_version, font_set_sha256,
          approved_by_id, approved_at, locked_at
        ) VALUES (
          $1, $2, $3, $4, 1, 'locked', 1, 1, $5::jsonb, $6,
          '[]'::jsonb, $7, $8, $9, 8192, 24, 'buildy-pdfkit', 'integration-v1',
          $10, $4, now(), now()
        )
      `, [
        revisionId,
        draftId,
        projectId,
        ownerId,
        JSON.stringify({
          version: 1,
          selectedFormat: "a4-landscape-hardcover-v1",
          pageCount: 24,
          warnings: [],
        }),
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
          checkout_snapshot, seller_snapshot, terms_version, legal_accepted_at,
          delivery_estimate, stripe_payment_intent_id, paid_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'paid', 'paid', 'unclaimed', 'EUR',
          1, 5000, 695, 1055, 6750, 'NL', 'v1.1.encrypted-email',
          'v1.1.encrypted-address', 1, $8::jsonb, $9::jsonb,
          'terms-integration-v1', now(), '5–8 werkdagen', $10, now()
        )
      `, [
        orderId,
        orderNumber,
        `buildy:${orderId}`,
        projectId,
        ownerId,
        revisionId,
        `manual-checkout-${orderId}`,
        JSON.stringify(checkoutSnapshot),
        JSON.stringify(sellerSnapshot),
        `pi_${orderId.replaceAll("-", "")}`,
      ]);

      await setWebActor(client, webRole!, ownerId);
      await client.query("SAVEPOINT ordinary_owner_denied");
      await expect(client.query(
        "SELECT * FROM app_admin_list_paid_orders('all', NULL, NULL, 20)",
      )).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT ordinary_owner_denied");

      await client.query("RESET ROLE");
      await setWebActor(client, webRole!, adminId);
      const queue = await client.query<{ order_id: string; fulfilment_state: string }>(`
        SELECT order_id, fulfilment_state
        FROM app_admin_list_paid_orders('all', NULL, NULL, 20)
        WHERE order_id = $1
      `, [orderId]);
      expect(queue.rows).toEqual([{ order_id: orderId, fulfilment_state: "awaiting_review" }]);

      const detail = await client.query<{ payload: Record<string, unknown> }>(`
        SELECT to_jsonb(item) AS payload FROM app_admin_load_paid_order($1) item
      `, [orderId]);
      expect(detail.rows[0]?.payload).toMatchObject({
        order_id: orderId,
        customer_email_ciphertext: "v1.1.encrypted-email",
        shipping_details_ciphertext: "v1.1.encrypted-address",
        pdf_sha256: pdfSha,
      });

      const idempotencyKey = `manual-fulfilment:v1:${digest(`review:${orderId}`)}`;
      const requestHash = digest(`review-request:${orderId}`);
      const applyReview = () => client.query<{
        fulfilment_state: string;
        order_version: number;
        replayed: boolean;
      }>(`
        SELECT fulfilment_state, order_version, replayed
        FROM app_admin_apply_manual_fulfilment(
          $1, 1, 'review', NULL, NULL, 'v1.1.encrypted-note', $2, $3, $4
        )
      `, [orderId, idempotencyKey, requestHash, requestId]);

      expect((await applyReview()).rows[0]).toEqual({
        fulfilment_state: "reviewed",
        order_version: 2,
        replayed: false,
      });
      expect((await applyReview()).rows[0]).toEqual({
        fulfilment_state: "reviewed",
        order_version: 2,
        replayed: true,
      });

      await client.query("SAVEPOINT missing_manual_reference");
      await expect(client.query(`
        SELECT * FROM app_admin_apply_manual_fulfilment(
          $1, 2, 'ordered_manually', NULL, NULL, NULL, $2, $3, $4
        )
      `, [
        orderId,
        `manual-fulfilment:v1:${digest(`missing-reference:${orderId}`)}`,
        digest(`missing-reference-request:${orderId}`),
        randomUUID(),
      ])).rejects.toMatchObject({ code: "55000" });
      await client.query("ROLLBACK TO SAVEPOINT missing_manual_reference");

      const ordered = await client.query<{ fulfilment_state: string; order_version: number }>(`
        SELECT fulfilment_state, order_version
        FROM app_admin_apply_manual_fulfilment(
          $1, 2, 'ordered_manually', 'PEECHO-MANUAL-TEST', NULL, NULL, $2, $3, $4
        )
      `, [
        orderId,
        `manual-fulfilment:v1:${digest(`ordered:${orderId}`)}`,
        digest(`ordered-request:${orderId}`),
        randomUUID(),
      ]);
      expect(ordered.rows[0]).toEqual({ fulfilment_state: "ordered_manually", order_version: 3 });

      await client.query("RESET ROLE");
      await client.query("SELECT set_config('app.actor_id', '', true)");
      await client.query(`
        UPDATE photobook_orders
        SET status = 'manual_review', payment_status = 'refunded',
          fulfilment_status = 'manual_review', refunded_minor = total_minor,
          version = version + 1, updated_at = statement_timestamp()
        WHERE id = $1
      `, [orderId]);
      const persisted = await client.query<{
        manual_fulfilment_status: string;
        refund_review_at: Date | null;
        event_count: number;
        audit_count: number;
      }>(`
        SELECT
          orders.manual_fulfilment_status::text,
          orders.refund_review_at,
          (SELECT count(*)::integer FROM photobook_order_events event
            WHERE event.order_id = orders.id AND event.source = 'admin') AS event_count,
          (SELECT count(*)::integer FROM audit_events audit
            WHERE audit.resource_id = orders.id AND audit.action LIKE 'order.manual_fulfilment.%') AS audit_count
        FROM photobook_orders orders
        WHERE orders.id = $1
      `, [orderId]);
      expect(persisted.rows[0]).toMatchObject({
        manual_fulfilment_status: "refund_review",
        event_count: 2,
        audit_count: 2,
      });
      expect(persisted.rows[0]?.refund_review_at).toBeInstanceOf(Date);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});

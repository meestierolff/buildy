// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createBuildyDatabase } from "../../server/db/client";
import { PostgresEmailWorkerRepository } from "../../server/email/postgresWorkerRepository";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const emailDatabaseUrl = process.env.DATABASE_SECURITY_EMAIL_WORKER_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && emailDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Ordermail-integratietests mogen uitsluitend op een lokale tijdelijke database draaien.");
  }
}

describeWithDatabase("order e-mail PostgreSQL boundary", () => {
  it("leases one PII-free intent and exposes encrypted context only to that lease", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(emailDatabaseUrl!);

    const ownerId = randomUUID();
    const projectId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const eventId = randomUUID();
    const documentHash = "1".repeat(64);
    const pdfHash = "2".repeat(64);
    const orderNumber = `BLD-EMAIL-${orderId.slice(0, 8).toUpperCase()}`;
    const idempotencyKey = `order:${orderId}:email:confirmation:v1`;
    const checkoutSnapshot = {
      schemaVersion: 1,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      projectTitle: "Ordermailintegratie",
      pageCount: 24,
      taxTreatment: "vat_included",
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

    const admin = new Client({ connectionString: adminDatabaseUrl });
    const resources = createBuildyDatabase(emailDatabaseUrl!, {
      applicationName: "buildy-order-email-integration",
      maxConnections: 1,
    });
    const repository = new PostgresEmailWorkerRepository(resources.database);
    await admin.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [ownerId]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision, published_at
        ) VALUES ($1, $2, $3, 'Ordermailintegratie', 'private', 'active', 1, now())
      `, [projectId, ownerId, `order-email-${projectId}`]);
      await admin.query(`
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
        `photobook-pdfs/${pdfAssetId.slice(0, 2)}/${pdfAssetId}`,
        `email-pdf-${pdfAssetId}`,
        pdfHash,
      ]);
      await admin.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES (
          $1, $2, $3, 'ready', 1, 1, $4::jsonb, $5, 24,
          'a4-landscape-hardcover-v1'
        )
      `, [
        draftId,
        projectId,
        ownerId,
        JSON.stringify({ version: 1, selectedFormat: "a4-landscape-hardcover-v1", pageCount: 24, warnings: [] }),
        documentHash,
      ]);
      await admin.query(`
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
        JSON.stringify({ version: 1, selectedFormat: "a4-landscape-hardcover-v1", pageCount: 24, warnings: [] }),
        documentHash,
        "3".repeat(64),
        pdfAssetId,
        pdfHash,
        "4".repeat(64),
      ]);
      await admin.query(`
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
          1, 4000, 695, 986, 5681, 'NL', $8, $9, 1, $10::jsonb,
          $11::jsonb, 'terms-integration-v1', now(), '5–8 werkdagen', $12, now()
        )
      `, [
        orderId,
        orderNumber,
        `buildy:${orderId}`,
        projectId,
        ownerId,
        revisionId,
        `checkout-${orderId}`,
        "v1.1.integration-encrypted-email",
        "v1.1.integration-encrypted-address",
        JSON.stringify(checkoutSnapshot),
        JSON.stringify(sellerSnapshot),
        `pi_${randomUUID().replaceAll("-", "")}`,
      ]);
      await admin.query(`
        INSERT INTO outbox_events (
          id, aggregate_type, aggregate_id, event_type, idempotency_key, payload
        ) VALUES (
          $1, 'photobook_order', $2, 'order.email.confirmation.requested.v1',
          $3, jsonb_build_object('schemaVersion', 1, 'orderId', $2::uuid)
        )
      `, [eventId, orderId, idempotencyKey]);

      await expect(resources.pool.query("select customer_email_ciphertext from photobook_orders"))
        .rejects.toThrow();
      await expect(repository.loadOrderEmailContext({
        eventId,
        leaseOwner: "wrong-lease-owner",
      })).resolves.toBeUndefined();

      const claimed = await repository.claim({
        batchSize: 25,
        leaseOwner: "email-integration-worker",
        leaseSeconds: 90,
      });
      expect(claimed).toContainEqual(expect.objectContaining({
        id: eventId,
        aggregateId: orderId,
        aggregateType: "photobook_order",
        idempotencyKey,
        payload: { schemaVersion: 1, orderId },
        attemptCount: 1,
      }));
      expect(JSON.stringify(claimed)).not.toContain("encrypted-email");

      const context = await repository.loadOrderEmailContext({
        eventId,
        leaseOwner: "email-integration-worker",
      });
      expect(context).toMatchObject({
        orderId,
        ownerId,
        orderNumber,
        customerEmailCiphertext: "v1.1.integration-encrypted-email",
        shippingDetailsCiphertext: "v1.1.integration-encrypted-address",
        totalMinor: 5681,
      });

      await expect(repository.prepareDelivery({
        eventId,
        leaseOwner: "email-integration-worker",
        idempotencyKey,
        recipientHash: "a".repeat(64),
        templateKey: "order.confirmation",
        templateVersion: "content-integration-v1",
      })).resolves.toMatchObject({ status: "queued" });
      await repository.complete({
        eventId,
        leaseOwner: "email-integration-worker",
        receipt: {
          provider: "brevo",
          messageId: `integration-${eventId}`,
          acceptedAt: new Date().toISOString(),
        },
      });

      const persisted = await admin.query<{
        recipient_user_id: string;
        metadata: Record<string, unknown>;
        delivery_status: string;
        outbox_status: string;
      }>(`
        SELECT
          delivery.recipient_user_id,
          delivery.metadata,
          delivery.status::text AS delivery_status,
          queued.status::text AS outbox_status
        FROM email_deliveries delivery
        JOIN outbox_events queued ON queued.id = delivery.outbox_event_id
        WHERE queued.id = $1
      `, [eventId]);
      expect(persisted.rows).toEqual([{
        recipient_user_id: ownerId,
        metadata: {},
        delivery_status: "submitted",
        outbox_status: "delivered",
      }]);
      await expect(repository.claim({
        batchSize: 1,
        leaseOwner: "email-integration-worker-replay",
        leaseSeconds: 90,
      })).resolves.not.toContainEqual(expect.objectContaining({ id: eventId }));
    } finally {
      await resources.pool.end();
      await admin.end();
    }
  });
});

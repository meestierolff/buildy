// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createBuildyDatabase } from "../../server/db/client";
import {
  PostgresStripePaymentEventRepository,
  type ApplyStripePaymentEventCommand,
} from "../../server/orders/paymentWebhook";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const paymentDatabaseUrl = process.env.DATABASE_SECURITY_PAYMENT_WORKER_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && paymentDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Stripe-integratietests mogen uitsluitend op een lokale tijdelijke database draaien.");
  }
}

describeWithDatabase("Stripe payment PostgreSQL boundary", () => {
  it("applies exact payment and monotonic refund events once through an isolated role", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(paymentDatabaseUrl!);

    const ownerId = randomUUID();
    const projectId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const orderNumber = `BLD-20260804-${orderId.slice(0, 10).replaceAll("-", "").toUpperCase()}`;
    const merchantReference = `buildy:${orderId}`;
    const checkoutSessionId = `cs_test_${orderId.replaceAll("-", "")}`;
    const paymentIntentId = `pi_${randomUUID().replaceAll("-", "")}`;
    const chargeId = `ch_${randomUUID().replaceAll("-", "")}`;
    const documentHash = "1".repeat(64);
    const pdfHash = "2".repeat(64);
    const totalMinor = 5_808;
    const now = new Date();
    const document = {
      version: 1,
      selectedFormat: "a4-landscape-hardcover-v1",
      pageCount: 24,
      warnings: [],
      sourceAssetIds: [],
      sourceAssets: [],
    };

    const admin = new Client({ connectionString: adminDatabaseUrl });
    const resources = createBuildyDatabase(paymentDatabaseUrl!, {
      applicationName: "buildy-stripe-integration",
      maxConnections: 1,
    });
    const repository = new PostgresStripePaymentEventRepository(resources.database);
    await admin.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [ownerId]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision, published_at
        ) VALUES ($1, $2, $3, 'Stripeproject', 'private', 'active', 1, now())
      `, [projectId, ownerId, `stripe-${projectId}`]);
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
        `stripe-pdf-${pdfAssetId}`,
        pdfHash,
      ]);
      await admin.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES ($1, $2, $3, 'ready', 1, 1, $4::jsonb, $5, 24, 'a4-landscape-hardcover-v1')
      `, [draftId, projectId, ownerId, JSON.stringify(document), documentHash]);
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
        JSON.stringify(document),
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
          fulfilment_status, currency, quantity, subtotal_minor,
          shipping_minor, tax_minor, total_minor, shipping_country,
          customer_email_ciphertext, shipping_details_ciphertext,
          pii_encryption_key_version, checkout_snapshot, seller_snapshot,
          terms_version, legal_accepted_at, stripe_checkout_session_id,
          stripe_checkout_expires_at, delivery_estimate
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          'checkout_open', 'unpaid', 'unclaimed', 'EUR', 1, 4000, 800, 1008, $8,
          'NL', 'v1.1.integration-email', 'v1.1.integration-address', 1,
          $9::jsonb, $10::jsonb, '2026-08-01', now(), $11, now() + interval '30 minutes',
          '5–8 werkdagen na productie'
        )
      `, [
        orderId,
        orderNumber,
        merchantReference,
        projectId,
        ownerId,
        revisionId,
        `stripe-checkout-${orderId}`,
        totalMinor,
        JSON.stringify({
          schemaVersion: 1,
          requestHash: "5".repeat(64),
          sku: "a4-landscape-hardcover-v1",
          format: "a4-landscape-hardcover-v1",
          projectTitle: "Stripeproject",
          pageCount: 24,
          documentSha256: documentHash,
          pdfSha256: pdfHash,
          unitAmountMinor: 4_000,
          quoteReference: "stripe-integration-quote",
          offeringId: "integration-a4",
          commercialApprovalId: "integration-approved-v1",
          taxTreatment: "vat_exclusive",
          quoteExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
          personalisedProduct: true,
        }),
        JSON.stringify({ legalName: "Buildy testverkoper" }),
        checkoutSessionId,
      ]);

      await expect(resources.pool.query("select count(*) from public.photobook_orders"))
        .rejects.toThrow();

      const baseCommand: ApplyStripePaymentEventCommand = {
        applicationEnvironment: "test",
        providerEnvironment: "test",
        providerEventId: "evt_buildy_payment_exact_1",
        eventType: "checkout.session.completed",
        eventAt: now,
        orderId,
        orderNumber,
        merchantReference,
        objectId: checkoutSessionId,
        checkoutSessionId,
        paymentIntentId,
        paymentStatus: "paid",
        amountTotalMinor: totalMinor,
        amountRefundedMinor: null,
        currency: "EUR",
        payloadSha256: "6".repeat(64),
      };

      await expect(repository.apply(baseCommand)).resolves.toMatchObject({
        applied: true,
        orderId,
        outcome: "paid",
      });
      await expect(repository.apply(baseCommand)).resolves.toMatchObject({
        applied: false,
        orderId,
        outcome: "duplicate",
      });

      await expect(repository.apply({
        ...baseCommand,
        providerEventId: "evt_buildy_payment_late_failure_1",
        eventType: "checkout.session.async_payment_failed",
        paymentStatus: "unpaid",
        payloadSha256: "7".repeat(64),
      })).resolves.toMatchObject({ applied: false, outcome: "ignored" });

      await expect(repository.apply({
        ...baseCommand,
        providerEventId: "evt_buildy_refund_partial_1",
        eventType: "charge.refunded",
        objectId: chargeId,
        checkoutSessionId: null,
        amountRefundedMinor: 1_000,
        payloadSha256: "8".repeat(64),
      })).resolves.toMatchObject({ applied: true, outcome: "partially_refunded" });

      await expect(repository.apply({
        ...baseCommand,
        providerEventId: "evt_buildy_refund_stale_1",
        eventType: "charge.refunded",
        objectId: chargeId,
        checkoutSessionId: null,
        amountRefundedMinor: 500,
        payloadSha256: "9".repeat(64),
      })).resolves.toMatchObject({ applied: false, outcome: "ignored" });

      await expect(repository.apply({
        ...baseCommand,
        providerEventId: "evt_buildy_refund_full_1",
        eventType: "charge.refunded",
        objectId: chargeId,
        checkoutSessionId: null,
        amountRefundedMinor: totalMinor,
        payloadSha256: "a".repeat(64),
      })).resolves.toMatchObject({ applied: true, outcome: "refunded" });

      const persisted = await admin.query<{
        status: string;
        payment_status: string;
        fulfilment_status: string;
        refunded_minor: number;
        stripe_payment_intent_id: string;
        stripe_charge_id: string;
        event_count: string;
        inbox_count: string;
        outbox_count: string;
      }>(`
        SELECT
          orders.status,
          orders.payment_status,
          orders.fulfilment_status,
          orders.refunded_minor,
          orders.stripe_payment_intent_id,
          orders.stripe_charge_id,
          (SELECT count(*)::text FROM photobook_order_events event WHERE event.order_id = orders.id) AS event_count,
          (SELECT count(*)::text FROM provider_event_inbox inbox WHERE inbox.reference = orders.id::text) AS inbox_count,
          (SELECT count(*)::text FROM outbox_events event WHERE event.aggregate_id = orders.id) AS outbox_count
        FROM photobook_orders orders
        WHERE orders.id = $1
      `, [orderId]);

      expect(persisted.rows).toEqual([expect.objectContaining({
        status: "manual_review",
        payment_status: "refunded",
        fulfilment_status: "manual_review",
        refunded_minor: totalMinor,
        stripe_payment_intent_id: paymentIntentId,
        stripe_charge_id: chargeId,
        event_count: "5",
        inbox_count: "5",
        outbox_count: "5",
      })]);
    } finally {
      await resources.pool.end();
      await admin.end();
    }
  });
});

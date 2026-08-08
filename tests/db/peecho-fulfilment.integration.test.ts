// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { createBuildyDatabase } from "../../server/db/client";
import { PostgresPeechoFulfilmentRepository } from "../../server/fulfilment/repository";
import type { MappedPrintStatus, VerifiedPrintCallback } from "../../server/print/printProvider";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const workerDatabaseUrl = process.env.DATABASE_SECURITY_FULFILMENT_WORKER_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && workerDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Peecho-integratietests mogen uitsluitend op een lokale tijdelijke database draaien.");
  }
}

function status(providerStatus: string, mappedStatus: MappedPrintStatus["status"]): MappedPrintStatus {
  return {
    providerStatus,
    status: mappedStatus,
    known: mappedStatus !== "unknown",
    terminal: ["shipped", "cancelled", "refunded"].includes(mappedStatus),
  };
}

describeWithDatabase("Peecho fulfilment PostgreSQL boundary", () => {
  it("leases, persists create before pay, reconciles retry, and applies callbacks monotonically", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(workerDatabaseUrl!);

    const ownerId = randomUUID();
    const projectId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const orderNumber = `BLD-20260804-${orderId.slice(0, 10).replaceAll("-", "").toUpperCase()}`;
    const merchantReference = `buildy:${orderId}`;
    const documentHash = "1".repeat(64);
    const pdfHash = "2".repeat(64);
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
    const resources = createBuildyDatabase(workerDatabaseUrl!, {
      applicationName: "buildy-peecho-integration",
      maxConnections: 1,
    });
    const repository = new PostgresPeechoFulfilmentRepository(resources.database);
    await admin.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active')", [ownerId]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision, published_at
        ) VALUES ($1, $2, $3, 'Peechoproject', 'private', 'active', 1, now())
      `, [projectId, ownerId, `peecho-${projectId}`]);
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
        `peecho-pdf-${pdfAssetId}`,
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
          stripe_checkout_expires_at, stripe_payment_intent_id, paid_at,
          delivery_estimate
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          'paid', 'paid', 'unclaimed', 'EUR', 1, 4000, 800, 1008, 5808,
          'NL', 'v1.1.integration-email', 'v1.1.integration-address', 1,
          $8::jsonb, $9::jsonb, '2026-08-01', now(), $10,
          now() + interval '30 minutes', $11, now(), '5–8 werkdagen na productie'
        )
      `, [
        orderId,
        orderNumber,
        merchantReference,
        projectId,
        ownerId,
        revisionId,
        `peecho-checkout-${orderId}`,
        JSON.stringify({
          schemaVersion: 1,
          requestHash: "5".repeat(64),
          sku: "a4-landscape-hardcover-v1",
          format: "a4-landscape-hardcover-v1",
          projectTitle: "Peechoproject",
          pageCount: 24,
          documentSha256: documentHash,
          pdfSha256: pdfHash,
          unitAmountMinor: 4_000,
          quoteReference: "peecho-integration-quote",
          offeringId: "233309",
          commercialApprovalId: "peecho-integration-approved-v1",
          taxTreatment: "vat_exclusive",
          quoteExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
          personalisedProduct: true,
        }),
        JSON.stringify({ legalName: "Buildy testverkoper" }),
        `cs_test_${orderId.replaceAll("-", "")}`,
        `pi_${randomUUID().replaceAll("-", "")}`,
      ]);

      await expect(resources.pool.query("select count(*) from public.photobook_orders"))
        .rejects.toThrow();

      const firstClaim = await repository.claimNext("peecho-worker:test:first", "test", 300);
      expect(firstClaim).toMatchObject({ orderId });
      const createJob = await repository.begin(firstClaim!, "test");
      expect(createJob).toMatchObject({
        orderId,
        phase: "create",
        offeringId: "233309",
        pdfBucket: "test-assets",
        pdfSha256: pdfHash,
      });
      await repository.beginCreate(createJob!);
      await repository.persistCreated(createJob!, {
        providerOrderId: "9001",
        merchantReference,
        status: status("OPEN", "awaiting_payment"),
      });
      await expect(repository.beginCreate(createJob!)).rejects.toMatchObject({
        code: "WORKER_LEASE_LOST",
      });

      const createdJob = { ...createJob!, providerOrderId: "9001" };
      await repository.beginPayment(createdJob);
      await repository.scheduleRetry(firstClaim!, "PEECHO_PAYMENT_TIMEOUT", 1, false);
      await admin.query(`
        UPDATE photobook_orders
        SET next_retry_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1
      `, [orderId]);

      const retryClaim = await repository.claimNext("peecho-worker:test:retry", "test", 300);
      expect(retryClaim).toMatchObject({ orderId });
      const reconcileJob = await repository.begin(retryClaim!, "test");
      expect(reconcileJob).toMatchObject({
        phase: "reconcile_payment",
        providerOrderId: "9001",
      });
      const reconciled = { ...reconcileJob!, providerOrderId: "9001" };
      await expect(repository.finalizeProviderStatus(reconciled, "OPEN")).resolves.toBe("payment_required");
      await repository.beginPayment(reconciled);
      await expect(repository.finalizeProviderStatus(reconciled, "PAID")).resolves.toBe("submitted");

      const callback = (input: Partial<VerifiedPrintCallback> & Pick<VerifiedPrintCallback, "eventKey" | "newStatus">) => repository.recordCallback({
        inboxEnvironment: "test",
        providerEnvironment: "test",
        event: {
          eventKey: input.eventKey,
          providerOrderId: "9001",
          merchantReference,
          oldStatus: input.oldStatus ?? status("PAID", "paid"),
          newStatus: input.newStatus,
          trackingCode: input.trackingCode ?? null,
          trackingUrl: input.trackingUrl ?? null,
          verifiedAt: input.verifiedAt ?? now.toISOString(),
        },
      });

      const productionEvent = {
        eventKey: "6".repeat(64),
        newStatus: status("IN_PRODUCTION", "in_production"),
      };
      await expect(callback(productionEvent)).resolves.toEqual({
        replayed: false,
        applied: true,
        outcome: "applied",
      });
      await expect(callback(productionEvent)).resolves.toEqual({
        replayed: true,
        applied: false,
        outcome: "applied",
      });
      await expect(callback({
        eventKey: "7".repeat(64),
        newStatus: status("PAID", "paid"),
      })).resolves.toMatchObject({ applied: false, outcome: "ignored_out_of_order" });
      await expect(callback({
        eventKey: "8".repeat(64),
        newStatus: status("SHIPPED", "shipped"),
        trackingCode: "TRACK-9001",
        trackingUrl: "https://carrier.example/track/TRACK-9001",
      })).resolves.toMatchObject({ applied: true, outcome: "applied" });
      await expect(callback({
        eventKey: "9".repeat(64),
        newStatus: status("FUTURE_STATE", "unknown"),
      })).resolves.toMatchObject({ applied: true, outcome: "manual_review" });

      await admin.query(`
        UPDATE photobook_orders
        SET payment_status = 'refunded', refunded_minor = total_minor,
          version = version + 1, updated_at = now()
        WHERE id = $1
      `, [orderId]);
      await expect(callback({
        eventKey: "a".repeat(64),
        newStatus: status("SHIPPED", "shipped"),
      })).resolves.toMatchObject({ outcome: "manual_review" });

      const persisted = await admin.query<{
        status: string;
        payment_status: string;
        fulfilment_status: string;
        peecho_order_id: string;
        peecho_status: string;
        tracking_code: string;
        tracking_url: string;
        inbox_count: string;
        in_production_email_count: string;
        shipped_email_count: string;
      }>(`
        SELECT
          orders.status, orders.payment_status, orders.fulfilment_status,
          orders.peecho_order_id, orders.peecho_status,
          orders.tracking_code, orders.tracking_url,
          (SELECT count(*)::text FROM provider_event_inbox inbox
            WHERE inbox.provider = 'peecho' AND inbox.reference = orders.merchant_reference) AS inbox_count,
          (SELECT count(*)::text FROM outbox_events event
            WHERE event.aggregate_id = orders.id AND event.event_type = 'order.email.in_production.requested.v1') AS in_production_email_count,
          (SELECT count(*)::text FROM outbox_events event
            WHERE event.aggregate_id = orders.id AND event.event_type = 'order.email.shipped.requested.v1') AS shipped_email_count
        FROM photobook_orders orders
        WHERE orders.id = $1
      `, [orderId]);

      expect(persisted.rows).toEqual([expect.objectContaining({
        status: "manual_review",
        payment_status: "refunded",
        fulfilment_status: "manual_review",
        peecho_order_id: "9001",
        peecho_status: "SHIPPED",
        tracking_code: "TRACK-9001",
        tracking_url: "https://carrier.example/track/TRACK-9001",
        inbox_count: "5",
        in_production_email_count: "1",
        shipped_email_count: "1",
      })]);
    } finally {
      await resources.pool.end();
      await admin.end();
    }
  });
});

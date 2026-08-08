// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createBuildyDatabase } from "../../server/db/client";
import { PostgresOrderRepository } from "../../server/orders/repository";

const adminDatabaseUrl = process.env.DATABASE_SECURITY_TEST_URL?.trim();
const webDatabaseUrl = process.env.DATABASE_SECURITY_WEB_URL?.trim();
const describeWithDatabase = adminDatabaseUrl && webDatabaseUrl ? describe : describe.skip;

function assertLocalDisposableDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!localHosts.has(url.hostname) || !/(?:test|tmp|ci)/i.test(databaseName)) {
    throw new Error("Checkout-integratietests mogen uitsluitend op een lokale tijdelijke database draaien.");
  }
}

describeWithDatabase("photobook checkout PostgreSQL boundary", () => {
  it("locks one approved proof and persists an immutable owner-scoped checkout snapshot", async () => {
    assertLocalDisposableDatabase(adminDatabaseUrl!);
    assertLocalDisposableDatabase(webDatabaseUrl!);

    const ownerId = randomUUID();
    const strangerId = randomUUID();
    const projectId = randomUUID();
    const pdfAssetId = randomUUID();
    const draftId = randomUUID();
    const revisionId = randomUUID();
    const orderId = randomUUID();
    const authUserId = `checkout-auth-${randomUUID()}`;
    const documentHash = "6".repeat(64);
    const pdfHash = "7".repeat(64);
    const requestHash = "8".repeat(64);
    const now = new Date("2026-08-04T12:00:00.000Z");
    const document = {
      version: 1,
      selectedFormat: "a4-landscape-hardcover-v1",
      pageCount: 24,
      warnings: [],
      sourceAssetIds: [],
      sourceAssets: [],
    };

    const admin = new Client({ connectionString: adminDatabaseUrl });
    const resources = createBuildyDatabase(webDatabaseUrl!, {
      applicationName: "buildy-order-integration",
      maxConnections: 2,
    });
    const repository = new PostgresOrderRepository(resources.database);
    await admin.connect();

    try {
      await admin.query("INSERT INTO app_users (id, status) VALUES ($1, 'active'), ($2, 'active')", [
        ownerId,
        strangerId,
      ]);
      await admin.query(`
        INSERT INTO auth_users (id, name, email, email_verified)
        VALUES ($1, 'Checkout eigenaar', 'checkout-owner@example.test', true)
      `, [authUserId]);
      await admin.query(`
        INSERT INTO auth_identity_mappings (
          app_user_id, auth_user_id, migration_status, linked_at
        ) VALUES ($1, $2, 'linked', now())
      `, [ownerId, authUserId]);
      await admin.query(`
        INSERT INTO projects (
          id, owner_id, slug, title, visibility, lifecycle_status, content_revision, published_at
        ) VALUES ($1, $2, $3, 'Checkoutproject', 'public', 'active', 1, now())
      `, [projectId, ownerId, `checkout-${projectId}`]);
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
        `checkout-pdf-${pdfAssetId}`,
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
        JSON.stringify(document),
        documentHash,
        "9".repeat(64),
        pdfAssetId,
        pdfHash,
        "a".repeat(64),
      ]);

      const proof = await repository.loadCheckoutProof(ownerId, revisionId);
      expect(proof).toMatchObject({
        projectId,
        revisionId,
        status: "approved",
        documentSha256: documentHash,
        pdfSha256: pdfHash,
        pageCount: 24,
        customerEmail: "checkout-owner@example.test",
      });
      expect(await repository.loadCheckoutProof(strangerId, revisionId)).toBeNull();

      const reservation = await repository.reserveCheckout({
        orderId,
        orderNumber: `BLD-20260804-${orderId.slice(0, 10).replaceAll("-", "").toUpperCase()}`,
        merchantReference: `buildy:${orderId}`,
        actorId: ownerId,
        projectId,
        projectTitle: "Checkoutproject",
        proofRevisionId: revisionId,
        documentSha256: documentHash,
        pdfSha256: pdfHash,
        sku: "a4-landscape-hardcover-v1",
        format: "a4-landscape-hardcover-v1",
        pageCount: 24,
        quantity: 1,
        destinationCountry: "NL",
        unitAmountMinor: 4_000,
        amounts: {
          currency: "EUR",
          subtotalMinor: 4_000,
          shippingMinor: 800,
          taxMinor: 1_008,
          totalMinor: 5_808,
        },
        deliveryEstimate: "5–8 werkdagen na productie",
        termsVersion: "2026-08-01",
        customerEmail: "checkout-owner@example.test",
        requestHash,
        idempotencyKey: "b".repeat(64),
        quoteReference: "integration-quote-1",
        offeringId: "integration-offering-a4",
        commercialApprovalId: "integration-approved-price-v1",
        taxTreatment: "vat_exclusive",
        pii: {
          customerEmailCiphertext: "v1.1.integration-email",
          shippingDetailsCiphertext: "v1.1.integration-address",
          encryptionKeyVersion: 1,
        },
        sellerSnapshot: {
          legalName: "Buildy Test B.V.",
          tradeName: "Buildy",
          registrationNumber: "TEST-ONLY",
          vatNumber: null,
          address: "Testadres",
          countryCode: "NL",
          supportEmail: "support@example.test",
        },
        shippingAddress: {
          firstName: "Mila",
          lastName: "Bouwer",
          addressLine1: "Teststraat 12",
          addressLine2: null,
          postalCode: "1234 AB",
          city: "Utrecht",
          state: null,
          countryCode: "NL",
        },
        reservedAt: now,
        quoteExpiresAt: new Date("2026-08-04T12:30:00.000Z"),
      });
      expect(reservation).toMatchObject({ orderId, proofRevisionId: revisionId, replayed: false });

      await repository.recordCheckoutSession({
        actorId: ownerId,
        orderId,
        sessionId: `cs_test_${orderId.replaceAll("-", "")}`,
        expiresAt: new Date("2026-08-04T12:20:00.000Z"),
        now,
      });
      const detail = await repository.getOrder(ownerId, orderId);
      expect(detail).toMatchObject({
        orderId,
        status: "checkout_open",
        paymentStatus: "unpaid",
        refundedMinor: 0,
        fulfilmentStatus: "unclaimed",
        totalMinor: undefined,
        amounts: { totalMinor: 5_808 },
      });
      expect(await repository.getOrder(strangerId, orderId)).toBeNull();

      const persisted = await admin.query<{
        proof_status: string;
        order_status: string;
        event_count: string;
      }>(`
        SELECT
          revision.status AS proof_status,
          orders.status AS order_status,
          (SELECT count(*)::text FROM photobook_order_events event WHERE event.order_id = orders.id) AS event_count
        FROM photobook_orders orders
        JOIN photobook_revisions revision ON revision.id = orders.proof_revision_id
        WHERE orders.id = $1
      `, [orderId]);
      expect(persisted.rows).toEqual([{
        proof_status: "locked",
        order_status: "checkout_open",
        event_count: "2",
      }]);
    } finally {
      await resources.pool.end();
      await admin.end();
    }
  });
});

// @vitest-environment node

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createBuildyDatabase } from "../../server/db/client";
import { PostgresOrderRepository } from "../../server/orders/repository";
import type { ReserveCheckoutCommand } from "../../server/orders/types";

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
        termsAccepted: true,
        customerEmail: "checkout-owner@example.test",
        requestHash,
        idempotencyKey: "b".repeat(64),
        quoteReference: "integration-quote-1",
        productReference: "buildy-a4-landscape-hardcover",
        priceVersion: "integration-approved-price-v1",
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

      const recoveredWithRenewedKey = await repository.findCheckoutReservation(
        ownerId,
        revisionId,
        "d".repeat(64),
      );
      expect(recoveredWithRenewedKey).toMatchObject({
        orderId,
        idempotencyKey: "b".repeat(64),
        productReference: "buildy-a4-landscape-hardcover",
        priceVersion: "integration-approved-price-v1",
        requestHashScheme: "blind-v2",
        replayed: true,
      });
      const reservedState = await admin.query<{
        proof_status: string;
        order_status: string;
        stripe_checkout_session_id: string | null;
      }>(`
        SELECT
          revision.status AS proof_status,
          orders.status AS order_status,
          orders.stripe_checkout_session_id
        FROM photobook_orders orders
        JOIN photobook_revisions revision ON revision.id = orders.proof_revision_id
        WHERE orders.id = $1
      `, [orderId]);
      expect(reservedState.rows).toEqual([{
        proof_status: "approved",
        order_status: "awaiting_payment",
        stripe_checkout_session_id: null,
      }]);
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
        projectTitle: "Checkoutproject",
        status: "checkout_open",
        paymentStatus: "unpaid",
        refundedMinor: 0,
        fulfilmentStatus: "awaiting_review",
        amounts: { totalMinor: 5_808 },
        statusHistory: [
          {
            eventType: "order.checkout_reserved.v1",
            fromStatus: null,
            toStatus: "awaiting_payment",
            occurredAt: now.toISOString(),
          },
          {
            eventType: "order.checkout_opened.v1",
            fromStatus: "awaiting_payment",
            toStatus: "checkout_open",
            occurredAt: now.toISOString(),
          },
        ],
      });
      expect("totalMinor" in (detail ?? {})).toBe(false);
      expect(await repository.getOrder(strangerId, orderId)).toBeNull();

      const ownerOrders = await repository.listOrders(ownerId, undefined, 20);
      expect(ownerOrders).toMatchObject({
        hasMore: false,
        items: [{
          orderId,
          projectId,
          projectTitle: "Checkoutproject",
          status: "checkout_open",
          paymentStatus: "unpaid",
          fulfilmentStatus: "awaiting_review",
          amounts: { totalMinor: 5_808 },
        }],
      });
      expect(await repository.listOrders(strangerId, undefined, 20)).toEqual({
        items: [],
        hasMore: false,
      });

      const persisted = await admin.query<{
        proof_status: string;
        order_status: string;
        event_count: string;
        checkout_snapshot: unknown;
        legal_accepted_at: Date | string;
      }>(`
        SELECT
          revision.status AS proof_status,
          orders.status AS order_status,
          orders.checkout_snapshot,
          orders.legal_accepted_at,
          (SELECT count(*)::text FROM photobook_order_events event WHERE event.order_id = orders.id) AS event_count
        FROM photobook_orders orders
        JOIN photobook_revisions revision ON revision.id = orders.proof_revision_id
        WHERE orders.id = $1
      `, [orderId]);
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({
        proof_status: "locked",
        order_status: "checkout_open",
        event_count: "2",
        checkout_snapshot: {
          schemaVersion: 3,
          requestHash,
          productReference: "buildy-a4-landscape-hardcover",
          priceVersion: "integration-approved-price-v1",
          termsAccepted: true,
          personalisedProduct: true,
        },
      });
      expect(JSON.stringify(persisted.rows[0]!.checkout_snapshot)).not.toContain("Mila");
      expect(JSON.stringify(persisted.rows[0]!.checkout_snapshot)).not.toContain("Teststraat");
      expect(JSON.stringify(persisted.rows[0]!.checkout_snapshot)).not.toContain("1234 AB");
      expect(new Date(persisted.rows[0]!.legal_accepted_at).toISOString()).toBe(now.toISOString());

      const racePdfAssetId = randomUUID();
      const raceDraftId = randomUUID();
      const raceRevisionId = randomUUID();
      const raceOrderId = randomUUID();
      const replacementOrderId = randomUUID();
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
        racePdfAssetId,
        ownerId,
        projectId,
        `photobook-pdfs/${racePdfAssetId.slice(0, 2)}/${racePdfAssetId}`,
        `checkout-race-pdf-${racePdfAssetId}`,
        "1".repeat(64),
      ]);
      await admin.query(`
        INSERT INTO photobook_drafts (
          id, project_id, owner_id, status, schema_version, project_revision,
          document, document_sha256, page_count, selected_format
        ) VALUES ($1, $2, $3, 'ready', 1, 1, $4::jsonb, $5, 24, 'a4-landscape-hardcover-v1')
      `, [raceDraftId, projectId, ownerId, JSON.stringify(document), "2".repeat(64)]);
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
        raceRevisionId,
        raceDraftId,
        projectId,
        ownerId,
        JSON.stringify(document),
        "2".repeat(64),
        "3".repeat(64),
        racePdfAssetId,
        "1".repeat(64),
        "4".repeat(64),
      ]);
      const raceExpiry = new Date("2026-08-04T12:30:00.000Z");
      const raceCommand: ReserveCheckoutCommand = {
        orderId: raceOrderId,
        orderNumber: `BLD-20260804-${raceOrderId.slice(0, 10).replaceAll("-", "").toUpperCase()}`,
        merchantReference: `buildy:${raceOrderId}`,
        actorId: ownerId,
        projectId,
        projectTitle: "Checkoutproject",
        proofRevisionId: raceRevisionId,
        documentSha256: "2".repeat(64),
        pdfSha256: "1".repeat(64),
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
        termsAccepted: true,
        customerEmail: "checkout-owner@example.test",
        requestHash: "5".repeat(64),
        idempotencyKey: "6".repeat(64),
        quoteReference: "integration-race-quote",
        productReference: "buildy-a4-landscape-hardcover",
        priceVersion: "integration-approved-price-v1",
        commercialApprovalId: "integration-approved-price-v1",
        taxTreatment: "vat_exclusive",
        pii: {
          customerEmailCiphertext: "v1.1.race-email",
          shippingDetailsCiphertext: "v1.1.race-address",
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
        quoteExpiresAt: raceExpiry,
      };
      await repository.reserveCheckout(raceCommand);
      const [cancelResult, recordResult] = await Promise.allSettled([
        repository.cancelExpiredCheckoutReservation({
          actorId: ownerId,
          orderId: raceOrderId,
          now: raceExpiry,
        }),
        repository.recordCheckoutSession({
          actorId: ownerId,
          orderId: raceOrderId,
          sessionId: `cs_test_${raceOrderId.replaceAll("-", "")}`,
          expiresAt: new Date("2026-08-04T12:50:00.000Z"),
          now: raceExpiry,
        }),
      ]);
      expect(cancelResult).toEqual({ status: "fulfilled", value: true });
      expect(recordResult).toMatchObject({
        status: "rejected",
        reason: { reason: "QUOTE_EXPIRED" },
      });
      const racedState = await admin.query<{
        status: string;
        proof_status: string;
        stripe_checkout_session_id: string | null;
        event_count: string;
      }>(`
        SELECT
          orders.status,
          revision.status AS proof_status,
          orders.stripe_checkout_session_id,
          (SELECT count(*)::text FROM photobook_order_events event
            WHERE event.order_id = orders.id) AS event_count
        FROM photobook_orders orders
        JOIN photobook_revisions revision ON revision.id = orders.proof_revision_id
        WHERE orders.id = $1
      `, [raceOrderId]);
      expect(racedState.rows).toEqual([{
        status: "cancelled",
        proof_status: "approved",
        stripe_checkout_session_id: null,
        event_count: "2",
      }]);

      const replacement = await repository.reserveCheckout({
        ...raceCommand,
        orderId: replacementOrderId,
        orderNumber: `BLD-20260804-${replacementOrderId.slice(0, 10).replaceAll("-", "").toUpperCase()}`,
        merchantReference: `buildy:${replacementOrderId}`,
        idempotencyKey: "7".repeat(64),
        quoteReference: "integration-race-replacement-quote",
        pii: {
          ...raceCommand.pii,
          customerEmailCiphertext: "v1.1.replacement-email",
          shippingDetailsCiphertext: "v1.1.replacement-address",
        },
        reservedAt: new Date("2026-08-04T12:31:00.000Z"),
        quoteExpiresAt: new Date("2026-08-04T13:00:00.000Z"),
      });
      expect(replacement).toMatchObject({
        orderId: replacementOrderId,
        status: "awaiting_payment",
        replayed: false,
      });
      await repository.recordCheckoutSession({
        actorId: ownerId,
        orderId: replacementOrderId,
        sessionId: `cs_test_${replacementOrderId.replaceAll("-", "")}`,
        expiresAt: new Date("2026-08-04T12:55:00.000Z"),
        now: new Date("2026-08-04T12:32:00.000Z"),
      });
      const replacementState = await admin.query<{ status: string; proof_status: string }>(`
        SELECT orders.status, revision.status AS proof_status
        FROM photobook_orders orders
        JOIN photobook_revisions revision ON revision.id = orders.proof_revision_id
        WHERE orders.id = $1
      `, [replacementOrderId]);
      expect(replacementState.rows).toEqual([{
        status: "checkout_open",
        proof_status: "locked",
      }]);

      const legacyOrderId = randomUUID();
      const legacyIdempotencyKey = "e".repeat(64);
      await admin.query(`
        INSERT INTO photobook_orders (
          id, order_number, merchant_reference, project_id, owner_id,
          proof_revision_id, idempotency_key, status, payment_status,
          fulfilment_status, currency, quantity, subtotal_minor,
          shipping_minor, tax_minor, total_minor, shipping_country,
          customer_email_ciphertext, shipping_details_ciphertext,
          pii_encryption_key_version, checkout_snapshot, seller_snapshot,
          terms_version, legal_accepted_at, delivery_estimate
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          'cancelled', 'unpaid', 'unclaimed', 'EUR', 1, 4000, 800, 1008, 5808,
          'NL', 'v1.1.legacy-email', 'v1.1.legacy-address', 1,
          $8::jsonb, $9::jsonb, '2026-08-01', $10, '5–8 werkdagen na productie'
        )
      `, [
        legacyOrderId,
        `BLD-20260804-${legacyOrderId.slice(0, 10).replaceAll("-", "").toUpperCase()}`,
        `buildy:${legacyOrderId}`,
        projectId,
        ownerId,
        revisionId,
        legacyIdempotencyKey,
        JSON.stringify({
          schemaVersion: 1,
          requestHash: "f".repeat(64),
          sku: "a4-landscape-hardcover-v1",
          format: "a4-landscape-hardcover-v1",
          projectTitle: "Checkoutproject",
          pageCount: 24,
          documentSha256: documentHash,
          pdfSha256: pdfHash,
          unitAmountMinor: 4_000,
          quoteReference: "legacy-integration-quote",
          offeringId: "legacy-provider-offering",
          commercialApprovalId: "legacy-approved-price-v1",
          taxTreatment: "vat_exclusive",
          quoteExpiresAt: "2026-08-04T12:30:00.000Z",
          personalisedProduct: true,
        }),
        JSON.stringify({ legalName: "Legacy Buildy testverkoper" }),
        now,
      ]);
      await expect(repository.findCheckoutReservation(
        ownerId,
        revisionId,
        legacyIdempotencyKey,
      )).resolves.toMatchObject({
        orderId: legacyOrderId,
        productReference: "legacy-provider-offering",
        priceVersion: "legacy-approved-price-v1",
        requestHashScheme: "legacy-v1",
      });
    } finally {
      await resources.pool.end();
      await admin.end();
    }
  });
});

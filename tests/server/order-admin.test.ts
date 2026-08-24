// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ModerationAdminActor } from "../../server/moderation/adminActor";
import { createOrderAdminHttpHandler } from "../../server/orders/adminHttp";
import { OrderAdminService } from "../../server/orders/adminService";
import type {
  AdminOrderActionCommand,
  EncryptedAdminOrder,
  OrderAdminRepository,
  OrderAdminServiceContract,
} from "../../server/orders/adminTypes";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";
import type { ObjectStorage } from "../../server/storage/objectStorage";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const REVISION_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const ACTION_KEY = "77777777-7777-4777-8777-777777777777";
const PDF = Buffer.from("%PDF-1.7\nlocked-print-proof\n%%EOF", "utf8");
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");

const admin: ModerationAdminActor = {
  appUserId: ADMIN_ID,
  role: "admin",
  grantExpiresAt: "2026-12-01T00:00:00.000Z",
};

function cryptoDependencies() {
  return {
    keyring: new DataProtectionKeyring({
      currentVersion: 1,
      keys: { 1: Buffer.alloc(32, 11).toString("base64") },
    }),
    blindIndex: new PrivacyBlindIndex(Buffer.alloc(32, 12).toString("base64")),
  };
}

function repository(overrides: Partial<OrderAdminRepository> = {}): OrderAdminRepository {
  return {
    list: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    load: vi.fn().mockResolvedValue(null),
    apply: vi.fn().mockResolvedValue({
      orderId: ORDER_ID,
      fulfilmentStatus: "reviewed",
      version: 2,
      replayed: false,
    }),
    ...overrides,
  };
}

function encryptedOrder(keyring: DataProtectionKeyring): EncryptedAdminOrder {
  return {
    orderId: ORDER_ID,
    orderNumber: "BLD-ORDER-0001",
    ownerId: OWNER_ID,
    customerName: "Bouwboekklant",
    customerEmailCiphertext: keyring.encrypt(
      "klant@example.test",
      `photobook-order:${ORDER_ID}:customer-email`,
    ),
    shippingDetailsCiphertext: keyring.encrypt(JSON.stringify({
      firstName: "Bouw",
      lastName: "Boeker",
      addressLine1: "Teststraat 1",
      addressLine2: null,
      postalCode: "1234 AB",
      city: "Utrecht",
      state: null,
      countryCode: "NL",
    }), `photobook-order:${ORDER_ID}:shipping-address`),
    projectId: PROJECT_ID,
    projectTitle: "Keukenverbouwing",
    paidAt: "2026-08-20T10:00:00.000Z",
    proofRevisionId: REVISION_ID,
    documentSha256: "a".repeat(64),
    pdfSha256: PDF_SHA,
    pdfObjectKey: `photobook-pdfs/${REVISION_ID}`,
    pdfSizeBytes: PDF.byteLength,
    pageCount: 24,
    quantity: 1,
    currency: "EUR",
    totalMinor: 6_750,
    paymentStatus: "paid",
    fulfilmentStatus: "awaiting_review",
    needsAttention: false,
    version: 1,
    amounts: {
      currency: "EUR",
      subtotalMinor: 5_000,
      shippingMinor: 695,
      taxMinor: 1_055,
      totalMinor: 6_750,
    },
    refundedMinor: 0,
    manualProviderReference: null,
    fulfilmentNotesCiphertext: null,
    trackingUrl: null,
    seller: {
      legalName: "Buildy test B.V.",
      tradeName: "Buildy",
      registrationNumber: "TEST-12345678",
      vatNumber: null,
      address: "Testadres — niet bezorgen",
      countryCode: "NL",
      supportEmail: "support@example.test",
    },
    stripeReferences: {
      checkoutSessionId: "cs_test_order",
      paymentIntentId: "pi_test_order",
      chargeId: "ch_test_order",
    },
    milestones: {
      reviewedAt: null,
      orderedManuallyAt: null,
      inProductionAt: null,
      shippedAt: null,
      completedAt: null,
      refundReviewAt: null,
    },
    createdAt: "2026-08-20T09:55:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    events: [],
  };
}

describe("OrderAdminService", () => {
  it("requires an authoritative admin role for every operation", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const repo = repository();
    const service = new OrderAdminService(repo, keyring, blindIndex);
    const moderator = { ...admin, role: "moderator" as const };

    await expect(service.queue(moderator, {})).rejects.toMatchObject({ reason: "FORBIDDEN" });
    await expect(service.detail(moderator, ORDER_ID)).rejects.toMatchObject({ reason: "FORBIDDEN" });
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.load).not.toHaveBeenCalled();
  });

  it("decrypts customer and shipping PII only on the explicit detail boundary", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    const repo = repository({ load: vi.fn().mockResolvedValue(encryptedOrder(keyring)) });
    const service = new OrderAdminService(repo, keyring, blindIndex);

    await expect(service.detail(admin, ORDER_ID)).resolves.toMatchObject({
      customerEmail: "klant@example.test",
      shippingAddress: { city: "Utrecht", countryCode: "NL" },
      pdfPath: `/api/admin/orders/${ORDER_ID}/pdf`,
    });
  });

  it("encrypts notes and binds exact action content to actor-scoped replay hashes", async () => {
    const { keyring, blindIndex } = cryptoDependencies();
    let command: AdminOrderActionCommand | undefined;
    const repo = repository({
      apply: vi.fn(async (input) => {
        command = input;
        return {
          orderId: ORDER_ID,
          fulfilmentStatus: "reviewed" as const,
          version: 2,
          replayed: false,
        };
      }),
    });
    const service = new OrderAdminService(repo, keyring, blindIndex);

    await service.action(admin, ORDER_ID, {
      action: "review",
      expectedVersion: 1,
      notes: "Alleen voor de founder",
      idempotencyKey: ACTION_KEY,
    }, REQUEST_ID);

    expect(command?.idempotencyKey).toMatch(/^manual-fulfilment:v1:[0-9a-f]{64}$/);
    expect(command?.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(command?.notesCiphertext).not.toContain("founder");
    expect(keyring.decrypt(
      command!.notesCiphertext!,
      `photobook-order:${ORDER_ID}:fulfilment-notes`,
    )).toBe("Alleen voor de founder");
  });
});

describe("order admin HTTP boundary", () => {
  function context(overrides: Partial<OrderAdminServiceContract> = {}, bytes = PDF) {
    const service: OrderAdminServiceContract = {
      queue: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      detail: vi.fn().mockResolvedValue({} as never),
      action: vi.fn().mockResolvedValue({
        orderId: ORDER_ID,
        fulfilmentStatus: "reviewed",
        version: 2,
        replayed: false,
      }),
      proofObject: vi.fn().mockResolvedValue({
        orderNumber: "BLD-ORDER-0001",
        objectKey: `photobook-pdfs/${REVISION_ID}`,
        sizeBytes: PDF.byteLength,
        sha256: PDF_SHA,
      }),
      ...overrides,
    };
    const actors = { resolve: vi.fn().mockResolvedValue(admin) };
    const storage = {
      streamObject: vi.fn().mockImplementation(async (input) => ({
        metadata: {
          key: input.key,
          sizeBytes: PDF.byteLength,
          contentType: "application/pdf",
        },
        stream: new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(bytes); controller.close(); },
        }),
        contentLength: bytes.byteLength,
      })),
    } as unknown as ObjectStorage;
    return { service, actors, storage, handle: createOrderAdminHttpHandler({ service, actors, storage }) };
  }

  it("rejects duplicate and unknown queue parameters before repository access", async () => {
    const first = context();
    await expect(first.handle(new Request(
      "https://buildy.test/api/admin/orders?status=all&status=reviewed",
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(first.service.queue).not.toHaveBeenCalled();

    const second = context();
    await expect(second.handle(new Request(
      "https://buildy.test/api/admin/orders?customerEmail=secret@example.test",
    ), REQUEST_ID)).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
    expect(second.service.queue).not.toHaveBeenCalled();
  });

  it("serves the exact authenticated private proof with no-store headers", async () => {
    const current = context();
    const response = await current.handle(new Request(
      `https://buildy.test/api/admin/orders/${ORDER_ID}/pdf`,
    ), REQUEST_ID);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("BLD-ORDER-0001-print.pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF);
    expect(current.actors.resolve).toHaveBeenCalledOnce();
  });

  it("fails closed when stored proof bytes no longer match the locked hash", async () => {
    const current = context({}, Buffer.alloc(PDF.byteLength, 120));
    const response = await current.handle(new Request(
      `https://buildy.test/api/admin/orders/${ORDER_ID}/pdf`,
    ), REQUEST_ID);
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: "UPLOAD_MISMATCH" });
  });
});

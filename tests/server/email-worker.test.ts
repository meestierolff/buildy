import { describe, expect, it, vi } from "vitest";
import { buildProtectedAuthEmailRecord } from "../../server/auth/postgresOutbox";
import type { CommunityEmailContext } from "../../server/email/communityEmailPayload";
import type { OrderEmailContext } from "../../server/email/orderEmailPayload";
import { EmailTemplateCatalog, parseEmailTemplateCatalog } from "../../server/email/templates";
import {
  EmailOutboxWorker,
  type ClaimedEmailEvent,
  type EmailWorkerRepository,
  type PreparedEmailDeliveryRecord,
} from "../../server/email/worker";
import {
  TransactionalEmailError,
  type TransactionalEmailProvider,
  type TransactionalEmailReceipt,
} from "../../server/email/transactionalEmail";
import { DataProtectionKeyring, PrivacyBlindIndex } from "../../server/security/dataProtection";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const blindIndexKey = Buffer.alloc(32, 9).toString("base64");

function dependencies() {
  return {
    keyring: new DataProtectionKeyring({ currentVersion: 1, keys: { 1: encryptionKey } }),
    blindIndex: new PrivacyBlindIndex(blindIndexKey),
    templates: new EmailTemplateCatalog({
      "auth.verify_email": { id: 101, version: "2026-08-01" },
      "auth.magic_link": { id: 102, version: "2026-08-01" },
      "auth.reset_password": { id: 103, version: "2026-08-01" },
      "order.confirmation": { id: 201, version: "content-v1" },
      "support.confirmation": { id: 301, version: "content-v1" },
      "moderation.report_received": { id: 302, version: "content-v1" },
      "lifecycle.welcome": { id: 401, version: "content-v1" },
      "social.access_requested": { id: 402, version: "content-v1" },
      "social.access_accepted": { id: 403, version: "content-v1" },
      "security.account_alert": { id: 404, version: "content-v1" },
      "migration.account": { id: 405, version: "content-v1" },
    }),
  };
}

function claimedOrderEvent(): ClaimedEmailEvent {
  const orderId = "10000000-0000-4000-8000-000000000011";
  return {
    id: "10000000-0000-4000-8000-000000000012",
    aggregateId: orderId,
    aggregateType: "photobook_order",
    eventType: "order.email.confirmation.requested.v1",
    idempotencyKey: `order:${orderId}:email:confirmation:v1`,
    payload: { schemaVersion: 1, orderId },
    attemptCount: 1,
  };
}

function orderContext(): OrderEmailContext {
  const { keyring } = dependencies();
  const orderId = "10000000-0000-4000-8000-000000000011";
  return {
    orderId,
    ownerId: "10000000-0000-4000-8000-000000000013",
    orderNumber: "BLD-2026-EMAIL001",
    currency: "EUR",
    quantity: 1,
    subtotalMinor: 4_000,
    shippingMinor: 695,
    taxMinor: 986,
    totalMinor: 5_681,
    refundedMinor: 0,
    shippingCountry: "NL",
    customerEmailCiphertext: keyring.encrypt(
      "order@example.test",
      `photobook-order:${orderId}:customer-email`,
    ),
    shippingDetailsCiphertext: keyring.encrypt(JSON.stringify({
      firstName: "Bouw",
      lastName: "Eigenaar",
      addressLine1: "Werkplaats 1",
      addressLine2: null,
      postalCode: "1234 AB",
      city: "Utrecht",
      state: null,
      countryCode: "NL",
    }), `photobook-order:${orderId}:shipping-address`),
    checkoutSnapshot: {
      schemaVersion: 1,
      sku: "a4-landscape-hardcover-v1",
      format: "a4-landscape-hardcover-v1",
      projectTitle: "De verbouwing",
      pageCount: 32,
      taxTreatment: "vat_included",
      personalisedProduct: true,
    },
    sellerSnapshot: {
      legalName: "Buildy B.V.",
      tradeName: "Buildy",
      registrationNumber: "12345678",
      vatNumber: "NL001234567B01",
      address: "Bouwlaan 1, Utrecht",
      countryCode: "NL",
      supportEmail: "support@buildy.test",
    },
    termsVersion: "terms-v1",
    deliveryEstimate: "5–8 werkdagen",
    status: "paid",
    paymentStatus: "paid",
    fulfilmentStatus: "unclaimed",
    trackingUrl: null,
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    paidAt: new Date("2026-08-04T10:01:00.000Z"),
  };
}

function claimedSupportEvent(): ClaimedEmailEvent {
  const submissionId = "10000000-0000-4000-8000-000000000021";
  return {
    id: "10000000-0000-4000-8000-000000000022",
    aggregateId: submissionId,
    aggregateType: "feedback_submission",
    eventType: "support.confirmation.requested.v1",
    idempotencyKey: `feedback-submission:${submissionId}:email:confirmation:v1`,
    payload: {
      schemaVersion: 1,
      submissionId,
      kind: "support",
      receiptCode: "HELP-ABCD1234",
    },
    attemptCount: 1,
  };
}

function communityContext(): CommunityEmailContext {
  const { keyring, blindIndex } = dependencies();
  const submissionId = "10000000-0000-4000-8000-000000000021";
  const recipient = "supporter@example.test";
  return {
    aggregateType: "feedback_submission",
    aggregateId: submissionId,
    recipientCiphertext: keyring.encrypt(
      recipient,
      `feedback-submission:${submissionId}:contact`,
    ),
    contactHash: blindIndex.create("email-recipient", recipient),
    receiptCode: "HELP-ABCD1234",
    kind: "support",
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    targetType: null,
    category: "technical",
  };
}

function claimedEvent(attemptCount = 1) {
  const { keyring, blindIndex } = dependencies();
  const record = buildProtectedAuthEmailRecord({
    authUserId: "auth-user-1",
    idempotencyKey: `auth-email:v1:verify_email:${"a".repeat(64)}`,
    kind: "verify_email",
    recipient: "synthetic@example.test",
    url: "https://app.buildy.test/auth/verify?token=synthetic-token",
  }, keyring, blindIndex);
  return {
    id: "10000000-0000-4000-8000-000000000001",
    attemptCount,
    ...record,
  };
}

class FakeRepository implements EmailWorkerRepository {
  readonly acknowledgements: Array<{ eventId: string; leaseOwner: string }> = [];
  readonly completions: Array<{ eventId: string; leaseOwner: string; receipt: TransactionalEmailReceipt }> = [];
  readonly failures: Array<Parameters<EmailWorkerRepository["fail"]>[0]> = [];
  readonly preparations: Array<Parameters<EmailWorkerRepository["prepareDelivery"]>[0]> = [];
  readonly orderContextLoads: Array<{ eventId: string; leaseOwner: string }> = [];
  readonly communityContextLoads: Array<{ eventId: string; leaseOwner: string }> = [];
  preparation: PreparedEmailDeliveryRecord = {
    status: "queued",
    firstAttemptAt: new Date("2026-08-04T10:00:00.000Z"),
  };

  constructor(
    private readonly events: ClaimedEmailEvent[] = [claimedEvent()],
    private readonly loadedOrderContext?: OrderEmailContext,
    private readonly loadedCommunityContext?: CommunityEmailContext,
  ) {}

  async claim(): Promise<ClaimedEmailEvent[]> {
    return structuredClone(this.events);
  }

  async loadOrderEmailContext(input: { eventId: string; leaseOwner: string }) {
    this.orderContextLoads.push(input);
    return this.loadedOrderContext ? structuredClone(this.loadedOrderContext) : undefined;
  }

  async loadCommunityEmailContext(input: { eventId: string; leaseOwner: string }) {
    this.communityContextLoads.push(input);
    return this.loadedCommunityContext
      ? structuredClone(this.loadedCommunityContext)
      : undefined;
  }

  async loadAccountEventEmailContext() {
    return undefined;
  }

  async prepareDelivery(input: Parameters<EmailWorkerRepository["prepareDelivery"]>[0]) {
    this.preparations.push(input);
    return this.preparation;
  }

  async acknowledge(input: Parameters<EmailWorkerRepository["acknowledge"]>[0]) {
    this.acknowledgements.push(input);
  }

  async complete(input: Parameters<EmailWorkerRepository["complete"]>[0]) {
    this.completions.push(input);
  }

  async fail(input: Parameters<EmailWorkerRepository["fail"]>[0]) {
    this.failures.push(input);
  }

  async reconcileDeliveries() {
    return 0;
  }
}

function provider(send: TransactionalEmailProvider["send"]): TransactionalEmailProvider {
  return { send };
}

describe("durable e-mail outbox worker", () => {
  it("decrypts only in the worker and persists only a recipient blind index", async () => {
    const repository = new FakeRepository();
    const send = vi.fn<TransactionalEmailProvider["send"]>().mockResolvedValue({
      provider: "brevo",
      messageId: "provider-message-1",
      acceptedAt: "2026-08-04T10:00:01.000Z",
    });
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(repository, provider(send), keyring, blindIndex, templates);

    await expect(worker.runOnce("email-worker-1")).resolves.toEqual({
      claimed: 1,
      deadLettered: 0,
      delivered: 1,
      reconciled: 0,
      retried: 0,
      skipped: 0,
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipient: { email: "synthetic@example.test" },
      templateId: 101,
      parameters: { actionUrl: "https://app.buildy.test/auth/verify?token=synthetic-token" },
    }));
    expect(repository.preparations[0]).toMatchObject({
      eventId: "10000000-0000-4000-8000-000000000001",
      recipientHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      templateKey: "auth.verify_email",
      templateVersion: "2026-08-01",
    });
    expect(JSON.stringify(repository.preparations)).not.toContain("synthetic@example.test");
    expect(repository.completions).toHaveLength(1);
  });

  it("loads an order snapshot only after claiming and submits repo-owned content", async () => {
    const repository = new FakeRepository([claimedOrderEvent()], orderContext());
    const send = vi.fn<TransactionalEmailProvider["send"]>().mockResolvedValue({
      provider: "brevo",
      messageId: "provider-order-message-1",
      acceptedAt: "2026-08-04T10:02:00.000Z",
    });
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(
      repository,
      provider(send),
      keyring,
      blindIndex,
      templates,
      { appOrigin: "https://app.buildy.test" },
    );

    const result = await worker.runOnce("email-worker-1");

    expect(result.delivered).toBe(1);
    expect(repository.orderContextLoads).toEqual([{
      eventId: "10000000-0000-4000-8000-000000000012",
      leaseOwner: "email-worker-1",
    }]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipient: { email: "order@example.test", name: "Bouw Eigenaar" },
      content: expect.objectContaining({
        subject: expect.stringContaining("BLD-2026-EMAIL001"),
      }),
    }));
    expect(repository.preparations[0]).toMatchObject({
      templateKey: "order.confirmation",
      templateVersion: "content-v1",
      recipientHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(repository.preparations)).not.toContain("order@example.test");
  });

  it("loads a leased support receipt and sends minimal repo-owned content", async () => {
    const repository = new FakeRepository(
      [claimedSupportEvent()],
      undefined,
      communityContext(),
    );
    const send = vi.fn<TransactionalEmailProvider["send"]>().mockResolvedValue({
      provider: "brevo",
      messageId: "provider-community-message-1",
      acceptedAt: "2026-08-04T10:02:00.000Z",
    });
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(
      repository,
      provider(send),
      keyring,
      blindIndex,
      templates,
    );

    const result = await worker.runOnce("email-worker-1");

    expect(result.delivered).toBe(1);
    expect(repository.communityContextLoads).toEqual([{
      eventId: "10000000-0000-4000-8000-000000000022",
      leaseOwner: "email-worker-1",
    }]);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipient: { email: "supporter@example.test" },
      content: expect.objectContaining({
        subject: expect.stringContaining("HELP-ABCD1234"),
        text: expect.not.stringContaining("supporter@example.test"),
      }),
      tags: ["community", "support-receipt"],
    }));
    expect(repository.preparations[0]).toMatchObject({
      templateKey: "support.confirmation",
      templateVersion: "content-v1",
      recipientHash: communityContext().contactHash,
    });
    expect(JSON.stringify(repository.preparations)).not.toContain("supporter@example.test");
  });

  it("dead-letters a community receipt whose contact blind index was tampered", async () => {
    const context = communityContext();
    context.contactHash = "f".repeat(64);
    const repository = new FakeRepository(
      [claimedSupportEvent()],
      undefined,
      context,
    );
    const send = vi.fn<TransactionalEmailProvider["send"]>();
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(
      repository,
      provider(send),
      keyring,
      blindIndex,
      templates,
    );

    const result = await worker.runOnce("email-worker-1");

    expect(result.deadLettered).toBe(1);
    expect(repository.failures[0]).toMatchObject({
      deadLetter: true,
      errorCode: "community_email_payload_invalid",
    });
    expect(send).not.toHaveBeenCalled();
    expect(repository.preparations).toHaveLength(0);
  });

  it("acknowledges an already submitted delivery without sending again", async () => {
    const repository = new FakeRepository();
    repository.preparation = {
      status: "submitted",
      firstAttemptAt: new Date("2026-08-04T10:00:00.000Z"),
    };
    const send = vi.fn<TransactionalEmailProvider["send"]>();
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(repository, provider(send), keyring, blindIndex, templates);

    const result = await worker.runOnce("email-worker-1");

    expect(result.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(repository.acknowledgements).toEqual([{
      eventId: "10000000-0000-4000-8000-000000000001",
      leaseOwner: "email-worker-1",
    }]);
  });

  it("retries a transient provider failure inside the idempotency window", async () => {
    const repository = new FakeRepository([claimedEvent(2)]);
    const send = vi.fn<TransactionalEmailProvider["send"]>().mockRejectedValue(
      new TransactionalEmailError("RATE_LIMITED", "provider throttled", true),
    );
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(repository, provider(send), keyring, blindIndex, templates, {
      now: () => new Date("2026-08-04T10:05:00.000Z"),
    });

    const result = await worker.runOnce("email-worker-1");

    expect(result.retried).toBe(1);
    expect(repository.failures[0]).toMatchObject({
      deadLetter: false,
      errorCode: "email_rate_limited",
      eventId: "10000000-0000-4000-8000-000000000001",
    });
    expect(repository.failures[0].delaySeconds).toBeGreaterThanOrEqual(30);
  });

  it("dead-letters provider uncertainty beyond the safe retry window", async () => {
    const repository = new FakeRepository([claimedEvent(3)]);
    const send = vi.fn<TransactionalEmailProvider["send"]>().mockRejectedValue(
      new TransactionalEmailError("PROVIDER_UNAVAILABLE", "provider unavailable", true),
    );
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(repository, provider(send), keyring, blindIndex, templates, {
      now: () => new Date("2026-08-04T10:26:00.000Z"),
    });

    const result = await worker.runOnce("email-worker-1");

    expect(result.deadLettered).toBe(1);
    expect(repository.failures[0]).toMatchObject({
      deadLetter: true,
      delaySeconds: 0,
      errorCode: "email_provider_unavailable",
    });
  });

  it("dead-letters an invalid protected payload without exposing or sending it", async () => {
    const event = claimedEvent();
    event.payload = { ...event.payload, kind: "magic_link" };
    const repository = new FakeRepository([event]);
    const send = vi.fn<TransactionalEmailProvider["send"]>();
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(repository, provider(send), keyring, blindIndex, templates);

    const result = await worker.runOnce("email-worker-1");

    expect(result.deadLettered).toBe(1);
    expect(repository.failures[0].errorCode).toBe("email_payload_invalid");
    expect(send).not.toHaveBeenCalled();
  });

  it("lets delivery-ledger persistence failures escape so the lease can recover", async () => {
    const repository = new FakeRepository();
    repository.complete = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const send = vi.fn<TransactionalEmailProvider["send"]>().mockResolvedValue({
      provider: "brevo",
      messageId: "provider-message-1",
      acceptedAt: "2026-08-04T10:00:01.000Z",
    });
    const { keyring, blindIndex, templates } = dependencies();
    const worker = new EmailOutboxWorker(repository, provider(send), keyring, blindIndex, templates);

    await expect(worker.runOnce("email-worker-1")).rejects.toThrow("database unavailable");
    expect(repository.failures).toHaveLength(0);
  });
});

describe("e-mail template catalog", () => {
  it("parses environment-specific immutable template ids and versions", () => {
    const catalog = parseEmailTemplateCatalog(JSON.stringify({
      "auth.verify_email": { id: 41, version: "staging-v3" },
    }));
    expect(catalog.resolve("auth.verify_email")).toEqual({ id: 41, version: "staging-v3" });
    expect(() => catalog.resolve("order.confirmation")).toThrow("E-mailtemplate ontbreekt");
  });

  it("rejects unknown template metadata", () => {
    expect(() => parseEmailTemplateCatalog(JSON.stringify({
      "auth.verify_email": { id: 41, version: "v1", recipient: "pii@example.test" },
    }))).toThrow("BREVO_TEMPLATE_IDS is ongeldig");
  });
});

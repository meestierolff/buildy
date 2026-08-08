// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createPeechoCallbackHandler } from "../../server/fulfilment/callback";
import type {
  PeechoCallbackResult,
  PeechoFulfilmentRepository,
} from "../../server/fulfilment/types";
import { PeechoV3HttpProvider } from "../../server/print/peechoV3Provider";

const SECRET = "test-peecho-secret";
const ORDER_ID = "9001";
const BUILDY_ORDER_ID = "10000000-0000-4000-8000-000000000001";
const REFERENCE = `buildy:${BUILDY_ORDER_ID}`;
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-04T12:00:00.000Z");

class CallbackRepository implements Pick<PeechoFulfilmentRepository, "recordCallback"> {
  calls = 0;
  events: Parameters<PeechoFulfilmentRepository["recordCallback"]>[0][] = [];
  private readonly seen = new Set<string>();
  private statusRank = 20;

  async recordCallback(input: Parameters<PeechoFulfilmentRepository["recordCallback"]>[0]): Promise<PeechoCallbackResult> {
    this.calls += 1;
    this.events.push(input);
    if (this.seen.has(input.event.eventKey)) {
      return { replayed: true, applied: false, outcome: "applied" };
    }
    this.seen.add(input.event.eventKey);
    if (
      input.providerEnvironment !== "test"
      || input.event.providerOrderId !== ORDER_ID
      || input.event.merchantReference !== REFERENCE
    ) {
      return { replayed: false, applied: false, outcome: "reference_rejected" };
    }
    if (!input.event.newStatus.known || ["manual_review", "cancelled", "refunded", "failed"].includes(input.event.newStatus.status)) {
      return { replayed: false, applied: true, outcome: "manual_review" };
    }
    const rank = {
      awaiting_payment: 10,
      paid: 20,
      queued: 30,
      submitted: 32,
      in_production: 40,
      shipped: 50,
    }[input.event.newStatus.status as "awaiting_payment" | "paid" | "queued" | "submitted" | "in_production" | "shipped"];
    if (rank < this.statusRank) {
      return { replayed: false, applied: false, outcome: "ignored_out_of_order" };
    }
    this.statusRank = rank;
    return { replayed: false, applied: true, outcome: "applied" };
  }
}

function provider(input: {
  environment?: "test" | "live";
  statuses?: string[];
  merchantReference?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
} = {}) {
  const environment = input.environment ?? "test";
  const adapter = new PeechoV3HttpProvider({
    environment,
    merchantApiKey: "merchant-test-key",
    secretKey: SECRET,
    fetch: (() => Promise.reject(new Error("no network"))) as typeof fetch,
    clock: {
      now: () => new Date(NOW),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
  });
  const statuses = input.statuses ?? ["IN_PRODUCTION"];
  let readCount = 0;
  return {
    environment,
    verifyCallback: adapter.verifyCallback.bind(adapter),
    getOrder: vi.fn(async () => {
      const providerStatus = statuses[Math.min(readCount, statuses.length - 1)]!;
      readCount += 1;
      return {
        providerOrderId: ORDER_ID,
        merchantReference: input.merchantReference === undefined ? REFERENCE : input.merchantReference,
        status: adapter.mapStatus(providerStatus),
        createdAt: null,
        currency: "EUR",
        trackingCode: input.trackingCode ?? null,
        trackingUrl: input.trackingUrl ?? null,
        moderationReason: null,
        fulfilmentLocation: null,
      };
    }),
  };
}

function callbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    signature: createHash("sha256").update(`${SECRET}${ORDER_ID}`).digest("hex"),
    order_id: ORDER_ID,
    order_reference: REFERENCE,
    old_status: "PAID",
    new_status: "IN_PRODUCTION",
    tracking_code: null,
    tracking_url: null,
    ...overrides,
  };
}

function request(payload: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://buildy.example/api/webhooks/peecho", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(payload),
  });
}

async function responseData(response: Response) {
  const body = await response.json() as { data: unknown };
  return body.data;
}

describe("Peecho callback boundary", () => {
  it("verifies the body signature before the repository sees any normalized event", async () => {
    const repository = new CallbackRepository();
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "test",
      provider: provider(),
      repository,
    });

    await expect(handler(request(callbackPayload({ signature: "0".repeat(64) })), REQUEST_ID)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(repository.calls).toBe(0);
  });

  it("ignores a reported reference and passes only the canonical identity with exact environments", async () => {
    const repository = new CallbackRepository();
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "staging",
      provider: provider(),
      repository,
    });

    expect(await responseData(await handler(
      request(callbackPayload({ order_reference: `buildy:${REQUEST_ID}` })),
      REQUEST_ID,
    ))).toMatchObject({
      accepted: true,
      applied: true,
    });
    expect(repository.events[0]).toMatchObject({
      inboxEnvironment: "staging",
      providerEnvironment: "test",
      event: { merchantReference: REFERENCE },
    });
  });

  it("applies a monotonic shipment once and reports a deterministic replay", async () => {
    const repository = new CallbackRepository();
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "test",
      provider: provider({ statuses: ["SHIPPED"] }),
      repository,
    });
    const payload = callbackPayload({
      old_status: "IN_PRODUCTION",
      new_status: "SHIPPED",
      tracking_code: "TRACK-1",
      tracking_url: "https://carrier.example/track/TRACK-1",
    });

    expect(await responseData(await handler(request(payload), REQUEST_ID))).toMatchObject({
      replayed: false,
      applied: true,
      outcome: "applied",
    });
    expect(await responseData(await handler(request(payload), REQUEST_ID))).toMatchObject({
      replayed: true,
      applied: false,
    });
  });

  it("ignores an older signed status after a newer state was applied", async () => {
    const repository = new CallbackRepository();
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "test",
      provider: provider({ statuses: ["SHIPPED", "IN_PRODUCTION"] }),
      repository,
    });
    await handler(request(callbackPayload({ old_status: "IN_PRODUCTION", new_status: "SHIPPED" })), REQUEST_ID);

    const response = await handler(request(callbackPayload({ old_status: "PAID", new_status: "IN_PRODUCTION" })), REQUEST_ID);
    expect(await responseData(response)).toMatchObject({
      applied: false,
      outcome: "ignored_out_of_order",
    });
  });

  it.each(["FUTURE_PEECHO_STATE", "REFUNDED", "CANCELLED"])(
    "moves signed %s status to manual review",
    async (newStatus) => {
      const repository = new CallbackRepository();
      const handler = createPeechoCallbackHandler({
        applicationEnvironment: "test",
        provider: provider({ statuses: [newStatus] }),
        repository,
      });
      const response = await handler(request(callbackPayload({ new_status: newStatus })), REQUEST_ID);

      expect(await responseData(response)).toMatchObject({
        applied: true,
        outcome: "manual_review",
      });
    },
  );

  it("rejects non-JSON and oversized callback requests before verification", async () => {
    const repository = new CallbackRepository();
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "test",
      provider: provider(),
      repository,
    });

    await expect(handler(request(callbackPayload(), { "content-type": "text/plain" }), REQUEST_ID)).rejects.toMatchObject({
      status: 415,
    });
    await expect(handler(request(callbackPayload(), { "content-length": "65537" }), REQUEST_ID)).rejects.toMatchObject({
      status: 413,
    });
    expect(repository.calls).toBe(0);
  });

  it("ignores forged fields behind a reused valid order digest and applies only canonical state", async () => {
    const repository = new CallbackRepository();
    const canonicalProvider = provider({ statuses: ["IN_PRODUCTION"] });
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "test",
      provider: canonicalProvider,
      repository,
    });

    expect(await responseData(await handler(request(callbackPayload({
      old_status: "IN_PRODUCTION",
      new_status: "SHIPPED",
      tracking_code: "FORGED",
      tracking_url: "https://attacker.example/track",
    })), REQUEST_ID))).toMatchObject({
      accepted: true,
      applied: true,
    });
    expect(canonicalProvider.getOrder).toHaveBeenCalledOnce();
    expect(repository.events[0]?.event).toMatchObject({
      merchantReference: REFERENCE,
      oldStatus: { providerStatus: "IN_PRODUCTION" },
      newStatus: { providerStatus: "IN_PRODUCTION" },
      trackingCode: null,
      trackingUrl: null,
    });
  });

  it("persists and deduplicates only canonical status and tracking fields", async () => {
    const repository = new CallbackRepository();
    const canonicalProvider = provider({
      statuses: ["SHIPPED"],
      trackingCode: "CANONICAL-TRACK",
      trackingUrl: "https://carrier.example/track/CANONICAL-TRACK",
    });
    const handler = createPeechoCallbackHandler({
      applicationEnvironment: "test",
      provider: canonicalProvider,
      repository,
    });

    const first = callbackPayload({
      old_status: "IN_PRODUCTION",
      new_status: "SHIPPED",
      tracking_code: "FORGED-A",
      tracking_url: "https://attacker.example/a",
    });
    const second = { ...first, tracking_code: "FORGED-B", tracking_url: "https://attacker.example/b" };

    expect(await responseData(await handler(request(first), REQUEST_ID))).toMatchObject({
      replayed: false,
      applied: true,
    });
    expect(await responseData(await handler(request(second), REQUEST_ID))).toMatchObject({
      replayed: true,
      applied: false,
    });
    expect(repository.events).toHaveLength(2);
    expect(repository.events[0]?.event).toMatchObject({
      oldStatus: { providerStatus: "SHIPPED" },
      newStatus: { providerStatus: "SHIPPED" },
      trackingCode: "CANONICAL-TRACK",
      trackingUrl: "https://carrier.example/track/CANONICAL-TRACK",
    });
    expect(repository.events[1]?.event.eventKey).toBe(repository.events[0]?.event.eventKey);
  });
});

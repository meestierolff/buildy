// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createBrevoWebhookHandler,
  parseBrevoDeliveryEvent,
  type BrevoDeliveryEvent,
  type BrevoWebhookRepository,
} from "../../server/email/brevoWebhook";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const SECRET = "b".repeat(32);

function payload(event = "delivered") {
  return JSON.stringify({
    event,
    email: "synthetic-private@example.test",
    id: 123,
    "message-id": "<provider-message-id@relay.test>",
    subject: "Privéonderwerp dat niet bewaard mag worden",
    ts_event: Math.floor(Date.now() / 1_000),
  });
}

class RecordingRepository implements BrevoWebhookRepository {
  readonly events: BrevoDeliveryEvent[] = [];

  async ingest(event: BrevoDeliveryEvent) {
    this.events.push(event);
    return { applied: true };
  }
}

describe("Brevo delivery webhook", () => {
  it("authenticates with a bearer secret and persists only a minimized event", async () => {
    const repository = new RecordingRepository();
    const handler = createBrevoWebhookHandler({
      environment: "staging",
      repository,
      secret: SECRET,
    });
    const response = await handler(new Request("https://app.buildy.test/api/webhooks/brevo", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: payload(),
    }), REQUEST_ID);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ data: { accepted: true, applied: true } });
    expect(repository.events[0]).toMatchObject({
      environment: "staging",
      eventType: "delivered",
      providerMessageId: "provider-message-id@relay.test",
      payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      providerEventId: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(repository.events)).not.toContain("synthetic-private@example.test");
    expect(JSON.stringify(repository.events)).not.toContain("Privéonderwerp");
  });

  it("rejects a forged bearer value before reading or persisting the payload", async () => {
    const repository = new RecordingRepository();
    const handler = createBrevoWebhookHandler({ environment: "test", repository, secret: SECRET });
    const request = new Request("https://app.buildy.test/api/webhooks/brevo", {
      method: "POST",
      headers: { authorization: "Bearer forged" },
      body: payload(),
    });
    const text = vi.spyOn(request, "text");

    await expect(handler(request, REQUEST_ID)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
    expect(text).not.toHaveBeenCalled();
    expect(repository.events).toHaveLength(0);
  });

  it("accepts but ignores events outside the configured delivery lifecycle", async () => {
    const repository = new RecordingRepository();
    const handler = createBrevoWebhookHandler({ environment: "test", repository, secret: SECRET });
    const response = await handler(new Request("https://app.buildy.test/api/webhooks/brevo", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: payload("opened"),
    }), REQUEST_ID);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: false, reason: "event_ignored" },
    });
    expect(repository.events).toHaveLength(0);
  });

  it("derives stable semantic replay ids despite irrelevant JSON ordering", () => {
    const timestamp = Math.floor(Date.now() / 1_000);
    const first = parseBrevoDeliveryEvent(JSON.stringify({
      event: "hard_bounce",
      "message-id": "message@relay.test",
      ts_event: timestamp,
      email: "first@example.test",
    }), "test");
    const second = parseBrevoDeliveryEvent(JSON.stringify({
      email: "second@example.test",
      ts_event: timestamp,
      "message-id": "<message@relay.test>",
      event: "hard_bounced",
    }), "test");

    expect(first?.providerEventId).toBe(second?.providerEventId);
    expect(first?.payloadSha256).not.toBe(second?.payloadSha256);
  });

  it("rejects malformed and oversized bodies before database access", async () => {
    expect(() => parseBrevoDeliveryEvent("not-json", "test")).toThrow("geen geldige JSON");
    expect(() => parseBrevoDeliveryEvent(`{"padding":"${"x".repeat(70_000)}"}`, "test"))
      .toThrow("ongeldige grootte");
  });
});

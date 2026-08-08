import { describe, expect, it, vi } from "vitest";
import {
  BrevoTransactionalEmailProvider,
  brevoIdempotencyKey,
} from "../../server/email/brevoTransactionalEmail";
import {
  MemoryEmailSink,
  TransactionalEmailError,
  type TransactionalEmailMessage,
} from "../../server/email/transactionalEmail";

const message: TransactionalEmailMessage = {
  recipient: { email: "bouwer@example.test", name: "Bouwer" },
  templateId: 42,
  parameters: { projectTitle: "Keizersgracht 42", count: 3 },
  idempotencyKey: "auth_verify:12345678",
  tags: ["auth", "verification"],
};

describe("transactional e-mail providers", () => {
  it("keeps local test messages provider-free and immutable from the caller", async () => {
    const sink = new MemoryEmailSink();
    const localMessage = structuredClone(message);
    const receipt = await sink.send(localMessage);
    if (!("parameters" in localMessage) || !localMessage.parameters) {
      throw new Error("expected template message");
    }
    localMessage.parameters.count = 4;

    expect(receipt.provider).toBe("local");
    const stored = sink.messages[0];
    expect(stored && "parameters" in stored ? stored.parameters?.count : undefined).toBe(3);
  });

  it("sends a Brevo template with provider idempotency and no API key in the body", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ messageId: "<provider-message-id>" }, { status: 201 }),
    );
    const provider = new BrevoTransactionalEmailProvider({
      apiKey: "secret-api-key",
      senderEmail: "berichten@buildy.example",
      senderName: "Buildy",
    }, request);

    const receipt = await provider.send(message);
    const [, init] = request.mock.calls[0];
    const body = String(init?.body);

    expect(receipt.messageId).toBe("provider-message-id");
    expect(init?.headers).toMatchObject({ "api-key": "secret-api-key" });
    const providerKey = brevoIdempotencyKey(message.idempotencyKey);
    expect(providerKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body).toContain(`"idempotencyKey":"${providerKey}"`);
    expect(body).not.toContain(message.idempotencyKey);
    expect(body).not.toContain("secret-api-key");
  });

  it("sends repo-owned HTML and text without a provider template", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ messageId: "order-message-id" }, { status: 201 }),
    );
    const provider = new BrevoTransactionalEmailProvider({
      apiKey: "secret-api-key",
      senderEmail: "berichten@buildy.example",
      senderName: "Buildy",
    }, request);

    await provider.send({
      recipient: { email: "bouwer@example.test" },
      content: {
        subject: "Je bestelling is bevestigd",
        html: "<p>Bevestigd</p>",
        text: "Bevestigd",
      },
      idempotencyKey: "order:12345678:confirmation",
      tags: ["order", "confirmation"],
    });

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      subject: "Je bestelling is bevestigd",
      htmlContent: "<p>Bevestigd</p>",
      textContent: "Bevestigd",
    });
    expect(body).not.toHaveProperty("templateId");
    expect(body).not.toHaveProperty("params");
  });

  it("derives one stable provider UUID per durable logical message", () => {
    expect(brevoIdempotencyKey(message.idempotencyKey)).toBe(
      brevoIdempotencyKey(message.idempotencyKey),
    );
    expect(brevoIdempotencyKey(message.idempotencyKey)).not.toBe(
      brevoIdempotencyKey(`${message.idempotencyKey}:other`),
    );
  });

  it("classifies provider throttling as retryable without echoing a response body", async () => {
    const provider = new BrevoTransactionalEmailProvider({
      apiKey: "secret-api-key",
      senderEmail: "berichten@buildy.example",
      senderName: "Buildy",
    }, vi.fn<typeof fetch>().mockResolvedValue(new Response("recipient@example.test", { status: 429 })));

    await expect(provider.send(message)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    } satisfies Partial<TransactionalEmailError>);
  });

  it("rejects invalid recipients before calling a provider", async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new BrevoTransactionalEmailProvider({
      apiKey: "secret-api-key",
      senderEmail: "berichten@buildy.example",
      senderName: "Buildy",
    }, request);

    await expect(provider.send({ ...message, recipient: { email: "not-an-email" } })).rejects.toMatchObject({
      code: "INVALID_EMAIL",
      retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
  });
});

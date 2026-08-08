// @vitest-environment node

import { describe, expect, it } from "vitest";
import { AuthUnavailableError } from "../../server/auth/errors";
import {
  authEmailIdempotencyKey,
  createAuthEmailCallbacks,
  type AuthEmailMessage,
  type AuthEmailOutbox,
} from "../../server/auth/outbox";

describe("auth e-mail outbox callbacks", () => {
  it("enqueues normalized, idempotent intents for all auth e-mail flows", async () => {
    const messages: AuthEmailMessage[] = [];
    const outbox: AuthEmailOutbox = {
      async enqueue(message) {
        messages.push(message);
      },
    };
    const callbacks = createAuthEmailCallbacks(outbox, ["https://app.buildy.test"]);

    await callbacks.sendVerificationEmail({
      token: "verify-token",
      url: "https://app.buildy.test/api/auth/verify-email?token=verify-token",
      user: { email: "  Bewoner@Example.COM ", id: "auth-user-1" },
    });
    await callbacks.sendMagicLink({
      email: "Bewoner@Example.COM",
      token: "magic-token",
      url: "https://app.buildy.test/api/auth/magic-link/verify?token=magic-token",
    });
    await callbacks.sendPasswordReset({
      token: "reset-token",
      url: "https://app.buildy.test/api/auth/reset-password/reset-token",
      user: { email: "Bewoner@Example.COM", id: "auth-user-1" },
    });

    expect(messages.map(({ kind }) => kind)).toEqual([
      "verify_email",
      "magic_link",
      "reset_password",
    ]);
    expect(messages.every(({ recipient }) => recipient === "bewoner@example.com")).toBe(true);
    expect(messages[0]).toMatchObject({ authUserId: "auth-user-1" });
    expect(messages[1].authUserId).toBeUndefined();
    expect(messages[0].idempotencyKey).not.toContain("verify-token");
  });

  it("creates stable keys without preserving recipient case", () => {
    expect(authEmailIdempotencyKey("magic_link", "A@EXAMPLE.COM", "token")).toBe(
      authEmailIdempotencyKey("magic_link", "a@example.com", "token"),
    );
    expect(authEmailIdempotencyKey("magic_link", "a@example.com", "token")).not.toBe(
      authEmailIdempotencyKey("reset_password", "a@example.com", "token"),
    );
  });

  it("never enqueues an action URL for an untrusted origin", async () => {
    const messages: AuthEmailMessage[] = [];
    const callbacks = createAuthEmailCallbacks(
      { enqueue: async (message) => void messages.push(message) },
      ["https://app.buildy.test"],
    );

    await expect(
      callbacks.sendMagicLink({
        email: "bewoner@example.com",
        token: "secret-token",
        url: "https://attacker.test/steal?token=secret-token",
      }),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(messages).toEqual([]);
  });

  it("turns a failed durable enqueue into a secret-free unavailable error", async () => {
    const callbacks = createAuthEmailCallbacks(
      {
        async enqueue() {
          throw new Error("postgresql://user:password@database.invalid/buildy");
        },
      },
      ["https://app.buildy.test"],
    );

    await expect(
      callbacks.sendMagicLink({
        email: "bewoner@example.com",
        token: "secret-token",
        url: "https://app.buildy.test/api/auth/magic-link/verify?token=secret-token",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "De authenticatieservice is niet beschikbaar.",
        reason: "email_outbox_failed",
      }),
    );
  });
});

import { createHash } from "node:crypto";
import { AuthUnavailableError } from "./errors.js";

export type AuthEmailKind = "verify_email" | "magic_link" | "reset_password";

export interface AuthEmailMessage {
  authUserId?: string;
  idempotencyKey: string;
  kind: AuthEmailKind;
  recipient: string;
  url: string;
}

/**
 * The concrete implementation must durably enqueue and return only after the
 * write commits. It must never call an e-mail provider from the auth request.
 */
export interface AuthEmailOutbox {
  enqueue(message: AuthEmailMessage): Promise<void>;
}

interface AuthEmailCallbacks {
  sendMagicLink(data: { email: string; token: string; url: string }): Promise<void>;
  sendPasswordReset(data: {
    token: string;
    url: string;
    user: { email: string; id: string };
  }): Promise<void>;
  sendVerificationEmail(data: {
    token: string;
    url: string;
    user: { email: string; id: string };
  }): Promise<void>;
}

function normalizedRecipient(email: string): string {
  return email.trim().toLowerCase();
}

function assertTrustedActionUrl(urlValue: string, trustedOrigins: ReadonlySet<string>): string {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new AuthUnavailableError("configuration_invalid");
  }

  if (url.username || url.password || url.hash || !trustedOrigins.has(url.origin)) {
    throw new AuthUnavailableError("configuration_invalid");
  }

  return url.toString();
}

export function authEmailIdempotencyKey(
  kind: AuthEmailKind,
  recipient: string,
  token: string,
): string {
  const digest = createHash("sha256")
    .update("buildy-auth-email-v1\0")
    .update(kind)
    .update("\0")
    .update(normalizedRecipient(recipient))
    .update("\0")
    .update(token)
    .digest("hex");

  return `auth-email:v1:${kind}:${digest}`;
}

export function createAuthEmailCallbacks(
  outbox: AuthEmailOutbox,
  trustedOriginValues: readonly string[],
): AuthEmailCallbacks {
  const trustedOrigins = new Set(trustedOriginValues);

  async function enqueue(message: AuthEmailMessage): Promise<void> {
    try {
      await outbox.enqueue(message);
    } catch {
      throw new AuthUnavailableError("email_outbox_failed");
    }
  }

  return {
    async sendMagicLink({ email, token, url }) {
      const recipient = normalizedRecipient(email);
      await enqueue({
        idempotencyKey: authEmailIdempotencyKey("magic_link", recipient, token),
        kind: "magic_link",
        recipient,
        url: assertTrustedActionUrl(url, trustedOrigins),
      });
    },

    async sendPasswordReset({ token, url, user }) {
      const recipient = normalizedRecipient(user.email);
      await enqueue({
        authUserId: user.id,
        idempotencyKey: authEmailIdempotencyKey("reset_password", recipient, token),
        kind: "reset_password",
        recipient,
        url: assertTrustedActionUrl(url, trustedOrigins),
      });
    },

    async sendVerificationEmail({ token, url, user }) {
      const recipient = normalizedRecipient(user.email);
      await enqueue({
        authUserId: user.id,
        idempotencyKey: authEmailIdempotencyKey("verify_email", recipient, token),
        kind: "verify_email",
        recipient,
        url: assertTrustedActionUrl(url, trustedOrigins),
      });
    },
  };
}

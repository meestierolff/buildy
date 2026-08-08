export type AuthUnavailableReason =
  | "configuration_missing"
  | "configuration_invalid"
  | "email_outbox_unconfigured"
  | "email_outbox_failed"
  | "initialization_failed";

/**
 * Deliberately contains no configuration values, credentials, recipients, or
 * action URLs. It is safe to classify at the HTTP boundary without leaking PII.
 */
export class AuthUnavailableError extends Error {
  readonly reason: AuthUnavailableReason;

  constructor(reason: AuthUnavailableReason) {
    super("De authenticatieservice is niet beschikbaar.");
    this.name = "AuthUnavailableError";
    this.reason = reason;
  }
}

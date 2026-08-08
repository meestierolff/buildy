import { z } from "zod";
import type { AuthEmailKind } from "../auth/outbox.js";

export const EMAIL_TEMPLATE_KEYS = [
  "auth.verify_email",
  "auth.magic_link",
  "auth.reset_password",
  "lifecycle.welcome",
  "social.access_requested",
  "social.access_accepted",
  "security.account_alert",
  "order.confirmation",
  "order.payment_failed",
  "order.in_production",
  "order.shipped",
  "order.tracking",
  "order.refund_review",
  "support.confirmation",
  "moderation.report_received",
  "migration.account",
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export interface EmailTemplateDefinition {
  id: number;
  version: string;
}

const definitionSchema = z.object({
  id: z.number().int().positive(),
  version: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
}).strict();

const catalogSchema = z.record(z.enum(EMAIL_TEMPLATE_KEYS), definitionSchema);

export class EmailTemplateConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmailTemplateConfigurationError";
  }
}

export class EmailTemplateCatalog {
  constructor(private readonly definitions: Partial<Record<EmailTemplateKey, EmailTemplateDefinition>>) {}

  resolve(key: EmailTemplateKey): EmailTemplateDefinition {
    const definition = this.definitions[key];
    if (!definition) {
      throw new EmailTemplateConfigurationError(`E-mailtemplate ontbreekt: ${key}.`);
    }
    return definition;
  }

  hasAll(keys: readonly EmailTemplateKey[]): boolean {
    return keys.every((key) => Boolean(this.definitions[key]));
  }
}

export function parseEmailTemplateCatalog(value: string): EmailTemplateCatalog {
  try {
    const parsed = catalogSchema.parse(JSON.parse(value));
    return new EmailTemplateCatalog(parsed);
  } catch (error) {
    throw new EmailTemplateConfigurationError("BREVO_TEMPLATE_IDS is ongeldig.", { cause: error });
  }
}

export const AUTH_EMAIL_TEMPLATE_KEYS = [
  "auth.verify_email",
  "auth.magic_link",
  "auth.reset_password",
] as const satisfies readonly EmailTemplateKey[];

export const ORDER_EMAIL_TEMPLATE_KEYS = [
  "order.confirmation",
  "order.payment_failed",
  "order.in_production",
  "order.shipped",
  "order.refund_review",
] as const satisfies readonly EmailTemplateKey[];

export const COMMUNITY_EMAIL_TEMPLATE_KEYS = [
  "support.confirmation",
  "moderation.report_received",
] as const satisfies readonly EmailTemplateKey[];

export const ACCOUNT_EVENT_EMAIL_TEMPLATE_KEYS = [
  "lifecycle.welcome",
  "social.access_requested",
  "social.access_accepted",
  "security.account_alert",
  "migration.account",
] as const satisfies readonly EmailTemplateKey[];

export function templateKeyForAuthEmail(kind: AuthEmailKind): EmailTemplateKey {
  switch (kind) {
    case "verify_email":
      return "auth.verify_email";
    case "magic_link":
      return "auth.magic_link";
    case "reset_password":
      return "auth.reset_password";
  }
}

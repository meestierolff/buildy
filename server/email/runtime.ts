import type { RuntimeConfig } from "../config/runtime.js";
import { getRuntimeConfig } from "../config/runtime.js";
import { getBuildyWorkerDatabase } from "../db/client.js";
import { resolveRuntimeDataProtection } from "../security/runtimeDataProtection.js";
import { BrevoTransactionalEmailProvider } from "./brevoTransactionalEmail.js";
import { PostgresEmailWorkerRepository } from "./postgresWorkerRepository.js";
import {
  ACCOUNT_EVENT_EMAIL_TEMPLATE_KEYS,
  AUTH_EMAIL_TEMPLATE_KEYS,
  COMMUNITY_EMAIL_TEMPLATE_KEYS,
  EmailTemplateConfigurationError,
  ORDER_EMAIL_TEMPLATE_KEYS,
  parseEmailTemplateCatalog,
} from "./templates.js";
import { EmailOutboxWorker } from "./worker.js";

type ConfiguredEmailRuntime = RuntimeConfig & Required<Pick<
  RuntimeConfig,
  | "DATABASE_EMAIL_WORKER_URL"
  | "PII_ENCRYPTION_KEYS"
  | "PII_ENCRYPTION_CURRENT_VERSION"
  | "PII_BLIND_INDEX_KEY"
  | "BREVO_API_KEY"
  | "BREVO_SENDER_EMAIL"
  | "BREVO_SENDER_NAME"
  | "BREVO_TEMPLATE_IDS"
  | "CRON_SECRET"
>>;

function isConfigured(config: RuntimeConfig): config is ConfiguredEmailRuntime {
  return Boolean(
    config.DATABASE_EMAIL_WORKER_URL
    && config.PII_ENCRYPTION_KEYS
    && config.PII_ENCRYPTION_CURRENT_VERSION
    && config.PII_BLIND_INDEX_KEY
    && config.BREVO_API_KEY
    && config.BREVO_SENDER_EMAIL
    && config.BREVO_SENDER_NAME
    && config.BREVO_TEMPLATE_IDS
    && config.CRON_SECRET
  );
}

export class EmailWorkerUnavailableError extends Error {
  constructor(public readonly reason: "unconfigured" | "invalid_configuration") {
    super("De e-mailworker is niet beschikbaar.");
    this.name = "EmailWorkerUnavailableError";
  }
}

export interface ConfiguredEmailWorker {
  cronSecret: string;
  worker: EmailOutboxWorker;
}

let cachedWorker: ConfiguredEmailWorker | undefined;

export function createEmailWorker(config: RuntimeConfig): ConfiguredEmailWorker {
  if (!isConfigured(config)) throw new EmailWorkerUnavailableError("unconfigured");

  try {
    const protection = resolveRuntimeDataProtection(config);
    const templates = parseEmailTemplateCatalog(config.BREVO_TEMPLATE_IDS);
    if (!templates.hasAll([
      ...AUTH_EMAIL_TEMPLATE_KEYS,
      ...ORDER_EMAIL_TEMPLATE_KEYS,
      ...COMMUNITY_EMAIL_TEMPLATE_KEYS,
      ...ACCOUNT_EVENT_EMAIL_TEMPLATE_KEYS,
    ])) {
      throw new EmailTemplateConfigurationError("Niet alle transactionele e-mailversies zijn geconfigureerd.");
    }
    const database = getBuildyWorkerDatabase(config.DATABASE_EMAIL_WORKER_URL, "email");
    const provider = new BrevoTransactionalEmailProvider({
      apiKey: config.BREVO_API_KEY,
      senderEmail: config.BREVO_SENDER_EMAIL,
      senderName: config.BREVO_SENDER_NAME,
    });

    return {
      cronSecret: config.CRON_SECRET,
      worker: new EmailOutboxWorker(
        new PostgresEmailWorkerRepository(database),
        provider,
        protection.keyring,
        protection.blindIndex,
        templates,
        { appOrigin: config.APP_ORIGIN },
      ),
    };
  } catch (error) {
    if (error instanceof EmailWorkerUnavailableError) throw error;
    throw new EmailWorkerUnavailableError("invalid_configuration");
  }
}

export function resolveDefaultEmailWorker(): ConfiguredEmailWorker {
  cachedWorker ??= createEmailWorker(getRuntimeConfig());
  return cachedWorker;
}

export function resetDefaultEmailWorkerForTests(): void {
  cachedWorker = undefined;
}

import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeConfig } from "../config/runtime.js";
import { getRuntimeConfig } from "../config/runtime.js";
import type { BuildyDatabase } from "../db/client.js";
import { getBuildyDatabase } from "../db/client.js";
import { HttpError } from "../http/errors.js";
import { jsonSuccess } from "../http/responses.js";
import { canonicalBrevoMessageId } from "./brevoTransactionalEmail.js";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export type BrevoDeliveryEventType =
  | "request"
  | "delivered"
  | "deferred"
  | "soft_bounce"
  | "hard_bounce"
  | "invalid_email"
  | "blocked"
  | "spam"
  | "error";

export type ProviderEnvironment = "preview" | "staging" | "production" | "test";

export interface BrevoDeliveryEvent {
  environment: ProviderEnvironment;
  eventAt: string;
  eventType: BrevoDeliveryEventType;
  payloadSha256: string;
  providerEventId: string;
  providerMessageId: string;
}

export interface BrevoWebhookRepository {
  ingest(event: BrevoDeliveryEvent): Promise<{ applied: boolean }>;
}

const payloadSchema = z.object({
  event: z.string().trim().min(1).max(80),
  "message-id": z.string().trim().min(1).max(502),
  ts_event: z.coerce.number().int().positive(),
}).passthrough();

const eventAliases: Readonly<Record<string, BrevoDeliveryEventType>> = {
  request: "request",
  delivered: "delivered",
  deferred: "deferred",
  soft_bounce: "soft_bounce",
  soft_bounced: "soft_bounce",
  hard_bounce: "hard_bounce",
  hard_bounced: "hard_bounce",
  invalid: "invalid_email",
  invalid_email: "invalid_email",
  blocked: "blocked",
  spam: "spam",
  error: "error",
};

function bearerMatches(header: string | null, secret: string): boolean {
  const actual = createHash("sha256").update(header ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(actual, expected);
}

function providerEnvironment(environment: RuntimeConfig["APP_ENV"]): ProviderEnvironment {
  return environment === "local" ? "test" : environment;
}

export function parseBrevoDeliveryEvent(
  rawBody: string,
  environment: ProviderEnvironment,
): BrevoDeliveryEvent | null {
  const bytes = Buffer.byteLength(rawBody);
  if (bytes < 2 || bytes > MAX_WEBHOOK_BYTES) {
    throw new HttpError(400, "BAD_REQUEST", "De webhookpayload heeft een ongeldige grootte.");
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "De webhookpayload is geen geldige JSON.");
  }

  const payload = payloadSchema.safeParse(rawPayload);
  if (!payload.success) {
    throw new HttpError(400, "BAD_REQUEST", "De webhookpayload mist verplichte velden.");
  }
  const eventType = eventAliases[payload.data.event.toLowerCase()];
  if (!eventType) return null;

  let providerMessageId: string;
  try {
    providerMessageId = canonicalBrevoMessageId(payload.data["message-id"]);
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Het webhookbericht-ID is ongeldig.");
  }
  const eventAt = new Date(payload.data.ts_event * 1_000);
  if (
    Number.isNaN(eventAt.getTime())
    || eventAt < new Date("2020-01-01T00:00:00.000Z")
    || eventAt.getTime() > Date.now() + 5 * 60_000
  ) {
    throw new HttpError(400, "BAD_REQUEST", "Het webhookievent heeft een ongeldige tijd.");
  }

  const providerEventId = createHash("sha256")
    .update("buildy-brevo-event-v1\0")
    .update(eventType)
    .update("\0")
    .update(providerMessageId)
    .update("\0")
    .update(String(payload.data.ts_event))
    .digest("hex");

  return {
    environment,
    eventAt: eventAt.toISOString(),
    eventType,
    payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    providerEventId,
    providerMessageId,
  };
}

export class PostgresBrevoWebhookRepository implements BrevoWebhookRepository {
  constructor(private readonly database: BuildyDatabase) {}

  async ingest(event: BrevoDeliveryEvent): Promise<{ applied: boolean }> {
    const result = await this.database.execute<{ applied: boolean }>(sql`
      select app_ingest_brevo_delivery_event(
        ${event.environment},
        ${event.providerEventId},
        ${event.eventType},
        ${event.providerMessageId},
        ${event.payloadSha256},
        ${event.eventAt}::timestamptz
      ) as applied
    `);
    return { applied: result.rows[0]?.applied === true };
  }
}

export function createBrevoWebhookHandler(input: {
  environment: ProviderEnvironment;
  repository: BrevoWebhookRepository;
  secret: string;
}) {
  return async (request: Request, requestId: string): Promise<Response> => {
    if (!bearerMatches(request.headers.get("authorization"), input.secret)) {
      throw new HttpError(401, "UNAUTHENTICATED", "Deze providerroute is niet toegankelijk.");
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_WEBHOOK_BYTES) {
      throw new HttpError(413, "BAD_REQUEST", "De webhookpayload is te groot.");
    }

    const event = parseBrevoDeliveryEvent(await request.text(), input.environment);
    if (!event) return jsonSuccess({ accepted: false, reason: "event_ignored" as const }, requestId, { status: 202 });
    const result = await input.repository.ingest(event);
    return jsonSuccess({ accepted: true, applied: result.applied }, requestId, { status: 202 });
  };
}

let defaultHandler: ReturnType<typeof createBrevoWebhookHandler> | undefined;

export function handleDefaultBrevoWebhook(request: Request, requestId: string): Promise<Response> {
  if (!defaultHandler) {
    const config = getRuntimeConfig();
    if (!config.DATABASE_URL || !config.BREVO_WEBHOOK_SECRET) {
      throw new HttpError(503, "PROVIDER_UNAVAILABLE", "De e-mailwebhook is niet geconfigureerd.");
    }
    defaultHandler = createBrevoWebhookHandler({
      environment: providerEnvironment(config.APP_ENV),
      repository: new PostgresBrevoWebhookRepository(getBuildyDatabase(config.DATABASE_URL)),
      secret: config.BREVO_WEBHOOK_SECRET,
    });
  }
  return defaultHandler(request, requestId);
}

export function resetDefaultBrevoWebhookForTests(): void {
  defaultHandler = undefined;
}

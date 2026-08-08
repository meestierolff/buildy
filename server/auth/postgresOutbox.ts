import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { BuildyDatabase } from "../db/client.js";
import {
  DataProtectionKeyring,
  PrivacyBlindIndex,
} from "../security/dataProtection.js";
import type { AuthEmailMessage, AuthEmailOutbox } from "./outbox.js";

interface ProtectedAuthEmailPayload extends Record<string, unknown> {
  schemaVersion: 1;
  kind: AuthEmailMessage["kind"];
  authUserIdHash?: string;
  recipientCiphertext: string;
  actionUrlCiphertext: string;
}

export interface AuthEmailOutboxRecord {
  aggregateId: string;
  aggregateType: "auth_email";
  eventType: `auth.email.${AuthEmailMessage["kind"]}`;
  idempotencyKey: string;
  payload: ProtectedAuthEmailPayload;
}

function deterministicAggregateId(idempotencyKey: string): string {
  const bytes = createHash("sha256")
    .update("buildy-auth-outbox-aggregate-v1\0")
    .update(idempotencyKey)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildProtectedAuthEmailRecord(
  message: AuthEmailMessage,
  keyring: DataProtectionKeyring,
  blindIndex: PrivacyBlindIndex,
): AuthEmailOutboxRecord {
  const aggregateId = deterministicAggregateId(message.idempotencyKey);
  const context = `auth-outbox:${aggregateId}:${message.kind}`;

  return {
    aggregateId,
    aggregateType: "auth_email",
    eventType: `auth.email.${message.kind}`,
    idempotencyKey: message.idempotencyKey,
    payload: {
      schemaVersion: 1,
      kind: message.kind,
      ...(message.authUserId
        ? { authUserIdHash: blindIndex.create("auth-user-id", message.authUserId) }
        : {}),
      recipientCiphertext: keyring.encrypt(message.recipient, `${context}:recipient`),
      actionUrlCiphertext: keyring.encrypt(message.url, `${context}:action-url`),
    },
  };
}

export class PostgresAuthEmailOutbox implements AuthEmailOutbox {
  constructor(
    private readonly database: BuildyDatabase,
    private readonly keyring: DataProtectionKeyring,
    private readonly blindIndex: PrivacyBlindIndex,
  ) {}

  async enqueue(message: AuthEmailMessage): Promise<void> {
    const record = buildProtectedAuthEmailRecord(message, this.keyring, this.blindIndex);
    await this.database.execute(sql`
      select app_enqueue_auth_email(
        ${record.aggregateId}::uuid,
        ${record.eventType},
        ${record.idempotencyKey},
        ${JSON.stringify(record.payload)}::jsonb
      )
    `);
  }
}

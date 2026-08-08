import { z } from "zod";
import type { DataProtectionKeyring, PrivacyBlindIndex } from "../security/dataProtection.js";

const inputSchema = z.object({
  appUserId: z.string().uuid(),
  email: z.string().trim().email().max(254),
}).strict();

export interface MigrationAccountEmailDatabase {
  query(
    queryText: string,
    values: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface MigrationAccountEmailResult {
  queued: boolean;
  replayed: boolean;
}

/**
 * Protects legacy recipient PII before crossing the target database boundary.
 * Callers receive only delivery state; this producer deliberately has no
 * logging callback and never includes the address in its result or errors.
 */
export async function enqueueMigrationAccountEmail(
  database: MigrationAccountEmailDatabase,
  keyring: DataProtectionKeyring,
  blindIndex: PrivacyBlindIndex,
  rawInput: { appUserId: string; email: string },
): Promise<MigrationAccountEmailResult> {
  const input = inputSchema.parse(rawInput);
  const email = input.email.normalize("NFKC").trim().toLowerCase();
  const ciphertext = keyring.encrypt(email, `email-recipient:${input.appUserId}:address`);
  const recipientHash = blindIndex.create("email-recipient", email);
  const result = await database.query(`
    SELECT queued, replayed
    FROM public.app_enqueue_migration_account_email($1::uuid, $2::text, $3::text)
  `, [input.appUserId, ciphertext, recipientHash]);
  const row = result.rows[0];
  if (!row || typeof row.queued !== "boolean" || typeof row.replayed !== "boolean") {
    throw new Error("Accountmigratie-e-mailproducer gaf geen geldig resultaat.");
  }
  return { queued: row.queued, replayed: row.replayed };
}

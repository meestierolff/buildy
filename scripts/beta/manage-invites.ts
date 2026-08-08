#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { PrivacyBlindIndex } from "../../server/security/dataProtection";
import {
  betaInviteCodeHash,
  betaInviteEmailHash,
  generateBetaInviteCode,
} from "../../server/beta/crypto";

type Flags = Record<string, string>;

function parseArguments(values: readonly string[]): { command: string; flags: Flags } {
  const [command = "help", ...rest] = values;
  const flags: Flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Gebruik uitsluitend benoemde --flags met een waarde.");
    }
    const name = key.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(name) || flags[name] !== undefined) {
      throw new Error("CLI-flag is ongeldig of dubbel opgegeven.");
    }
    flags[name] = value;
  }
  return { command, flags };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Vereiste waarde ontbreekt: ${name}.`);
  return value;
}

function directDatabaseUrl(): string {
  const value = required(process.env.DATABASE_DIRECT_URL, "DATABASE_DIRECT_URL");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_DIRECT_URL moet PostgreSQL gebruiken.");
  }
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  if (!isLocal && !["require", "verify-ca", "verify-full"].includes(sslMode ?? "")) {
    throw new Error("Een externe databaseverbinding moet TLS afdwingen.");
  }
  return value;
}

function blindIndex(): PrivacyBlindIndex {
  return new PrivacyBlindIndex(required(process.env.PII_BLIND_INDEX_KEY, "PII_BLIND_INDEX_KEY"));
}

function integerFlag(flags: Flags, name: string, fallback: number, min: number, max: number): number {
  const value = flags[name] === undefined ? fallback : Number(flags[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} moet tussen ${min} en ${max} liggen.`);
  }
  return value;
}

async function generate(flags: Flags): Promise<void> {
  const allowed = new Set(["output", "email", "max-uses", "expires-days", "cohort"]);
  if (Object.keys(flags).some((name) => !allowed.has(name))) {
    throw new Error("Onbekende generate-flag.");
  }
  const outputPath = resolve(required(flags.output, "--output"));
  const maxUses = integerFlag(flags, "max-uses", 1, 1, 100);
  const expiryDays = integerFlag(flags, "expires-days", 14, 1, 179);
  const cohort = flags.cohort ?? "private-beta";
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(cohort)) throw new Error("--cohort is ongeldig.");

  const indexes = blindIndex();
  const code = generateBetaInviteCode();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1_000);
  const emailHash = flags.email ? betaInviteEmailHash(flags.email, indexes) : null;
  const client = new Client({ connectionString: directDatabaseUrl() });
  let secretFileCreated = false;
  let committed = false;

  try {
    await client.connect();
    await client.query("begin");
    await client.query(
      `select id, expires_at from public.app_create_beta_invite(
        $1::uuid, $2::text, $3::text, $4::integer, $5::timestamptz, $6::text, $7::text
      )`,
      [
        id,
        betaInviteCodeHash(code, indexes),
        emailHash,
        maxUses,
        expiresAt.toISOString(),
        cohort,
        `beta-cli:${randomUUID()}`,
      ],
    );

    const file = await open(outputPath, "wx", 0o600);
    secretFileCreated = true;
    try {
      await file.writeFile(`${JSON.stringify({
        schemaVersion: 1,
        inviteId: id,
        inviteCode: code,
        expiresAt: expiresAt.toISOString(),
        maxUses,
        emailRestricted: emailHash !== null,
        cohort,
      }, null, 2)}\n`, { encoding: "utf8" });
      await file.sync();
    } finally {
      await file.close();
    }
    await client.query("commit");
    committed = true;
    process.stdout.write(`${JSON.stringify({ created: true, writtenTo: outputPath })}\n`);
  } catch {
    let rolledBack = false;
    try {
      await client.query("rollback");
      rolledBack = true;
    } catch {
      // A failed COMMIT has an unknown outcome. Preserve the one-time secret.
    }
    if (!committed && rolledBack && secretFileCreated) {
      await unlink(outputPath).catch(() => undefined);
    }
    throw new Error(
      secretFileCreated && !rolledBack
        ? "Invite-opdracht heeft een onbekende uitkomst; bewaar het outputbestand en controleer de auditlog."
        : "Invite-opdracht is mislukt; er is geen bruikbare uitnodiging uitgegeven.",
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function revoke(flags: Flags): Promise<void> {
  if (Object.keys(flags).some((name) => name !== "code-file")) {
    throw new Error("Onbekende revoke-flag.");
  }
  const codePath = resolve(required(flags["code-file"], "--code-file"));
  const fileStatus = await stat(codePath);
  if (!fileStatus.isFile() || (fileStatus.mode & 0o077) !== 0) {
    throw new Error("Het codebestand moet een regulier bestand met modus 0600 zijn.");
  }
  const payload = JSON.parse(await readFile(codePath, "utf8")) as { inviteCode?: unknown };
  if (typeof payload.inviteCode !== "string") throw new Error("Het codebestand is ongeldig.");

  const client = new Client({ connectionString: directDatabaseUrl() });
  try {
    await client.connect();
    const result = await client.query<{ revoked: boolean }>(
      "select public.app_revoke_beta_invite($1::text, $2::text) as revoked",
      [
        betaInviteCodeHash(payload.inviteCode, blindIndex()),
        `beta-cli:${randomUUID()}`,
      ],
    );
    process.stdout.write(`${JSON.stringify({ revoked: result.rows[0]?.revoked === true })}\n`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const { command, flags } = parseArguments(process.argv.slice(2));
  if (command === "generate") return generate(flags);
  if (command === "revoke") return revoke(flags);
  throw new Error(
    "Gebruik: generate --output <0600-bestand> [--email <adres>] [--max-uses 1] [--expires-days 14] [--cohort private-beta] of revoke --code-file <bestand>.",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Invite-opdracht is mislukt.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

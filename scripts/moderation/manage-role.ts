#!/usr/bin/env node
import { Client } from "pg";
import { z } from "zod";
import {
  assertSafeMigrationConnection,
  createMigrationClient,
  requireMigrationDatabaseUrl,
} from "../../db/migrate.ts";

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const operatorReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{2,119}$/);
const reasonCodeSchema = z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/);
const timestampSchema = z.string().datetime({ offset: true });

type ParsedArguments = {
  command: "grant" | "revoke";
  execute: boolean;
  confirm?: string;
  operationId: string;
  appUserId?: string;
  grantId?: string;
  role?: "moderator" | "admin";
  operatorReference: string;
  reasonCode: string;
  startsAt?: string;
  expiresAt?: string;
};

function usage(): never {
  throw new Error(
    "Gebruik grant|revoke met --operation-id, --operator-ref, --reason-code, --confirm en --execute; grant vereist daarnaast --app-user-id en --role, revoke --grant-id.",
  );
}

function flagValues(arguments_: string[]): Map<string, string | true> {
  const values = new Map<string, string | true>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument?.startsWith("--") || values.has(argument)) usage();
    if (argument === "--execute") {
      values.set(argument, true);
      continue;
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(argument, value);
    index += 1;
  }
  return values;
}

function stringFlag(values: Map<string, string | true>, name: string, required = true): string | undefined {
  const value = values.get(name);
  if (typeof value === "string") return value;
  if (required) usage();
  return undefined;
}

function parseArguments(arguments_: string[]): ParsedArguments {
  const command = arguments_[0];
  if (command !== "grant" && command !== "revoke") usage();
  const values = flagValues(arguments_.slice(1));
  const allowed = new Set([
    "--operation-id",
    "--app-user-id",
    "--grant-id",
    "--role",
    "--operator-ref",
    "--reason-code",
    "--starts-at",
    "--expires-at",
    "--confirm",
    "--execute",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) usage();

  const operationId = uuidSchema.parse(stringFlag(values, "--operation-id"));
  const operatorReference = operatorReferenceSchema.parse(stringFlag(values, "--operator-ref"));
  const reasonCode = reasonCodeSchema.parse(stringFlag(values, "--reason-code"));
  const confirm = stringFlag(values, "--confirm");
  const execute = values.get("--execute") === true;
  const startsAtValue = stringFlag(values, "--starts-at", false);
  const expiresAtValue = stringFlag(values, "--expires-at", false);
  const startsAt = startsAtValue ? timestampSchema.parse(startsAtValue) : undefined;
  const expiresAt = expiresAtValue ? timestampSchema.parse(expiresAtValue) : undefined;

  if (command === "grant") {
    const role = z.enum(["moderator", "admin"]).parse(stringFlag(values, "--role"));
    const appUserId = uuidSchema.parse(stringFlag(values, "--app-user-id"));
    if (values.has("--grant-id")) usage();
    return {
      command,
      execute,
      confirm,
      operationId,
      appUserId,
      role,
      operatorReference,
      reasonCode,
      startsAt,
      expiresAt,
    };
  }

  if (values.has("--app-user-id") || values.has("--role") || values.has("--starts-at") || values.has("--expires-at")) {
    usage();
  }
  return {
    command,
    execute,
    confirm,
    operationId,
    grantId: uuidSchema.parse(stringFlag(values, "--grant-id")),
    operatorReference,
    reasonCode,
  };
}

async function assertMigrationOwner(client: Client, command: ParsedArguments["command"]): Promise<void> {
  const signature = command === "grant"
    ? "public.app_migration_grant_role(uuid,uuid,text,text,text,timestamptz,timestamptz)"
    : "public.app_migration_revoke_role(uuid,uuid,text,text)";
  const result = await client.query<{ is_owner: boolean }>(`
    SELECT current_user = pg_catalog.pg_get_userbyid(procedure.proowner) AS is_owner
    FROM pg_catalog.pg_proc procedure
    WHERE procedure.oid = $1::regprocedure
  `, [signature]);
  if (result.rows[0]?.is_owner !== true) {
    throw new Error("MIGRATION_OWNER_REQUIRED");
  }
}

async function executeCommand(input: ParsedArguments): Promise<void> {
  const expectedConfirmation = `${input.command.toUpperCase()}:${input.operationId}`;
  if (!input.execute || input.confirm !== expectedConfirmation) {
    throw new Error("EXECUTION_CONFIRMATION_REQUIRED");
  }
  const databaseUrl = requireMigrationDatabaseUrl();
  const client = createMigrationClient(databaseUrl, 30_000);
  try {
    await client.connect();
    await assertSafeMigrationConnection(client, databaseUrl);
    await assertMigrationOwner(client, input.command);
    await client.query("BEGIN");
    if (input.command === "grant") {
      const result = await client.query<{
        grant_id: string;
        granted_role: "moderator" | "admin";
        active: boolean;
        expires_at: Date | null;
        replayed: boolean;
      }>(`
        SELECT * FROM public.app_migration_grant_role($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz)
      `, [
        input.operationId,
        input.appUserId,
        input.role,
        input.operatorReference,
        input.reasonCode,
        input.startsAt ?? null,
        input.expiresAt ?? null,
      ]);
      const row = result.rows[0];
      if (!row) throw new Error("ROLE_COMMAND_FAILED");
      await client.query("COMMIT");
      console.info(`Roltoekenning voltooid: ${row.granted_role}; actief=${row.active}; replay=${row.replayed}; grant=${row.grant_id}.`);
      return;
    }

    const result = await client.query<{
      grant_id: string;
      revoked_role: "moderator" | "admin";
      revoked_at: Date;
      replayed: boolean;
    }>(`
      SELECT * FROM public.app_migration_revoke_role($1::uuid, $2::uuid, $3, $4)
    `, [
      input.operationId,
      input.grantId,
      input.operatorReference,
      input.reasonCode,
    ]);
    const row = result.rows[0];
    if (!row) throw new Error("ROLE_COMMAND_FAILED");
    await client.query("COMMIT");
    console.info(`Rolintrekking voltooid: ${row.revoked_role}; replay=${row.replayed}; grant=${row.grant_id}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function safeFailure(error: unknown): string {
  if (error instanceof z.ZodError) return "ROLE_COMMAND_INVALID";
  if (error instanceof Error && [
    "EXECUTION_CONFIRMATION_REQUIRED",
    "MIGRATION_OWNER_REQUIRED",
    "ROLE_COMMAND_FAILED",
  ].includes(error.message)) return error.message;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return `ROLE_DATABASE_ERROR_${error.code.replace(/[^A-Z0-9]/gi, "").slice(0, 12) || "UNKNOWN"}`;
  }
  return "ROLE_COMMAND_INVALID";
}

Promise.resolve()
  .then(() => executeCommand(parseArguments(process.argv.slice(2))))
  .catch((error: unknown) => {
    console.error(safeFailure(error));
    process.exitCode = 1;
  });

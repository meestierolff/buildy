import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client, type ClientConfig } from "pg";

export const MIGRATION_RUNNER_VERSION = "1";
export const MIGRATION_LEDGER_SCHEMA = "buildy_meta";
export const MIGRATION_LEDGER_TABLE = "schema_migrations";
export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./migrations", import.meta.url));
export const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 120_000;
export const MAX_MIGRATION_BYTES = 10 * 1024 * 1024;

const ADVISORY_LOCK_NAMESPACE = 1_112_887_617;
const ADVISORY_LOCK_RESOURCE = 1_297_045_058;
const LOCK_POLL_INTERVAL_MS = 100;
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MIGRATION_FILENAME = /^(\d{4,14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export type MigrationMode = "apply" | "check" | "dry-run";

export type MigrationFile = {
  filename: string;
  path: string;
  sequence: number;
  sha256: string;
  byteLength: number;
  sql: string;
};

export type MigrationLedgerRecord = {
  filename: string;
  sequence: number | string;
  sha256: string;
};

export type MigrationPlan = {
  applied: MigrationFile[];
  pending: MigrationFile[];
};

export type MigrationRunnerOptions = {
  mode?: MigrationMode;
  migrationsDirectory?: string;
  databaseUrl?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  logger?: Pick<Console, "info" | "warn">;
};

export class MigrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationValidationError";
  }
}

function assertPositiveInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new MigrationValidationError(`${name} moet een geheel getal tussen 1 en ${maximum} zijn.`);
  }
}

export function parseMigrationFilename(filename: string): { sequence: number; name: string } {
  const match = MIGRATION_FILENAME.exec(filename);
  if (!match) {
    throw new MigrationValidationError(
      `Ongeldige migrationnaam '${filename}'; verwacht 0001_korte_naam.sql met 4-14 cijfers.`,
    );
  }

  const sequence = Number.parseInt(match[1], 10);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence <= 0 ||
    (match[1].length > 4 && match[1].startsWith("0"))
  ) {
    throw new MigrationValidationError(`Migration '${filename}' heeft geen geldige positieve volgorde.`);
  }

  return { sequence, name: match[2] };
}

function maskRange(output: string[], input: string, start: number, end: number): void {
  for (let position = start; position < end; position += 1) {
    output[position] = input[position] === "\n" ? "\n" : " ";
  }
}

/**
 * Masks comments and literal bodies while retaining executable SQL and line breaks.
 * Double-quoted identifiers retain their contents so protected ledger names remain detectable.
 */
export function maskSqlCommentsAndLiterals(sql: string): string {
  const output = Array<string>(sql.length).fill(" ");
  let position = 0;

  while (position < sql.length) {
    const character = sql[position];
    const next = sql[position + 1];

    if (character === "-" && next === "-") {
      const start = position;
      position += 2;
      while (position < sql.length && sql[position] !== "\n") position += 1;
      maskRange(output, sql, start, position);
      continue;
    }

    if (character === "/" && next === "*") {
      const start = position;
      let depth = 1;
      position += 2;
      while (position < sql.length && depth > 0) {
        if (sql[position] === "/" && sql[position + 1] === "*") {
          depth += 1;
          position += 2;
        } else if (sql[position] === "*" && sql[position + 1] === "/") {
          depth -= 1;
          position += 2;
        } else {
          position += 1;
        }
      }
      if (depth !== 0) {
        throw new MigrationValidationError("Migration bevat een onafgesloten block comment.");
      }
      maskRange(output, sql, start, position);
      continue;
    }

    if (character === "'") {
      const start = position;
      const previous = sql[position - 1];
      const beforePrevious = sql[position - 2];
      const escapeString =
        (previous === "E" || previous === "e") &&
        (beforePrevious === undefined || !/[A-Za-z0-9_$]/.test(beforePrevious));
      position += 1;
      let closed = false;
      while (position < sql.length) {
        if (escapeString && sql[position] === "\\") {
          position = Math.min(position + 2, sql.length);
        } else if (sql[position] === "'" && sql[position + 1] === "'") {
          position += 2;
        } else if (sql[position] === "'") {
          position += 1;
          closed = true;
          break;
        } else {
          position += 1;
        }
      }
      if (!closed) {
        throw new MigrationValidationError("Migration bevat een onafgesloten string literal.");
      }
      maskRange(output, sql, start, position);
      continue;
    }

    if (character === '"') {
      output[position] = " ";
      position += 1;
      let closed = false;
      while (position < sql.length) {
        if (sql[position] === '"' && sql[position + 1] === '"') {
          output[position] = '"';
          output[position + 1] = " ";
          position += 2;
        } else if (sql[position] === '"') {
          output[position] = " ";
          position += 1;
          closed = true;
          break;
        } else {
          output[position] = sql[position] === ";" ? " " : sql[position];
          position += 1;
        }
      }
      if (!closed) {
        throw new MigrationValidationError("Migration bevat een onafgesloten quoted identifier.");
      }
      continue;
    }

    if (character === "$") {
      const delimiterMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(position));
      if (delimiterMatch) {
        const start = position;
        const delimiter = delimiterMatch[0];
        const contentStart = position + delimiter.length;
        const closingPosition = sql.indexOf(delimiter, contentStart);
        if (closingPosition < 0) {
          throw new MigrationValidationError(`Migration bevat een onafgesloten dollar quote ${delimiter}.`);
        }
        position = closingPosition + delimiter.length;
        maskRange(output, sql, start, position);
        continue;
      }
    }

    output[position] = character;
    position += 1;
  }

  return output.join("");
}

type ForbiddenStatement = { pattern: RegExp; reason: string };

const FORBIDDEN_STATEMENTS: ForbiddenStatement[] = [
  {
    pattern: /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END(?:\s+TRANSACTION)?|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT|PREPARE\s+TRANSACTION)\b/,
    reason: "transaction control hoort uitsluitend bij de migrationrunner",
  },
  {
    pattern: /^(?:CREATE|DROP)\s+DATABASE\b/,
    reason: "databasebrede create/drop is niet toegestaan vanuit een applicatiemigration",
  },
  {
    pattern: /^ALTER\s+SYSTEM\b/,
    reason: "ALTER SYSTEM wijzigt de clusterconfiguratie",
  },
  {
    pattern: /^(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER)\b/,
    reason: "clusterrollen worden buiten applicatiemigrations beheerd",
  },
  {
    pattern: /^(?:CREATE|DROP)\s+TABLESPACE\b/,
    reason: "tablespaces zijn clusterinfrastructuur",
  },
  {
    pattern: /^(?:SET|RESET|DISCARD)\b/,
    reason: "migrations mogen runner-timeouts of sessieconfiguratie niet overschrijven",
  },
  {
    pattern: /^(?:VACUUM|CLUSTER|CHECKPOINT)\b/,
    reason: "niet-transactioneel databaseonderhoud hoort niet in een migration",
  },
  {
    pattern: /^(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/,
    reason: "CONCURRENTLY kan niet binnen de verplichte migrationtransactie",
  },
  {
    pattern: /^REINDEX\b.*\bCONCURRENTLY\b/,
    reason: "REINDEX CONCURRENTLY kan niet binnen de verplichte migrationtransactie",
  },
  {
    pattern: /^COPY\b.*\bPROGRAM\b/,
    reason: "COPY PROGRAM kan processen op de databasehost starten",
  },
  {
    pattern: /^(?:DROP\s+SCHEMA|DROP\s+OWNED|REASSIGN\s+OWNED|TRUNCATE)\b/,
    reason: "breed destructieve statements vereisen een afzonderlijk, gereviewd datamigratiepad",
  },
  {
    pattern: /^(?:LISTEN|UNLISTEN)\b/,
    reason: "sessiegebonden notification state hoort niet in een migration",
  },
];

export function validateMigrationSql(filename: string, sql: string): void {
  if (sql.length === 0 || sql.trim().length === 0) {
    throw new MigrationValidationError(`Migration '${filename}' is leeg.`);
  }
  if (sql.charCodeAt(0) === 0xfeff) {
    throw new MigrationValidationError(`Migration '${filename}' bevat een UTF-8 BOM.`);
  }
  if (sql.includes("\0")) {
    throw new MigrationValidationError(`Migration '${filename}' bevat een NUL-byte.`);
  }

  const executableSql = maskSqlCommentsAndLiterals(sql);
  if (/^\s*\\/m.test(executableSql)) {
    throw new MigrationValidationError(`Migration '${filename}' bevat een psql-metacommand.`);
  }

  const statements = executableSql
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim().toUpperCase())
    .filter(Boolean);

  if (statements.length === 0) {
    throw new MigrationValidationError(`Migration '${filename}' bevat geen uitvoerbaar SQL-statement.`);
  }

  for (const statement of statements) {
    for (const forbidden of FORBIDDEN_STATEMENTS) {
      if (forbidden.pattern.test(statement)) {
        throw new MigrationValidationError(
          `Migration '${filename}' bevat verboden SQL: ${forbidden.reason}.`,
        );
      }
    }

    if (/\bBUILDY_META\s*\.\s*SCHEMA_MIGRATIONS\b/.test(statement)) {
      throw new MigrationValidationError(
        `Migration '${filename}' mag de runnerledger niet lezen of wijzigen.`,
      );
    }
    if (
      /\bPG_(?:TRY_)?ADVISORY_(?:(?:XACT_)?LOCK(?:_SHARED)?|UNLOCK(?:_SHARED|_ALL)?)\s*\(/.test(
        statement,
      )
    ) {
      throw new MigrationValidationError(
        `Migration '${filename}' mag de advisory lock van de runner niet manipuleren.`,
      );
    }
    if (
      /\bSECURITY\s+DEFINER\b/.test(statement) &&
      !/\bSET\s+SEARCH_PATH\s*=\s*(?:PG_CATALOG\s*,\s*PUBLIC|PUBLIC\s*,\s*PG_CATALOG)(?![A-Z0-9_$]|\s*,)/.test(
        statement,
      )
    ) {
      throw new MigrationValidationError(
        `Migration '${filename}' bevat SECURITY DEFINER zonder vaste search_path.`,
      );
    }
  }
}

export async function discoverMigrations(
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<MigrationFile[]> {
  const directoryPath = await realpath(migrationsDirectory).catch(() => {
    throw new MigrationValidationError(`Migrationmap bestaat niet: ${migrationsDirectory}`);
  });
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const sqlEntries = entries.filter((entry) => entry.name.endsWith(".sql"));

  if (sqlEntries.length === 0) {
    throw new MigrationValidationError(`Geen SQL-migrations gevonden in ${directoryPath}.`);
  }

  const migrations: MigrationFile[] = [];
  for (const entry of sqlEntries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new MigrationValidationError(`Migration '${entry.name}' moet een regulier bestand zijn.`);
    }

    const { sequence } = parseMigrationFilename(entry.name);
    const migrationPath = resolve(directoryPath, entry.name);
    const resolvedMigrationPath = await realpath(migrationPath);
    const pathFromDirectory = relative(directoryPath, resolvedMigrationPath);
    if (pathFromDirectory.startsWith("..") || resolve(dirname(resolvedMigrationPath)) !== directoryPath) {
      throw new MigrationValidationError(`Migration '${entry.name}' ontsnapt uit de migrationmap.`);
    }

    const fileStats = await stat(resolvedMigrationPath);
    if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > MAX_MIGRATION_BYTES) {
      throw new MigrationValidationError(
        `Migration '${entry.name}' moet tussen 1 en ${MAX_MIGRATION_BYTES} bytes groot zijn.`,
      );
    }
    const bytes = await readFile(resolvedMigrationPath);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MIGRATION_BYTES) {
      throw new MigrationValidationError(
        `Migration '${entry.name}' wijzigde tijdens discovery of overschrijdt de maximale grootte.`,
      );
    }

    let sql: string;
    try {
      sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new MigrationValidationError(`Migration '${entry.name}' is geen geldige UTF-8.`);
    }
    validateMigrationSql(entry.name, sql);

    migrations.push({
      filename: entry.name,
      path: resolvedMigrationPath,
      sequence,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
      sql,
    });
  }

  migrations.sort((left, right) => left.sequence - right.sequence || left.filename.localeCompare(right.filename));
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].sequence === migrations[index].sequence) {
      throw new MigrationValidationError(
        `Migrationvolgorde ${migrations[index].sequence} wordt meer dan eenmaal gebruikt.`,
      );
    }
  }

  return migrations;
}

function normalizedLedgerSequence(record: MigrationLedgerRecord): number {
  const sequence = typeof record.sequence === "number" ? record.sequence : Number(record.sequence);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new MigrationValidationError(`Ledger bevat een ongeldige volgorde voor '${record.filename}'.`);
  }
  return sequence;
}

export function planMigrations(
  migrations: MigrationFile[],
  ledgerRecords: MigrationLedgerRecord[],
): MigrationPlan {
  const migrationSequences = new Set<number>();
  const migrationFilenames = new Set<string>();
  let previousSequence = 0;
  for (const migration of migrations) {
    const parsed = parseMigrationFilename(migration.filename);
    if (parsed.sequence !== migration.sequence) {
      throw new MigrationValidationError(
        `Migrationvolgorde wijkt af van filename '${migration.filename}'.`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(migration.sha256)) {
      throw new MigrationValidationError(`Migration '${migration.filename}' heeft geen geldige SHA-256.`);
    }
    if (
      migrationFilenames.has(migration.filename) ||
      migrationSequences.has(migration.sequence) ||
      migration.sequence <= previousSequence
    ) {
      throw new MigrationValidationError("Lokale migrations staan niet in een unieke, oplopende volgorde.");
    }
    migrationFilenames.add(migration.filename);
    migrationSequences.add(migration.sequence);
    previousSequence = migration.sequence;
  }

  const migrationByFilename = new Map(migrations.map((migration) => [migration.filename, migration]));
  const ledgerByFilename = new Map<string, MigrationLedgerRecord>();
  const ledgerSequences = new Set<number>();

  for (const record of ledgerRecords) {
    const parsed = parseMigrationFilename(record.filename);
    const sequence = normalizedLedgerSequence(record);
    if (parsed.sequence !== sequence) {
      throw new MigrationValidationError(`Ledgervolgorde wijkt af van filename '${record.filename}'.`);
    }
    if (!/^[0-9a-f]{64}$/.test(record.sha256)) {
      throw new MigrationValidationError(`Ledger bevat een ongeldige SHA-256 voor '${record.filename}'.`);
    }
    if (ledgerByFilename.has(record.filename) || ledgerSequences.has(sequence)) {
      throw new MigrationValidationError(`Ledger bevat dubbele migration '${record.filename}'.`);
    }
    if (!migrationByFilename.has(record.filename)) {
      throw new MigrationValidationError(
        `Toegepaste migration '${record.filename}' ontbreekt lokaal; geschiedenis mag niet worden verwijderd.`,
      );
    }
    ledgerByFilename.set(record.filename, record);
    ledgerSequences.add(sequence);
  }

  const applied: MigrationFile[] = [];
  const pending: MigrationFile[] = [];
  for (const migration of migrations) {
    const record = ledgerByFilename.get(migration.filename);
    if (!record) {
      pending.push(migration);
      continue;
    }
    if (record.sha256 !== migration.sha256) {
      throw new MigrationValidationError(
        `Hash van toegepaste migration '${migration.filename}' is gewijzigd; maak een nieuwe migration.`,
      );
    }
    applied.push(migration);
  }

  const highestAppliedSequence = applied.reduce(
    (highest, migration) => Math.max(highest, migration.sequence),
    0,
  );
  const outOfOrder = pending.find((migration) => migration.sequence < highestAppliedSequence);
  if (outOfOrder) {
    throw new MigrationValidationError(
      `Pending migration '${outOfOrder.filename}' staat vóór reeds toegepaste migrations.`,
    );
  }

  return { applied, pending };
}

export function validateMigrationDatabaseUrl(rawUrl: string): string {
  const trimmedUrl = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmedUrl);
  } catch {
    throw new MigrationValidationError("DATABASE_MIGRATION_URL is geen geldige URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new MigrationValidationError("DATABASE_MIGRATION_URL moet postgres:// of postgresql:// gebruiken.");
  }
  if (!url.hostname || !url.username || !url.pathname || url.pathname === "/") {
    throw new MigrationValidationError(
      "DATABASE_MIGRATION_URL moet host, gebruiker en databasenaam expliciet bevatten.",
    );
  }
  if (
    /(^|[.-])pooler([.-]|$)/i.test(url.hostname) ||
    url.searchParams.get("pgbouncer")?.toLowerCase() === "true"
  ) {
    throw new MigrationValidationError(
      "DATABASE_MIGRATION_URL lijkt een pooled endpoint; migrations vereisen de directe verbinding.",
    );
  }

  if (!LOCAL_DATABASE_HOSTS.has(url.hostname)) {
    const sslMode = url.searchParams.get("sslmode");
    if (!new Set(["require", "verify-ca", "verify-full"]).has(sslMode ?? "")) {
      throw new MigrationValidationError(
        "Een externe DATABASE_MIGRATION_URL moet sslmode=require, verify-ca of verify-full bevatten.",
      );
    }
  }

  return trimmedUrl;
}

export function requireMigrationDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const rawUrl = environment.DATABASE_MIGRATION_URL?.trim();
  if (!rawUrl) {
    throw new MigrationValidationError(
      "DATABASE_MIGRATION_URL is verplicht; DATABASE_URL wordt bewust niet als fallback gebruikt.",
    );
  }

  return validateMigrationDatabaseUrl(rawUrl);
}

export function createMigrationClient(databaseUrl: string, statementTimeoutMs: number): Client {
  const config: ClientConfig = {
    connectionString: databaseUrl,
    application_name: "buildy-migration-runner",
    connectionTimeoutMillis: 10_000,
    query_timeout: statementTimeoutMs + 5_000,
    keepAlive: true,
  };
  return new Client(config);
}

type MigrationConnectionIdentity = {
  database_name: string;
  role_name: string;
  server_version_num: string;
  has_role_membership: boolean;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
};

/**
 * Confirms that the direct URL reached the database and least-privileged role it names.
 * Database ownership is allowed; cluster-wide privileges are deliberately not.
 */
export async function assertSafeMigrationConnection(
  client: Client,
  databaseUrl: string,
): Promise<void> {
  const parsedUrl = new URL(databaseUrl);
  let expectedDatabase: string;
  let expectedRole: string;
  try {
    expectedDatabase = decodeURIComponent(parsedUrl.pathname.slice(1));
    expectedRole = decodeURIComponent(parsedUrl.username);
  } catch {
    throw new MigrationValidationError(
      "DATABASE_MIGRATION_URL bevat ongeldige percent-encoding in gebruiker of databasenaam.",
    );
  }
  if (!expectedDatabase || expectedDatabase.includes("/") || !expectedRole) {
    throw new MigrationValidationError(
      "DATABASE_MIGRATION_URL moet exact één databasenaam en één gebruiker bevatten.",
    );
  }

  const result = await client.query<MigrationConnectionIdentity>(`
    WITH RECURSIVE migration_role_memberships(granted_role_oid) AS (
      SELECT membership.roleid
      FROM pg_catalog.pg_roles migration_role
      JOIN pg_catalog.pg_auth_members membership ON membership.member = migration_role.oid
      WHERE migration_role.rolname = current_user

      UNION

      SELECT membership.roleid
      FROM migration_role_memberships membership_path
      JOIN pg_catalog.pg_auth_members membership
        ON membership.member = membership_path.granted_role_oid
    )
    SELECT
      current_database() AS database_name,
      current_user AS role_name,
      current_setting('server_version_num') AS server_version_num,
      EXISTS (SELECT 1 FROM migration_role_memberships) AS has_role_membership,
      roles.rolsuper,
      roles.rolcreatedb,
      roles.rolcreaterole,
      roles.rolreplication,
      roles.rolbypassrls
    FROM pg_catalog.pg_roles roles
    WHERE roles.rolname = current_user
  `);
  const identity = result.rows[0];
  if (!identity) {
    throw new MigrationValidationError("Verbonden databaserol kon niet veilig worden vastgesteld.");
  }
  if (identity.database_name !== expectedDatabase || identity.role_name !== expectedRole) {
    throw new MigrationValidationError(
      "DATABASE_MIGRATION_URL kwam uit op een andere database of gebruiker dan expliciet opgegeven.",
    );
  }
  if (Number.parseInt(identity.server_version_num, 10) < 160_000) {
    throw new MigrationValidationError("Buildy-migrations vereisen PostgreSQL 16 of nieuwer.");
  }
  if (identity.has_role_membership) {
    throw new MigrationValidationError(
      "De migrationrol heeft directe of transitieve rollidmaatschappen; gebruik een dedicated rol zonder pg_auth_members-lidmaatschap.",
    );
  }
  if (
    identity.rolsuper ||
    identity.rolcreatedb ||
    identity.rolcreaterole ||
    identity.rolreplication ||
    identity.rolbypassrls
  ) {
    throw new MigrationValidationError(
      "De migrationrol heeft clusterbrede privileges; gebruik een dedicated NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS-rol.",
    );
  }
}

export async function acquireMigrationLock(
  client: Client,
  timeoutMs: number,
  shared = false,
): Promise<void> {
  assertPositiveInteger("lock timeout", timeoutMs, 300_000);
  const deadline = Date.now() + timeoutMs;
  const functionName = shared ? "pg_try_advisory_lock_shared" : "pg_try_advisory_lock";

  while (Date.now() <= deadline) {
    const result = await client.query<{ acquired: boolean }>(
      `SELECT ${functionName}($1::integer, $2::integer) AS acquired`,
      [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_RESOURCE],
    );
    if (result.rows[0]?.acquired) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, LOCK_POLL_INTERVAL_MS));
  }

  throw new MigrationValidationError(`Migrationlock kon niet binnen ${timeoutMs} ms worden verkregen.`);
}

export async function releaseMigrationLock(client: Client, shared = false): Promise<void> {
  const functionName = shared ? "pg_advisory_unlock_shared" : "pg_advisory_unlock";
  const result = await client.query<{ released: boolean }>(
    `SELECT ${functionName}($1::integer, $2::integer) AS released`,
    [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_RESOURCE],
  );
  if (!result.rows[0]?.released) {
    throw new MigrationValidationError("De migrationlock was niet meer in bezit van deze sessie.");
  }
}

export async function configureMigrationTransaction(
  client: Client,
  lockTimeoutMs: number,
  statementTimeoutMs: number,
): Promise<void> {
  await client.query(
    "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true), set_config('search_path', 'public, pg_catalog', true)",
    [`${lockTimeoutMs}ms`, `${statementTimeoutMs}ms`, `${statementTimeoutMs + 5_000}ms`],
  );
}

async function ensureMigrationLedger(
  client: Client,
  lockTimeoutMs: number,
  statementTimeoutMs: number,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await configureMigrationTransaction(client, lockTimeoutMs, statementTimeoutMs);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${MIGRATION_LEDGER_SCHEMA}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE} (
        filename text PRIMARY KEY,
        sequence bigint NOT NULL UNIQUE CHECK (sequence > 0),
        sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now(),
        execution_ms integer NOT NULL CHECK (execution_ms >= 0),
        runner_version text NOT NULL,
        applied_by text NOT NULL DEFAULT current_user
      )
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

type LedgerColumn = {
  column_name: string;
  data_type: string;
  not_null: boolean;
};

const EXPECTED_LEDGER_COLUMNS = new Map<string, string>([
  ["filename", "text"],
  ["sequence", "bigint"],
  ["sha256", "character(64)"],
  ["applied_at", "timestamp with time zone"],
  ["execution_ms", "integer"],
  ["runner_version", "text"],
  ["applied_by", "text"],
]);

export async function migrationLedgerExists(client: Client): Promise<boolean> {
  const relation = await client.query<{ ledger: string | null }>(
    "SELECT to_regclass($1) AS ledger",
    [`${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE}`],
  );
  return Boolean(relation.rows[0]?.ledger);
}

export async function assertMigrationLedgerStructure(client: Client): Promise<void> {
  if (!(await migrationLedgerExists(client))) {
    throw new MigrationValidationError(
      `Migrationledger ${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE} ontbreekt.`,
    );
  }

  const columns = await client.query<LedgerColumn>(`
    SELECT
      attributes.attname AS column_name,
      pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) AS data_type,
      attributes.attnotnull AS not_null
    FROM pg_catalog.pg_attribute attributes
    WHERE attributes.attrelid = '${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE}'::regclass
      AND attributes.attnum > 0
      AND NOT attributes.attisdropped
    ORDER BY attributes.attnum
  `);
  if (columns.rows.length !== EXPECTED_LEDGER_COLUMNS.size) {
    throw new MigrationValidationError("Migrationledger heeft een onverwachte kolomstructuur.");
  }
  for (const column of columns.rows) {
    if (EXPECTED_LEDGER_COLUMNS.get(column.column_name) !== column.data_type || !column.not_null) {
      throw new MigrationValidationError(
        `Migrationledgerkolom '${column.column_name}' heeft een onverwacht type of nullability.`,
      );
    }
  }

  const constraints = await client.query<{ constraint_type: "p" | "u"; columns: string[] }>(`
    SELECT
      constraints.contype AS constraint_type,
      array_agg(attributes.attname::text ORDER BY keys.ordinality) AS columns
    FROM pg_catalog.pg_constraint constraints
    CROSS JOIN LATERAL unnest(constraints.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_catalog.pg_attribute attributes
      ON attributes.attrelid = constraints.conrelid
     AND attributes.attnum = keys.attnum
    WHERE constraints.conrelid = '${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE}'::regclass
      AND constraints.contype IN ('p', 'u')
    GROUP BY constraints.oid, constraints.contype
  `);
  const hasFilenamePrimaryKey = constraints.rows.some(
    (constraint) => constraint.constraint_type === "p" && constraint.columns.join(",") === "filename",
  );
  const hasSequenceUnique = constraints.rows.some(
    (constraint) => constraint.constraint_type === "u" && constraint.columns.join(",") === "sequence",
  );
  if (!hasFilenamePrimaryKey || !hasSequenceUnique) {
    throw new MigrationValidationError(
      "Migrationledger mist de primaire filename-key of unieke sequence-constraint.",
    );
  }
}

export async function readMigrationLedger(client: Client): Promise<MigrationLedgerRecord[]> {
  if (!(await migrationLedgerExists(client))) return [];

  const result = await client.query<MigrationLedgerRecord>(`
    SELECT filename, sequence, sha256
    FROM ${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE}
    ORDER BY sequence ASC
  `);
  return result.rows;
}

async function applyMigration(
  client: Client,
  migration: MigrationFile,
  lockTimeoutMs: number,
  statementTimeoutMs: number,
): Promise<number> {
  const startedAt = performance.now();
  await client.query("BEGIN");
  try {
    await configureMigrationTransaction(client, lockTimeoutMs, statementTimeoutMs);
    await client.query(migration.sql);
    const executionMs = Math.max(0, Math.round(performance.now() - startedAt));
    await client.query(
      `INSERT INTO ${MIGRATION_LEDGER_SCHEMA}.${MIGRATION_LEDGER_TABLE}
        (filename, sequence, sha256, execution_ms, runner_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        migration.filename,
        migration.sequence,
        migration.sha256,
        executionMs,
        MIGRATION_RUNNER_VERSION,
      ],
    );
    await client.query("COMMIT");
    return executionMs;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    const errorMessage = error instanceof Error ? error.message : "onbekende databasefout";
    throw new MigrationValidationError(
      `Migration '${migration.filename}' is teruggedraaid${errorCode ? ` (${errorCode})` : ""}: ${errorMessage}`,
    );
  }
}

export async function runMigrations(options: MigrationRunnerOptions = {}): Promise<MigrationPlan> {
  const mode = options.mode ?? "apply";
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const logger = options.logger ?? console;
  assertPositiveInteger("lock timeout", lockTimeoutMs, 300_000);
  assertPositiveInteger("statement timeout", statementTimeoutMs, 900_000);

  const migrations = await discoverMigrations(options.migrationsDirectory);
  logger.info(
    `${migrations.length} migration(s) gevalideerd; laatste is ${migrations.at(-1)?.filename}.`,
  );
  if (mode === "check") return { applied: [], pending: migrations };

  const databaseUrl = options.databaseUrl
    ? validateMigrationDatabaseUrl(options.databaseUrl)
    : requireMigrationDatabaseUrl();
  const client = createMigrationClient(databaseUrl, statementTimeoutMs);
  let lockAcquired = false;

  try {
    await client.connect();
    await assertSafeMigrationConnection(client, databaseUrl);
    await acquireMigrationLock(client, lockTimeoutMs);
    lockAcquired = true;

    if (mode === "apply") {
      await ensureMigrationLedger(client, lockTimeoutMs, statementTimeoutMs);
    }
    if (mode === "apply" || (await migrationLedgerExists(client))) {
      await assertMigrationLedgerStructure(client);
    }

    const ledgerRecords = await readMigrationLedger(client);
    const plan = planMigrations(migrations, ledgerRecords);
    if (mode === "dry-run") {
      logger.info(
        plan.pending.length === 0
          ? "Dry-run: database is actueel; geen migrations pending."
          : `Dry-run: ${plan.pending.length} pending: ${plan.pending.map((item) => item.filename).join(", ")}.`,
      );
      return plan;
    }

    for (const migration of plan.pending) {
      logger.info(`Migration toepassen: ${migration.filename} (${migration.sha256.slice(0, 12)}…).`);
      const executionMs = await applyMigration(
        client,
        migration,
        lockTimeoutMs,
        statementTimeoutMs,
      );
      logger.info(`Migration toegepast: ${migration.filename} in ${executionMs} ms.`);
    }

    const finalPlan = planMigrations(migrations, await readMigrationLedger(client));
    if (finalPlan.pending.length !== 0) {
      throw new MigrationValidationError("Migrationrun eindigde met onverwacht pending migrations.");
    }
    if (plan.pending.length === 0) logger.info("Database is al actueel; niets gewijzigd.");
    return finalPlan;
  } finally {
    if (lockAcquired) {
      await releaseMigrationLock(client).catch((error: unknown) => {
        logger.warn(error instanceof Error ? error.message : "Migrationlock kon niet worden vrijgegeven.");
      });
    }
    await client.end().catch(() => undefined);
  }
}

export type ParsedMigrationArguments = {
  mode: MigrationMode;
  migrationsDirectory?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

export function parseMigrationArguments(argumentsList: string[]): ParsedMigrationArguments {
  const parsed: ParsedMigrationArguments = { mode: "apply" };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--check") {
      if (parsed.mode !== "apply") throw new MigrationValidationError("Kies één runner mode.");
      parsed.mode = "check";
    } else if (argument === "--dry-run") {
      if (parsed.mode !== "apply") throw new MigrationValidationError("Kies één runner mode.");
      parsed.mode = "dry-run";
    } else if (argument === "--migrations-dir") {
      const value = argumentsList[++index];
      if (!value) throw new MigrationValidationError("--migrations-dir vereist een pad.");
      parsed.migrationsDirectory = resolve(value);
    } else if (argument === "--lock-timeout-ms") {
      const value = Number(argumentsList[++index]);
      assertPositiveInteger("lock timeout", value, 300_000);
      parsed.lockTimeoutMs = value;
    } else if (argument === "--statement-timeout-ms") {
      const value = Number(argumentsList[++index]);
      assertPositiveInteger("statement timeout", value, 900_000);
      parsed.statementTimeoutMs = value;
    } else {
      throw new MigrationValidationError(`Onbekend migrationargument '${argument}'.`);
    }
  }

  return parsed;
}

async function runCli(): Promise<void> {
  const parsed = parseMigrationArguments(process.argv.slice(2));
  await runMigrations(parsed);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Onbekende migrationfout.");
    process.exitCode = 1;
  });
}

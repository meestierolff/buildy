import { Pool, type PoolClient } from "pg";
import { buildAuthMigrationPlan, type AuthMigrationPlan, type LegacyAuthUser } from "./auth";
import { canonicalJson, keyedFingerprint, sha256Hex } from "./core";

const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const PAGE_SIZE = 500;

export type LegacyTableDisposition = "transform" | "merge" | "manual_review" | "retire";

export interface LegacyTableSpec {
  disposition: LegacyTableDisposition;
  orderBy: readonly string[];
  target: readonly string[];
}

/**
 * Explicit allowlist derived from the audited source schema history. It
 * prevents a caller from turning the migration tool into an arbitrary SQL
 * export utility and records the intended disposition of every known table.
 */
export const LEGACY_TABLES = {
  profiles: { disposition: "transform", orderBy: ["id"], target: ["app_users", "profiles", "media_assets"] },
  trips: { disposition: "transform", orderBy: ["id"], target: ["projects", "project_phases", "media_assets", "floorplans"] },
  trip_private_info: { disposition: "transform", orderBy: ["trip_id"], target: ["project_private_details"] },
  steps: { disposition: "transform", orderBy: ["id"], target: ["updates", "floorplan_pins"] },
  step_media: { disposition: "transform", orderBy: ["id"], target: ["media_assets", "update_media"] },
  step_contractor_info: { disposition: "manual_review", orderBy: ["step_id"], target: [] },
  trip_budgets: { disposition: "transform", orderBy: ["trip_id"], target: ["project_budgets"] },
  step_budget: { disposition: "transform", orderBy: ["step_id"], target: ["budget_items"] },
  follows: { disposition: "transform", orderBy: ["id"], target: ["project_access_requests", "project_followers"] },
  favorites: { disposition: "merge", orderBy: ["id"], target: ["project_followers"] },
  user_follows: { disposition: "transform", orderBy: ["id"], target: ["user_relationships"] },
  comments: { disposition: "transform", orderBy: ["id"], target: ["comments", "comment_mentions"] },
  reactions: { disposition: "merge", orderBy: ["id"], target: ["reactions"] },
  likes: { disposition: "merge", orderBy: ["id"], target: ["reactions"] },
  notifications: { disposition: "transform", orderBy: ["id"], target: ["notifications"] },
  photobook_settings: { disposition: "transform", orderBy: ["trip_id"], target: ["photobook_settings"] },
  photobook_excluded_media: { disposition: "manual_review", orderBy: ["trip_id", "media_id"], target: [] },
  photobook_excluded_steps: { disposition: "manual_review", orderBy: ["trip_id", "step_id"], target: [] },
  photobook_orders: { disposition: "manual_review", orderBy: ["id"], target: [] },
  photobook_order_events: { disposition: "manual_review", orderBy: ["id"], target: [] },
  ai_blueprint_usage: { disposition: "retire", orderBy: ["id"], target: [] },
  account_deletion_locks: { disposition: "manual_review", orderBy: ["user_id"], target: [] },
  account_deletion_cleanup_failures: { disposition: "manual_review", orderBy: ["id"], target: [] },
  photobook_order_archive: { disposition: "manual_review", orderBy: ["id"], target: [] },
} as const satisfies Record<string, LegacyTableSpec>;

export type LegacyTableName = keyof typeof LEGACY_TABLES;

const ORPHAN_CHECKS = [
  ["profiles_without_auth", "public.profiles", "auth.users", "source.user_id = target.id"],
  ["trips_without_profile", "public.trips", "public.profiles", "source.user_id = target.user_id"],
  ["steps_without_trip", "public.steps", "public.trips", "source.trip_id = target.id"],
  ["media_without_step", "public.step_media", "public.steps", "source.step_id = target.id"],
  ["comments_without_step", "public.comments", "public.steps", "source.step_id = target.id"],
  ["reactions_without_step", "public.reactions", "public.steps", "source.step_id = target.id"],
  ["project_follows_without_trip", "public.follows", "public.trips", "source.project_id = target.id"],
] as const;

function quoteIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error("SQL identifier valt buiten de migratie-allowlist.");
  return `"${value}"`;
}

function qualified(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error("Bron bevat een ongeldige timestamp.");
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bronrij is geen JSON-object.");
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export interface LegacyTableInventory {
  columns: string[];
  disposition: LegacyTableDisposition;
  exists: boolean;
  maximumUpdatedAt: string | null;
  rowCount: number;
  table: LegacyTableName;
  targets: readonly string[];
}

export interface LegacySourceInventory {
  schemaVersion: 1;
  capturedAt: string;
  readOnlyTransactionVerified: true;
  snapshotId: string;
  auth: {
    disabledUsers: number;
    emailVerifiedUsers: number;
    providerCounts: Record<string, number>;
    totalUsers: number;
  };
  orphanCounts: Record<string, number>;
  storageBuckets: Array<{ bucket: string; objectCount: number; public: boolean; totalBytes: number }>;
  tables: LegacyTableInventory[];
  sourceFunctions: number;
  sourcePolicies: number;
}

export interface LegacyTableExport {
  primaryKeyFingerprints: string[];
  rowCount: number;
  rows: Record<string, unknown>[];
  rowsSha256: string;
  table: LegacyTableName;
}

export interface LegacyExportBundle {
  schemaVersion: 1;
  auth: AuthMigrationPlan;
  capturedAt: string;
  inventory: LegacySourceInventory;
  tables: LegacyTableExport[];
}

async function existingTables(client: PoolClient): Promise<Map<string, string[]>> {
  const names = Object.keys(LEGACY_TABLES);
  const result = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    ORDER BY table_name, ordinal_position
  `, [names]);
  const tables = new Map<string, string[]>();
  for (const row of result.rows) {
    const columns = tables.get(row.table_name) ?? [];
    columns.push(row.column_name);
    tables.set(row.table_name, columns);
  }
  return tables;
}

async function legacyAuthUsers(client: PoolClient): Promise<LegacyAuthUser[]> {
  const result = await client.query<{
    banned_until: Date | string | null;
    created_at: Date | string;
    deleted_at: Date | string | null;
    email: string;
    email_verified: boolean;
    has_password: boolean;
    id: string;
    provider: string | null;
    providers: unknown;
  }>(`
    SELECT
      id::text,
      email,
      created_at,
      email_confirmed_at IS NOT NULL AS email_verified,
      encrypted_password IS NOT NULL AND encrypted_password <> '' AS has_password,
      raw_app_meta_data ->> 'provider' AS provider,
      coalesce(raw_app_meta_data -> 'providers', '[]'::jsonb) AS providers,
      banned_until,
      deleted_at
    FROM auth.users
    ORDER BY id
  `);
  return result.rows.map((row) => {
    const providers = Array.isArray(row.providers)
      ? row.providers.filter((value): value is string => typeof value === "string")
      : [];
    if (row.provider) providers.push(row.provider);
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified,
      hasPassword: row.has_password,
      providers,
      disabled: Boolean(row.deleted_at) || (row.banned_until ? new Date(row.banned_until).getTime() > Date.now() : false),
      createdAt: toIso(row.created_at),
    };
  });
}

async function inReadOnlySnapshot<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const mode = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") throw new Error("Brontransactie is niet read-only.");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function inventoryWithinSnapshot(client: PoolClient): Promise<LegacySourceInventory> {
  const tablesByName = await existingTables(client);
  const snapshot = await client.query<{ snapshot_id: string }>("SELECT txid_current_snapshot()::text AS snapshot_id");
  const tables: LegacyTableInventory[] = [];
  for (const [table, spec] of Object.entries(LEGACY_TABLES) as Array<[LegacyTableName, LegacyTableSpec]>) {
    const columns = tablesByName.get(table) ?? [];
    if (columns.length === 0) {
      tables.push({ columns: [], disposition: spec.disposition, exists: false, maximumUpdatedAt: null, rowCount: 0, table, targets: spec.target });
      continue;
    }
    const updatedColumn = columns.includes("updated_at") ? "updated_at" : columns.includes("created_at") ? "created_at" : null;
    const result = await client.query<{ maximum_updated_at: Date | string | null; row_count: string }>(`
      SELECT count(*)::text AS row_count,
        ${updatedColumn ? `max(${quoteIdentifier(updatedColumn)})` : "NULL::timestamptz"} AS maximum_updated_at
      FROM ${qualified("public", table)}
    `);
    tables.push({
      columns,
      disposition: spec.disposition,
      exists: true,
      maximumUpdatedAt: result.rows[0]?.maximum_updated_at ? toIso(result.rows[0].maximum_updated_at) : null,
      rowCount: Number(result.rows[0]?.row_count ?? 0),
      table,
      targets: spec.target,
    });
  }

  const authProviders = await client.query<{
    provider: string;
    provider_count: string;
  }>(`
    SELECT
      coalesce(raw_app_meta_data ->> 'provider', 'unknown') AS provider,
      count(*)::text AS provider_count
    FROM auth.users
    GROUP BY coalesce(raw_app_meta_data ->> 'provider', 'unknown')
    ORDER BY provider
  `);
  const authSummary = await client.query<{
    disabled_users: string;
    email_verified_users: string;
    total_users: string;
  }>(`
    SELECT
      count(*)::text AS total_users,
      count(*) filter (where email_confirmed_at is not null)::text AS email_verified_users,
      count(*) filter (where deleted_at is not null OR banned_until > now())::text AS disabled_users
    FROM auth.users
  `);
  const providerCounts = Object.fromEntries(authProviders.rows.map((row) => [row.provider, Number(row.provider_count)]));

  const storage = await client.query<{
    bucket: string;
    object_count: string;
    public: boolean;
    total_bytes: string;
  }>(`
    SELECT bucket.id AS bucket,
      bucket.public,
      count(object.id)::text AS object_count,
      coalesce(sum(CASE
        WHEN object.metadata ->> 'size' ~ '^[0-9]+$' THEN (object.metadata ->> 'size')::bigint
        ELSE 0
      END), 0)::text AS total_bytes
    FROM storage.buckets bucket
    LEFT JOIN storage.objects object ON object.bucket_id = bucket.id
    GROUP BY bucket.id, bucket.public
    ORDER BY bucket.id
  `);

  const orphanCounts: Record<string, number> = {};
  for (const [label, sourceName, targetName, predicate] of ORPHAN_CHECKS) {
    const [sourceSchema, sourceTable] = sourceName.split(".");
    const [targetSchema, targetTable] = targetName.split(".");
    if (!tablesByName.has(sourceTable) && sourceSchema === "public") {
      orphanCounts[label] = 0;
      continue;
    }
    const result = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM ${qualified(sourceSchema, sourceTable)} source
      WHERE NOT EXISTS (
        SELECT 1 FROM ${qualified(targetSchema, targetTable)} target WHERE ${predicate}
      )
    `);
    orphanCounts[label] = Number(result.rows[0]?.count ?? 0);
  }

  const metadata = await client.query<{ function_count: string; policy_count: string }>(`
    SELECT
      (SELECT count(*)::text FROM pg_proc proc JOIN pg_namespace ns ON ns.oid = proc.pronamespace WHERE ns.nspname = 'public') AS function_count,
      (SELECT count(*)::text FROM pg_policies WHERE schemaname IN ('public', 'storage')) AS policy_count
  `);
  const firstAuth = authSummary.rows[0];
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    readOnlyTransactionVerified: true,
    snapshotId: snapshot.rows[0]?.snapshot_id ?? "unknown",
    auth: {
      disabledUsers: Number(firstAuth?.disabled_users ?? 0),
      emailVerifiedUsers: Number(firstAuth?.email_verified_users ?? 0),
      providerCounts,
      totalUsers: Number(firstAuth?.total_users ?? 0),
    },
    orphanCounts,
    storageBuckets: storage.rows.map((row) => ({
      bucket: row.bucket,
      objectCount: Number(row.object_count),
      public: row.public,
      totalBytes: Number(row.total_bytes),
    })),
    tables,
    sourceFunctions: Number(metadata.rows[0]?.function_count ?? 0),
    sourcePolicies: Number(metadata.rows[0]?.policy_count ?? 0),
  };
}

export async function inventoryLegacySource(pool: Pool): Promise<LegacySourceInventory> {
  return inReadOnlySnapshot(pool, inventoryWithinSnapshot);
}

async function exportTable(
  client: PoolClient,
  table: LegacyTableName,
  spec: LegacyTableSpec,
  fingerprintKey: Uint8Array,
): Promise<LegacyTableExport> {
  const rows: Record<string, unknown>[] = [];
  const order = spec.orderBy.map(quoteIdentifier).join(", ");
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await client.query<{ row: Record<string, unknown> }>(`
      SELECT row_to_json(source)::jsonb AS row
      FROM ${qualified("public", table)} source
      ORDER BY ${order}
      LIMIT $1 OFFSET $2
    `, [PAGE_SIZE, offset]);
    rows.push(...result.rows.map((entry) => jsonRecord(entry.row)));
    if (result.rows.length < PAGE_SIZE) break;
  }
  const primaryKeyFingerprints = rows.map((row) => {
    const key = spec.orderBy.map((column) => row[column]).join("\0");
    return keyedFingerprint(fingerprintKey, `row.${table}`, key);
  });
  return {
    primaryKeyFingerprints,
    rowCount: rows.length,
    rows,
    rowsSha256: sha256Hex(canonicalJson(rows)),
    table,
  };
}

export async function exportLegacySource(
  pool: Pool,
  fingerprintKey: Uint8Array,
): Promise<LegacyExportBundle> {
  return inReadOnlySnapshot(pool, async (client) => {
    const inventory = await inventoryWithinSnapshot(client);
    const present = new Set(inventory.tables.filter((table) => table.exists).map((table) => table.table));
    const tables: LegacyTableExport[] = [];
    for (const [table, spec] of Object.entries(LEGACY_TABLES) as Array<[LegacyTableName, LegacyTableSpec]>) {
      if (!present.has(table)) continue;
      tables.push(await exportTable(client, table, spec, fingerprintKey));
    }
    const authUsers = await legacyAuthUsers(client);
    return {
      schemaVersion: 1,
      auth: buildAuthMigrationPlan(authUsers, fingerprintKey),
      capturedAt: inventory.capturedAt,
      inventory,
      tables,
    };
  });
}

export interface TargetTableRows {
  conflictColumns: string[];
  rows: Record<string, unknown>[];
  table: string;
  updateColumns: string[];
}

export interface TargetImportBundle {
  schemaVersion: 1;
  generatedAt: string;
  sourceExportSha256: string;
  tables: TargetTableRows[];
  quarantined: Array<{
    reasonCode: string;
    recordFingerprint: string;
    sourceTable: LegacyTableName;
  }>;
}

export const TARGET_IMPORT_ALLOWLIST: Record<string, { conflictColumns: readonly string[]; columns: readonly string[] }> = {
  app_users: { conflictColumns: ["id"], columns: ["id", "status", "created_at", "updated_at"] },
  auth_identity_mappings: { conflictColumns: ["legacy_provider", "legacy_subject_id"], columns: ["id", "app_user_id", "auth_user_id", "legacy_provider", "legacy_subject_id", "migration_status", "linked_at", "created_at", "updated_at"] },
  profiles: { conflictColumns: ["id"], columns: ["id", "user_id", "display_name", "slug", "bio", "location", "avatar_asset_id", "is_private", "is_pro", "onboarded_at", "created_at", "updated_at"] },
  projects: { conflictColumns: ["id"], columns: ["id", "owner_id", "legacy_trip_id", "slug", "title", "description", "project_type", "start_date", "expected_end_date", "completed_at", "visibility", "lifecycle_status", "progress_percentage", "published_at", "created_at", "updated_at"] },
  project_phases: { conflictColumns: ["id"], columns: ["id", "project_id", "name", "sort_order", "is_custom", "created_at", "updated_at"] },
  project_private_details: { conflictColumns: ["project_id"], columns: ["project_id", "owner_id", "address_line_1_ciphertext", "address_line_2_ciphertext", "postal_code_ciphertext", "city_ciphertext", "country_code", "contractor_notes_ciphertext", "encryption_key_version", "created_at", "updated_at"] },
  updates: { conflictColumns: ["id"], columns: ["id", "project_id", "project_owner_id", "author_id", "phase_id", "legacy_step_id", "title", "room", "description", "update_date", "status", "is_milestone", "sort_order", "published_at", "created_at", "updated_at"] },
  media_assets: { conflictColumns: ["id"], columns: ["id", "owner_id", "project_id", "purpose", "status", "storage_provider", "bucket", "object_key", "upload_idempotency_key", "claimed_content_type", "detected_content_type", "size_bytes", "sha256", "exif_stripped", "ready_at", "created_at", "updated_at"] },
  update_media: { conflictColumns: ["update_id", "media_asset_id"], columns: ["update_id", "project_id", "media_asset_id", "role", "sort_order", "caption", "created_at", "updated_at"] },
  floorplans: { conflictColumns: ["id"], columns: ["id", "project_id", "owner_id", "media_asset_id", "name", "floor_number", "sort_order", "created_at", "updated_at"] },
  floorplan_pins: { conflictColumns: ["id"], columns: ["id", "project_id", "floorplan_id", "update_id", "x", "y", "label", "created_at", "updated_at"] },
  user_relationships: { conflictColumns: ["id"], columns: ["id", "source_user_id", "target_user_id", "kind", "status", "decided_at", "revoked_at", "created_at", "updated_at"] },
  project_access_requests: { conflictColumns: ["id"], columns: ["id", "project_id", "project_owner_id", "requester_id", "status", "decided_by_id", "decided_at", "revoked_at", "created_at", "updated_at"] },
  project_followers: { conflictColumns: ["project_id", "follower_id"], columns: ["project_id", "project_owner_id", "follower_id", "status", "followed_at", "updated_at"] },
  comments: { conflictColumns: ["id"], columns: ["id", "project_id", "update_id", "author_id", "parent_comment_id", "body", "status", "created_at", "updated_at"] },
  comment_mentions: { conflictColumns: ["comment_id", "mentioned_user_id"], columns: ["comment_id", "update_id", "mentioned_user_id", "created_at"] },
  reactions: { conflictColumns: ["id"], columns: ["id", "project_id", "update_id", "comment_id", "actor_id", "target", "emoji", "created_at"] },
  notifications: { conflictColumns: ["id"], columns: ["id", "recipient_id", "actor_id", "project_id", "update_id", "comment_id", "type", "status", "dedupe_key", "payload", "read_at", "created_at", "updated_at"] },
  project_budgets: { conflictColumns: ["id"], columns: ["id", "project_id", "owner_id", "currency", "planned_amount_minor", "is_shared", "created_at", "updated_at"] },
  budget_items: { conflictColumns: ["id"], columns: ["id", "budget_id", "project_id", "update_id", "created_by_id", "kind", "category", "description", "amount_minor", "occurred_on", "sort_order", "created_at", "updated_at"] },
  photobook_settings: { conflictColumns: ["project_id"], columns: ["project_id", "owner_id", "cover_media_asset_id", "selected_format", "title", "subtitle", "include_budget", "preferences", "created_at", "updated_at"] },
};

function validateTargetTable(batch: TargetTableRows): { conflictColumns: readonly string[]; columns: readonly string[] } {
  const allowed = TARGET_IMPORT_ALLOWLIST[batch.table];
  if (!allowed) throw new Error("Doeltabel valt buiten de migratie-allowlist.");
  if (canonicalJson([...batch.conflictColumns].sort()) !== canonicalJson([...allowed.conflictColumns].sort())) {
    throw new Error("Conflictkolommen wijken af van de migratie-allowlist.");
  }
  for (const column of batch.updateColumns) {
    if (!allowed.columns.includes(column) || allowed.conflictColumns.includes(column)) {
      throw new Error("Updatekolom valt buiten de migratie-allowlist.");
    }
  }
  return allowed;
}

export interface ImportApplyResult {
  appliedRows: Record<string, number>;
  dryRun: boolean;
}

export async function applyTargetImport(
  pool: Pool,
  bundle: TargetImportBundle,
  execute: boolean,
): Promise<ImportApplyResult> {
  const appliedRows: Record<string, number> = {};
  for (const batch of bundle.tables) validateTargetTable(batch);
  if (!execute) {
    for (const batch of bundle.tables) appliedRows[batch.table] = 0;
    return { appliedRows, dryRun: true };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Domain e-mail triggers must never turn imported historical social rows
    // into current notifications. The setting is transaction-local and only
    // suppresses producers that explicitly recognize the migration boundary.
    await client.query("SELECT set_config('app.migration_mode', 'on', true)");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('buildy-legacy-import-v1', 0))");
    for (const batch of bundle.tables) {
      const allowed = validateTargetTable(batch);
      let applied = 0;
      for (const row of batch.rows) {
        const columns = allowed.columns.filter((column) => row[column] !== undefined);
        if (columns.length === 0 || allowed.conflictColumns.some((column) => row[column] === undefined)) {
          throw new Error("Doelrij mist verplichte conflictkolommen.");
        }
        const values = columns.map((column) => row[column]);
        const updates = batch.updateColumns
          .filter((column) => columns.includes(column))
          .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
          .join(", ");
        const onConflict = updates
          ? `DO UPDATE SET ${updates}`
          : "DO NOTHING";
        const result = await client.query(`
          INSERT INTO ${qualified("public", batch.table)} (${columns.map(quoteIdentifier).join(", ")})
          VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})
          ON CONFLICT (${allowed.conflictColumns.map(quoteIdentifier).join(", ")}) ${onConflict}
        `, values);
        applied += result.rowCount ?? 0;
      }
      appliedRows[batch.table] = applied;
    }
    await client.query("COMMIT");
    return { appliedRows, dryRun: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface TableDigest {
  keySetSha256: string;
  rowCount: number;
  rowsSha256?: string;
  table: string;
}

export interface ReconciliationInput {
  actual: TableDigest[];
  expected: TableDigest[];
  auth: { expectedMappings: number; mapped: number; duplicateMappings: number; missingOwners: number };
  integrity: { foreignKeyViolations: number; notificationViolations: number; orderCountMismatch: number; orderTotalMismatchMinor: number; uniqueViolations: number };
  storage: { checksumMismatches: number; duplicateDestinations: number; missingObjects: number; expectedObjects: number; verifiedObjects: number };
}

export interface ReconciliationReport extends ReconciliationInput {
  schemaVersion: 1;
  generatedAt: string;
  passed: boolean;
  failures: string[];
}

export function reconcileMigration(input: ReconciliationInput, now = new Date()): ReconciliationReport {
  const failures: string[] = [];
  const actualByTable = new Map(input.actual.map((digest) => [digest.table, digest]));
  for (const expected of input.expected) {
    const actual = actualByTable.get(expected.table);
    if (!actual) {
      failures.push(`table_missing:${expected.table}`);
      continue;
    }
    if (actual.rowCount !== expected.rowCount) failures.push(`row_count:${expected.table}`);
    if (actual.keySetSha256 !== expected.keySetSha256) failures.push(`key_set:${expected.table}`);
    if (expected.rowsSha256 && actual.rowsSha256 !== expected.rowsSha256) failures.push(`row_checksum:${expected.table}`);
  }
  if (input.auth.mapped !== input.auth.expectedMappings) failures.push("auth_mapping_count");
  if (input.auth.duplicateMappings > 0) failures.push("auth_mapping_duplicates");
  if (input.auth.missingOwners > 0) failures.push("owner_mapping_missing");
  if (input.integrity.foreignKeyViolations > 0) failures.push("foreign_key_violations");
  if (input.integrity.uniqueViolations > 0) failures.push("unique_violations");
  if (input.integrity.notificationViolations > 0) failures.push("notification_integrity");
  if (input.integrity.orderCountMismatch > 0) failures.push("order_count_mismatch");
  if (input.integrity.orderTotalMismatchMinor !== 0) failures.push("order_total_mismatch");
  if (input.storage.missingObjects > 0) failures.push("storage_missing");
  if (input.storage.checksumMismatches > 0) failures.push("storage_checksum");
  if (input.storage.duplicateDestinations > 0) failures.push("storage_duplicate_destination");
  if (input.storage.verifiedObjects !== input.storage.expectedObjects) failures.push("storage_verification_count");
  return { ...input, schemaVersion: 1, generatedAt: now.toISOString(), passed: failures.length === 0, failures };
}

interface MergedTargetRow {
  columns: string[];
  conflictColumns: string[];
  key: string;
  row: Record<string, unknown>;
}

function normalizeDatabaseValue(column: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && column.endsWith("_at")) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return value;
}

function mergeTargetRows(bundle: TargetImportBundle): Map<string, MergedTargetRow[]> {
  const byTable = new Map<string, Map<string, MergedTargetRow>>();
  for (const batch of bundle.tables) {
    const allowed = validateTargetTable(batch);
    const table = byTable.get(batch.table) ?? new Map<string, MergedTargetRow>();
    byTable.set(batch.table, table);
    for (const inputRow of batch.rows) {
      const key = canonicalJson(Object.fromEntries(allowed.conflictColumns.map((column) => [column, inputRow[column]])));
      const existing = table.get(key);
      const normalized = Object.fromEntries(Object.entries(inputRow).map(([column, value]) => [
        column,
        normalizeDatabaseValue(column, value),
      ]));
      if (existing) {
        existing.row = { ...existing.row, ...normalized };
        existing.columns = [...new Set([...existing.columns, ...Object.keys(normalized)])].sort();
      } else {
        table.set(key, {
          columns: Object.keys(normalized).sort(),
          conflictColumns: [...allowed.conflictColumns],
          key,
          row: normalized,
        });
      }
    }
  }
  return new Map([...byTable].map(([table, rows]) => [table, [...rows.values()].sort((left, right) => left.key.localeCompare(right.key))]));
}

function digestsForMergedRows(rowsByTable: ReadonlyMap<string, readonly MergedTargetRow[]>): TableDigest[] {
  return [...rowsByTable.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([table, rows]) => ({
    table,
    rowCount: rows.length,
    keySetSha256: sha256Hex(canonicalJson(rows.map((row) => row.key))),
    rowsSha256: sha256Hex(canonicalJson(rows.map((row) => ({
      key: row.key,
      row: Object.fromEntries(row.columns.map((column) => [column, normalizeDatabaseValue(column, row.row[column])])),
    })))),
  }));
}

export function expectedTargetDigests(bundle: TargetImportBundle): TableDigest[] {
  return digestsForMergedRows(mergeTargetRows(bundle));
}

async function inspectTargetRowsWithinSnapshot(
  client: PoolClient,
  bundle: TargetImportBundle,
): Promise<TableDigest[]> {
  const expectedByTable = mergeTargetRows(bundle);
  const actualByTable = new Map<string, MergedTargetRow[]>();
  for (const [table, expectedRows] of expectedByTable) {
    const allowed = TARGET_IMPORT_ALLOWLIST[table];
    if (!allowed) throw new Error("Doeltabel valt buiten de migratie-allowlist.");
    const actualRows: MergedTargetRow[] = [];
    for (let start = 0; start < expectedRows.length; start += 100) {
      const chunk = expectedRows.slice(start, start + 100);
      const parameters: unknown[] = [];
      const predicates = chunk.map((expected) => `(${expected.conflictColumns.map((column) => {
        parameters.push(expected.row[column]);
        return `${quoteIdentifier(column)} IS NOT DISTINCT FROM $${parameters.length}`;
      }).join(" AND ")})`).join(" OR ");
      const columns = [...new Set(chunk.flatMap((row) => row.columns))].sort();
      const result = await client.query<Record<string, unknown>>(`
        SELECT ${columns.map(quoteIdentifier).join(", ")}
        FROM ${qualified("public", table)}
        WHERE ${predicates || "false"}
      `, parameters);
      for (const rawRow of result.rows) {
        const normalized = Object.fromEntries(Object.entries(rawRow).map(([column, value]) => [
          column,
          normalizeDatabaseValue(column, value),
        ]));
        const key = canonicalJson(Object.fromEntries(allowed.conflictColumns.map((column) => [column, normalized[column]])));
        const expected = chunk.find((candidate) => candidate.key === key);
        if (!expected) continue;
        actualRows.push({
          columns: expected.columns,
          conflictColumns: expected.conflictColumns,
          key,
          row: Object.fromEntries(expected.columns.map((column) => [column, normalized[column]])),
        });
      }
    }
    actualRows.sort((left, right) => left.key.localeCompare(right.key));
    actualByTable.set(table, actualRows);
  }
  return digestsForMergedRows(actualByTable);
}

export interface TargetInspectionInput {
  bundle: TargetImportBundle;
  storage: {
    checksumMismatches: number;
    duplicateDestinations: number;
    expectedObjects: number;
    missingObjects: number;
    verifiedObjects: number;
  };
}

/** Builds reconciliation evidence from a read-only Neon snapshot. */
export async function inspectTargetImport(
  pool: Pool,
  input: TargetInspectionInput,
): Promise<ReconciliationInput> {
  return inReadOnlySnapshot(pool, async (client) => {
    const expected = expectedTargetDigests(input.bundle);
    const actual = await inspectTargetRowsWithinSnapshot(client, input.bundle);
    const identityRows = input.bundle.tables
      .filter((table) => table.table === "auth_identity_mappings")
      .flatMap((table) => table.rows);
    const appUserIds = [...new Set(input.bundle.tables
      .filter((table) => table.table === "app_users")
      .flatMap((table) => table.rows)
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string"))];
    const legacySubjects = identityRows
      .map((row) => row.legacy_subject_id)
      .filter((value): value is string => typeof value === "string");
    const mappings = await client.query<{ duplicate_count: string; mapped_count: string }>(`
      SELECT
        count(*) filter (where mapping.legacy_subject_id = any($1::text[]))::text AS mapped_count,
        coalesce((
          SELECT count(*) FROM (
            SELECT legacy_provider, legacy_subject_id
            FROM public.auth_identity_mappings
            WHERE legacy_provider IS NOT NULL
            GROUP BY legacy_provider, legacy_subject_id
            HAVING count(*) > 1
          ) duplicates
        ), 0)::text AS duplicate_count
      FROM public.auth_identity_mappings mapping
    `, [legacySubjects]);
    const owners = await client.query<{ missing_count: string }>(`
      SELECT count(*)::text AS missing_count
      FROM unnest($1::uuid[]) expected(id)
      LEFT JOIN public.app_users app_user ON app_user.id = expected.id
      WHERE app_user.id IS NULL
    `, [appUserIds]);
    const constraints = await client.query<{ unvalidated: string }>(`
      SELECT count(*)::text AS unvalidated
      FROM pg_constraint constraint_row
      JOIN pg_namespace namespace_row ON namespace_row.oid = constraint_row.connamespace
      WHERE namespace_row.nspname = 'public'
        AND constraint_row.contype IN ('f', 'u', 'p', 'c')
        AND NOT constraint_row.convalidated
    `);
    const notificationIds = input.bundle.tables
      .filter((table) => table.table === "notifications")
      .flatMap((table) => table.rows)
      .map((row) => row.id)
      .filter((value): value is string => typeof value === "string");
    const notifications = await client.query<{ invalid_count: string }>(`
      SELECT count(*)::text AS invalid_count
      FROM public.notifications notification
      WHERE notification.id = any($1::uuid[])
        AND (
          NOT EXISTS (SELECT 1 FROM public.app_users app_user WHERE app_user.id = notification.recipient_id)
          OR (notification.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects project WHERE project.id = notification.project_id))
          OR (notification.update_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.updates project_update WHERE project_update.id = notification.update_id))
        )
    `, [notificationIds]);
    const unvalidated = Number(constraints.rows[0]?.unvalidated ?? 0);
    const unresolvedOrders = input.bundle.quarantined.filter((entry) =>
      entry.sourceTable === "photobook_orders" && entry.reasonCode === "legacy_order_manual_review").length;
    return {
      actual,
      expected,
      auth: {
        duplicateMappings: Number(mappings.rows[0]?.duplicate_count ?? 0),
        expectedMappings: legacySubjects.length,
        mapped: Number(mappings.rows[0]?.mapped_count ?? 0),
        missingOwners: Number(owners.rows[0]?.missing_count ?? 0),
      },
      integrity: {
        foreignKeyViolations: unvalidated,
        notificationViolations: Number(notifications.rows[0]?.invalid_count ?? 0),
        orderCountMismatch: unresolvedOrders,
        orderTotalMismatchMinor: 0,
        uniqueViolations: unvalidated,
      },
      storage: input.storage,
    };
  });
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    allowExitOnIdle: true,
    connectionString,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    max: 1,
    statement_timeout: 120_000,
  });
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "pg";
import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_MIGRATIONS_DIRECTORY,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  acquireMigrationLock,
  assertMigrationLedgerStructure,
  assertSafeMigrationConnection,
  configureMigrationTransaction,
  createMigrationClient,
  discoverMigrations,
  planMigrations,
  readMigrationLedger,
  releaseMigrationLock,
  requireMigrationDatabaseUrl,
  validateMigrationDatabaseUrl,
  MigrationValidationError,
} from "./migrate.ts";

export const EXPECTED_PUBLIC_TABLES = [
  "app_users",
  "app_role_grants",
  "auth_accounts",
  "auth_identity_mappings",
  "auth_rate_limits",
  "auth_sessions",
  "auth_users",
  "auth_verifications",
  "audit_events",
  "beta_invite_redemptions",
  "beta_invites",
  "budget_items",
  "comment_mentions",
  "comments",
  "deletion_assets",
  "deletion_jobs",
  "email_deliveries",
  "email_recipient_profiles",
  "export_jobs",
  "feedback_submissions",
  "floorplan_pins",
  "floorplans",
  "media_assets",
  "moderation_actions",
  "moderation_account_restrictions",
  "moderation_reports",
  "moderation_target_states",
  "notifications",
  "outbox_events",
  "photobook_drafts",
  "photobook_exclusions",
  "photobook_order_events",
  "photobook_orders",
  "photobook_revisions",
  "photobook_settings",
  "profiles",
  "product_events",
  "project_access_requests",
  "project_budgets",
  "project_followers",
  "project_phases",
  "project_private_details",
  "projects",
  "provider_event_inbox",
  "reactions",
  "update_media",
  "updates",
  "user_relationships",
] as const;

// Better Auth owns these core tables. Every remaining public table fails closed
// through PostgreSQL RLS, including identity and encrypted-recipient records.
const BETTER_AUTH_CORE_TABLES = new Set([
  "auth_accounts",
  "auth_rate_limits",
  "auth_sessions",
  "auth_users",
  "auth_verifications",
]);

export const EXPECTED_RLS_TABLES = EXPECTED_PUBLIC_TABLES.filter(
  (table) => !BETTER_AUTH_CORE_TABLES.has(table),
);

const REQUIRED_FUNCTIONS = [
  "app_account_order_is_active",
  "app_request_account_export",
  "app_request_account_deletion",
  "app_request_project_deletion",
  "app_account_worker_claim_export",
  "app_account_worker_begin_export",
  "app_account_worker_finalize_export",
  "app_account_worker_fail_export",
  "app_account_worker_claim_expired_export",
  "app_account_worker_finalize_export_cleanup",
  "app_account_worker_fail_export_cleanup",
  "app_account_worker_claim_deletion",
  "app_account_worker_begin_deletion",
  "app_account_worker_verify_deletion_asset",
  "app_account_worker_fail_deletion",
  "app_account_worker_finalize_deletion",
  "app_account_worker_finalize_deletion_job",
  "app_project_worker_finalize_deletion",
  "app_apply_brevo_delivery_event",
  "app_actor_id",
  "app_email_worker_acknowledge",
  "app_email_worker_claim",
  "app_email_worker_complete",
  "app_email_worker_fail",
  "app_email_worker_load_community_receipt",
  "app_email_worker_load_account_event",
  "app_email_worker_load_order",
  "app_email_worker_prepare",
  "app_email_worker_prepare_account",
  "app_ingest_brevo_delivery_event",
  "app_ack_outbox_event",
  "app_begin_media_processing_job",
  "app_claim_outbox_event",
  "app_fail_media_processing_job",
  "app_finalize_media_processing_job",
  "app_enqueue_auth_email",
  "app_enqueue_account_security_email",
  "app_enqueue_migration_account_email",
  "app_enqueue_order_transactional_email",
  "app_enqueue_project_access_email",
  "app_enqueue_welcome_email",
  "app_email_event_is_supported",
  "app_media_protected_object_keys",
  "app_photobook_worker_claim",
  "app_begin_photobook_render",
  "app_finalize_photobook_render",
  "app_fail_photobook_render",
  "app_peecho_worker_claim",
  "app_begin_peecho_fulfilment",
  "app_begin_peecho_order_create",
  "app_persist_peecho_order_created",
  "app_begin_peecho_order_payment",
  "app_finalize_peecho_order_status",
  "app_retry_peecho_fulfilment",
  "app_mark_peecho_manual_review",
  "app_peecho_status_rank",
  "app_record_peecho_callback",
  "app_provision_auth_identity",
  "app_register_auth_email_recipient",
  "app_require_email_recipient_before_first_auth",
  "app_set_social_access_email_preference",
  "app_reconcile_brevo_delivery_events",
  "app_retry_outbox_event",
  "app_resolve_active_user",
  "app_can_view_profile",
  "app_can_view_project",
  "app_can_view_update",
  "app_can_manage_comment",
  "app_can_view_notification_target",
  "app_enqueue_engagement_notification",
  "app_enqueue_social_notification",
  "app_follow_state_allowed",
  "app_lock_social_user_pair",
  "app_owns_project",
  "app_resolve_engagement_mentions",
  "app_social_project_context",
  "app_users_are_blocked",
  "app_actor_moderation_role",
  "app_moderation_target_owner",
  "app_moderation_target_hidden",
  "app_moderation_media_hidden",
  "app_resolve_moderation_actor",
  "app_admin_list_moderation_reports",
  "app_admin_load_moderation_report",
  "app_admin_list_moderation_actions",
  "app_admin_apply_moderation_action",
  "app_migration_grant_role",
  "app_migration_revoke_role",
  "app_product_event_properties_valid",
  "app_product_event_subject_hash",
  "app_insert_product_event",
  "app_create_beta_invite",
  "app_revoke_beta_invite",
  "app_reserve_beta_invite",
  "app_complete_beta_signup",
  "app_record_client_product_event",
  "app_capture_product_event",
  "guard_access_request_identity",
  "guard_comment_identity",
  "guard_linked_avatar_asset",
  "guard_locked_photobook_asset",
  "guard_locked_photobook_revision",
  "guard_photobook_order_transition",
  "guard_notification_recipient_update",
  "guard_profile_privileges",
  "guard_project_follower_identity",
  "guard_relationship_identity",
  "prevent_append_only_mutation",
  "set_updated_at",
  "guard_project_budget_server_fields",
  "validate_budget_item_scope",
  "validate_floorplan_asset_scope",
  "validate_floorplan_pin_scope",
  "validate_photobook_order_proof",
  "validate_photobook_revision_proof",
] as const;

const REQUIRED_TRIGGERS = [
  "audit_events_append_only",
  "app_users_enqueue_welcome_email",
  "app_users_require_email_recipient_before_first_auth",
  "product_events_append_only",
  "beta_signup_product_event",
  "onboarding_product_event",
  "project_created_product_event",
  "first_update_product_event",
  "photo_upload_product_event",
  "follow_product_event",
  "comment_created_product_event",
  "photobook_draft_product_event",
  "photobook_proof_product_event",
  "checkout_product_event",
  "feedback_product_event",
  "deletion_jobs_enqueue_security_email",
  "media_assets_guard_locked_proof",
  "media_assets_guard_linked_avatar",
  "notifications_guard_recipient_update",
  "photobook_order_events_append_only",
  "photobook_order_events_enqueue_transactional_email",
  "photobook_orders_guard_transition",
  "photobook_orders_validate_proof",
  "photobook_revisions_guard_locked",
  "photobook_revisions_validate_proof",
  "profiles_guard_privileges",
  "project_access_requests_guard_identity",
  "project_access_requests_enqueue_email",
  "project_followers_guard_identity",
  "comments_guard_identity",
  "budget_items_validate_scope",
  "floorplan_pins_validate_scope",
  "floorplans_validate_asset_scope",
  "project_budgets_guard_server_fields",
  "user_relationships_guard_identity",
] as const;

type VerificationOptions = {
  migrationsDirectory?: string;
  databaseUrl?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  logger?: Pick<Console, "info" | "warn">;
};

export type VerificationReport = {
  migrationCount: number;
  publicTableCount: number;
  rlsTableCount: number;
};

function assertPositiveInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new MigrationValidationError(`${name} moet een geheel getal tussen 1 en ${maximum} zijn.`);
  }
}

export function compareExpectedNames(
  label: string,
  expectedNames: readonly string[],
  actualNames: readonly string[],
): void {
  const expected = new Set(expectedNames);
  const actual = new Set(actualNames);
  const missing = [...expected].filter((name) => !actual.has(name)).sort();
  const unexpected = [...actual].filter((name) => !expected.has(name)).sort();
  if (missing.length === 0 && unexpected.length === 0) return;

  const details = [
    missing.length > 0 ? `ontbreekt: ${missing.join(", ")}` : undefined,
    unexpected.length > 0 ? `onverwacht: ${unexpected.join(", ")}` : undefined,
  ].filter(Boolean);
  throw new MigrationValidationError(`${label} wijkt af (${details.join("; ")}).`);
}

async function verifyPublicTables(client: Client): Promise<void> {
  const result = await client.query<{ name: string; rls_enabled: boolean }>(`
    SELECT classes.relname AS name, classes.relrowsecurity AS rls_enabled
    FROM pg_catalog.pg_class classes
    JOIN pg_catalog.pg_namespace namespaces ON namespaces.oid = classes.relnamespace
    WHERE namespaces.nspname = 'public'
      AND classes.relkind IN ('r', 'p')
    ORDER BY classes.relname
  `);

  compareExpectedNames(
    "Publieke tabelcatalogus",
    EXPECTED_PUBLIC_TABLES,
    result.rows.map((row) => row.name),
  );
  compareExpectedNames(
    "RLS-tabelcatalogus",
    EXPECTED_RLS_TABLES,
    result.rows.filter((row) => row.rls_enabled).map((row) => row.name),
  );
}

async function verifySupportingObjects(client: Client): Promise<void> {
  const extension = await client.query<{ installed: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') AS installed",
  );
  if (!extension.rows[0]?.installed) {
    throw new MigrationValidationError("Vereiste PostgreSQL-extensie pgcrypto ontbreekt.");
  }

  const functions = await client.query<{ name: string }>(`
    SELECT DISTINCT procedures.proname AS name
    FROM pg_catalog.pg_proc procedures
    JOIN pg_catalog.pg_namespace namespaces ON namespaces.oid = procedures.pronamespace
    WHERE namespaces.nspname = 'public'
  `);
  const availableFunctions = new Set(functions.rows.map((row) => row.name));
  const missingFunctions = REQUIRED_FUNCTIONS.filter((name) => !availableFunctions.has(name));
  if (missingFunctions.length > 0) {
    throw new MigrationValidationError(
      `Vereiste databasefuncties ontbreken: ${missingFunctions.join(", ")}.`,
    );
  }

  const securityDefiners = await client.query<{ name: string; settings: string[] | null }>(`
    SELECT procedures.proname AS name, procedures.proconfig AS settings
    FROM pg_catalog.pg_proc procedures
    JOIN pg_catalog.pg_namespace namespaces ON namespaces.oid = procedures.pronamespace
    WHERE namespaces.nspname = 'public'
      AND procedures.prosecdef
  `);
  for (const routine of securityDefiners.rows) {
    const searchPath = routine.settings?.find((setting) => setting.startsWith("search_path="));
    const normalizedSearchPath = searchPath?.replace(/\s+/g, "").toLowerCase();
    if (
      normalizedSearchPath !== "search_path=pg_catalog,public" &&
      normalizedSearchPath !== "search_path=public,pg_catalog"
    ) {
      throw new MigrationValidationError(
        `SECURITY DEFINER-functie '${routine.name}' heeft geen vaste veilige search_path.`,
      );
    }
  }

  const publiclyExecutable = await client.query<{ name: string }>(`
    SELECT DISTINCT
      procedures.proname || '(' || pg_catalog.pg_get_function_identity_arguments(procedures.oid) || ')' AS name
    FROM pg_catalog.pg_proc procedures
    JOIN pg_catalog.pg_namespace namespaces ON namespaces.oid = procedures.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedures.proacl, pg_catalog.acldefault('f', procedures.proowner))
    ) privileges
    WHERE namespaces.nspname = 'public'
      AND procedures.prosecdef
      AND privileges.grantee = 0
      AND privileges.privilege_type = 'EXECUTE'
  `);
  if (publiclyExecutable.rows.length > 0) {
    throw new MigrationValidationError(
      `SECURITY DEFINER-functies zijn publiek uitvoerbaar: ${publiclyExecutable.rows.map((row) => row.name).join(", ")}.`,
    );
  }

  const triggers = await client.query<{ name: string; enabled: string }>(`
    SELECT triggers.tgname AS name, triggers.tgenabled AS enabled
    FROM pg_catalog.pg_trigger triggers
    JOIN pg_catalog.pg_class classes ON classes.oid = triggers.tgrelid
    JOIN pg_catalog.pg_namespace namespaces ON namespaces.oid = classes.relnamespace
    WHERE namespaces.nspname = 'public'
      AND NOT triggers.tgisinternal
  `);
  const triggerByName = new Map(triggers.rows.map((trigger) => [trigger.name, trigger.enabled]));
  const missingTriggers = REQUIRED_TRIGGERS.filter((name) => !triggerByName.has(name));
  if (missingTriggers.length > 0) {
    throw new MigrationValidationError(`Vereiste triggers ontbreken: ${missingTriggers.join(", ")}.`);
  }
  const inactiveTriggers = triggers.rows
    .filter((trigger) => trigger.enabled !== "O" && trigger.enabled !== "A")
    .map((trigger) => trigger.name)
    .sort();
  if (inactiveTriggers.length > 0) {
    throw new MigrationValidationError(`Niet-actieve triggers gevonden: ${inactiveTriggers.join(", ")}.`);
  }

  const invalidConstraints = await client.query<{ name: string }>(`
    SELECT constraints.conname AS name
    FROM pg_catalog.pg_constraint constraints
    JOIN pg_catalog.pg_namespace namespaces ON namespaces.oid = constraints.connamespace
    WHERE namespaces.nspname = 'public'
      AND NOT constraints.convalidated
    ORDER BY constraints.conname
  `);
  if (invalidConstraints.rows.length > 0) {
    throw new MigrationValidationError(
      `Niet-gevalideerde constraints gevonden: ${invalidConstraints.rows.map((row) => row.name).join(", ")}.`,
    );
  }
}

export async function verifyDatabase(options: VerificationOptions = {}): Promise<VerificationReport> {
  const migrationsDirectory = options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const logger = options.logger ?? console;
  assertPositiveInteger("lock timeout", lockTimeoutMs, 300_000);
  assertPositiveInteger("statement timeout", statementTimeoutMs, 900_000);

  const migrations = await discoverMigrations(migrationsDirectory);
  const databaseUrl = options.databaseUrl
    ? validateMigrationDatabaseUrl(options.databaseUrl)
    : requireMigrationDatabaseUrl();
  const client = createMigrationClient(databaseUrl, statementTimeoutMs);
  let lockAcquired = false;
  let transactionOpen = false;

  try {
    await client.connect();
    await assertSafeMigrationConnection(client, databaseUrl);
    await acquireMigrationLock(client, lockTimeoutMs, true);
    lockAcquired = true;

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await configureMigrationTransaction(client, lockTimeoutMs, statementTimeoutMs);

    await assertMigrationLedgerStructure(client);
    const plan = planMigrations(migrations, await readMigrationLedger(client));
    if (plan.pending.length > 0 || plan.applied.length !== migrations.length) {
      throw new MigrationValidationError(
        `Database is niet volledig gemigreerd; pending: ${plan.pending.map((item) => item.filename).join(", ")}.`,
      );
    }
    await verifyPublicTables(client);
    await verifySupportingObjects(client);

    await client.query("COMMIT");
    transactionOpen = false;
    const report = {
      migrationCount: migrations.length,
      publicTableCount: EXPECTED_PUBLIC_TABLES.length,
      rlsTableCount: EXPECTED_RLS_TABLES.length,
    };
    logger.info(
      `Database geverifieerd: ${report.migrationCount} migration(s), ${report.publicTableCount} tabellen, ${report.rlsTableCount} met RLS.`,
    );
    return report;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseMigrationLock(client, true).catch((error: unknown) => {
        logger.warn(error instanceof Error ? error.message : "Verificatielock kon niet worden vrijgegeven.");
      });
    }
    await client.end().catch(() => undefined);
  }
}

type ParsedVerificationArguments = {
  migrationsDirectory?: string;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
};

export function parseVerificationArguments(argumentsList: string[]): ParsedVerificationArguments {
  const parsed: ParsedVerificationArguments = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--migrations-dir") {
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
      throw new MigrationValidationError(`Onbekend verificatieargument '${argument}'.`);
    }
  }
  return parsed;
}

async function runCli(): Promise<void> {
  await verifyDatabase(parseVerificationArguments(process.argv.slice(2)));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Onbekende databaseverificatiefout.");
    process.exitCode = 1;
  });
}

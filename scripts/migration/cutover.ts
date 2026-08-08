import { z } from "zod";
import type { LegacyExportBundle, LegacyTableName, ReconciliationReport } from "./database";
import { canonicalJson, sha256Hex } from "./core";
import type { SessionInvalidationGate } from "./auth";

export interface DeltaTable {
  changedOrAddedRows: Record<string, unknown>[];
  deletedKeyFingerprints: string[];
  table: LegacyTableName;
  unchanged: number;
}

export interface MigrationDelta {
  schemaVersion: 1;
  baseCapturedAt: string;
  capturedAt: string;
  finalDelta: boolean;
  tables: DeltaTable[];
  summary: {
    changedOrAdded: number;
    deletionCandidates: number;
    unchanged: number;
  };
}

function rowState(bundle: LegacyExportBundle, table: LegacyTableName): Map<string, { row: Record<string, unknown>; sha256: string }> {
  const exported = bundle.tables.find((candidate) => candidate.table === table);
  const result = new Map<string, { row: Record<string, unknown>; sha256: string }>();
  if (!exported) return result;
  exported.rows.forEach((row, index) => {
    const key = exported.primaryKeyFingerprints[index];
    if (!key) throw new Error("Bronexport mist een primary-keyfingerprint.");
    result.set(key, { row, sha256: sha256Hex(canonicalJson(row)) });
  });
  return result;
}

/**
 * Computes full-key deltas, including delete candidates that an updated_at
 * watermark cannot observe. Delete candidates are never applied automatically.
 */
export function computeMigrationDelta(
  base: LegacyExportBundle,
  current: LegacyExportBundle,
  finalDelta: boolean,
): MigrationDelta {
  if (new Date(current.capturedAt).getTime() < new Date(base.capturedAt).getTime()) {
    throw new Error("Delta-export is ouder dan de basisexport.");
  }
  const names = new Set<LegacyTableName>([
    ...base.tables.map((table) => table.table),
    ...current.tables.map((table) => table.table),
  ]);
  const tables: DeltaTable[] = [];
  for (const table of [...names].sort()) {
    const before = rowState(base, table);
    const after = rowState(current, table);
    const changedOrAddedRows: Record<string, unknown>[] = [];
    const deletedKeyFingerprints: string[] = [];
    let unchanged = 0;
    for (const [key, value] of after) {
      if (before.get(key)?.sha256 === value.sha256) unchanged += 1;
      else changedOrAddedRows.push(value.row);
    }
    for (const key of before.keys()) if (!after.has(key)) deletedKeyFingerprints.push(key);
    tables.push({
      changedOrAddedRows,
      deletedKeyFingerprints: deletedKeyFingerprints.sort(),
      table,
      unchanged,
    });
  }
  return {
    schemaVersion: 1,
    baseCapturedAt: base.capturedAt,
    capturedAt: current.capturedAt,
    finalDelta,
    tables,
    summary: {
      changedOrAdded: tables.reduce((total, table) => total + table.changedOrAddedRows.length, 0),
      deletionCandidates: tables.reduce((total, table) => total + table.deletedKeyFingerprints.length, 0),
      unchanged: tables.reduce((total, table) => total + table.unchanged, 0),
    },
  };
}

const checksumSchema = z.string().regex(/^[0-9a-f]{64}$/);

export interface CutoverEvidence {
  acceptance: {
    acceptedAt?: string;
    acceptedByFingerprint?: string;
    artifactSha256?: string;
    ticket?: string;
  };
  auth: {
    migrationEmailsRehearsed: boolean;
    oauthRelinkRehearsed: boolean;
    passwordSetRehearsed: boolean;
    sessionInvalidation: SessionInvalidationGate;
  };
  backup: {
    artifactSha256?: string;
    readbackVerifiedAt?: string;
    restoreRehearsalPassed: boolean;
  };
  finalDelta: MigrationDelta;
  providerRoutes: {
    brevoReady: boolean;
    peechoCallbackReady: boolean;
    stripeWebhookReady: boolean;
  };
  reconciliation: ReconciliationReport;
  rollback: {
    ownerFingerprint?: string;
    windowEndsAt?: string;
    planArtifactSha256?: string;
  };
  smoke: {
    privateMediaDeniedAnonymously: boolean;
    privateProjectDeniedAnonymously: boolean;
    syntheticCoreFlowsPassed: boolean;
  };
  sourceFreeze: {
    finalSnapshotStartedAt?: string;
    frozenAt?: string;
    writesDisabledVerified: boolean;
  };
  targetEnvironment: "staging" | "production";
}

export interface CutoverGateReport {
  schemaVersion: 1;
  evaluatedAt: string;
  gates: Array<{ code: string; passed: boolean }>;
  passed: boolean;
  targetEnvironment: "staging" | "production";
}

function validDate(value: string | undefined): boolean {
  return Boolean(value && Number.isFinite(new Date(value).getTime()));
}

function validChecksum(value: string | undefined): boolean {
  return checksumSchema.safeParse(value).success;
}

export function evaluateCutoverGates(evidence: CutoverEvidence, now = new Date()): CutoverGateReport {
  const finalSnapshotAt = evidence.sourceFreeze.finalSnapshotStartedAt
    ? new Date(evidence.sourceFreeze.finalSnapshotStartedAt).getTime()
    : Number.NaN;
  const frozenAt = evidence.sourceFreeze.frozenAt
    ? new Date(evidence.sourceFreeze.frozenAt).getTime()
    : Number.NaN;
  const rollbackEndsAt = evidence.rollback.windowEndsAt
    ? new Date(evidence.rollback.windowEndsAt).getTime()
    : Number.NaN;
  const gates = [
    { code: "backup_checksum", passed: validChecksum(evidence.backup.artifactSha256) },
    { code: "backup_readback", passed: validDate(evidence.backup.readbackVerifiedAt) },
    { code: "restore_rehearsal", passed: evidence.backup.restoreRehearsalPassed },
    { code: "source_frozen", passed: evidence.sourceFreeze.writesDisabledVerified && Number.isFinite(frozenAt) },
    { code: "final_delta_after_freeze", passed: evidence.finalDelta.finalDelta && Number.isFinite(finalSnapshotAt) && finalSnapshotAt >= frozenAt },
    { code: "final_delta_delete_review", passed: evidence.finalDelta.summary.deletionCandidates === 0 },
    { code: "reconciliation", passed: evidence.reconciliation.passed },
    { code: "private_media", passed: evidence.smoke.privateMediaDeniedAnonymously },
    { code: "private_projects", passed: evidence.smoke.privateProjectDeniedAnonymously },
    { code: "synthetic_smoke", passed: evidence.smoke.syntheticCoreFlowsPassed },
    { code: "auth_password_set", passed: evidence.auth.passwordSetRehearsed },
    { code: "auth_oauth_relink", passed: evidence.auth.oauthRelinkRehearsed },
    { code: "auth_migration_email", passed: evidence.auth.migrationEmailsRehearsed },
    { code: "rollback_plan", passed: validChecksum(evidence.rollback.planArtifactSha256) },
    { code: "rollback_owner", passed: Boolean(evidence.rollback.ownerFingerprint) },
    { code: "rollback_window", passed: Number.isFinite(rollbackEndsAt) && rollbackEndsAt > now.getTime() },
  ];

  if (evidence.targetEnvironment === "production") {
    gates.push(
      { code: "old_sessions_invalidated", passed: evidence.auth.sessionInvalidation.complete },
      { code: "stripe_webhook_route", passed: evidence.providerRoutes.stripeWebhookReady },
      { code: "peecho_callback_route", passed: evidence.providerRoutes.peechoCallbackReady },
      { code: "brevo_route", passed: evidence.providerRoutes.brevoReady },
      {
        code: "owner_acceptance",
        passed: validDate(evidence.acceptance.acceptedAt)
          && Boolean(evidence.acceptance.acceptedByFingerprint)
          && Boolean(evidence.acceptance.ticket)
          && validChecksum(evidence.acceptance.artifactSha256),
      },
    );
  }
  return {
    schemaVersion: 1,
    evaluatedAt: now.toISOString(),
    gates,
    passed: gates.every((gate) => gate.passed),
    targetEnvironment: evidence.targetEnvironment,
  };
}

export interface RollbackPlan {
  schemaVersion: 1;
  generatedAt: string;
  irreversibleActionsAllowed: false;
  steps: readonly string[];
  triggers: readonly string[];
}

export function createRollbackPlan(now = new Date()): RollbackPlan {
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    irreversibleActionsAllowed: false,
    triggers: [
      "authenticatie of ownershipmapping wijkt af",
      "private media of privéproject is anoniem bereikbaar",
      "order- of betalingstotalen wijken af",
      "kritieke writeflow faalt in de productiesmoke",
      "providerwebhook komt bij de verkeerde omgeving uit",
    ],
    steps: [
      "Zet de nieuwe runtime onmiddellijk in read-only onderhoudsmodus.",
      "Bewaar de nieuwe append-only writes en audit-events als versleuteld delta-artifact.",
      "Herstel de vorige DNS- en webhookroutes met de vooraf vastgelegde configuratie.",
      "Hef de legacy freeze pas op nadat oude sessies opnieuw veilig zijn geconfigureerd.",
      "Voer de synthetische privacy-, auth- en order-smokes opnieuw uit op legacy.",
      "Reconcileer writes uit het cutovervenster handmatig; verlies of blind terugschrijven is niet toegestaan.",
      "Bewaar Neon, R2 en source backups ongewijzigd voor incidentanalyse.",
    ],
  };
}

export type LegacyCleanupState = "retained_for_rollback" | "awaiting_retention_decision" | "eligible_for_manual_decommission";

export interface LegacyCleanupLedger {
  schemaVersion: 1;
  generatedAt: string;
  destructiveActionsAllowed: false;
  cutoverAcceptanceSha256: string;
  entries: Array<{
    resource: "legacy_database" | "legacy_storage" | "legacy_auth" | "legacy_hosting" | "legacy_secrets";
    state: LegacyCleanupState;
  }>;
}

/** Marks cleanup eligibility in an offline ledger. It never calls or deletes a provider resource. */
export function markLegacyCleanupEligibility(input: {
  acceptanceSha256: string;
  backupRetentionApproved: boolean;
  cutoverReport: CutoverGateReport;
  now?: Date;
  rollbackWindowEndsAt: string;
}): LegacyCleanupLedger {
  const now = input.now ?? new Date();
  if (!input.cutoverReport.passed || input.cutoverReport.targetEnvironment !== "production") {
    throw new Error("Legacy cleanup kan pas na een geslaagde productieacceptatie worden gemarkeerd.");
  }
  if (!validChecksum(input.acceptanceSha256)) throw new Error("Cutoveracceptatiechecksum is ongeldig.");
  const rollbackEndsAt = new Date(input.rollbackWindowEndsAt).getTime();
  if (!Number.isFinite(rollbackEndsAt)) throw new Error("Rollbackwindow is ongeldig.");
  const state: LegacyCleanupState = now.getTime() <= rollbackEndsAt
    ? "retained_for_rollback"
    : input.backupRetentionApproved
      ? "eligible_for_manual_decommission"
      : "awaiting_retention_decision";
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    destructiveActionsAllowed: false,
    cutoverAcceptanceSha256: input.acceptanceSha256,
    entries: ["legacy_database", "legacy_storage", "legacy_auth", "legacy_hosting", "legacy_secrets"].map((resource) => ({
      resource: resource as LegacyCleanupLedger["entries"][number]["resource"],
      state,
    })),
  };
}

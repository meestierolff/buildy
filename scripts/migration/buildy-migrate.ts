#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { DataProtectionKeyring } from "../../server/security/dataProtection";
import {
  applyTargetImport,
  createPool,
  exportLegacySource,
  inspectTargetImport,
  inventoryLegacySource,
  reconcileMigration,
  type LegacyExportBundle,
  type ReconciliationInput,
  type TargetImportBundle,
} from "./database";
import {
  assertNetworkReadAuthorized,
  assertTargetReadAuthorized,
  assertTargetWriteAuthorized,
  assertTrustedEndpoint,
  createMigrationRunId,
  migrationEnvironmentSchema,
  readSealedArtifact,
  redactForLog,
  sealArtifact,
  writeSealedArtifact,
} from "./core";
import {
  computeMigrationDelta,
  createRollbackPlan,
  evaluateCutoverGates,
  markLegacyCleanupEligibility,
  type CutoverEvidence,
  type CutoverGateReport,
} from "./cutover";
import { buildTargetImportBundle, planLegacyStorage } from "./mapping";
import {
  type StorageCopyCheckpoint,
  type StorageMigrationPlan,
} from "./storage";

type Arguments = Record<string, string | boolean>;

function parseArguments(values: readonly string[]): { command: string; flags: Arguments } {
  const [command = "help", ...rest] = values;
  const flags: Arguments = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) throw new Error("Gebruik uitsluitend benoemde --flags.");
    const key = value.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(key) || flags[key] !== undefined) throw new Error("CLI-flag is ongeldig of dubbel opgegeven.");
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function flag(flags: Arguments, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function enabled(flags: Arguments, name: string): boolean {
  return flags[name] === true;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Vereiste configuratiesleutel ontbreekt: ${name}.`);
  return value;
}

function environment(): "local" | "test" | "preview" | "staging" | "production" {
  return migrationEnvironmentSchema.parse(process.env.APP_ENV ?? "local");
}

function artifactKey(): string {
  return required(process.env.MIGRATION_ARTIFACT_KEY, "MIGRATION_ARTIFACT_KEY");
}

function fingerprintKey(): Buffer {
  const key = Buffer.from(artifactKey(), "base64");
  if (key.byteLength !== 32) throw new Error("MIGRATION_ARTIFACT_KEY moet exact 256 bits zijn.");
  return key;
}

function runId(flags: Arguments): string {
  return flag(flags, "run-id") ?? process.env.MIGRATION_RUN_ID ?? createMigrationRunId();
}

function defaultArtifactPath(id: string, kind: string): string {
  return `artifacts/migration/${id}/${kind}.sealed.json`;
}

function log(value: unknown): void {
  process.stdout.write(`${JSON.stringify(redactForLog(value), null, 2)}\n`);
}

async function writePayload(input: {
  flags: Arguments;
  kind: string;
  payload: unknown;
  runId: string;
}): Promise<{ path: string; sha256: string }> {
  const path = flag(input.flags, "output") ?? defaultArtifactPath(input.runId, input.kind);
  const sealed = sealArtifact({
    artifactKeyBase64: artifactKey(),
    kind: input.kind,
    payload: input.payload,
    runId: input.runId,
  });
  return { path, sha256: await writeSealedArtifact(path, sealed) };
}

async function readPayload<T>(path: string): Promise<{ payload: T; runId: string; kind: string; sha256: string }> {
  const result = await readSealedArtifact<T>(path, artifactKey());
  return {
    payload: result.payload,
    runId: result.sealed.runId,
    kind: result.sealed.kind,
    sha256: result.envelopeSha256,
  };
}

function sourceReadGate(
  flags: Arguments,
  id: string,
  url: string,
  overrides?: { confirmation?: string; expectedHost?: string },
): void {
  assertNetworkReadAuthorized({
    allowNetworkRead: enabled(flags, "allow-network-read"),
    confirmation: overrides?.confirmation ?? process.env.MIGRATION_SOURCE_READ_CONFIRM,
    runId: id,
    source: {
      expectedHost: overrides?.expectedHost ?? required(process.env.MIGRATION_EXPECTED_SOURCE_HOST, "MIGRATION_EXPECTED_SOURCE_HOST"),
      url,
    },
  });
}

function targetWriteInput(
  flags: Arguments,
  id: string,
  targetUrl: string,
  overrides?: { expectedHost?: string; productionConfirmation?: string; writeConfirmation?: string },
) {
  return {
    acceptanceArtifactSha256: process.env.MIGRATION_ACCEPTANCE_ARTIFACT_SHA256,
    backupArtifactSha256: process.env.MIGRATION_BACKUP_ARTIFACT_SHA256,
    environment: environment(),
    execute: enabled(flags, "execute"),
    expectedHost: overrides?.expectedHost ?? required(process.env.MIGRATION_EXPECTED_TARGET_HOST, "MIGRATION_EXPECTED_TARGET_HOST"),
    productionConfirmation: overrides?.productionConfirmation ?? process.env.MIGRATION_PRODUCTION_CONFIRM,
    runId: id,
    targetUrl,
    writeConfirmation: overrides?.writeConfirmation ?? process.env.MIGRATION_WRITE_CONFIRM,
  } as const;
}

function sourceDatabaseUrl(): string {
  return required(process.env.LEGACY_DATABASE_URL, "LEGACY_DATABASE_URL");
}

async function inventoryCommand(flags: Arguments): Promise<void> {
  const id = runId(flags);
  if (!enabled(flags, "allow-network-read")) {
    log({
      command: "inventory",
      dryRun: true,
      requiredConfirmation: `READ:${id}:<MIGRATION_EXPECTED_SOURCE_HOST>`,
      runId: id,
      writes: false,
    });
    return;
  }
  const connectionString = sourceDatabaseUrl();
  sourceReadGate(flags, id, connectionString);
  const pool = createPool(connectionString);
  try {
    const inventory = await inventoryLegacySource(pool);
    const artifact = await writePayload({ flags, kind: "source-inventory", payload: inventory, runId: id });
    log({ artifactSha256: artifact.sha256, output: artifact.path, runId: id, summary: {
      authUsers: inventory.auth.totalUsers,
      storageBuckets: inventory.storageBuckets.length,
      tables: inventory.tables.length,
    } });
  } finally {
    await pool.end();
  }
}

async function exportCommand(flags: Arguments): Promise<void> {
  const id = runId(flags);
  if (!enabled(flags, "allow-network-read")) {
    log({ command: "export", dryRun: true, requiredConfirmation: `READ:${id}:<MIGRATION_EXPECTED_SOURCE_HOST>`, runId: id, writes: false });
    return;
  }
  const connectionString = sourceDatabaseUrl();
  sourceReadGate(flags, id, connectionString);
  const pool = createPool(connectionString);
  try {
    const bundle = await exportLegacySource(pool, fingerprintKey());
    const artifact = await writePayload({ flags, kind: "source-export", payload: bundle, runId: id });
    log({ artifactSha256: artifact.sha256, output: artifact.path, runId: id, summary: {
      authUsers: bundle.auth.summary.total,
      rows: bundle.tables.reduce((total, table) => total + table.rowCount, 0),
      tables: bundle.tables.length,
    } });
  } finally {
    await pool.end();
  }
}

async function planStorageCommand(flags: Arguments): Promise<void> {
  const source = await readPayload<LegacyExportBundle>(required(flag(flags, "source"), "--source"));
  if (source.kind !== "source-export") throw new Error("--source is geen source-exportartifact.");
  const result = planLegacyStorage(source.payload, fingerprintKey());
  const artifact = await writePayload({ flags, kind: "storage-plan", payload: result, runId: source.runId });
  log({ artifactSha256: artifact.sha256, output: artifact.path, runId: source.runId, summary: {
    issues: result.collection.issues.length,
    objects: result.plan.sourceObjectCount,
    references: result.plan.referenceCount,
  } });
}

interface StoragePlanArtifact {
  collection?: unknown;
  plan: StorageMigrationPlan;
}

function dataProtection(): { keyring: DataProtectionKeyring; version: number } {
  const raw = required(process.env.PII_ENCRYPTION_KEYS, "PII_ENCRYPTION_KEYS");
  const version = Number(required(process.env.PII_ENCRYPTION_CURRENT_VERSION, "PII_ENCRYPTION_CURRENT_VERSION"));
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const keys = Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
    if (typeof value !== "string") throw new Error("PII-keyring bevat een ongeldige waarde.");
    return [Number(key), value];
  }));
  return { keyring: new DataProtectionKeyring({ currentVersion: version, keys }), version };
}

async function buildImportCommand(flags: Arguments): Promise<void> {
  const source = await readPayload<LegacyExportBundle>(required(flag(flags, "source"), "--source"));
  const plan = await readPayload<StoragePlanArtifact>(required(flag(flags, "plan"), "--plan"));
  const checkpoint = await readPayload<{ checkpoints: StorageCopyCheckpoint[] }>(required(flag(flags, "checkpoint"), "--checkpoint"));
  if (new Set([source.runId, plan.runId, checkpoint.runId]).size !== 1) throw new Error("Migratie-artifacts horen niet bij dezelfde run.");
  const protection = dataProtection();
  const bundle = buildTargetImportBundle({
    artifactFingerprintKey: fingerprintKey(),
    bundle: source.payload,
    dataProtection: protection.keyring,
    dataProtectionKeyVersion: protection.version,
    storageCheckpoints: checkpoint.payload.checkpoints,
    storagePlan: plan.payload.plan,
    targetStorageNamespace: required(
      process.env.MIGRATION_TARGET_STORAGE_NAMESPACE,
      "MIGRATION_TARGET_STORAGE_NAMESPACE",
    ),
  });
  const artifact = await writePayload({ flags, kind: "target-import", payload: bundle, runId: source.runId });
  log({ artifactSha256: artifact.sha256, output: artifact.path, runId: source.runId, summary: {
    quarantined: bundle.quarantined.length,
    rows: bundle.tables.reduce((total, table) => total + table.rows.length, 0),
    tables: bundle.tables.length,
  } });
}

async function applyImportCommand(flags: Arguments): Promise<void> {
  const artifact = await readPayload<TargetImportBundle>(required(flag(flags, "import"), "--import"));
  if (artifact.kind !== "target-import") throw new Error("--import is geen target-importartifact.");
  if (!enabled(flags, "execute")) {
    const pool = createPool("postgresql://localhost/buildy_dry_run");
    try {
      const result = await applyTargetImport(pool, artifact.payload, false);
      log({ ...result, importArtifactSha256: artifact.sha256, runId: artifact.runId });
    } finally {
      await pool.end();
    }
    return;
  }
  const targetUrl = required(process.env.DATABASE_DIRECT_URL, "DATABASE_DIRECT_URL");
  assertTargetWriteAuthorized(targetWriteInput(flags, artifact.runId, targetUrl));
  const pool = createPool(targetUrl);
  try {
    const result = await applyTargetImport(pool, artifact.payload, true);
    const receipt = await writePayload({ flags, kind: "import-receipt", payload: {
      ...result,
      importArtifactSha256: artifact.sha256,
    }, runId: artifact.runId });
    log({ artifactSha256: receipt.sha256, output: receipt.path, runId: artifact.runId, summary: result });
  } finally {
    await pool.end();
  }
}

async function deltaCommand(flags: Arguments): Promise<void> {
  const base = await readPayload<LegacyExportBundle>(required(flag(flags, "base"), "--base"));
  const current = await readPayload<LegacyExportBundle>(required(flag(flags, "current"), "--current"));
  const delta = computeMigrationDelta(base.payload, current.payload, enabled(flags, "final"));
  const artifact = await writePayload({ flags, kind: enabled(flags, "final") ? "final-delta" : "delta", payload: delta, runId: current.runId });
  log({ artifactSha256: artifact.sha256, output: artifact.path, runId: current.runId, summary: delta.summary });
}

async function reconcileCommand(flags: Arguments): Promise<void> {
  const input = await readPayload<ReconciliationInput>(required(flag(flags, "evidence"), "--evidence"));
  const report = reconcileMigration(input.payload);
  const artifact = await writePayload({ flags, kind: "reconciliation", payload: report, runId: input.runId });
  log({ artifactSha256: artifact.sha256, output: artifact.path, passed: report.passed, runId: input.runId, failures: report.failures });
}

async function reconcileTargetCommand(flags: Arguments): Promise<void> {
  const imported = await readPayload<TargetImportBundle>(required(flag(flags, "import"), "--import"));
  const plan = await readPayload<StoragePlanArtifact>(required(flag(flags, "plan"), "--plan"));
  const checkpoint = await readPayload<{ checkpoints: StorageCopyCheckpoint[] }>(required(flag(flags, "checkpoint"), "--checkpoint"));
  if (new Set([imported.runId, plan.runId, checkpoint.runId]).size !== 1) throw new Error("Migratie-artifacts horen niet bij dezelfde run.");
  if (!enabled(flags, "allow-network-read")) {
    log({
      command: "reconcile-target",
      dryRun: true,
      requiredConfirmation: `READ-TARGET:${imported.runId}:<MIGRATION_EXPECTED_TARGET_HOST>`,
      runId: imported.runId,
      writes: false,
    });
    return;
  }
  const targetUrl = required(process.env.DATABASE_DIRECT_URL, "DATABASE_DIRECT_URL");
  assertTargetReadAuthorized({
    allowNetworkRead: true,
    confirmation: process.env.MIGRATION_TARGET_READ_CONFIRM,
    runId: imported.runId,
    source: {
      expectedHost: required(process.env.MIGRATION_EXPECTED_TARGET_HOST, "MIGRATION_EXPECTED_TARGET_HOST"),
      url: targetUrl,
    },
  });
  const destinations = plan.payload.plan.entries.map((entry) => entry.destinationKey);
  const verified = checkpoint.payload.checkpoints.filter((entry) => entry.status === "verified");
  const checkpointByAssetId = new Map(checkpoint.payload.checkpoints.map((entry) => [entry.assetId, entry]));
  const evidenceStorage = {
    checksumMismatches: checkpoint.payload.checkpoints.filter((entry) => entry.status === "conflict").length,
    duplicateDestinations: destinations.length - new Set(destinations).size,
    expectedObjects: plan.payload.plan.entries.length,
    missingObjects: plan.payload.plan.entries.filter((entry) => {
      const state = checkpointByAssetId.get(entry.assetId)?.status;
      return state === undefined || state === "failed" || state === "planned";
    }).length,
    verifiedObjects: new Set(verified.map((entry) => entry.assetId)).size,
  };
  const pool = createPool(targetUrl);
  try {
    const evidence = await inspectTargetImport(pool, { bundle: imported.payload, storage: evidenceStorage });
    const report = reconcileMigration(evidence);
    const artifact = await writePayload({ flags, kind: "reconciliation", payload: report, runId: imported.runId });
    log({ artifactSha256: artifact.sha256, failures: report.failures, output: artifact.path, passed: report.passed, runId: imported.runId });
  } finally {
    await pool.end();
  }
}

async function evaluateCutoverCommand(flags: Arguments): Promise<void> {
  const input = await readPayload<CutoverEvidence>(required(flag(flags, "evidence"), "--evidence"));
  const report = evaluateCutoverGates(input.payload);
  const artifact = await writePayload({ flags, kind: "cutover-gates", payload: report, runId: input.runId });
  log({ artifactSha256: artifact.sha256, output: artifact.path, passed: report.passed, runId: input.runId, failedGates: report.gates.filter((gate) => !gate.passed).map((gate) => gate.code) });
}

async function rollbackPlanCommand(flags: Arguments): Promise<void> {
  const id = runId(flags);
  const artifact = await writePayload({ flags, kind: "rollback-plan", payload: createRollbackPlan(), runId: id });
  log({ artifactSha256: artifact.sha256, output: artifact.path, runId: id });
}

async function markCleanupCommand(flags: Arguments): Promise<void> {
  const report = await readPayload<CutoverGateReport>(required(flag(flags, "cutover-report"), "--cutover-report"));
  const ledger = markLegacyCleanupEligibility({
    acceptanceSha256: required(process.env.MIGRATION_ACCEPTANCE_ARTIFACT_SHA256, "MIGRATION_ACCEPTANCE_ARTIFACT_SHA256"),
    backupRetentionApproved: enabled(flags, "retention-approved"),
    cutoverReport: report.payload,
    rollbackWindowEndsAt: required(process.env.MIGRATION_ROLLBACK_WINDOW_ENDS_AT, "MIGRATION_ROLLBACK_WINDOW_ENDS_AT"),
  });
  const artifact = await writePayload({ flags, kind: "legacy-cleanup-ledger", payload: ledger, runId: report.runId });
  log({ artifactSha256: artifact.sha256, destructiveActionsAllowed: false, output: artifact.path, runId: report.runId, states: [...new Set(ledger.entries.map((entry) => entry.state))] });
}

async function verifyArtifactCommand(flags: Arguments): Promise<void> {
  const path = required(flag(flags, "artifact"), "--artifact");
  const result = await readPayload<unknown>(path);
  log({ artifact: path, envelopeSha256: result.sha256, kind: result.kind, runId: result.runId, verified: true });
}

function preflightCommand(flags: Arguments): void {
  const id = runId(flags);
  const sourceUrl = process.env.LEGACY_DATABASE_URL;
  const targetUrl = process.env.DATABASE_DIRECT_URL;
  const sourceHost = sourceUrl ? new URL(sourceUrl).hostname : "<MIGRATION_EXPECTED_SOURCE_HOST>";
  const targetHost = targetUrl ? new URL(targetUrl).hostname : "<MIGRATION_EXPECTED_TARGET_HOST>";
  if (sourceUrl && process.env.MIGRATION_EXPECTED_SOURCE_HOST) {
    assertTrustedEndpoint(sourceUrl, { allowLocal: true, allowedHostSuffixes: [process.env.MIGRATION_EXPECTED_SOURCE_HOST, "localhost"], expectedHost: process.env.MIGRATION_EXPECTED_SOURCE_HOST, label: "Legacy bron" });
  }
  if (targetUrl && process.env.MIGRATION_EXPECTED_TARGET_HOST) {
    assertTrustedEndpoint(targetUrl, { allowLocal: true, allowedHostSuffixes: ["neon.tech", "localhost"], expectedHost: process.env.MIGRATION_EXPECTED_TARGET_HOST, label: "Doeldatabase" });
  }
  if (sourceUrl && targetUrl && new URL(sourceUrl).hostname === new URL(targetUrl).hostname && new URL(sourceUrl).pathname === new URL(targetUrl).pathname) {
    throw new Error("Bron- en doeldatabase mogen niet dezelfde database zijn.");
  }
  log({
    command: "preflight",
    dryRun: true,
    environment: environment(),
    requiredConfirmations: {
      production: `PRODUCTION-CUTOVER:${id}:${targetHost}`,
      sourceRead: `READ:${id}:${sourceHost}`,
      targetWrite: `APPLY:${id}:${environment()}:${targetHost}`,
    },
    runId: id,
    configurationPresent: {
      artifactKey: Boolean(process.env.MIGRATION_ARTIFACT_KEY),
      sourceDatabase: Boolean(sourceUrl),
      targetDatabase: Boolean(targetUrl),
      targetStorageNamespace: Boolean(process.env.MIGRATION_TARGET_STORAGE_NAMESPACE),
    },
    writes: false,
  });
}

function help(): void {
  process.stdout.write(`Buildy migratie- en cutovertool\n\n`);
  process.stdout.write(`Alle databasewrites zijn standaard dry-run. Commando's:\n`);
  process.stdout.write(`  preflight | inventory | export | plan-storage\n`);
  process.stdout.write(`  build-import | apply-import | delta\n`);
  process.stdout.write(`  reconcile | reconcile-target | rollback-plan\n`);
  process.stdout.write(`  evaluate-cutover | mark-cleanup | verify-artifact\n`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { command, flags } = parseArguments(argv);
  switch (command) {
    case "preflight": preflightCommand(flags); break;
    case "inventory": await inventoryCommand(flags); break;
    case "export": await exportCommand(flags); break;
    case "plan-storage": await planStorageCommand(flags); break;
    case "build-import": await buildImportCommand(flags); break;
    case "apply-import": await applyImportCommand(flags); break;
    case "delta": await deltaCommand(flags); break;
    case "reconcile": await reconcileCommand(flags); break;
    case "reconcile-target": await reconcileTargetCommand(flags); break;
    case "rollback-plan": await rollbackPlanCommand(flags); break;
    case "evaluate-cutover": await evaluateCutoverCommand(flags); break;
    case "mark-cleanup": await markCleanupCommand(flags); break;
    case "verify-artifact": await verifyArtifactCommand(flags); break;
    case "help": help(); break;
    default: throw new Error(`Onbekend migratiecommando: ${command}.`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    const code = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "MIGRATION_COMMAND_FAILED";
    process.stderr.write(`${JSON.stringify({ code, message: "Migratiecommando is veilig gestopt; controleer configuratie en artifacts." })}\n`);
    process.exitCode = 1;
  });
}

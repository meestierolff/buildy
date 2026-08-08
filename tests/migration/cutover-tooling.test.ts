import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { DataProtectionKeyring } from "../../server/security/dataProtection";
import { buildAuthMigrationPlan, evaluateOldSessionInvalidation } from "../../scripts/migration/auth";
import {
  applyTargetImport,
  reconcileMigration,
  type LegacyExportBundle,
  type LegacyTableExport,
  type TargetImportBundle,
} from "../../scripts/migration/database";
import {
  artifactEnvelopeSha256,
  assertNetworkReadAuthorized,
  assertStorageWriteAuthorized,
  assertTargetWriteAuthorized,
  canonicalJson,
  preserveOrMapUuid,
  redactForLog,
  sealArtifact,
  sha256Hex,
  stableUuid,
  unsealArtifact,
  writeSealedArtifact,
} from "../../scripts/migration/core";
import {
  computeMigrationDelta,
  createRollbackPlan,
  evaluateCutoverGates,
  markLegacyCleanupEligibility,
  type CutoverEvidence,
} from "../../scripts/migration/cutover";
import { buildTargetImportBundle, planLegacyStorage } from "../../scripts/migration/mapping";
import {
  buildStorageMigrationPlan,
  copyStoragePlan,
  parseLegacyObjectLocator,
  type MigrationObjectMetadata,
  type MigrationObjectStore,
  type StorageCopyCheckpoint,
} from "../../scripts/migration/storage";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const UPDATE_ID = "55555555-5555-4555-8555-555555555555";
const MEDIA_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_USER_ID = "77777777-7777-4777-8777-777777777777";
const ARTIFACT_KEY = Buffer.alloc(32, 7).toString("base64");
const FINGERPRINT_KEY = Buffer.alloc(32, 9);
const NOW = "2026-08-04T10:00:00.000Z";

function legacyTable(table: LegacyTableExport["table"], rows: Record<string, unknown>[]): LegacyTableExport {
  return {
    table,
    rows,
    rowCount: rows.length,
    rowsSha256: sha256Hex(canonicalJson(rows)),
    primaryKeyFingerprints: rows.map((row, index) => sha256Hex(`${table}:${String(row.id ?? row.trip_id ?? row.step_id ?? index)}`)),
  };
}

function legacyBundle(overrides: Partial<Record<LegacyTableExport["table"], Record<string, unknown>[]>> = {}): LegacyExportBundle {
  const auth = buildAuthMigrationPlan([{
    id: USER_ID,
    email: "synthetic@example.test",
    emailVerified: true,
    hasPassword: true,
    providers: ["email", "google"],
    disabled: false,
    createdAt: NOW,
  }], FINGERPRINT_KEY);
  const rows: Partial<Record<LegacyTableExport["table"], Record<string, unknown>[]>> = {
    profiles: [{
      id: PROFILE_ID,
      user_id: USER_ID,
      display_name: "Synthetische Tester",
      avatar_url: null,
      bio: "Testprofiel",
      location: "Teststad",
      is_private: true,
      is_pro: false,
      onboarded: true,
      created_at: NOW,
      updated_at: NOW,
    }],
    trips: [{
      id: PROJECT_ID,
      user_id: USER_ID,
      title: "Testverbouwing",
      description: "Alleen synthetische data",
      is_public: false,
      progress_percentage: 25,
      custom_phases: ["Testfase"],
      cover_storage_path: null,
      cover_image_url: null,
      floorplan_storage_path: null,
      floorplan_url: null,
      floorplans: [],
      created_at: NOW,
      updated_at: NOW,
    }],
    trip_private_info: [{ trip_id: PROJECT_ID, address: "Teststraat 1", updated_at: NOW }],
    steps: [{
      id: UPDATE_ID,
      trip_id: PROJECT_ID,
      user_id: USER_ID,
      location_name: "Keuken",
      room: "Keuken",
      description: "Synthetische update",
      phase: "Testfase",
      step_date: "2026-08-03",
      step_order: 1,
      is_milestone: false,
      created_at: NOW,
      updated_at: NOW,
    }],
    step_media: [{
      id: MEDIA_ID,
      step_id: UPDATE_ID,
      user_id: USER_ID,
      storage_path: `${USER_ID}/steps/${UPDATE_ID}/synthetic.jpg`,
      media_url: "https://legacy.example/storage/v1/object/sign/trip-private/redacted?token=never-store",
      media_type: "image",
      compare_role: "before",
      sort_order: 0,
      created_at: NOW,
    }],
    photobook_orders: [],
    ...overrides,
  };
  return {
    schemaVersion: 1,
    auth,
    capturedAt: NOW,
    inventory: {
      schemaVersion: 1,
      capturedAt: NOW,
      readOnlyTransactionVerified: true,
      snapshotId: "1:1:",
      auth: { disabledUsers: 0, emailVerifiedUsers: 1, providerCounts: { email: 1 }, totalUsers: 1 },
      orphanCounts: {},
      storageBuckets: [],
      tables: [],
      sourceFunctions: 0,
      sourcePolicies: 0,
    },
    tables: Object.entries(rows).map(([table, tableRows]) => legacyTable(
      table as LegacyTableExport["table"],
      tableRows ?? [],
    )),
  };
}

class MemoryStore implements MigrationObjectStore {
  readonly reads = vi.fn();
  readonly writes = vi.fn();
  readonly objects = new Map<string, { bytes: Uint8Array; metadata: MigrationObjectMetadata }>();

  async head(key: string): Promise<MigrationObjectMetadata | null> {
    return this.objects.get(key)?.metadata ?? null;
  }

  async read(key: string, maximumBytes: number): Promise<Uint8Array> {
    this.reads(key);
    const object = this.objects.get(key);
    if (!object || object.bytes.byteLength > maximumBytes) throw new Error("OBJECT_MISSING");
    return object.bytes;
  }

  async writeIfAbsent(input: { bytes: Uint8Array; checksumSha256: string; contentType: string; key: string }): Promise<"created" | "exists"> {
    this.writes(input.key);
    if (this.objects.has(input.key)) return "exists";
    this.objects.set(input.key, {
      bytes: input.bytes,
      metadata: { checksumSha256: input.checksumSha256, contentType: input.contentType, sizeBytes: input.bytes.byteLength },
    });
    return "created";
  }
}

describe("migration artifact and endpoint safety", () => {
  it("creates canonical hashes and RFC 4122 UUIDv5 values", () => {
    expect(canonicalJson({ z: 1, a: "e\u0301" })).toBe('{"a":"é","z":1}');
    expect(stableUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "python.org"))
      .toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    expect(preserveOrMapUuid(USER_ID.toUpperCase(), RUN_ID)).toBe(USER_ID);
  });

  it("encrypts artifacts, detects tampering and writes mode 0600", async () => {
    const payload = { email: "synthetic@example.test", sourceKey: "owner/private.jpg" };
    const sealed = sealArtifact({ artifactKeyBase64: ARTIFACT_KEY, createdAt: new Date(NOW), kind: "test-export", payload, runId: RUN_ID });
    expect(JSON.stringify(sealed)).not.toContain("synthetic@example.test");
    expect(JSON.stringify(sealed)).not.toContain("private.jpg");
    expect(unsealArtifact(sealed, ARTIFACT_KEY)).toEqual(payload);
    expect(artifactEnvelopeSha256(sealed)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => unsealArtifact({ ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -1)}A` }, ARTIFACT_KEY)).toThrow();

    const directory = await mkdtemp(join(tmpdir(), "buildy-migration-test-"));
    await mkdir(join(directory, "nested"));
    const path = join(directory, "nested", "artifact.json");
    await writeSealedArtifact(path, sealed);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).not.toContain("synthetic@example.test");
  });

  it("fails closed for missing gates, untrusted hosts and production writes", () => {
    expect(() => assertNetworkReadAuthorized({
      allowNetworkRead: false,
      runId: RUN_ID,
      source: { expectedHost: "source.buildy.invalid", url: "postgresql://secret@source.buildy.invalid/postgres" },
    })).toThrow(/standaard uitgeschakeld/);
    expect(() => assertNetworkReadAuthorized({
      allowNetworkRead: true,
      confirmation: `READ:${RUN_ID}:evil.example`,
      runId: RUN_ID,
      source: { expectedHost: "source.buildy.invalid", url: "postgresql://secret@evil.example/postgres" },
    })).toThrow(/verwachte host/);
    expect(() => assertTargetWriteAuthorized({
      environment: "production",
      execute: true,
      expectedHost: "ep-test.neon.tech",
      runId: RUN_ID,
      targetUrl: "postgresql://secret@ep-test.neon.tech/buildy",
      writeConfirmation: `APPLY:${RUN_ID}:production:ep-test.neon.tech`,
      productionConfirmation: `PRODUCTION-CUTOVER:${RUN_ID}:ep-test.neon.tech`,
    })).toThrow(/backup/);
    expect(() => assertStorageWriteAuthorized({
      environment: "staging",
      execute: true,
      expectedHost: "account.r2.cloudflarestorage.com",
      runId: RUN_ID,
      targetUrl: "https://account.r2.cloudflarestorage.com",
      writeConfirmation: `APPLY:${RUN_ID}:staging:account.r2.cloudflarestorage.com`,
    })).not.toThrow();
  });

  it("redacts secrets, URLs, e-mail and object keys before logging", () => {
    expect(redactForLog({ email: "a@example.test", nested: { objectKey: "private/a.jpg", ok: 3 }, url: "https://signed.example/x" }))
      .toEqual({ email: "[REDACTED]", nested: { objectKey: "[REDACTED]", ok: 3 }, url: "[REDACTED]" });
  });
});

describe("auth bridge", () => {
  it("preserves ownership IDs without exporting password hashes or sessions", () => {
    const plan = buildAuthMigrationPlan([{
      id: USER_ID,
      email: "Synthetic@Example.test",
      emailVerified: true,
      hasPassword: true,
      providers: ["google", "email"],
      disabled: false,
      createdAt: NOW,
    }], FINGERPRINT_KEY);
    expect(plan.records[0]).toMatchObject({
      appUserId: USER_ID,
      email: "synthetic@example.test",
      status: "pending",
      strategies: ["oauth_relink_required", "password_set_required"],
      targetAuthUserId: null,
    });
    expect(plan.passwordHashesExported).toBe(false);
    expect(plan.sessionImportAllowed).toBe(false);
    expect(plan.records[0]).not.toHaveProperty("password");
    expect(plan.records[0]).not.toHaveProperty("encryptedPassword");
    expect(plan.records[0]).not.toHaveProperty("session");
  });

  it("routes duplicate e-mails and disabled users to manual review", () => {
    const base = { email: "same@example.test", emailVerified: true, hasPassword: false, providers: ["email"], createdAt: NOW };
    const plan = buildAuthMigrationPlan([
      { ...base, id: USER_ID, disabled: false },
      { ...base, id: OTHER_USER_ID, disabled: true },
    ], FINGERPRINT_KEY);
    expect(plan.summary.manualReview).toBe(1);
    expect(plan.records[1].status).toBe("manual_review");
  });

  it("requires every old-session invalidation proof", () => {
    const partial = evaluateOldSessionInvalidation({ betterAuthCookieNamespaceVerified: true });
    expect(partial.complete).toBe(false);
    expect(partial.missing).toContain("legacy_refresh_tokens_revoked");
    expect(evaluateOldSessionInvalidation({
      betterAuthCookieNamespaceVerified: true,
      legacyAnonKeyRotatedAt: NOW,
      legacyRefreshTokensRevokedAt: NOW,
      legacyTokenRejectedAt: NOW,
      sourceJwtSecretRotatedAt: NOW,
    }).complete).toBe(true);
  });
});

describe("private storage migration", () => {
  it("uses a dedicated cutover credential and never a runtime or generic R2 key", async () => {
    const cliSource = await readFile(
      join(process.cwd(), "scripts/migration/buildy-migrate.ts"),
      "utf8",
    );
    expect(cliSource).toContain("process.env.R2_MIGRATION_ACCESS_KEY_ID");
    expect(cliSource).toContain("process.env.R2_MIGRATION_SECRET_ACCESS_KEY");
    expect(cliSource).not.toMatch(/process\.env\.R2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/);
    expect(cliSource).not.toMatch(/process\.env\.R2_(?:WEB|ACCOUNT_WORKER|MEDIA_WORKER|PHOTOBOOK_WORKER|FULFILMENT_WORKER)_/);
  });

  it("parses legacy public/signed URLs without retaining bearer query tokens", () => {
    expect(parseLegacyObjectLocator("https://source.buildy.invalid/storage/v1/object/sign/trip-private/user/photo.jpg?token=secret"))
      .toEqual({ bucket: "trip-private", key: "user/photo.jpg" });
    expect(() => parseLegacyObjectLocator("../escape.jpg", "trip-private")).toThrow(/padtraversal/);
    expect(() => parseLegacyObjectLocator("http://source.buildy.invalid/storage/v1/object/public/trip-media/x.jpg")).toThrow(/HTTPS/);
  });

  it("creates deterministic opaque keys that contain no owner or source path", () => {
    const plan = buildStorageMigrationPlan([{
      bucket: "trip-private",
      key: `${USER_ID}/steps/${UPDATE_ID}/kitchen.jpg`,
      field: "storage_path",
      ownerId: USER_ID,
      projectId: PROJECT_ID,
      purpose: "originals",
      recordId: MEDIA_ID,
      table: "step_media",
    }], FINGERPRINT_KEY);
    expect(plan.entries[0].destinationKey).toMatch(/^originals\/[0-9a-f]{2}\/[0-9a-f-]{36}\/source$/);
    expect(plan.entries[0].destinationKey).not.toContain(USER_ID);
    expect(plan.entries[0].destinationKey).not.toContain("kitchen");
    expect(buildStorageMigrationPlan([{
      bucket: "trip-private", key: `${USER_ID}/steps/${UPDATE_ID}/kitchen.jpg`, field: "storage_path",
      ownerId: USER_ID, projectId: PROJECT_ID, purpose: "originals", recordId: MEDIA_ID, table: "step_media",
    }], FINGERPRINT_KEY).entries[0].destinationKey).toBe(plan.entries[0].destinationKey);
  });

  it("is dry-run by default and copies with checksum readback when explicitly executed", async () => {
    const bytes = new TextEncoder().encode("synthetic image bytes");
    const checksum = sha256Hex(bytes);
    const source = new MemoryStore();
    source.objects.set("owner/photo.jpg", { bytes, metadata: { checksumSha256: checksum, contentType: "image/jpeg", sizeBytes: bytes.byteLength } });
    const target = new MemoryStore();
    const plan = buildStorageMigrationPlan([{
      bucket: "trip-private", key: "owner/photo.jpg", field: "storage_path", ownerId: USER_ID,
      projectId: PROJECT_ID, purpose: "originals", recordId: MEDIA_ID, table: "step_media",
    }], FINGERPRINT_KEY);

    const dry = await copyStoragePlan({ execute: false, plan, sourceByBucket: new Map(), target });
    expect(dry.summary.planned).toBe(1);
    expect(source.reads).not.toHaveBeenCalled();
    expect(target.writes).not.toHaveBeenCalled();

    const copied = await copyStoragePlan({ execute: true, plan, sourceByBucket: new Map([["trip-private", source]]), target, now: () => new Date(NOW) });
    expect(copied.summary.verified).toBe(1);
    expect(copied.checkpoints[0]).toMatchObject({ checksumSha256: checksum, contentType: "image/jpeg", status: "verified" });
    expect(target.writes).toHaveBeenCalledTimes(1);

    const resumed = await copyStoragePlan({ execute: true, plan, previous: copied.checkpoints, sourceByBucket: new Map([["trip-private", source]]), target });
    expect(resumed.summary.skippedVerified).toBe(1);
    expect(target.writes).toHaveBeenCalledTimes(1);
  });

  it("never overwrites a destination checksum conflict", async () => {
    const sourceBytes = new TextEncoder().encode("source");
    const targetBytes = new TextEncoder().encode("different");
    const source = new MemoryStore();
    const target = new MemoryStore();
    source.objects.set("owner/photo.jpg", { bytes: sourceBytes, metadata: { checksumSha256: sha256Hex(sourceBytes), contentType: "image/jpeg", sizeBytes: sourceBytes.byteLength } });
    const plan = buildStorageMigrationPlan([{
      bucket: "trip-private", key: "owner/photo.jpg", field: "storage_path", ownerId: USER_ID,
      projectId: PROJECT_ID, purpose: "originals", recordId: MEDIA_ID, table: "step_media",
    }], FINGERPRINT_KEY);
    target.objects.set(plan.entries[0].destinationKey, { bytes: targetBytes, metadata: { checksumSha256: sha256Hex(targetBytes), contentType: "image/jpeg", sizeBytes: targetBytes.byteLength } });
    const result = await copyStoragePlan({ execute: true, plan, sourceByBucket: new Map([["trip-private", source]]), target });
    expect(result.summary.conflicts).toBe(1);
    expect(target.writes).not.toHaveBeenCalled();
  });
});

describe("schema mapping and target import boundary", () => {
  it("keeps UUID ownership, encrypts the address and requires verified storage", () => {
    const source = legacyBundle();
    const { plan } = planLegacyStorage(source, FINGERPRINT_KEY);
    const checkpoints: StorageCopyCheckpoint[] = plan.entries.map((entry) => ({
      assetId: entry.assetId,
      attempt: 1,
      checksumSha256: "a".repeat(64),
      completedAt: NOW,
      contentType: "image/jpeg",
      destinationKey: entry.destinationKey,
      locatorFingerprint: entry.locatorFingerprint,
      sizeBytes: 123,
      status: "verified",
    }));
    const keyring = new DataProtectionKeyring({ currentVersion: 1, keys: { 1: Buffer.alloc(32, 2).toString("base64") } });
    const target = buildTargetImportBundle({
      artifactFingerprintKey: FINGERPRINT_KEY,
      bundle: source,
      dataProtection: keyring,
      dataProtectionKeyVersion: 1,
      storageCheckpoints: checkpoints,
      storagePlan: plan,
      targetBucket: "buildy-private",
    });
    const appUser = target.tables.find((table) => table.table === "app_users")?.rows[0];
    const project = target.tables.find((table) => table.table === "projects")?.rows[0];
    const privateDetails = target.tables.find((table) => table.table === "project_private_details")?.rows[0];
    const media = target.tables.find((table) => table.table === "media_assets")?.rows[0];
    expect(appUser?.id).toBe(USER_ID);
    expect(project).toMatchObject({ id: PROJECT_ID, owner_id: USER_ID, legacy_trip_id: PROJECT_ID, visibility: "private" });
    expect(privateDetails?.address_line_1_ciphertext).not.toBe("Teststraat 1");
    expect(keyring.decrypt(String(privateDetails?.address_line_1_ciphertext), `project:${PROJECT_ID}:private:address_line_1`)).toBe("Teststraat 1");
    expect(media).toMatchObject({ storage_provider: "r2", bucket: "buildy-private", status: "uploaded", exif_stripped: false });
    expect(String(media?.object_key)).not.toContain(USER_ID);
    expect(JSON.stringify(target.quarantined)).not.toContain("Teststraat");
  });

  it("quarantines legacy orders instead of inventing proof or legal snapshots", () => {
    const source = legacyBundle({ photobook_orders: [{ id: "88888888-8888-4888-8888-888888888888", user_id: USER_ID, trip_id: PROJECT_ID, status: "paid", customer_email: "order@example.test" }] });
    const { plan } = planLegacyStorage(source, FINGERPRINT_KEY);
    const keyring = new DataProtectionKeyring({ currentVersion: 1, keys: { 1: Buffer.alloc(32, 2).toString("base64") } });
    const target = buildTargetImportBundle({
      artifactFingerprintKey: FINGERPRINT_KEY, bundle: source, dataProtection: keyring,
      dataProtectionKeyVersion: 1, storageCheckpoints: [], storagePlan: plan, targetBucket: "buildy-private",
    });
    expect(target.tables.some((table) => table.table === "photobook_orders")).toBe(false);
    expect(target.quarantined).toContainEqual(expect.objectContaining({ reasonCode: "legacy_order_manual_review", sourceTable: "photobook_orders" }));
    expect(JSON.stringify(target.quarantined)).not.toContain("order@example.test");
  });

  it("validates the complete target allowlist even in dry-run", async () => {
    const malicious = {
      schemaVersion: 1,
      generatedAt: NOW,
      sourceExportSha256: "a".repeat(64),
      quarantined: [],
      tables: [{ table: "auth_users; drop table projects", conflictColumns: ["id"], updateColumns: [], rows: [{ id: USER_ID }] }],
    } satisfies TargetImportBundle;
    await expect(applyTargetImport({} as Pool, malicious, false)).rejects.toThrow(/allowlist/);
  });
});

function passingReconciliation() {
  return reconcileMigration({
    expected: [{ table: "projects", rowCount: 1, keySetSha256: "a".repeat(64), rowsSha256: "b".repeat(64) }],
    actual: [{ table: "projects", rowCount: 1, keySetSha256: "a".repeat(64), rowsSha256: "b".repeat(64) }],
    auth: { expectedMappings: 1, mapped: 1, duplicateMappings: 0, missingOwners: 0 },
    integrity: { foreignKeyViolations: 0, notificationViolations: 0, orderCountMismatch: 0, orderTotalMismatchMinor: 0, uniqueViolations: 0 },
    storage: { checksumMismatches: 0, duplicateDestinations: 0, expectedObjects: 1, missingObjects: 0, verifiedObjects: 1 },
  }, new Date(NOW));
}

function fullCutoverEvidence(): CutoverEvidence {
  const sessionInvalidation = evaluateOldSessionInvalidation({
    betterAuthCookieNamespaceVerified: true,
    legacyAnonKeyRotatedAt: NOW,
    legacyRefreshTokensRevokedAt: NOW,
    legacyTokenRejectedAt: NOW,
    sourceJwtSecretRotatedAt: NOW,
  });
  return {
    acceptance: { acceptedAt: NOW, acceptedByFingerprint: "owner-hash", artifactSha256: "a".repeat(64), ticket: "CUTOVER-1" },
    auth: { migrationEmailsRehearsed: true, oauthRelinkRehearsed: true, passwordSetRehearsed: true, sessionInvalidation },
    backup: { artifactSha256: "b".repeat(64), readbackVerifiedAt: NOW, restoreRehearsalPassed: true },
    finalDelta: { schemaVersion: 1, baseCapturedAt: "2026-08-04T08:00:00.000Z", capturedAt: NOW, finalDelta: true, tables: [], summary: { changedOrAdded: 0, deletionCandidates: 0, unchanged: 10 } },
    providerRoutes: { brevoReady: true, peechoCallbackReady: true, stripeWebhookReady: true },
    reconciliation: passingReconciliation(),
    rollback: { ownerFingerprint: "owner-hash", windowEndsAt: "2026-08-06T10:00:00.000Z", planArtifactSha256: "c".repeat(64) },
    smoke: { privateMediaDeniedAnonymously: true, privateProjectDeniedAnonymously: true, syntheticCoreFlowsPassed: true },
    sourceFreeze: { finalSnapshotStartedAt: "2026-08-04T09:30:00.000Z", frozenAt: "2026-08-04T09:00:00.000Z", writesDisabledVerified: true },
    targetEnvironment: "production",
  };
}

describe("delta, reconciliation, cutover and cleanup", () => {
  it("detects changes and full-key deletion candidates", () => {
    const base = legacyBundle();
    const current = legacyBundle({
      profiles: [{ ...base.tables.find((table) => table.table === "profiles")?.rows[0], display_name: "Gewijzigd" }],
      step_media: [],
    });
    const delta = computeMigrationDelta(base, { ...current, capturedAt: "2026-08-04T11:00:00.000Z" }, true);
    expect(delta.summary.changedOrAdded).toBe(1);
    expect(delta.summary.deletionCandidates).toBe(1);
    expect(delta.tables.find((table) => table.table === "step_media")?.deletedKeyFingerprints).toHaveLength(1);
  });

  it("fails reconciliation on any privacy, ownership, order or storage mismatch", () => {
    const report = reconcileMigration({
      expected: [{ table: "projects", rowCount: 1, keySetSha256: "a".repeat(64) }],
      actual: [{ table: "projects", rowCount: 0, keySetSha256: "b".repeat(64) }],
      auth: { expectedMappings: 1, mapped: 0, duplicateMappings: 1, missingOwners: 1 },
      integrity: { foreignKeyViolations: 1, notificationViolations: 1, orderCountMismatch: 1, orderTotalMismatchMinor: 1, uniqueViolations: 1 },
      storage: { checksumMismatches: 1, duplicateDestinations: 1, expectedObjects: 2, missingObjects: 1, verifiedObjects: 0 },
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining(["owner_mapping_missing", "storage_checksum", "order_total_mismatch"]));
  });

  it("requires every production gate and creates a non-destructive rollback plan", () => {
    const evidence = fullCutoverEvidence();
    const passing = evaluateCutoverGates(evidence, new Date(NOW));
    expect(passing.passed).toBe(true);
    const failing = evaluateCutoverGates({ ...evidence, smoke: { ...evidence.smoke, privateMediaDeniedAnonymously: false } }, new Date(NOW));
    expect(failing.passed).toBe(false);
    expect(failing.gates).toContainEqual({ code: "private_media", passed: false });
    expect(createRollbackPlan(new Date(NOW))).toMatchObject({ irreversibleActionsAllowed: false });
  });

  it("only marks offline cleanup eligibility after accepted cutover and never authorizes deletion", () => {
    const report = evaluateCutoverGates(fullCutoverEvidence(), new Date(NOW));
    const retained = markLegacyCleanupEligibility({
      acceptanceSha256: "d".repeat(64), backupRetentionApproved: false, cutoverReport: report,
      now: new Date(NOW), rollbackWindowEndsAt: "2026-08-06T10:00:00.000Z",
    });
    expect(retained.destructiveActionsAllowed).toBe(false);
    expect(retained.entries.every((entry) => entry.state === "retained_for_rollback")).toBe(true);
    const eligible = markLegacyCleanupEligibility({
      acceptanceSha256: "d".repeat(64), backupRetentionApproved: true, cutoverReport: report,
      now: new Date("2026-08-07T10:00:00.000Z"), rollbackWindowEndsAt: "2026-08-06T10:00:00.000Z",
    });
    expect(eligible.entries.every((entry) => entry.state === "eligible_for_manual_decommission")).toBe(true);
    expect(() => markLegacyCleanupEligibility({
      acceptanceSha256: "d".repeat(64), backupRetentionApproved: true,
      cutoverReport: { ...report, passed: false }, now: new Date(NOW), rollbackWindowEndsAt: "2026-08-06T10:00:00.000Z",
    })).toThrow(/productieacceptatie/);
  });
});

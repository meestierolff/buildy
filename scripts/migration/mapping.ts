import { DataProtectionKeyring } from "../../server/security/dataProtection";
import { STANDARD_PROJECT_PHASES } from "../../server/projects/types";
import { BUILDY_MIGRATION_NAMESPACE } from "./auth";
import {
  type LegacyExportBundle,
  type LegacyTableName,
  type TargetImportBundle,
  type TargetTableRows,
} from "./database";
import { canonicalJson, keyedFingerprint, sha256Hex, stableUuid } from "./core";
import {
  buildStorageMigrationPlan,
  parseLegacyObjectLocator,
  type LegacyMediaReference,
  type StorageCopyCheckpoint,
  type StorageMigrationPlan,
  type StorageMigrationPlanEntry,
} from "./storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "🔥", "👏", "🔨"]);

interface MigrationIssue {
  reasonCode: string;
  recordFingerprint: string;
  sourceTable: LegacyTableName;
}

export interface LegacyMediaCollection {
  issues: MigrationIssue[];
  references: LegacyMediaReference[];
}

function rowsFor(bundle: LegacyExportBundle, table: LegacyTableName): Record<string, unknown>[] {
  return bundle.tables.find((entry) => entry.table === table)?.rows ?? [];
}

function stringValue(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function uuidValue(row: Record<string, unknown>, field: string): string | null {
  const value = stringValue(row, field);
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

function timestampValue(row: Record<string, unknown>, field: string, fallback: string): string {
  const value = stringValue(row, field);
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function dateValue(row: Record<string, unknown>, field: string): string | null {
  const value = stringValue(row, field);
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return value.slice(0, 10);
}

function numberValue(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) return Number(value);
  return null;
}

function booleanValue(row: Record<string, unknown>, field: string, fallback = false): boolean {
  return typeof row[field] === "boolean" ? row[field] as boolean : fallback;
}

function sourceFingerprint(key: Uint8Array, table: LegacyTableName, row: Record<string, unknown>): string {
  const identifier = stringValue(row, "id")
    ?? stringValue(row, "trip_id")
    ?? stringValue(row, "step_id")
    ?? sha256Hex(canonicalJson(row));
  return keyedFingerprint(key, `quarantine.${table}`, identifier);
}

function locatorFromFields(
  row: Record<string, unknown>,
  pathField: string,
  urlField: string,
  fallbackBucket: string,
): { bucket: string; key: string; field: string } | null {
  const path = stringValue(row, pathField);
  if (path) {
    const withoutBucket = path.startsWith(`${fallbackBucket}/`) ? path.slice(fallbackBucket.length + 1) : path;
    const parsed = parseLegacyObjectLocator(withoutBucket, fallbackBucket);
    return { ...parsed, field: pathField };
  }
  const url = stringValue(row, urlField);
  if (!url) return null;
  return { ...parseLegacyObjectLocator(url), field: urlField };
}

function addMediaReference(
  target: LegacyMediaReference[],
  issues: MigrationIssue[],
  fingerprintKey: Uint8Array,
  input: {
    field: string;
    locator: { bucket: string; key: string } | null;
    ownerId: string | null;
    projectId: string | null;
    purpose: LegacyMediaReference["purpose"];
    recordId: string | null;
    sourceRow: Record<string, unknown>;
    table: LegacyTableName;
  },
): void {
  if (!input.locator) return;
  if (!input.ownerId || !input.recordId || (input.purpose !== "avatars" && !input.projectId)) {
    issues.push({
      reasonCode: "media_owner_or_project_missing",
      recordFingerprint: sourceFingerprint(fingerprintKey, input.table, input.sourceRow),
      sourceTable: input.table,
    });
    return;
  }
  target.push({
    ...input.locator,
    field: input.field,
    ownerId: input.ownerId,
    projectId: input.projectId,
    purpose: input.purpose,
    recordId: input.recordId,
    table: input.table,
  });
}

export function collectLegacyMediaReferences(
  bundle: LegacyExportBundle,
  fingerprintKey: Uint8Array,
): LegacyMediaCollection {
  const references: LegacyMediaReference[] = [];
  const issues: MigrationIssue[] = [];
  const tripOwner = new Map(rowsFor(bundle, "trips").flatMap((row) => {
    const id = uuidValue(row, "id");
    const owner = uuidValue(row, "user_id");
    return id && owner ? [[id, owner] as const] : [];
  }));
  const stepTrip = new Map(rowsFor(bundle, "steps").flatMap((row) => {
    const id = uuidValue(row, "id");
    const tripId = uuidValue(row, "trip_id");
    return id && tripId ? [[id, tripId] as const] : [];
  }));

  for (const row of rowsFor(bundle, "profiles")) {
    const locator = locatorFromFields(row, "avatar_storage_path", "avatar_url", "avatars");
    addMediaReference(references, issues, fingerprintKey, {
      field: locator?.field ?? "avatar_url",
      locator,
      ownerId: uuidValue(row, "user_id"),
      projectId: null,
      purpose: "avatars",
      recordId: uuidValue(row, "id"),
      sourceRow: row,
      table: "profiles",
    });
  }

  for (const row of rowsFor(bundle, "trips")) {
    const tripId = uuidValue(row, "id");
    const ownerId = uuidValue(row, "user_id");
    const cover = locatorFromFields(row, "cover_storage_path", "cover_image_url", "trip-private");
    addMediaReference(references, issues, fingerprintKey, {
      field: cover?.field ?? "cover_image_url", locator: cover, ownerId, projectId: tripId,
      purpose: "originals", recordId: tripId, sourceRow: row, table: "trips",
    });
    const legacyFloor = locatorFromFields(row, "floorplan_storage_path", "floorplan_url", "trip-private");
    addMediaReference(references, issues, fingerprintKey, {
      field: legacyFloor?.field ?? "floorplan_url", locator: legacyFloor, ownerId, projectId: tripId,
      purpose: "floorplans", recordId: tripId, sourceRow: row, table: "trips",
    });
    if (Array.isArray(row.floorplans)) {
      row.floorplans.forEach((candidate, index) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
        const floor = candidate as Record<string, unknown>;
        const floorId = uuidValue(floor, "id") ?? stableUuid(BUILDY_MIGRATION_NAMESPACE, `floor:${tripId}:${index}`);
        const locator = locatorFromFields(floor, "storage_path", "url", "trip-private");
        addMediaReference(references, issues, fingerprintKey, {
          field: `floorplans[${index}].${locator?.field ?? "url"}`, locator, ownerId, projectId: tripId,
          purpose: "floorplans", recordId: floorId, sourceRow: row, table: "trips",
        });
      });
    }
  }

  for (const row of rowsFor(bundle, "step_media")) {
    const stepId = uuidValue(row, "step_id");
    const projectId = stepId ? stepTrip.get(stepId) ?? null : null;
    const locator = locatorFromFields(row, "storage_path", "media_url", "trip-private");
    addMediaReference(references, issues, fingerprintKey, {
      field: locator?.field ?? "media_url",
      locator,
      ownerId: uuidValue(row, "user_id") ?? (projectId ? tripOwner.get(projectId) ?? null : null),
      projectId,
      purpose: "originals",
      recordId: uuidValue(row, "id"),
      sourceRow: row,
      table: "step_media",
    });
  }

  for (const row of rowsFor(bundle, "photobook_orders")) {
    const projectId = uuidValue(row, "trip_id");
    const locator = locatorFromFields(row, "pdf_storage_path", "pdf_url", "photobook-pdfs");
    addMediaReference(references, issues, fingerprintKey, {
      field: locator?.field ?? "pdf_url",
      locator,
      ownerId: uuidValue(row, "user_id") ?? (projectId ? tripOwner.get(projectId) ?? null : null),
      projectId,
      purpose: "photobook-pdfs",
      recordId: uuidValue(row, "id"),
      sourceRow: row,
      table: "photobook_orders",
    });
  }
  return { references, issues };
}

function batch(
  table: string,
  conflictColumns: string[],
  rows: Record<string, unknown>[],
  updateColumns: string[],
): TargetTableRows {
  return { table, conflictColumns, rows, updateColumns };
}

function minorUnits(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "number" ? value.toString() : String(value);
  const match = raw.match(/^([0-9]+)(?:\.([0-9]+))?$/);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = `${match[2] ?? ""}000`;
  let cents = whole * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) cents += 1n;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function relationshipStatus(value: unknown): "pending" | "active" | "rejected" | "revoked" {
  if (value === "accepted" || value === "active") return "active";
  if (value === "rejected") return "rejected";
  if (value === "revoked" || value === "cancelled") return "revoked";
  return "pending";
}

function entryLocatorKey(entry: Pick<StorageMigrationPlanEntry, "bucket" | "key" | "purpose">): string {
  return `${entry.purpose}\0${entry.bucket}\0${entry.key}`;
}

function referenceLocatorKey(reference: LegacyMediaReference): string {
  return `${reference.purpose}\0${reference.bucket}\0${reference.key}`;
}

export interface BuildTargetImportInput {
  artifactFingerprintKey: Uint8Array;
  bundle: LegacyExportBundle;
  dataProtection: DataProtectionKeyring;
  dataProtectionKeyVersion: number;
  storageCheckpoints: readonly StorageCopyCheckpoint[];
  storagePlan: StorageMigrationPlan;
  targetStorageNamespace: string;
}

export function buildTargetImportBundle(input: BuildTargetImportInput): TargetImportBundle {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.targetStorageNamespace)) {
    throw new Error("Doelopslagnamespace is ongeldig.");
  }
  if (!Number.isSafeInteger(input.dataProtectionKeyVersion) || input.dataProtectionKeyVersion < 1) {
    throw new Error("PII-keyversie is ongeldig.");
  }
  const quarantine: MigrationIssue[] = [];
  const tables: TargetTableRows[] = [];
  const sourceCapturedAt = input.bundle.capturedAt;
  const mediaCollection = collectLegacyMediaReferences(input.bundle, input.artifactFingerprintKey);
  quarantine.push(...mediaCollection.issues);
  const storageByLocator = new Map(input.storagePlan.entries.map((entry) => [entryLocatorKey(entry), entry]));
  const checkpointByAsset = new Map(input.storageCheckpoints.map((checkpoint) => [checkpoint.assetId, checkpoint]));
  const mediaReferenceBySourceRecord = new Map<string, StorageMigrationPlanEntry>();
  for (const reference of mediaCollection.references) {
    const entry = storageByLocator.get(referenceLocatorKey(reference));
    if (entry) mediaReferenceBySourceRecord.set(`${reference.table}:${reference.recordId}:${reference.field}`, entry);
  }

  const userIds = new Set(input.bundle.auth.records.map((record) => record.appUserId));
  const userFields = ["user_id", "actor_id", "follower_id", "following_id"];
  for (const table of input.bundle.tables) {
    for (const row of table.rows) {
      for (const field of userFields) {
        const value = uuidValue(row, field);
        if (value) userIds.add(value);
      }
    }
  }
  const authByAppUser = new Map(input.bundle.auth.records.map((record) => [record.appUserId, record]));
  tables.push(batch("app_users", ["id"], [...userIds].sort().map((id) => {
    const auth = authByAppUser.get(id);
    return {
      id,
      status: auth?.status === "manual_review" ? "suspended" : "active",
      created_at: auth?.createdAt ?? sourceCapturedAt,
      updated_at: sourceCapturedAt,
    };
  }), ["status", "updated_at"]));
  tables.push(batch("auth_identity_mappings", ["legacy_provider", "legacy_subject_id"], input.bundle.auth.records.map((record) => ({
    id: record.identityMappingId,
    app_user_id: record.appUserId,
    auth_user_id: null,
    legacy_provider: record.legacyProvider,
    legacy_subject_id: record.legacySubjectId,
    migration_status: "requires_reset",
    linked_at: null,
    created_at: record.createdAt,
    updated_at: sourceCapturedAt,
  })), ["app_user_id", "migration_status", "updated_at"]));

  const profileRows: Record<string, unknown>[] = [];
  const avatarUpdates: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "profiles")) {
    const id = uuidValue(row, "id");
    const userId = uuidValue(row, "user_id");
    if (!id || !userId) {
      quarantine.push({ reasonCode: "profile_identity_invalid", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "profiles", row), sourceTable: "profiles" });
      continue;
    }
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    const updatedAt = timestampValue(row, "updated_at", createdAt);
    const displayNameRaw = stringValue(row, "display_name") ?? "Nieuwe verbouwer";
    if (displayNameRaw.length > 80) quarantine.push({ reasonCode: "profile_display_name_too_long", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "profiles", row), sourceTable: "profiles" });
    profileRows.push({
      id,
      user_id: userId,
      display_name: displayNameRaw.slice(0, 80),
      slug: `verbouwer-${userId.replaceAll("-", "")}`,
      bio: stringValue(row, "bio"),
      location: stringValue(row, "location"),
      avatar_asset_id: null,
      is_private: booleanValue(row, "is_private", true),
      is_pro: booleanValue(row, "is_pro"),
      onboarded_at: booleanValue(row, "onboarded") ? updatedAt : null,
      created_at: createdAt,
      updated_at: updatedAt,
    });
    const avatar = [...mediaReferenceBySourceRecord.entries()].find(([key]) => key.startsWith(`profiles:${id}:`))?.[1];
    if (avatar && checkpointByAsset.get(avatar.assetId)?.status === "verified") {
      avatarUpdates.push({ id, avatar_asset_id: avatar.assetId, updated_at: updatedAt });
    }
  }
  tables.push(batch("profiles", ["id"], profileRows, ["display_name", "slug", "bio", "location", "is_private", "is_pro", "onboarded_at", "updated_at"]));

  const projectRows: Record<string, unknown>[] = [];
  const projectOwner = new Map<string, string>();
  for (const row of rowsFor(input.bundle, "trips")) {
    const id = uuidValue(row, "id");
    const ownerId = uuidValue(row, "user_id");
    if (!id || !ownerId) {
      quarantine.push({ reasonCode: "project_identity_invalid", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "trips", row), sourceTable: "trips" });
      continue;
    }
    projectOwner.set(id, ownerId);
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    const updatedAt = timestampValue(row, "updated_at", createdAt);
    const isPublic = booleanValue(row, "is_public");
    projectRows.push({
      id,
      owner_id: ownerId,
      legacy_trip_id: id,
      slug: `project-${id.replaceAll("-", "")}`,
      title: (stringValue(row, "title") ?? "Verbouwing").slice(0, 120),
      description: stringValue(row, "description"),
      project_type: stringValue(row, "project_type"),
      start_date: dateValue(row, "start_date"),
      expected_end_date: dateValue(row, "end_date"),
      completed_at: null,
      visibility: isPublic ? "public" : "private",
      lifecycle_status: "active",
      progress_percentage: Math.max(0, Math.min(100, Math.round(numberValue(row, "progress_percentage") ?? 0))),
      published_at: isPublic ? createdAt : null,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  }
  tables.push(batch("projects", ["id"], projectRows, ["owner_id", "title", "description", "project_type", "start_date", "expected_end_date", "visibility", "progress_percentage", "published_at", "updated_at"]));

  const phases: Record<string, unknown>[] = [];
  const phaseIdByProjectAndName = new Map<string, string>();
  for (const project of rowsFor(input.bundle, "trips")) {
    const projectId = uuidValue(project, "id");
    if (!projectId || !projectOwner.has(projectId)) continue;
    const names = new Set<string>(STANDARD_PROJECT_PHASES);
    if (Array.isArray(project.custom_phases)) {
      for (const value of project.custom_phases) if (typeof value === "string" && value.trim()) names.add(value.trim().slice(0, 80));
    }
    for (const update of rowsFor(input.bundle, "steps")) {
      if (uuidValue(update, "trip_id") !== projectId) continue;
      const phase = stringValue(update, "phase");
      if (phase) names.add(phase.slice(0, 80));
    }
    [...names].forEach((name, sortOrder) => {
      const id = stableUuid(BUILDY_MIGRATION_NAMESPACE, `phase:${projectId}:${name.normalize("NFC")}`);
      phaseIdByProjectAndName.set(`${projectId}\0${name}`, id);
      phases.push({
        id, project_id: projectId, name, sort_order: sortOrder,
        is_custom: !STANDARD_PROJECT_PHASES.includes(name as typeof STANDARD_PROJECT_PHASES[number]),
        created_at: timestampValue(project, "created_at", sourceCapturedAt),
        updated_at: timestampValue(project, "updated_at", sourceCapturedAt),
      });
    });
  }
  tables.push(batch("project_phases", ["id"], phases, ["name", "sort_order", "is_custom", "updated_at"]));

  const privateRows: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "trip_private_info")) {
    const projectId = uuidValue(row, "trip_id");
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    if (!projectId || !ownerId) {
      quarantine.push({ reasonCode: "private_project_missing", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "trip_private_info", row), sourceTable: "trip_private_info" });
      continue;
    }
    const address = stringValue(row, "address");
    const updatedAt = timestampValue(row, "updated_at", sourceCapturedAt);
    privateRows.push({
      project_id: projectId,
      owner_id: ownerId,
      address_line_1_ciphertext: address ? input.dataProtection.encrypt(address, `project:${projectId}:private:address_line_1`) : null,
      address_line_2_ciphertext: null,
      postal_code_ciphertext: null,
      city_ciphertext: null,
      country_code: null,
      contractor_notes_ciphertext: null,
      encryption_key_version: input.dataProtectionKeyVersion,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }
  tables.push(batch("project_private_details", ["project_id"], privateRows, ["owner_id", "address_line_1_ciphertext", "encryption_key_version", "updated_at"]));

  const updateRows: Record<string, unknown>[] = [];
  const updateProject = new Map<string, string>();
  for (const row of rowsFor(input.bundle, "steps")) {
    const id = uuidValue(row, "id");
    const projectId = uuidValue(row, "trip_id");
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    if (!id || !projectId || !ownerId) {
      quarantine.push({ reasonCode: "update_identity_invalid", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "steps", row), sourceTable: "steps" });
      continue;
    }
    updateProject.set(id, projectId);
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    const updatedAt = timestampValue(row, "updated_at", createdAt);
    const phaseName = stringValue(row, "phase");
    updateRows.push({
      id,
      project_id: projectId,
      project_owner_id: ownerId,
      author_id: ownerId,
      phase_id: phaseName ? phaseIdByProjectAndName.get(`${projectId}\0${phaseName.slice(0, 80)}`) ?? null : null,
      legacy_step_id: id,
      title: stringValue(row, "location_name")?.slice(0, 120),
      room: stringValue(row, "room")?.slice(0, 80),
      description: stringValue(row, "description"),
      update_date: dateValue(row, "step_date") ?? createdAt.slice(0, 10),
      status: "published",
      is_milestone: booleanValue(row, "is_milestone"),
      sort_order: Math.max(0, Math.round(numberValue(row, "step_order") ?? 0)),
      published_at: createdAt,
      created_at: createdAt,
      updated_at: updatedAt,
    });
  }
  tables.push(batch("updates", ["id"], updateRows, ["phase_id", "title", "room", "description", "update_date", "is_milestone", "sort_order", "updated_at"]));

  const mediaRows: Record<string, unknown>[] = [];
  for (const entry of input.storagePlan.entries) {
    const checkpoint = checkpointByAsset.get(entry.assetId);
    if (checkpoint?.status !== "verified" || !checkpoint.checksumSha256 || !checkpoint.sizeBytes) {
      quarantine.push({
        reasonCode: "storage_copy_not_verified",
        recordFingerprint: entry.locatorFingerprint,
        sourceTable: entry.references[0]?.table as LegacyTableName ?? "step_media",
      });
      continue;
    }
    const ownerIds = new Set(entry.references.map((reference) => reference.ownerId));
    const projectIds = new Set(entry.references.map((reference) => reference.projectId).filter(Boolean));
    if (ownerIds.size !== 1 || (entry.purpose !== "avatars" && projectIds.size !== 1)) {
      quarantine.push({ reasonCode: "storage_scope_conflict", recordFingerprint: entry.locatorFingerprint, sourceTable: entry.references[0]?.table as LegacyTableName ?? "step_media" });
      continue;
    }
    const first = entry.references[0];
    const purpose = entry.purpose === "avatars" ? "avatar"
      : entry.purpose === "floorplans" ? "floorplan"
      : entry.purpose === "photobook-pdfs" ? "photobook_pdf"
      : entry.references.some((reference) => reference.field.includes("cover")) ? "project_cover"
      : "project_media";
    mediaRows.push({
      id: entry.assetId,
      owner_id: first.ownerId,
      project_id: purpose === "avatar" ? null : first.projectId,
      purpose,
      status: "uploaded",
      storage_provider: "vercel_blob",
      bucket: input.targetStorageNamespace,
      object_key: entry.destinationKey,
      upload_idempotency_key: `legacy-migration:v1:${entry.assetId}`,
      claimed_content_type: checkpoint.contentType ?? "application/octet-stream",
      detected_content_type: checkpoint.contentType ?? "application/octet-stream",
      size_bytes: checkpoint.sizeBytes,
      sha256: checkpoint.checksumSha256,
      exif_stripped: false,
      ready_at: null,
      created_at: sourceCapturedAt,
      updated_at: checkpoint.completedAt ?? sourceCapturedAt,
    });
  }
  tables.push(batch("media_assets", ["id"], mediaRows, ["status", "bucket", "object_key", "claimed_content_type", "detected_content_type", "size_bytes", "sha256", "updated_at"]));

  const updateMediaRows: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "step_media")) {
    const mediaId = uuidValue(row, "id");
    const updateId = uuidValue(row, "step_id");
    const projectId = updateId ? updateProject.get(updateId) : undefined;
    if (!mediaId || !updateId || !projectId) continue;
    const entry = [...mediaReferenceBySourceRecord.entries()].find(([key]) => key.startsWith(`step_media:${mediaId}:`))?.[1];
    if (!entry || checkpointByAsset.get(entry.assetId)?.status !== "verified") continue;
    const role = row.compare_role === "before" || row.compare_role === "after" ? row.compare_role : "gallery";
    updateMediaRows.push({
      update_id: updateId,
      project_id: projectId,
      media_asset_id: entry.assetId,
      role,
      sort_order: Math.max(0, Math.round(numberValue(row, "sort_order") ?? 0)),
      caption: null,
      created_at: timestampValue(row, "created_at", sourceCapturedAt),
      updated_at: timestampValue(row, "created_at", sourceCapturedAt),
    });
  }
  tables.push(batch("update_media", ["update_id", "media_asset_id"], updateMediaRows, ["role", "sort_order", "updated_at"]));
  if (avatarUpdates.length > 0) tables.push(batch("profiles", ["id"], avatarUpdates, ["avatar_asset_id", "updated_at"]));

  const floorplanRows: Record<string, unknown>[] = [];
  const floorplanMedia = new Map<string, string>();
  for (const project of rowsFor(input.bundle, "trips")) {
    const projectId = uuidValue(project, "id");
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    if (!projectId || !ownerId) continue;
    const candidates: Array<{ fieldPrefix: string; floor: Record<string, unknown>; floorId: string; index: number }> = [];
    if (stringValue(project, "floorplan_storage_path") || stringValue(project, "floorplan_url")) {
      candidates.push({ fieldPrefix: "floorplan_", floor: project, floorId: stableUuid(BUILDY_MIGRATION_NAMESPACE, `floor:${projectId}:legacy`), index: 0 });
    }
    if (Array.isArray(project.floorplans)) {
      project.floorplans.forEach((candidate, index) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
        const floor = candidate as Record<string, unknown>;
        candidates.push({ fieldPrefix: `floorplans[${index}].`, floor, floorId: uuidValue(floor, "id") ?? stableUuid(BUILDY_MIGRATION_NAMESPACE, `floor:${projectId}:${index}`), index });
      });
    }
    for (const candidate of candidates) {
      const entry = [...mediaReferenceBySourceRecord.entries()].find(([key]) =>
        key.startsWith(`trips:${candidate.floorId}:`) || (candidate.fieldPrefix === "floorplan_" && key.startsWith(`trips:${projectId}:floorplan_`)))?.[1];
      if (!entry || checkpointByAsset.get(entry.assetId)?.status !== "verified") continue;
      floorplanMedia.set(candidate.floorId, entry.assetId);
      floorplanRows.push({
        id: candidate.floorId,
        project_id: projectId,
        owner_id: ownerId,
        media_asset_id: entry.assetId,
        name: (stringValue(candidate.floor, "label") ?? `Verdieping ${candidate.index + 1}`).slice(0, 80),
        floor_number: null,
        sort_order: candidate.index,
        created_at: timestampValue(project, "created_at", sourceCapturedAt),
        updated_at: timestampValue(project, "updated_at", sourceCapturedAt),
      });
    }
  }
  tables.push(batch("floorplans", ["id"], floorplanRows, ["name", "sort_order", "media_asset_id", "updated_at"]));

  const pinRows: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "steps")) {
    const updateId = uuidValue(row, "id");
    const projectId = updateId ? updateProject.get(updateId) : undefined;
    const x = numberValue(row, "floorplan_x");
    const y = numberValue(row, "floorplan_y");
    if (!updateId || !projectId || x === null || y === null) continue;
    const explicitFloor = uuidValue(row, "floorplan_id");
    const floorplanId = explicitFloor && floorplanMedia.has(explicitFloor)
      ? explicitFloor
      : stableUuid(BUILDY_MIGRATION_NAMESPACE, `floor:${projectId}:legacy`);
    if (!floorplanMedia.has(floorplanId)) {
      quarantine.push({ reasonCode: "floorplan_pin_asset_missing", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "steps", row), sourceTable: "steps" });
      continue;
    }
    const normalizedX = x > 1 ? x / 100 : x;
    const normalizedY = y > 1 ? y / 100 : y;
    if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
      quarantine.push({ reasonCode: "floorplan_pin_out_of_range", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "steps", row), sourceTable: "steps" });
      continue;
    }
    pinRows.push({
      id: stableUuid(BUILDY_MIGRATION_NAMESPACE, `pin:${floorplanId}:${updateId}`),
      project_id: projectId,
      floorplan_id: floorplanId,
      update_id: updateId,
      x: normalizedX,
      y: normalizedY,
      label: stringValue(row, "room")?.slice(0, 80) ?? null,
      created_at: timestampValue(row, "created_at", sourceCapturedAt),
      updated_at: timestampValue(row, "updated_at", sourceCapturedAt),
    });
  }
  tables.push(batch("floorplan_pins", ["id"], pinRows, ["x", "y", "label", "updated_at"]));

  const relationships = rowsFor(input.bundle, "user_follows").flatMap((row) => {
    const id = uuidValue(row, "id");
    const source = uuidValue(row, "follower_id");
    const target = uuidValue(row, "following_id");
    if (!id || !source || !target || source === target) return [];
    const status = relationshipStatus(row.status);
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    return [{
      id, source_user_id: source, target_user_id: target, kind: "follow", status,
      decided_at: status === "pending" ? null : createdAt,
      revoked_at: status === "revoked" ? createdAt : null,
      created_at: createdAt, updated_at: createdAt,
    }];
  });
  tables.push(batch("user_relationships", ["id"], relationships, ["status", "decided_at", "revoked_at", "updated_at"]));

  const accessRequests: Record<string, unknown>[] = [];
  const followersByKey = new Map<string, Record<string, unknown>>();
  const projectVisibility = new Map(projectRows.map((row) => [row.id as string, row.visibility as string]));
  const followSources = [...rowsFor(input.bundle, "follows").map((row) => ({ row, favorite: false })), ...rowsFor(input.bundle, "favorites").map((row) => ({ row, favorite: true }))];
  for (const { row, favorite } of followSources) {
    const projectId = uuidValue(row, "project_id");
    const followerId = uuidValue(row, "user_id");
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    if (!projectId || !followerId || !ownerId || followerId === ownerId) continue;
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    const sourceStatus = favorite ? "active" : relationshipStatus(row.status);
    const accepted = sourceStatus === "active" || projectVisibility.get(projectId) === "public";
    if (projectVisibility.get(projectId) === "private") {
      accessRequests.push({
        id: uuidValue(row, "id") ?? stableUuid(BUILDY_MIGRATION_NAMESPACE, `access:${projectId}:${followerId}`),
        project_id: projectId, project_owner_id: ownerId, requester_id: followerId,
        status: accepted ? "accepted" : sourceStatus === "rejected" ? "rejected" : "pending",
        decided_by_id: accepted || sourceStatus === "rejected" ? ownerId : null,
        decided_at: accepted || sourceStatus === "rejected" ? createdAt : null,
        revoked_at: null, created_at: createdAt, updated_at: createdAt,
      });
    }
    if (accepted) {
      followersByKey.set(`${projectId}:${followerId}`, {
        project_id: projectId, project_owner_id: ownerId, follower_id: followerId,
        status: "active", followed_at: createdAt, updated_at: createdAt,
      });
    }
  }
  tables.push(batch("project_access_requests", ["id"], accessRequests, ["status", "decided_by_id", "decided_at", "revoked_at", "updated_at"]));
  tables.push(batch("project_followers", ["project_id", "follower_id"], [...followersByKey.values()], ["status", "updated_at"]));

  const commentRows: Record<string, unknown>[] = [];
  const mentionRows: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "comments")) {
    const id = uuidValue(row, "id");
    const updateId = uuidValue(row, "step_id");
    const projectId = updateId ? updateProject.get(updateId) : undefined;
    const authorId = uuidValue(row, "user_id");
    const body = stringValue(row, "content");
    if (!id || !updateId || !projectId || !authorId || !body || body.length > 2000) {
      quarantine.push({ reasonCode: "comment_invalid", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, "comments", row), sourceTable: "comments" });
      continue;
    }
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    commentRows.push({ id, project_id: projectId, update_id: updateId, author_id: authorId, parent_comment_id: uuidValue(row, "parent_id"), body, status: "published", created_at: createdAt, updated_at: createdAt });
    if (Array.isArray(row.mentions)) {
      for (const mention of row.mentions) if (typeof mention === "string" && UUID.test(mention)) {
        mentionRows.push({ comment_id: id, update_id: updateId, mentioned_user_id: mention.toLowerCase(), created_at: createdAt });
      }
    }
  }
  tables.push(batch("comments", ["id"], commentRows, ["parent_comment_id", "body", "updated_at"]));
  tables.push(batch("comment_mentions", ["comment_id", "mentioned_user_id"], mentionRows, []));

  const reactionRows: Record<string, unknown>[] = [];
  for (const [tableName, emojiFallback] of [["reactions", null], ["likes", "👍"]] as const) {
    for (const row of rowsFor(input.bundle, tableName)) {
      const id = uuidValue(row, "id");
      const updateId = uuidValue(row, "step_id");
      const projectId = updateId ? updateProject.get(updateId) : undefined;
      const actorId = uuidValue(row, "user_id");
      const emoji = emojiFallback ?? stringValue(row, "emoji");
      if (!id || !updateId || !projectId || !actorId || !emoji || !ALLOWED_REACTIONS.has(emoji)) {
        quarantine.push({ reasonCode: "reaction_invalid", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, tableName, row), sourceTable: tableName });
        continue;
      }
      reactionRows.push({ id, project_id: projectId, update_id: updateId, comment_id: null, actor_id: actorId, target: "update", emoji, created_at: timestampValue(row, "created_at", sourceCapturedAt) });
    }
  }
  tables.push(batch("reactions", ["id"], reactionRows, ["emoji"]));

  const notificationRows = rowsFor(input.bundle, "notifications").flatMap((row) => {
    const id = uuidValue(row, "id");
    const recipient = uuidValue(row, "user_id");
    if (!id || !recipient) return [];
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    const read = booleanValue(row, "read");
    return [{
      id, recipient_id: recipient, actor_id: uuidValue(row, "actor_id"), project_id: uuidValue(row, "project_id"),
      update_id: uuidValue(row, "step_id"), comment_id: null,
      type: (stringValue(row, "type") ?? "legacy.notification").slice(0, 100), status: read ? "read" : "unread",
      dedupe_key: `legacy:${id}`, payload: {}, read_at: read ? createdAt : null,
      created_at: createdAt, updated_at: createdAt,
    }];
  });
  tables.push(batch("notifications", ["id"], notificationRows, ["status", "read_at", "updated_at"]));

  const budgetIdByProject = new Map<string, string>();
  const budgetRows: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "trip_budgets")) {
    const projectId = uuidValue(row, "trip_id");
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    const amount = minorUnits(row.budget_total) ?? 0;
    if (!projectId || !ownerId) continue;
    const id = stableUuid(BUILDY_MIGRATION_NAMESPACE, `budget:${projectId}`);
    budgetIdByProject.set(projectId, id);
    const createdAt = timestampValue(row, "created_at", sourceCapturedAt);
    budgetRows.push({ id, project_id: projectId, owner_id: ownerId, currency: "EUR", planned_amount_minor: amount, is_shared: false, created_at: createdAt, updated_at: timestampValue(row, "updated_at", createdAt) });
  }
  tables.push(batch("project_budgets", ["id"], budgetRows, ["planned_amount_minor", "updated_at"]));

  const budgetItems: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "step_budget")) {
    const updateId = uuidValue(row, "step_id");
    const projectId = uuidValue(row, "trip_id") ?? (updateId ? updateProject.get(updateId) ?? null : null);
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    if (!updateId || !projectId || !ownerId) continue;
    let budgetId = budgetIdByProject.get(projectId);
    if (!budgetId) {
      budgetId = stableUuid(BUILDY_MIGRATION_NAMESPACE, `budget:${projectId}`);
      budgetIdByProject.set(projectId, budgetId);
      budgetRows.push({ id: budgetId, project_id: projectId, owner_id: ownerId, currency: "EUR", planned_amount_minor: 0, is_shared: false, created_at: sourceCapturedAt, updated_at: sourceCapturedAt });
    }
    const explicit = minorUnits(row.cost);
    const split = (minorUnits(row.diy_cost) ?? 0) + (minorUnits(row.outsourced_cost) ?? 0);
    const amount = explicit ?? split;
    budgetItems.push({
      id: stableUuid(BUILDY_MIGRATION_NAMESPACE, `budget-item:${updateId}`), budget_id: budgetId,
      project_id: projectId, update_id: updateId, created_by_id: ownerId, kind: "actual",
      category: "Algemeen", description: stringValue(row, "work_type"), amount_minor: amount,
      occurred_on: null, sort_order: 0,
      created_at: timestampValue(row, "updated_at", sourceCapturedAt), updated_at: timestampValue(row, "updated_at", sourceCapturedAt),
    });
  }
  tables.push(batch("budget_items", ["id"], budgetItems, ["category", "description", "amount_minor", "updated_at"]));

  const settingsRows: Record<string, unknown>[] = [];
  for (const row of rowsFor(input.bundle, "photobook_settings")) {
    const projectId = uuidValue(row, "trip_id");
    const ownerId = projectId ? projectOwner.get(projectId) : undefined;
    if (!projectId || !ownerId) continue;
    const coverLegacyId = uuidValue(row, "cover_media_id");
    const coverAsset = coverLegacyId
      ? [...mediaReferenceBySourceRecord.entries()].find(([key]) => key.startsWith(`step_media:${coverLegacyId}:`))?.[1]
      : undefined;
    settingsRows.push({
      project_id: projectId, owner_id: ownerId,
      cover_media_asset_id: coverAsset && checkpointByAsset.get(coverAsset.assetId)?.status === "verified" ? coverAsset.assetId : null,
      selected_format: "a4-landscape-hardcover-v1",
      title: stringValue(row, "cover_title"), subtitle: stringValue(row, "cover_subtitle"), include_budget: false,
      preferences: {
        legacyChapterOverrides: row.chapter_overrides ?? {},
        legacyStepLayoutOverrides: row.step_layout_overrides ?? {},
        legacyStepPhotoOrder: row.step_photo_order ?? {},
      },
      created_at: timestampValue(row, "updated_at", sourceCapturedAt), updated_at: timestampValue(row, "updated_at", sourceCapturedAt),
    });
  }
  tables.push(batch("photobook_settings", ["project_id"], settingsRows, ["cover_media_asset_id", "title", "subtitle", "preferences", "updated_at"]));

  for (const sourceTable of ["photobook_excluded_media", "photobook_excluded_steps", "photobook_orders", "photobook_order_events", "step_contractor_info", "account_deletion_locks", "account_deletion_cleanup_failures", "photobook_order_archive"] as LegacyTableName[]) {
    for (const row of rowsFor(input.bundle, sourceTable)) {
      quarantine.push({ reasonCode: sourceTable.startsWith("photobook_order") ? "legacy_order_manual_review" : "legacy_record_manual_review", recordFingerprint: sourceFingerprint(input.artifactFingerprintKey, sourceTable, row), sourceTable });
    }
  }

  const nonEmptyTables = tables.filter((table) => table.rows.length > 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceExportSha256: sha256Hex(canonicalJson(input.bundle)),
    tables: nonEmptyTables,
    quarantined: quarantine.sort((left, right) => `${left.sourceTable}:${left.recordFingerprint}`.localeCompare(`${right.sourceTable}:${right.recordFingerprint}`)),
  };
}

export function planLegacyStorage(
  bundle: LegacyExportBundle,
  fingerprintKey: Uint8Array,
): { collection: LegacyMediaCollection; plan: StorageMigrationPlan } {
  const collection = collectLegacyMediaReferences(bundle, fingerprintKey);
  return { collection, plan: buildStorageMigrationPlan(collection.references, fingerprintKey) };
}

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers } from "./auth.js";
import {
  mediaPurposeEnum,
  mediaStatusEnum,
  optimisticVersion,
  timestamps,
  updateMediaRoleEnum,
} from "./common.js";
import { projects, updates } from "./projects.js";

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    originalAssetId: uuid("original_asset_id"),
    purpose: mediaPurposeEnum("purpose").notNull(),
    status: mediaStatusEnum("status").default("pending_upload").notNull(),
    storageProvider: text("storage_provider").default("r2").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    storageVersion: text("storage_version"),
    uploadIdempotencyKey: text("upload_idempotency_key").notNull(),
    claimedContentType: text("claimed_content_type"),
    detectedContentType: text("detected_content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    widthPixels: integer("width_pixels"),
    heightPixels: integer("height_pixels"),
    durationMilliseconds: integer("duration_milliseconds"),
    exifStripped: boolean("exif_stripped").default(false).notNull(),
    isCurrent: boolean("is_current").default(true).notNull(),
    focalX: numeric("focal_x", { precision: 5, scale: 4 }),
    focalY: numeric("focal_y", { precision: 5, scale: 4 }),
    privacyVersion: integer("privacy_version").default(1).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "media_assets_project_owner_fk",
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_assets_original_owner_fk",
      columns: [table.originalAssetId, table.ownerId],
      foreignColumns: [table.id, table.ownerId],
    }).onDelete("restrict"),
    unique("media_assets_id_project_uq").on(table.id, table.projectId),
    unique("media_assets_id_owner_uq").on(table.id, table.ownerId),
    uniqueIndex("media_assets_object_uq").on(table.storageProvider, table.bucket, table.objectKey),
    uniqueIndex("media_assets_upload_idempotency_uq").on(table.uploadIdempotencyKey),
    index("media_assets_project_status_idx").on(table.projectId, table.status, table.createdAt),
    index("media_assets_owner_purpose_idx").on(table.ownerId, table.purpose, table.status),
    index("media_assets_cleanup_idx").on(table.status, table.deletedAt),
    check("media_assets_object_key_ck", sql`length(${table.objectKey}) BETWEEN 1 AND 1024 AND ${table.objectKey} !~ '(^|/)[.][.](/|$)'`),
    check("media_assets_bucket_ck", sql`${table.bucket} ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'`),
    check("media_assets_size_ck", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} BETWEEN 1 AND 536870912`),
    check("media_assets_sha_ck", sql`${table.sha256} IS NULL OR ${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check("media_assets_dimensions_ck", sql`(${table.widthPixels} IS NULL OR ${table.widthPixels} > 0) AND (${table.heightPixels} IS NULL OR ${table.heightPixels} > 0)`),
    check("media_assets_duration_ck", sql`${table.durationMilliseconds} IS NULL OR ${table.durationMilliseconds} >= 0`),
    check("media_assets_focal_x_ck", sql`${table.focalX} IS NULL OR ${table.focalX} BETWEEN 0 AND 1`),
    check("media_assets_focal_y_ck", sql`${table.focalY} IS NULL OR ${table.focalY} BETWEEN 0 AND 1`),
    check("media_assets_privacy_version_ck", sql`${table.privacyVersion} > 0 AND ${table.version} > 0`),
    check("media_assets_original_not_self_ck", sql`${table.originalAssetId} IS NULL OR ${table.originalAssetId} <> ${table.id}`),
    check(
      "media_assets_project_scope_ck",
      sql`(${table.purpose} IN ('avatar', 'export_archive', 'temporary_upload') AND ${table.projectId} IS NULL) OR (${table.purpose} NOT IN ('avatar', 'export_archive', 'temporary_upload') AND ${table.projectId} IS NOT NULL)`,
    ),
    check(
      "media_assets_ready_ck",
      sql`${table.status} <> 'ready' OR (${table.readyAt} IS NOT NULL AND ${table.sha256} IS NOT NULL AND ${table.sizeBytes} IS NOT NULL AND ${table.detectedContentType} IS NOT NULL)`,
    ),
  ],
);

export const updateMedia = pgTable(
  "update_media",
  {
    updateId: uuid("update_id").notNull(),
    projectId: uuid("project_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    role: updateMediaRoleEnum("role").default("gallery").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    caption: text("caption"),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: "update_media_pk", columns: [table.updateId, table.mediaAssetId] }),
    foreignKey({
      name: "update_media_update_project_fk",
      columns: [table.updateId, table.projectId],
      foreignColumns: [updates.id, updates.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "update_media_asset_project_fk",
      columns: [table.mediaAssetId, table.projectId],
      foreignColumns: [mediaAssets.id, mediaAssets.projectId],
    }).onDelete("restrict"),
    uniqueIndex("update_media_asset_uq").on(table.mediaAssetId),
    uniqueIndex("update_media_update_sort_uq").on(table.updateId, table.sortOrder),
    index("update_media_project_idx").on(table.projectId, table.updateId),
    check("update_media_sort_ck", sql`${table.sortOrder} >= 0`),
    check("update_media_caption_ck", sql`${table.caption} IS NULL OR char_length(${table.caption}) <= 500`),
  ],
);

export const floorplans = pgTable(
  "floorplans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    name: text("name").notNull(),
    floorNumber: integer("floor_number"),
    sortOrder: integer("sort_order").default(0).notNull(),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "floorplans_project_owner_fk",
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "floorplans_asset_project_fk",
      columns: [table.mediaAssetId, table.projectId],
      foreignColumns: [mediaAssets.id, mediaAssets.projectId],
    }).onDelete("restrict"),
    unique("floorplans_id_project_uq").on(table.id, table.projectId),
    uniqueIndex("floorplans_asset_uq").on(table.mediaAssetId),
    uniqueIndex("floorplans_project_sort_uq").on(table.projectId, table.sortOrder),
    check("floorplans_name_ck", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 80`),
    check("floorplans_sort_version_ck", sql`${table.sortOrder} >= 0 AND ${table.version} > 0`),
  ],
);

export const floorplanPins = pgTable(
  "floorplan_pins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    floorplanId: uuid("floorplan_id").notNull(),
    updateId: uuid("update_id").notNull(),
    x: numeric("x", { precision: 6, scale: 5 }).notNull(),
    y: numeric("y", { precision: 6, scale: 5 }).notNull(),
    label: text("label"),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "floorplan_pins_floorplan_project_fk",
      columns: [table.floorplanId, table.projectId],
      foreignColumns: [floorplans.id, floorplans.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "floorplan_pins_update_project_fk",
      columns: [table.updateId, table.projectId],
      foreignColumns: [updates.id, updates.projectId],
    }).onDelete("cascade"),
    uniqueIndex("floorplan_pins_floorplan_update_uq").on(table.floorplanId, table.updateId),
    index("floorplan_pins_update_idx").on(table.updateId),
    check("floorplan_pins_x_ck", sql`${table.x} BETWEEN 0 AND 1`),
    check("floorplan_pins_y_ck", sql`${table.y} BETWEEN 0 AND 1`),
    check("floorplan_pins_label_ck", sql`${table.label} IS NULL OR char_length(${table.label}) <= 80`),
    check("floorplan_pins_version_ck", sql`${table.version} > 0`),
  ],
);

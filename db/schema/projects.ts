import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
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
  accessRequestStatusEnum,
  followerStatusEnum,
  optimisticVersion,
  projectLifecycleStatusEnum,
  projectVisibilityEnum,
  timestamps,
  updateStatusEnum,
} from "./common.js";

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    slug: text("slug").notNull(),
    bio: text("bio"),
    location: text("location"),
    avatarAssetId: uuid("avatar_asset_id"),
    isPrivate: boolean("is_private").default(true).notNull(),
    isPro: boolean("is_pro").default(false).notNull(),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("profiles_user_uq").on(table.userId),
    uniqueIndex("profiles_slug_uq").on(table.slug),
    index("profiles_avatar_idx").on(table.avatarAssetId),
    index("profiles_discovery_idx").on(table.isPrivate, table.createdAt),
    check("profiles_display_name_length_ck", sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 80`),
    check("profiles_slug_format_ck", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(${table.slug}) <= 80`),
    check("profiles_bio_length_ck", sql`${table.bio} IS NULL OR char_length(${table.bio}) <= 500`),
    check("profiles_location_length_ck", sql`${table.location} IS NULL OR char_length(${table.location}) <= 120`),
    check("profiles_version_positive", sql`${table.version} > 0`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    legacyTripId: uuid("legacy_trip_id"),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    projectType: text("project_type"),
    startDate: date("start_date"),
    expectedEndDate: date("expected_end_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    visibility: projectVisibilityEnum("visibility").default("private").notNull(),
    lifecycleStatus: projectLifecycleStatusEnum("lifecycle_status").default("active").notNull(),
    progressPercentage: integer("progress_percentage").default(0).notNull(),
    contentRevision: bigint("content_revision", { mode: "number" }).default(1).notNull(),
    version: optimisticVersion(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("projects_slug_uq").on(table.slug),
    uniqueIndex("projects_legacy_trip_uq").on(table.legacyTripId),
    unique("projects_id_owner_uq").on(table.id, table.ownerId),
    index("projects_owner_status_idx").on(table.ownerId, table.lifecycleStatus, table.updatedAt),
    index("projects_public_discovery_idx").on(table.visibility, table.lifecycleStatus, table.publishedAt),
    check("projects_slug_format_ck", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("projects_title_length_ck", sql`char_length(btrim(${table.title})) BETWEEN 1 AND 120`),
    check("projects_description_length_ck", sql`${table.description} IS NULL OR char_length(${table.description}) <= 5000`),
    check("projects_progress_range_ck", sql`${table.progressPercentage} BETWEEN 0 AND 100`),
    check("projects_revision_positive_ck", sql`${table.contentRevision} > 0 AND ${table.version} > 0`),
    check(
      "projects_date_order_ck",
      sql`${table.startDate} IS NULL OR ${table.expectedEndDate} IS NULL OR ${table.expectedEndDate} >= ${table.startDate}`,
    ),
    check(
      "projects_publication_ck",
      sql`${table.visibility} = 'private' OR ${table.publishedAt} IS NOT NULL`,
    ),
    check(
      "projects_deleted_state_ck",
      sql`(${table.lifecycleStatus} = 'deleted') = (${table.deletedAt} IS NOT NULL)`,
    ),
  ],
);

export const projectShareLinks = pgTable(
  "project_share_links",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    issueIdempotencyHash: text("issue_idempotency_hash").notNull(),
    issueRequestHash: text("issue_request_hash").notNull(),
    revokeIdempotencyHash: text("revoke_idempotency_hash"),
    revokeRequestHash: text("revoke_request_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "project_share_links_project_owner_fk",
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    uniqueIndex("project_share_links_token_hash_uq").on(table.tokenHash),
    uniqueIndex("project_share_links_issue_idempotency_uq").on(table.issueIdempotencyHash),
    uniqueIndex("project_share_links_revoke_idempotency_uq")
      .on(table.revokeIdempotencyHash)
      .where(sql`${table.revokeIdempotencyHash} IS NOT NULL`),
    uniqueIndex("project_share_links_current_project_uq")
      .on(table.projectId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("project_share_links_owner_created_idx").on(table.ownerId, table.createdAt, table.id),
    check("project_share_links_token_hash_ck", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("project_share_links_issue_idempotency_hash_ck", sql`${table.issueIdempotencyHash} ~ '^[0-9a-f]{64}$'`),
    check("project_share_links_issue_request_hash_ck", sql`${table.issueRequestHash} ~ '^[0-9a-f]{64}$'`),
    check("project_share_links_revoke_hash_pair_ck", sql`
      (${table.revokeIdempotencyHash} IS NULL) = (${table.revokeRequestHash} IS NULL)
      AND (${table.revokeIdempotencyHash} IS NULL OR ${table.revokeIdempotencyHash} ~ '^[0-9a-f]{64}$')
      AND (${table.revokeRequestHash} IS NULL OR ${table.revokeRequestHash} ~ '^[0-9a-f]{64}$')
    `),
    check("project_share_links_expiry_ck", sql`${table.expiresAt} > ${table.createdAt}`),
    check("project_share_links_revocation_ck", sql`
      ((${table.revokedAt} IS NULL) = (${table.revokeIdempotencyHash} IS NULL))
      OR (${table.revokedAt} IS NOT NULL AND ${table.revokeIdempotencyHash} IS NULL)
    `),
    check("project_share_links_version_ck", sql`${table.version} > 0`),
  ],
);

export const projectPrivateDetails = pgTable(
  "project_private_details",
  {
    projectId: uuid("project_id").primaryKey(),
    ownerId: uuid("owner_id").notNull(),
    addressLine1Ciphertext: text("address_line_1_ciphertext"),
    addressLine2Ciphertext: text("address_line_2_ciphertext"),
    postalCodeCiphertext: text("postal_code_ciphertext"),
    cityCiphertext: text("city_ciphertext"),
    countryCode: text("country_code"),
    contractorNotesCiphertext: text("contractor_notes_ciphertext"),
    encryptionKeyVersion: integer("encryption_key_version").default(1).notNull(),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "project_private_details_project_owner_fk",
      columns: [table.projectId, table.ownerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    check(
      "project_private_details_country_ck",
      sql`${table.countryCode} IS NULL OR ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check("project_private_details_key_version_ck", sql`${table.encryptionKeyVersion} > 0 AND ${table.version} > 0`),
  ],
);

export const projectPhases = pgTable(
  "project_phases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isCustom: boolean("is_custom").default(false).notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("project_phases_id_project_uq").on(table.id, table.projectId),
    uniqueIndex("project_phases_project_sort_uq").on(table.projectId, table.sortOrder),
    uniqueIndex("project_phases_project_name_uq").on(table.projectId, table.name),
    check("project_phases_name_length_ck", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 80`),
    check("project_phases_sort_nonnegative_ck", sql`${table.sortOrder} >= 0`),
  ],
);

export const projectAccessRequests = pgTable(
  "project_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    projectOwnerId: uuid("project_owner_id").notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    status: accessRequestStatusEnum("status").default("pending").notNull(),
    decidedById: uuid("decided_by_id").references(() => appUsers.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "project_access_requests_project_owner_fk",
      columns: [table.projectId, table.projectOwnerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    uniqueIndex("project_access_requests_project_requester_uq").on(table.projectId, table.requesterId),
    index("project_access_requests_owner_status_idx").on(table.projectOwnerId, table.status, table.createdAt),
    index("project_access_requests_requester_status_idx").on(table.requesterId, table.status, table.updatedAt),
    check("project_access_requests_not_owner_ck", sql`${table.requesterId} <> ${table.projectOwnerId}`),
    check(
      "project_access_requests_decision_ck",
      sql`${table.status} = 'pending' OR ${table.decidedAt} IS NOT NULL`,
    ),
  ],
);

export const projectFollowers = pgTable(
  "project_followers",
  {
    projectId: uuid("project_id").notNull(),
    projectOwnerId: uuid("project_owner_id").notNull(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    status: followerStatusEnum("status").default("active").notNull(),
    followedAt: timestamp("followed_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "project_followers_pk", columns: [table.projectId, table.followerId] }),
    foreignKey({
      name: "project_followers_project_owner_fk",
      columns: [table.projectId, table.projectOwnerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    index("project_followers_follower_status_idx").on(table.followerId, table.status, table.followedAt),
    check("project_followers_not_owner_ck", sql`${table.followerId} <> ${table.projectOwnerId}`),
  ],
);

export const updates = pgTable(
  "updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    projectOwnerId: uuid("project_owner_id").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    phaseId: uuid("phase_id"),
    legacyStepId: uuid("legacy_step_id"),
    title: text("title"),
    room: text("room"),
    description: text("description"),
    updateDate: date("update_date").notNull(),
    status: updateStatusEnum("status").default("draft").notNull(),
    isMilestone: boolean("is_milestone").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    contentRevision: bigint("content_revision", { mode: "number" }).default(1).notNull(),
    version: optimisticVersion(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "updates_project_owner_fk",
      columns: [table.projectId, table.projectOwnerId],
      foreignColumns: [projects.id, projects.ownerId],
    }).onDelete("cascade"),
    foreignKey({
      name: "updates_phase_project_fk",
      columns: [table.phaseId, table.projectId],
      foreignColumns: [projectPhases.id, projectPhases.projectId],
    }).onDelete("restrict"),
    unique("updates_id_project_uq").on(table.id, table.projectId),
    unique("updates_id_project_author_uq").on(table.id, table.projectId, table.authorId),
    uniqueIndex("updates_legacy_step_uq").on(table.legacyStepId),
    index("updates_project_timeline_idx").on(table.projectId, table.status, table.updateDate, table.sortOrder),
    index("updates_author_idx").on(table.authorId, table.createdAt),
    check("updates_author_owner_ck", sql`${table.authorId} = ${table.projectOwnerId}`),
    check("updates_title_length_ck", sql`${table.title} IS NULL OR char_length(btrim(${table.title})) BETWEEN 1 AND 120`),
    check("updates_room_length_ck", sql`${table.room} IS NULL OR char_length(${table.room}) <= 80`),
    check("updates_description_length_ck", sql`${table.description} IS NULL OR char_length(${table.description}) <= 10000`),
    check("updates_sort_revision_ck", sql`${table.sortOrder} >= 0 AND ${table.contentRevision} > 0 AND ${table.version} > 0`),
    check(
      "updates_publication_ck",
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
    ),
    check(
      "updates_deleted_state_ck",
      sql`(${table.status} = 'deleted') = (${table.deletedAt} IS NOT NULL)`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  appUserStatusEnum,
  identityMigrationStatusEnum,
  optimisticVersion,
  timestamps,
} from "./common.js";

// Better Auth uses text identifiers. Model names are configured explicitly in the auth adapter.
export const authUsers = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps(),
  },
  (table) => [uniqueIndex("auth_users_email_lower_uq").on(sql`lower(${table.email})`)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_account_uq").on(table.providerId, table.accountId),
    index("auth_accounts_user_idx").on(table.userId),
  ],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("auth_verifications_identifier_idx").on(table.identifier),
    index("auth_verifications_expiry_idx").on(table.expiresAt),
  ],
);

// Internal, shared rate-limit state for Better Auth. The request-derived key is
// HMAC blind-indexed before it reaches this table; raw IP/path material is never
// persisted. This table is server-only and deliberately not exposed through RLS.
export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    count: integer("count").default(0).notNull(),
    windowStartedAtMs: bigint("window_started_at_ms", { mode: "number" }).notNull(),
    lastRequestAtMs: bigint("last_request_at_ms", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auth_rate_limits_expiry_idx").on(table.expiresAt),
    check("auth_rate_limits_key_hash_ck", sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`),
    check("auth_rate_limits_count_ck", sql`${table.count} >= 0`),
    check(
      "auth_rate_limits_timestamps_ck",
      sql`${table.windowStartedAtMs} > 0 AND ${table.lastRequestAtMs} >= ${table.windowStartedAtMs}`,
    ),
  ],
);

// Stable domain identity. Domain foreign keys never point directly at a provider-owned auth ID.
export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: appUserStatusEnum("status").default("active").notNull(),
    authzVersion: bigint("authz_version", { mode: "number" }).default(1).notNull(),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    privacyVersion: text("privacy_version"),
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true }),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: optimisticVersion(),
    ...timestamps(),
  },
  (table) => [
    check("app_users_version_positive", sql`${table.authzVersion} > 0 AND ${table.version} > 0`),
    check(
      "app_users_terms_pair_ck",
      sql`(${table.termsVersion} IS NULL) = (${table.termsAcceptedAt} IS NULL)`,
    ),
    check(
      "app_users_privacy_pair_ck",
      sql`(${table.privacyVersion} IS NULL) = (${table.privacyAcceptedAt} IS NULL)`,
    ),
    check(
      "app_users_deleted_state_ck",
      sql`(${table.status} = 'deleted') = (${table.deletedAt} IS NOT NULL)`,
    ),
  ],
);

export const authIdentityMappings = pgTable(
  "auth_identity_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    legacyProvider: text("legacy_provider"),
    legacySubjectId: text("legacy_subject_id"),
    migrationStatus: identityMigrationStatusEnum("migration_status").default("pending").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("auth_identity_mappings_legacy_uq").on(table.legacyProvider, table.legacySubjectId),
    uniqueIndex("auth_identity_mappings_auth_user_uq").on(table.authUserId),
    index("auth_identity_mappings_app_user_idx").on(table.appUserId),
    check(
      "auth_identity_mappings_source_ck",
      sql`${table.authUserId} IS NOT NULL OR (${table.legacyProvider} IS NOT NULL AND ${table.legacySubjectId} IS NOT NULL)`,
    ),
    check(
      "auth_identity_mappings_legacy_pair_ck",
      sql`(${table.legacyProvider} IS NULL) = (${table.legacySubjectId} IS NULL)`,
    ),
    check(
      "auth_identity_mappings_provider_nonempty",
      sql`${table.legacyProvider} IS NULL OR length(btrim(${table.legacyProvider})) > 0`,
    ),
    check(
      "auth_identity_mappings_subject_nonempty",
      sql`${table.legacySubjectId} IS NULL OR length(btrim(${table.legacySubjectId})) > 0`,
    ),
    check(
      "auth_identity_mappings_linked_ck",
      sql`${table.migrationStatus} <> 'linked' OR (${table.authUserId} IS NOT NULL AND ${table.linkedAt} IS NOT NULL)`,
    ),
  ],
);

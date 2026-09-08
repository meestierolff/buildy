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

// Historical provider-era tables. Kept intact as a compatibility bridge for existing identities.
export const authUsers = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
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

// Password authentication never invents an email address or stores a raw token.
export const passwordCredentials = pgTable(
  "password_credentials",
  {
    authUserId: text("auth_user_id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    ...timestamps(),
  },
  (table) => [
    check("password_credentials_username_ck", sql`${table.username} ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'`),
    check("password_credentials_hash_ck", sql`${table.passwordHash} ~ '^scrypt\\$v1\\$131072\\$8\\$1\\$[0-9a-f]{32}\\$[0-9a-f]{128}$'`),
  ],
);

export const passwordSessions = pgTable(
  "password_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: text("auth_user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("password_sessions_user_expiry_idx").on(table.authUserId, table.expiresAt.desc()).where(sql`${table.revokedAt} IS NULL`),
    index("password_sessions_expiry_idx").on(table.expiresAt),
    check("password_sessions_token_hash_ck", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("password_sessions_user_agent_ck", sql`${table.userAgent} IS NULL OR char_length(${table.userAgent}) BETWEEN 1 AND 1000`),
    check("password_sessions_expiry_ck", sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '8 days'`),
    check("password_sessions_revoked_ck", sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`),
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

// Internal, shared authentication rate-limit state. The request-derived key is
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

/**
 * Active Google identity boundary. `authUserId` is a compatibility bridge into
 * the stable app-user mapping while legacy auth rows remain untouched.
 */
export const googleOidcIdentities = pgTable(
  "google_oidc_identities",
  {
    subject: text("subject").primaryKey(),
    authUserId: text("auth_user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "google_oidc_identities_subject_ck",
      sql`char_length(${table.subject}) BETWEEN 1 AND 255 AND ${table.subject} !~ '[[:cntrl:]]'`,
    ),
    check(
      "google_oidc_identities_authenticated_clock_ck",
      sql`${table.lastAuthenticatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const googleOidcLoginAttempts = pgTable(
  "google_oidc_login_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stateHash: text("state_hash").notNull().unique(),
    sourceHash: text("source_hash").notNull(),
    browserBindingHash: text("browser_binding_hash").notNull(),
    codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
    nonceCiphertext: text("nonce_ciphertext").notNull(),
    nextPath: text("next_path").default("/").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("google_oidc_login_attempts_source_expiry_idx")
      .on(table.sourceHash, table.expiresAt)
      .where(sql`${table.consumedAt} IS NULL`),
    index("google_oidc_login_attempts_expiry_idx").on(table.expiresAt),
    check("google_oidc_login_attempts_state_hash_ck", sql`${table.stateHash} ~ '^[0-9a-f]{64}$'`),
    check("google_oidc_login_attempts_source_hash_ck", sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "google_oidc_login_attempts_browser_binding_hash_ck",
      sql`${table.browserBindingHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "google_oidc_login_attempts_expiry_ck",
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '15 minutes'`,
    ),
  ],
);

export const googleOidcSessions = pgTable(
  "google_oidc_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identitySubject: text("identity_subject")
      .notNull()
      .references(() => googleOidcIdentities.subject, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("google_oidc_sessions_identity_expiry_idx")
      .on(table.identitySubject, table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
    index("google_oidc_sessions_expiry_idx").on(table.expiresAt),
    check("google_oidc_sessions_token_hash_ck", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
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

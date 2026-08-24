import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUsers, authUsers } from "./auth.js";
import {
  auditActorKindEnum,
  appRoleKindEnum,
  betaInviteStatusEnum,
  betaRedemptionStatusEnum,
  deletionAssetStatusEnum,
  deletionKindEnum,
  deletionStatusEnum,
  emailDeliveryStatusEnum,
  exportJobStatusEnum,
  feedbackStatusEnum,
  moderationActionKindEnum,
  moderationAccountRestrictionKindEnum,
  moderationReportStatusEnum,
  moderationTargetStateKindEnum,
  outboxStatusEnum,
  providerInboxStatusEnum,
  timestamps,
} from "./common.js";
import { mediaAssets } from "./media.js";

export const providerEventInbox = pgTable(
  "provider_event_inbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    reference: text("reference"),
    payloadSha256: text("payload_sha256").notNull(),
    payloadCiphertext: text("payload_ciphertext"),
    payloadSummary: jsonb("payload_summary").$type<Record<string, unknown>>().default({}).notNull(),
    signatureVerifiedAt: timestamp("signature_verified_at", { withTimezone: true }).notNull(),
    status: providerInboxStatusEnum("status").default("received").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_event_inbox_provider_event_uq").on(
      table.provider,
      table.environment,
      table.providerEventId,
    ),
    index("provider_event_inbox_claim_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
    index("provider_event_inbox_reference_idx").on(table.provider, table.reference),
    check("provider_event_inbox_provider_ck", sql`${table.provider} IN ('stripe', 'peecho', 'brevo')`),
    check("provider_event_inbox_environment_ck", sql`${table.environment} IN ('preview', 'staging', 'production', 'test')`),
    check("provider_event_inbox_event_type_ck", sql`char_length(btrim(${table.eventType})) BETWEEN 1 AND 160`),
    check("provider_event_inbox_hash_ck", sql`${table.payloadSha256} ~ '^[0-9a-f]{64}$'`),
    check("provider_event_inbox_payload_ck", sql`jsonb_typeof(${table.payloadSummary}) = 'object'`),
    check("provider_event_inbox_attempt_ck", sql`${table.attemptCount} >= 0`),
    check("provider_event_inbox_lease_ck", sql`(${table.leaseOwner} IS NULL) = (${table.leaseExpiresAt} IS NULL)`),
    check("provider_event_inbox_applied_ck", sql`${table.status} <> 'applied' OR ${table.appliedAt} IS NOT NULL`),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    status: outboxStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("outbox_events_idempotency_uq").on(table.idempotencyKey),
    index("outbox_events_claim_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
    index("outbox_events_aggregate_idx").on(table.aggregateType, table.aggregateId, table.createdAt),
    check("outbox_events_aggregate_type_ck", sql`char_length(btrim(${table.aggregateType})) BETWEEN 1 AND 80`),
    check("outbox_events_event_type_ck", sql`char_length(btrim(${table.eventType})) BETWEEN 1 AND 120`),
    check("outbox_events_payload_ck", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check("outbox_events_attempt_ck", sql`${table.attemptCount} >= 0`),
    check("outbox_events_lease_ck", sql`(${table.leaseOwner} IS NULL) = (${table.leaseExpiresAt} IS NULL)`),
    check("outbox_events_delivered_ck", sql`${table.status} <> 'delivered' OR ${table.deliveredAt} IS NOT NULL`),
  ],
);

export const emailRecipientProfiles = pgTable(
  "email_recipient_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    recipientCiphertext: text("recipient_ciphertext").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    socialAccessEnabled: boolean("social_access_enabled").default(true).notNull(),
    ...timestamps(),
  },
  (table) => [
    check(
      "email_recipient_profiles_ciphertext_ck",
      sql`${table.recipientCiphertext} LIKE 'v1.%' AND char_length(${table.recipientCiphertext}) <= 2048`,
    ),
    check(
      "email_recipient_profiles_hash_ck",
      sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const deletionJobs = pgTable(
  "deletion_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: deletionKindEnum("kind").notNull(),
    targetId: uuid("target_id").notNull(),
    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    status: deletionStatusEnum("status").default("requested").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    retentionPolicyVersion: text("retention_policy_version").notNull(),
    assetManifestSha256: text("asset_manifest_sha256"),
    activeOrderCount: integer("active_order_count").default(0).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("deletion_jobs_idempotency_uq").on(table.idempotencyKey),
    uniqueIndex("deletion_jobs_active_target_uq")
      .on(table.kind, table.targetId)
      .where(sql`${table.status} NOT IN ('completed', 'dead_letter')`),
    index("deletion_jobs_claim_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
    check("deletion_jobs_manifest_ck", sql`${table.assetManifestSha256} IS NULL OR ${table.assetManifestSha256} ~ '^[0-9a-f]{64}$'`),
    check("deletion_jobs_counts_ck", sql`${table.activeOrderCount} >= 0 AND ${table.attemptCount} >= 0`),
    check("deletion_jobs_lease_ck", sql`(${table.leaseOwner} IS NULL) = (${table.leaseExpiresAt} IS NULL)`),
    check("deletion_jobs_completed_ck", sql`${table.status} <> 'completed' OR ${table.completedAt} IS NOT NULL`),
  ],
);

export const deletionAssets = pgTable(
  "deletion_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deletionJobId: uuid("deletion_job_id")
      .notNull()
      .references(() => deletionJobs.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    storageProvider: text("storage_provider").notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    expectedSha256: text("expected_sha256"),
    status: deletionAssetStatusEnum("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("deletion_assets_job_object_uq").on(
      table.deletionJobId,
      table.storageProvider,
      table.bucket,
      table.objectKey,
    ),
    index("deletion_assets_status_idx").on(table.deletionJobId, table.status),
    check("deletion_assets_object_key_ck", sql`length(${table.objectKey}) BETWEEN 1 AND 1024 AND ${table.objectKey} !~ '(^|/)\.\.(/|$)'`),
    check("deletion_assets_sha_ck", sql`${table.expectedSha256} IS NULL OR ${table.expectedSha256} ~ '^[0-9a-f]{64}$'`),
    check("deletion_assets_attempt_ck", sql`${table.attemptCount} >= 0`),
    check("deletion_assets_verified_ck", sql`${table.status} <> 'verified' OR ${table.verifiedAt} IS NOT NULL`),
  ],
);

export const appRoleGrants = pgTable(
  "app_role_grants",
  {
    id: uuid("id").primaryKey(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    role: appRoleKindEnum("role").notNull(),
    operatorReference: text("operator_reference").notNull(),
    reasonCode: text("reason_code").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationOperationId: uuid("revocation_operation_id"),
    revokedOperatorReference: text("revoked_operator_reference"),
    revokedReasonCode: text("revoked_reason_code"),
    version: integer("version").default(1).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("app_role_grants_active_user_idx")
      .on(table.appUserId, table.role, table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
    uniqueIndex("app_role_grants_revocation_operation_uq")
      .on(table.revocationOperationId)
      .where(sql`${table.revocationOperationId} IS NOT NULL`),
    check("app_role_grants_operator_reference_ck", sql`${table.operatorReference} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{2,119}$'`),
    check("app_role_grants_reason_code_ck", sql`${table.reasonCode} ~ '^[a-z][a-z0-9_.-]{2,79}$'`),
    check("app_role_grants_window_ck", sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.startsAt}`),
    check("app_role_grants_version_ck", sql`${table.version} > 0`),
  ],
);

export const moderationReports = pgTable(
  "moderation_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id").references(() => appUsers.id, { onDelete: "set null" }),
    reporterContactCiphertext: text("reporter_contact_ciphertext"),
    contactHash: text("contact_hash"),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    detailsCiphertext: text("details_ciphertext"),
    targetSnapshotCiphertext: text("target_snapshot_ciphertext"),
    urgency: text("urgency").default("normal").notNull(),
    status: moderationReportStatusEnum("status").default("open").notNull(),
    assignedToId: uuid("assigned_to_id").references(() => appUsers.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    sourceFingerprintHash: text("source_fingerprint_hash"),
    policyVersion: text("policy_version"),
    route: text("route"),
    receiptCode: text("receipt_code"),
    version: integer("version").default(1).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("moderation_reports_queue_idx").on(table.status, table.urgency, table.createdAt),
    index("moderation_reports_target_idx").on(table.targetType, table.targetId, table.createdAt),
    uniqueIndex("moderation_reports_idempotency_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("moderation_reports_receipt_code_uq")
      .on(table.receiptCode)
      .where(sql`${table.receiptCode} IS NOT NULL`),
    index("moderation_reports_source_created_idx")
      .on(table.sourceFingerprintHash, table.createdAt)
      .where(sql`${table.sourceFingerprintHash} IS NOT NULL`),
    check("moderation_reports_target_type_ck", sql`${table.targetType} IN ('profile', 'project', 'update', 'media', 'comment')`),
    check("moderation_reports_reason_ck", sql`char_length(btrim(${table.reason})) BETWEEN 1 AND 80`),
    check("moderation_reports_details_ck", sql`${table.details} IS NULL OR char_length(${table.details}) <= 5000`),
    check("moderation_reports_request_hash_ck", sql`${table.requestHash} IS NULL OR ${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("moderation_reports_contact_hash_ck", sql`${table.contactHash} IS NULL OR ${table.contactHash} ~ '^[0-9a-f]{64}$'`),
    check("moderation_reports_source_hash_ck", sql`${table.sourceFingerprintHash} IS NULL OR ${table.sourceFingerprintHash} ~ '^[0-9a-f]{64}$'`),
    check("moderation_reports_contact_pair_ck", sql`(${table.reporterContactCiphertext} IS NULL) = (${table.contactHash} IS NULL)`),
    check("moderation_reports_details_storage_ck", sql`${table.details} IS NULL OR ${table.detailsCiphertext} IS NULL`),
    check("moderation_reports_policy_version_ck", sql`${table.policyVersion} IS NULL OR ${table.policyVersion} ~ '^[A-Za-z0-9._-]{1,80}$'`),
    check("moderation_reports_route_safe_ck", sql`${table.route} IS NULL OR (char_length(${table.route}) <= 500 AND ${table.route} ~ '^/([A-Za-z0-9._~-]+/?)*$')`),
    check("moderation_reports_receipt_code_ck", sql`${table.receiptCode} IS NULL OR ${table.receiptCode} ~ '^MELD-[A-Z0-9]{8}$'`),
    check("moderation_reports_envelope_ck", sql`(${table.reporterContactCiphertext} IS NULL OR ${table.reporterContactCiphertext} LIKE 'v1.%') AND (${table.detailsCiphertext} IS NULL OR ${table.detailsCiphertext} LIKE 'v1.%') AND (${table.targetSnapshotCiphertext} IS NULL OR ${table.targetSnapshotCiphertext} LIKE 'v1.%')`),
    check("moderation_reports_api_shape_ck", sql`${table.idempotencyKey} IS NULL OR (${table.requestHash} IS NOT NULL AND ${table.sourceFingerprintHash} IS NOT NULL AND ${table.targetSnapshotCiphertext} IS NOT NULL AND ${table.policyVersion} IS NOT NULL AND ${table.receiptCode} IS NOT NULL)`),
    check("moderation_reports_urgency_ck", sql`${table.urgency} IN ('normal', 'high', 'urgent')`),
    check("moderation_reports_version_ck", sql`${table.version} > 0`),
    check("moderation_reports_resolution_ck", sql`${table.status} NOT IN ('resolved', 'dismissed') OR ${table.resolvedAt} IS NOT NULL`),
  ],
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => moderationReports.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    kind: moderationActionKindEnum("kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason"),
    reasonCiphertext: text("reason_ciphertext"),
    actorRole: appRoleKindEnum("actor_role").default("moderator").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    expectedReportVersion: integer("expected_report_version"),
    reportVersion: integer("report_version").default(1).notNull(),
    reversesActionId: uuid("reverses_action_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reversedByActionId: uuid("reversed_by_action_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "moderation_actions_reversal_fk",
      columns: [table.reversedByActionId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "moderation_actions_reverses_fk",
      columns: [table.reversesActionId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    index("moderation_actions_report_idx").on(table.reportId, table.createdAt),
    index("moderation_actions_target_idx").on(table.targetType, table.targetId, table.createdAt),
    uniqueIndex("moderation_actions_idempotency_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("moderation_actions_reverses_idx")
      .on(table.reversesActionId)
      .where(sql`${table.reversesActionId} IS NOT NULL`),
    check("moderation_actions_target_type_ck", sql`${table.targetType} IN ('profile', 'project', 'update', 'media', 'comment')`),
    check("moderation_actions_reason_storage_ck", sql`(${table.reason} IS NOT NULL AND ${table.reasonCiphertext} IS NULL AND char_length(btrim(${table.reason})) BETWEEN 1 AND 1000) OR (${table.reason} IS NULL AND ${table.reasonCiphertext} IS NOT NULL AND ${table.reasonCiphertext} LIKE 'v1.%' AND char_length(${table.reasonCiphertext}) <= 16000)`),
    check("moderation_actions_request_hash_ck", sql`${table.requestHash} IS NULL OR ${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("moderation_actions_not_self_reverse_ck", sql`${table.reversedByActionId} IS NULL OR ${table.reversedByActionId} <> ${table.id}`),
  ],
);

export const moderationTargetStates = pgTable(
  "moderation_target_states",
  {
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    state: moderationTargetStateKindEnum("state").notNull(),
    currentActionId: uuid("current_action_id")
      .notNull()
      .references(() => moderationActions.id, { onDelete: "restrict" }),
    version: integer("version").default(1).notNull(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.targetType, table.targetId] }),
    index("moderation_target_states_hidden_idx")
      .on(table.targetType, table.targetId)
      .where(sql`${table.state} = 'hidden'`),
    check("moderation_target_states_type_ck", sql`${table.targetType} IN ('profile', 'project', 'update', 'media', 'comment')`),
    check("moderation_target_states_state_ck", sql`(${table.state} = 'hidden' AND ${table.hiddenAt} IS NOT NULL AND ${table.restoredAt} IS NULL) OR (${table.state} = 'visible' AND ${table.restoredAt} IS NOT NULL)`),
    check("moderation_target_states_version_ck", sql`${table.version} > 0`),
  ],
);

export const moderationAccountRestrictions = pgTable(
  "moderation_account_restrictions",
  {
    appUserId: uuid("app_user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    kind: moderationAccountRestrictionKindEnum("kind").notNull(),
    currentActionId: uuid("current_action_id")
      .notNull()
      .unique()
      .references(() => moderationActions.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorKind: auditActorKindEnum("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    requestId: text("request_id"),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_resource_idx").on(table.resourceType, table.resourceId, table.createdAt),
    index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_events_request_idx").on(table.requestId),
    check("audit_events_action_ck", sql`char_length(btrim(${table.action})) BETWEEN 1 AND 120`),
    check("audit_events_resource_type_ck", sql`char_length(btrim(${table.resourceType})) BETWEEN 1 AND 80`),
    check("audit_events_ip_hash_ck", sql`${table.ipHash} IS NULL OR ${table.ipHash} ~ '^[0-9a-f]{64}$'`),
    check("audit_events_ua_hash_ck", sql`${table.userAgentHash} IS NULL OR ${table.userAgentHash} ~ '^[0-9a-f]{64}$'`),
    check("audit_events_metadata_ck", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);

export const betaInvites = pgTable(
  "beta_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    emailHash: text("email_hash"),
    status: betaInviteStatusEnum("status").default("active").notNull(),
    maxUses: integer("max_uses").default(1).notNull(),
    useCount: integer("use_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdById: uuid("created_by_id").references(() => appUsers.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("beta_invites_code_hash_uq").on(table.codeHash),
    index("beta_invites_status_expiry_idx").on(table.status, table.expiresAt),
    check("beta_invites_code_hash_ck", sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`),
    check("beta_invites_email_hash_ck", sql`${table.emailHash} IS NULL OR ${table.emailHash} ~ '^[0-9a-f]{64}$'`),
    check("beta_invites_usage_ck", sql`${table.maxUses} > 0 AND ${table.useCount} BETWEEN 0 AND ${table.maxUses}`),
    check("beta_invites_metadata_ck", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);

export const betaInviteRedemptions = pgTable(
  "beta_invite_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    inviteId: uuid("invite_id")
      .notNull()
      .references(() => betaInvites.id, { onDelete: "restrict" }),
    appUserId: uuid("app_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    authUserId: text("auth_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    reservationTokenHash: text("reservation_token_hash").notNull(),
    status: betaRedemptionStatusEnum("status").default("reserved").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).defaultNow().notNull(),
    reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }).notNull(),
    provider: text("provider"),
    emailHash: text("email_hash"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("beta_invite_redemptions_token_uq").on(table.reservationTokenHash),
    uniqueIndex("beta_invite_redemptions_invite_app_user_uq").on(table.inviteId, table.appUserId),
    uniqueIndex("beta_invite_redemptions_idempotency_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("beta_invite_redemptions_status_expiry_idx").on(table.status, table.reservationExpiresAt),
    check("beta_invite_redemptions_token_ck", sql`${table.reservationTokenHash} ~ '^[0-9a-f]{64}$'`),
    check("beta_invite_redemptions_expiry_ck", sql`${table.reservationExpiresAt} > ${table.reservedAt}`),
    check("beta_invite_redemptions_provider_ck", sql`${table.provider} IS NULL OR ${table.provider} IN ('email', 'google')`),
    check("beta_invite_redemptions_email_hash_ck", sql`${table.emailHash} IS NULL OR ${table.emailHash} ~ '^[0-9a-f]{64}$'`),
    check("beta_invite_redemptions_idempotency_ck", sql`${table.idempotencyKey} IS NULL OR ${table.idempotencyKey} ~ '^beta-reservation:v1:[0-9a-f-]{36}$'`),
    check("beta_invite_redemptions_request_hash_ck", sql`${table.requestHash} IS NULL OR ${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("beta_invite_redemptions_runtime_shape_ck", sql`${table.idempotencyKey} IS NULL OR (${table.provider} IS NOT NULL AND ${table.requestHash} IS NOT NULL AND (${table.provider} <> 'email' OR ${table.emailHash} IS NOT NULL))`),
    check("beta_invite_redemptions_completion_ck", sql`${table.status} <> 'completed' OR (${table.completedAt} IS NOT NULL AND ${table.appUserId} IS NOT NULL AND ${table.authUserId} IS NOT NULL)`),
  ],
);

export const productEvents = pgTable(
  "product_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventName: text("event_name").notNull(),
    eventKey: text("event_key").notNull(),
    subjectHash: text("subject_hash"),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({ schemaVersion: 1 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_events_event_key_uq").on(table.eventKey),
    index("product_events_name_occurred_idx").on(table.eventName, table.occurredAt, table.id),
    index("product_events_subject_occurred_idx")
      .on(table.subjectHash, table.occurredAt)
      .where(sql`${table.subjectHash} IS NOT NULL`),
    check("product_events_event_name_ck", sql`${table.eventName} IN ('signup_started','signup_completed','onboarding_completed','project_created','first_update_created','photo_upload_completed','project_shared','follow_requested','follow_accepted','comment_created','photobook_opened','photobook_draft_generated','proof_generated','proof_approved','checkout_started','checkout_completed','feedback_submitted','error_encountered')`),
    check("product_events_event_key_ck", sql`char_length(${table.eventKey}) BETWEEN 16 AND 180 AND ${table.eventKey} ~ '^[A-Za-z0-9:_-]+$'`),
    check("product_events_subject_hash_ck", sql`${table.subjectHash} IS NULL OR ${table.subjectHash} ~ '^[0-9a-f]{64}$'`),
    check("product_events_properties_ck", sql`jsonb_typeof(${table.properties}) = 'object' AND ${table.properties} ? 'schemaVersion' AND ${table.properties}->'schemaVersion' = '1'::jsonb`),
    check("product_events_exact_properties_ck", sql`public.app_product_event_properties_valid(${table.eventName}, ${table.properties})`),
    check("product_events_time_ck", sql`${table.occurredAt} <= ${table.createdAt} + interval '5 minutes'`),
  ],
);

export const feedbackSubmissions = pgTable(
  "feedback_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submittedById: uuid("submitted_by_id").references(() => appUsers.id, { onDelete: "set null" }),
    kind: text("kind").default("feedback").notNull(),
    category: text("category").notNull(),
    message: text("message"),
    messageCiphertext: text("message_ciphertext"),
    contactCiphertext: text("contact_ciphertext"),
    contactHash: text("contact_hash"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    sourceFingerprintHash: text("source_fingerprint_hash"),
    route: text("route"),
    status: feedbackStatusEnum("status").default("new").notNull(),
    screenshotAssetId: uuid("screenshot_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    userAgentFamily: text("user_agent_family"),
    privacyNoticeVersion: text("privacy_notice_version"),
    receiptCode: text("receipt_code"),
    assignedToId: uuid("assigned_to_id").references(() => appUsers.id, { onDelete: "set null" }),
    version: integer("version").default(1).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index("feedback_submissions_status_idx").on(table.status, table.createdAt),
    index("feedback_submissions_user_idx").on(table.submittedById, table.createdAt),
    uniqueIndex("feedback_submissions_idempotency_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("feedback_submissions_receipt_code_uq")
      .on(table.receiptCode)
      .where(sql`${table.receiptCode} IS NOT NULL`),
    index("feedback_submissions_source_created_idx")
      .on(table.sourceFingerprintHash, table.createdAt)
      .where(sql`${table.sourceFingerprintHash} IS NOT NULL`),
    check("feedback_submissions_kind_ck", sql`${table.kind} IN ('feedback', 'support', 'third_party_request', 'appeal')`),
    check("feedback_submissions_category_ck", sql`char_length(btrim(${table.category})) BETWEEN 1 AND 80`),
    check("feedback_submissions_message_ck", sql`${table.message} IS NULL OR char_length(btrim(${table.message})) BETWEEN 1 AND 5000`),
    check("feedback_submissions_message_storage_ck", sql`(${table.message} IS NOT NULL OR ${table.messageCiphertext} IS NOT NULL) AND NOT (${table.message} IS NOT NULL AND ${table.messageCiphertext} IS NOT NULL)`),
    check("feedback_submissions_contact_pair_ck", sql`(${table.contactCiphertext} IS NULL) = (${table.contactHash} IS NULL)`),
    check("feedback_submissions_contact_hash_ck", sql`${table.contactHash} IS NULL OR ${table.contactHash} ~ '^[0-9a-f]{64}$'`),
    check("feedback_submissions_request_hash_ck", sql`${table.requestHash} IS NULL OR ${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("feedback_submissions_source_hash_ck", sql`${table.sourceFingerprintHash} IS NULL OR ${table.sourceFingerprintHash} ~ '^[0-9a-f]{64}$'`),
    check("feedback_submissions_privacy_version_ck", sql`${table.privacyNoticeVersion} IS NULL OR ${table.privacyNoticeVersion} ~ '^[A-Za-z0-9._-]{1,80}$'`),
    check("feedback_submissions_receipt_code_ck", sql`${table.receiptCode} IS NULL OR ${table.receiptCode} ~ '^HELP-[A-Z0-9]{8}$'`),
    check("feedback_submissions_envelope_ck", sql`(${table.messageCiphertext} IS NULL OR ${table.messageCiphertext} LIKE 'v1.%') AND (${table.contactCiphertext} IS NULL OR ${table.contactCiphertext} LIKE 'v1.%')`),
    check("feedback_submissions_api_shape_ck", sql`${table.idempotencyKey} IS NULL OR (${table.requestHash} IS NOT NULL AND ${table.sourceFingerprintHash} IS NOT NULL AND ${table.messageCiphertext} IS NOT NULL AND ${table.privacyNoticeVersion} IS NOT NULL AND ${table.receiptCode} IS NOT NULL)`),
    check("feedback_submissions_route_ck", sql`${table.route} IS NULL OR char_length(${table.route}) <= 500`),
    check("feedback_submissions_version_ck", sql`${table.version} > 0`),
    check("feedback_submissions_resolution_ck", sql`${table.status} NOT IN ('resolved', 'closed') OR ${table.resolvedAt} IS NOT NULL`),
  ],
);

export const feedbackSubmissionReviews = pgTable(
  "feedback_submission_reviews",
  {
    id: uuid("id").primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => feedbackSubmissions.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    actorRole: appRoleKindEnum("actor_role").notNull(),
    fromStatus: feedbackStatusEnum("from_status").notNull(),
    toStatus: feedbackStatusEnum("to_status").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    submissionVersion: integer("submission_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_submission_reviews_submission_idx").on(
      table.submissionId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("feedback_submission_reviews_idempotency_uq").on(table.idempotencyKey),
    check("feedback_submission_reviews_transition_ck", sql`${table.fromStatus} <> ${table.toStatus}`),
    check("feedback_submission_reviews_versions_ck", sql`${table.expectedVersion} > 0 AND ${table.submissionVersion} = ${table.expectedVersion} + 1`),
    check("feedback_submission_reviews_idempotency_ck", sql`${table.idempotencyKey} ~ '^feedback-admin-command:v1:[0-9a-f]{64}$'`),
    check("feedback_submission_reviews_request_hash_ck", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("feedback_submission_reviews_request_id_ck", sql`${table.requestId} ~ '^[0-9a-f-]{36}$'`),
  ],
);

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboxEventId: uuid("outbox_event_id")
      .notNull()
      .references(() => outboxEvents.id, { onDelete: "restrict" }),
    recipientUserId: uuid("recipient_user_id").references(() => appUsers.id, { onDelete: "set null" }),
    recipientHash: text("recipient_hash").notNull(),
    provider: text("provider").default("brevo").notNull(),
    providerMessageId: text("provider_message_id"),
    templateKey: text("template_key").notNull(),
    templateVersion: text("template_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: emailDeliveryStatusEnum("status").default("queued").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("email_deliveries_idempotency_uq").on(table.idempotencyKey),
    uniqueIndex("email_deliveries_provider_message_uq").on(table.provider, table.providerMessageId),
    index("email_deliveries_status_idx").on(table.status, table.updatedAt),
    check("email_deliveries_recipient_hash_ck", sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`),
    check("email_deliveries_attempt_ck", sql`${table.attemptCount} >= 0`),
    check("email_deliveries_metadata_ck", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check("email_deliveries_delivery_ck", sql`${table.status} <> 'delivered' OR ${table.deliveredAt} IS NOT NULL`),
  ],
);

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: exportJobStatusEnum("status").default("requested").notNull(),
    format: text("format").default("json").notNull(),
    includeMedia: boolean("include_media").default(false).notNull(),
    exportAssetId: uuid("export_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    manifestSha256: text("manifest_sha256"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("export_jobs_idempotency_uq").on(table.idempotencyKey),
    index("export_jobs_user_idx").on(table.userId, table.createdAt),
    index("export_jobs_status_idx").on(table.status, table.createdAt),
    index("export_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
      table.createdAt,
    ),
    check("export_jobs_format_ck", sql`${table.format} IN ('json', 'zip')`),
    check("export_jobs_manifest_ck", sql`${table.manifestSha256} IS NULL OR ${table.manifestSha256} ~ '^[0-9a-f]{64}$'`),
    check("export_jobs_attempt_ck", sql`${table.attemptCount} >= 0`),
    check("export_jobs_lease_ck", sql`(${table.leaseOwner} IS NULL) = (${table.leaseExpiresAt} IS NULL)`),
    check("export_jobs_ready_ck", sql`${table.status} <> 'ready' OR (${table.exportAssetId} IS NOT NULL AND ${table.manifestSha256} IS NOT NULL AND ${table.expiresAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL)`),
  ],
);

import { integer, pgEnum, timestamp } from "drizzle-orm/pg-core";

export const appUserStatusEnum = pgEnum("app_user_status", [
  "active",
  "suspended",
  "deletion_pending",
  "deleted",
]);

export const identityMigrationStatusEnum = pgEnum("identity_migration_status", [
  "pending",
  "linked",
  "requires_reset",
  "failed",
]);

export const projectVisibilityEnum = pgEnum("project_visibility", ["private", "public"]);
export const projectLifecycleStatusEnum = pgEnum("project_lifecycle_status", [
  "active",
  "deletion_pending",
  "deleted",
]);

export const accessRequestStatusEnum = pgEnum("access_request_status", [
  "pending",
  "accepted",
  "rejected",
  "revoked",
  "cancelled",
]);

export const followerStatusEnum = pgEnum("follower_status", ["active", "muted", "revoked"]);
export const relationshipKindEnum = pgEnum("relationship_kind", ["follow", "block"]);
export const relationshipStatusEnum = pgEnum("relationship_status", [
  "pending",
  "active",
  "rejected",
  "revoked",
]);

export const updateStatusEnum = pgEnum("update_status", [
  "draft",
  "published",
  "deletion_pending",
  "deleted",
]);

export const mediaPurposeEnum = pgEnum("media_purpose", [
  "avatar",
  "project_media",
  "project_cover",
  "floorplan",
  "photobook_pdf",
  "export_archive",
  "temporary_upload",
]);

export const mediaStatusEnum = pgEnum("media_status", [
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "quarantined",
  "deletion_pending",
  "deleted",
  "failed",
]);

export const updateMediaRoleEnum = pgEnum("update_media_role", ["gallery", "before", "after"]);
export const commentStatusEnum = pgEnum("comment_status", ["published", "hidden", "deleted"]);
export const reactionTargetEnum = pgEnum("reaction_target", ["update", "comment"]);
export const notificationStatusEnum = pgEnum("notification_status", ["unread", "read", "archived"]);

export const budgetItemKindEnum = pgEnum("budget_item_kind", ["planned", "actual"]);

export const photobookDraftStatusEnum = pgEnum("photobook_draft_status", [
  "draft",
  "rendering",
  "ready",
  "archived",
]);

export const photobookExclusionTargetEnum = pgEnum("photobook_exclusion_target", [
  "update",
  "media",
  "chapter",
]);

export const photobookProofStatusEnum = pgEnum("photobook_proof_status", [
  "draft",
  "rendering",
  "ready",
  "approved",
  "locked",
  "invalidated",
  "failed",
]);

export const photobookOrderStatusEnum = pgEnum("photobook_order_status", [
  "draft",
  "awaiting_payment",
  "checkout_open",
  "paid",
  "payment_failed",
  "expired",
  "cancelled",
  "manual_review",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "processing",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
]);

export const fulfilmentStatusEnum = pgEnum("fulfilment_status", [
  "unclaimed",
  "claimed",
  "peecho_order_created",
  "peecho_payment_pending",
  "submitted_to_production",
  "in_production",
  "shipped",
  "delivered",
  "failed",
  "retry_scheduled",
  "manual_review",
  "cancelled",
]);

export const providerInboxStatusEnum = pgEnum("provider_inbox_status", [
  "received",
  "claimed",
  "applied",
  "ignored",
  "retry",
  "dead_letter",
]);

export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "claimed",
  "delivered",
  "retry",
  "dead_letter",
]);

export const deletionKindEnum = pgEnum("deletion_kind", ["project", "account", "update", "media"]);
export const deletionStatusEnum = pgEnum("deletion_status", [
  "requested",
  "blocked_active_order",
  "deletion_pending",
  "database_redaction",
  "storage_cleanup",
  "verification",
  "completed",
  "retry_scheduled",
  "manual_review",
  "dead_letter",
]);

export const deletionAssetStatusEnum = pgEnum("deletion_asset_status", [
  "pending",
  "deleted",
  "verified",
  "retry",
  "failed",
]);

export const moderationReportStatusEnum = pgEnum("moderation_report_status", [
  "open",
  "triaged",
  "investigating",
  "resolved",
  "dismissed",
]);

export const moderationActionKindEnum = pgEnum("moderation_action_kind", [
  "hide",
  "restore",
  "warn",
  "suspend",
  "block",
  "dismiss",
  "resolve",
]);

export const appRoleKindEnum = pgEnum("app_role_kind", ["moderator", "admin"]);
export const moderationTargetStateKindEnum = pgEnum("moderation_target_state_kind", [
  "hidden",
  "visible",
]);
export const moderationAccountRestrictionKindEnum = pgEnum(
  "moderation_account_restriction_kind",
  ["suspended", "blocked"],
);

export const auditActorKindEnum = pgEnum("audit_actor_kind", ["user", "admin", "system", "provider"]);
export const betaInviteStatusEnum = pgEnum("beta_invite_status", ["active", "exhausted", "expired", "revoked"]);
export const betaRedemptionStatusEnum = pgEnum("beta_redemption_status", [
  "reserved",
  "completed",
  "expired",
  "revoked",
]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["new", "triaged", "planned", "resolved", "closed"]);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "queued",
  "submitted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "complained",
]);
export const exportJobStatusEnum = pgEnum("export_job_status", [
  "requested",
  "processing",
  "retry_scheduled",
  "ready",
  "expired",
  "failed",
  "dead_letter",
  "deleted",
]);

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const optimisticVersion = () => integer("version").default(1).notNull();

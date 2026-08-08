CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'accepted', 'rejected', 'revoked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."app_user_status" AS ENUM('active', 'suspended', 'deletion_pending', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_kind" AS ENUM('user', 'admin', 'system', 'provider');--> statement-breakpoint
CREATE TYPE "public"."beta_invite_status" AS ENUM('active', 'exhausted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."beta_redemption_status" AS ENUM('reserved', 'completed', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."budget_item_kind" AS ENUM('planned', 'actual');--> statement-breakpoint
CREATE TYPE "public"."comment_status" AS ENUM('published', 'hidden', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."deletion_asset_status" AS ENUM('pending', 'deleted', 'verified', 'retry', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deletion_kind" AS ENUM('project', 'account', 'update', 'media');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('requested', 'blocked_active_order', 'deletion_pending', 'database_redaction', 'storage_cleanup', 'verification', 'completed', 'retry_scheduled', 'manual_review', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."email_delivery_status" AS ENUM('queued', 'submitted', 'delivered', 'deferred', 'bounced', 'failed', 'complained');--> statement-breakpoint
CREATE TYPE "public"."export_job_status" AS ENUM('requested', 'processing', 'ready', 'expired', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'planned', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."follower_status" AS ENUM('active', 'muted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."fulfilment_status" AS ENUM('unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending', 'submitted_to_production', 'in_production', 'shipped', 'delivered', 'failed', 'retry_scheduled', 'manual_review', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."identity_migration_status" AS ENUM('pending', 'linked', 'requires_reset', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_purpose" AS ENUM('avatar', 'project_media', 'project_cover', 'floorplan', 'photobook_pdf', 'export_archive', 'temporary_upload');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'quarantined', 'deletion_pending', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."moderation_action_kind" AS ENUM('hide', 'restore', 'warn', 'suspend', 'block', 'dismiss');--> statement-breakpoint
CREATE TYPE "public"."moderation_report_status" AS ENUM('open', 'triaged', 'investigating', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('unread', 'read', 'archived');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'claimed', 'delivered', 'retry', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'processing', 'paid', 'partially_refunded', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."photobook_draft_status" AS ENUM('draft', 'rendering', 'ready', 'archived');--> statement-breakpoint
CREATE TYPE "public"."photobook_exclusion_target" AS ENUM('update', 'media', 'chapter');--> statement-breakpoint
CREATE TYPE "public"."photobook_order_status" AS ENUM('draft', 'awaiting_payment', 'checkout_open', 'paid', 'payment_failed', 'expired', 'cancelled', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."photobook_proof_status" AS ENUM('draft', 'rendering', 'ready', 'approved', 'locked', 'invalidated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."project_lifecycle_status" AS ENUM('active', 'deletion_pending', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."provider_inbox_status" AS ENUM('received', 'claimed', 'applied', 'ignored', 'retry', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."reaction_target" AS ENUM('update', 'comment');--> statement-breakpoint
CREATE TYPE "public"."relationship_kind" AS ENUM('follow', 'block');--> statement-breakpoint
CREATE TYPE "public"."relationship_status" AS ENUM('pending', 'active', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."update_media_role" AS ENUM('gallery', 'before', 'after');--> statement-breakpoint
CREATE TYPE "public"."update_status" AS ENUM('draft', 'published', 'deletion_pending', 'deleted');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "app_user_status" DEFAULT 'active' NOT NULL,
	"authz_version" bigint DEFAULT 1 NOT NULL,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"privacy_version" text,
	"privacy_accepted_at" timestamp with time zone,
	"last_authenticated_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_version_positive" CHECK ("app_users"."authz_version" > 0 AND "app_users"."version" > 0),
	CONSTRAINT "app_users_terms_pair_ck" CHECK (("app_users"."terms_version" IS NULL) = ("app_users"."terms_accepted_at" IS NULL)),
	CONSTRAINT "app_users_privacy_pair_ck" CHECK (("app_users"."privacy_version" IS NULL) = ("app_users"."privacy_accepted_at" IS NULL)),
	CONSTRAINT "app_users_deleted_state_ck" CHECK (("app_users"."status" = 'deleted') = ("app_users"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_identity_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_user_id" uuid NOT NULL,
	"auth_user_id" text,
	"legacy_provider" text,
	"legacy_subject_id" text,
	"migration_status" "identity_migration_status" DEFAULT 'pending' NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identity_mappings_source_ck" CHECK ("auth_identity_mappings"."auth_user_id" IS NOT NULL OR ("auth_identity_mappings"."legacy_provider" IS NOT NULL AND "auth_identity_mappings"."legacy_subject_id" IS NOT NULL)),
	CONSTRAINT "auth_identity_mappings_legacy_pair_ck" CHECK (("auth_identity_mappings"."legacy_provider" IS NULL) = ("auth_identity_mappings"."legacy_subject_id" IS NULL)),
	CONSTRAINT "auth_identity_mappings_provider_nonempty" CHECK ("auth_identity_mappings"."legacy_provider" IS NULL OR length(btrim("auth_identity_mappings"."legacy_provider")) > 0),
	CONSTRAINT "auth_identity_mappings_subject_nonempty" CHECK ("auth_identity_mappings"."legacy_subject_id" IS NULL OR length(btrim("auth_identity_mappings"."legacy_subject_id")) > 0),
	CONSTRAINT "auth_identity_mappings_linked_ck" CHECK ("auth_identity_mappings"."migration_status" <> 'linked' OR ("auth_identity_mappings"."auth_user_id" IS NOT NULL AND "auth_identity_mappings"."linked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"update_id" uuid,
	"created_by_id" uuid NOT NULL,
	"kind" "budget_item_kind" NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"amount_minor" integer NOT NULL,
	"occurred_on" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_items_category_ck" CHECK (char_length(btrim("budget_items"."category")) BETWEEN 1 AND 80),
	CONSTRAINT "budget_items_description_ck" CHECK ("budget_items"."description" IS NULL OR char_length("budget_items"."description") <= 500),
	CONSTRAINT "budget_items_amount_ck" CHECK ("budget_items"."amount_minor" >= 0),
	CONSTRAINT "budget_items_sort_version_ck" CHECK ("budget_items"."sort_order" >= 0 AND "budget_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"planned_amount_minor" integer DEFAULT 0 NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budgets_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "project_budgets_currency_ck" CHECK ("project_budgets"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "project_budgets_amount_ck" CHECK ("project_budgets"."planned_amount_minor" >= 0),
	CONSTRAINT "project_budgets_version_ck" CHECK ("project_budgets"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "floorplan_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"x" numeric(6, 5) NOT NULL,
	"y" numeric(6, 5) NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floorplan_pins_x_ck" CHECK ("floorplan_pins"."x" BETWEEN 0 AND 1),
	CONSTRAINT "floorplan_pins_y_ck" CHECK ("floorplan_pins"."y" BETWEEN 0 AND 1),
	CONSTRAINT "floorplan_pins_label_ck" CHECK ("floorplan_pins"."label" IS NULL OR char_length("floorplan_pins"."label") <= 80)
);
--> statement-breakpoint
CREATE TABLE "floorplans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"name" text NOT NULL,
	"floor_number" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floorplans_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "floorplans_name_ck" CHECK (char_length(btrim("floorplans"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "floorplans_sort_version_ck" CHECK ("floorplans"."sort_order" >= 0 AND "floorplans"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid,
	"original_asset_id" uuid,
	"purpose" "media_purpose" NOT NULL,
	"status" "media_status" DEFAULT 'pending_upload' NOT NULL,
	"storage_provider" text DEFAULT 'r2' NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"storage_version" text,
	"upload_idempotency_key" text NOT NULL,
	"claimed_content_type" text,
	"detected_content_type" text,
	"size_bytes" bigint,
	"sha256" text,
	"width_pixels" integer,
	"height_pixels" integer,
	"duration_milliseconds" integer,
	"exif_stripped" boolean DEFAULT false NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"focal_x" numeric(5, 4),
	"focal_y" numeric(5, 4),
	"privacy_version" integer DEFAULT 1 NOT NULL,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"failure_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "media_assets_id_owner_uq" UNIQUE("id","owner_id"),
	CONSTRAINT "media_assets_object_key_ck" CHECK (length("media_assets"."object_key") BETWEEN 1 AND 1024 AND "media_assets"."object_key" !~ '(^|/)..(/|$)'),
	CONSTRAINT "media_assets_bucket_ck" CHECK ("media_assets"."bucket" ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
	CONSTRAINT "media_assets_size_ck" CHECK ("media_assets"."size_bytes" IS NULL OR "media_assets"."size_bytes" BETWEEN 1 AND 536870912),
	CONSTRAINT "media_assets_sha_ck" CHECK ("media_assets"."sha256" IS NULL OR "media_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_assets_dimensions_ck" CHECK (("media_assets"."width_pixels" IS NULL OR "media_assets"."width_pixels" > 0) AND ("media_assets"."height_pixels" IS NULL OR "media_assets"."height_pixels" > 0)),
	CONSTRAINT "media_assets_duration_ck" CHECK ("media_assets"."duration_milliseconds" IS NULL OR "media_assets"."duration_milliseconds" >= 0),
	CONSTRAINT "media_assets_focal_x_ck" CHECK ("media_assets"."focal_x" IS NULL OR "media_assets"."focal_x" BETWEEN 0 AND 1),
	CONSTRAINT "media_assets_focal_y_ck" CHECK ("media_assets"."focal_y" IS NULL OR "media_assets"."focal_y" BETWEEN 0 AND 1),
	CONSTRAINT "media_assets_privacy_version_ck" CHECK ("media_assets"."privacy_version" > 0 AND "media_assets"."version" > 0),
	CONSTRAINT "media_assets_original_not_self_ck" CHECK ("media_assets"."original_asset_id" IS NULL OR "media_assets"."original_asset_id" <> "media_assets"."id"),
	CONSTRAINT "media_assets_project_scope_ck" CHECK (("media_assets"."purpose" IN ('avatar', 'export_archive', 'temporary_upload') AND "media_assets"."project_id" IS NULL) OR ("media_assets"."purpose" NOT IN ('avatar', 'export_archive', 'temporary_upload') AND "media_assets"."project_id" IS NOT NULL)),
	CONSTRAINT "media_assets_ready_ck" CHECK ("media_assets"."status" <> 'ready' OR ("media_assets"."ready_at" IS NOT NULL AND "media_assets"."sha256" IS NOT NULL AND "media_assets"."size_bytes" IS NOT NULL AND "media_assets"."detected_content_type" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "update_media" (
	"update_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"role" "update_media_role" DEFAULT 'gallery' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "update_media_pk" PRIMARY KEY("update_id","media_asset_id"),
	CONSTRAINT "update_media_sort_ck" CHECK ("update_media"."sort_order" >= 0),
	CONSTRAINT "update_media_caption_ck" CHECK ("update_media"."caption" IS NULL OR char_length("update_media"."caption") <= 500)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"request_id" text,
	"ip_hash" text,
	"user_agent_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_action_ck" CHECK (char_length(btrim("audit_events"."action")) BETWEEN 1 AND 120),
	CONSTRAINT "audit_events_resource_type_ck" CHECK (char_length(btrim("audit_events"."resource_type")) BETWEEN 1 AND 80),
	CONSTRAINT "audit_events_ip_hash_ck" CHECK ("audit_events"."ip_hash" IS NULL OR "audit_events"."ip_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_events_ua_hash_ck" CHECK ("audit_events"."user_agent_hash" IS NULL OR "audit_events"."user_agent_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_events_metadata_ck" CHECK (jsonb_typeof("audit_events"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "beta_invite_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"app_user_id" uuid,
	"auth_user_id" text,
	"reservation_token_hash" text NOT NULL,
	"status" "beta_redemption_status" DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_invite_redemptions_token_ck" CHECK ("beta_invite_redemptions"."reservation_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "beta_invite_redemptions_expiry_ck" CHECK ("beta_invite_redemptions"."reservation_expires_at" > "beta_invite_redemptions"."reserved_at"),
	CONSTRAINT "beta_invite_redemptions_completion_ck" CHECK ("beta_invite_redemptions"."status" <> 'completed' OR ("beta_invite_redemptions"."completed_at" IS NOT NULL AND "beta_invite_redemptions"."app_user_id" IS NOT NULL AND "beta_invite_redemptions"."auth_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "beta_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"email_hash" text,
	"status" "beta_invite_status" DEFAULT 'active' NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_invites_code_hash_ck" CHECK ("beta_invites"."code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "beta_invites_email_hash_ck" CHECK ("beta_invites"."email_hash" IS NULL OR "beta_invites"."email_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "beta_invites_usage_ck" CHECK ("beta_invites"."max_uses" > 0 AND "beta_invites"."use_count" BETWEEN 0 AND "beta_invites"."max_uses"),
	CONSTRAINT "beta_invites_metadata_ck" CHECK (jsonb_typeof("beta_invites"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "deletion_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deletion_job_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"expected_sha256" text,
	"status" "deletion_asset_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_assets_object_key_ck" CHECK (length("deletion_assets"."object_key") BETWEEN 1 AND 1024 AND "deletion_assets"."object_key" !~ '(^|/)..(/|$)'),
	CONSTRAINT "deletion_assets_sha_ck" CHECK ("deletion_assets"."expected_sha256" IS NULL OR "deletion_assets"."expected_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "deletion_assets_attempt_ck" CHECK ("deletion_assets"."attempt_count" >= 0),
	CONSTRAINT "deletion_assets_verified_ck" CHECK ("deletion_assets"."status" <> 'verified' OR "deletion_assets"."verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "deletion_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"status" "deletion_status" DEFAULT 'requested' NOT NULL,
	"idempotency_key" text NOT NULL,
	"retention_policy_version" text NOT NULL,
	"asset_manifest_sha256" text,
	"active_order_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_jobs_manifest_ck" CHECK ("deletion_jobs"."asset_manifest_sha256" IS NULL OR "deletion_jobs"."asset_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "deletion_jobs_counts_ck" CHECK ("deletion_jobs"."active_order_count" >= 0 AND "deletion_jobs"."attempt_count" >= 0),
	CONSTRAINT "deletion_jobs_lease_ck" CHECK (("deletion_jobs"."lease_owner" IS NULL) = ("deletion_jobs"."lease_expires_at" IS NULL)),
	CONSTRAINT "deletion_jobs_completed_ck" CHECK ("deletion_jobs"."status" <> 'completed' OR "deletion_jobs"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"recipient_user_id" uuid,
	"recipient_hash" text NOT NULL,
	"provider" text DEFAULT 'brevo' NOT NULL,
	"provider_message_id" text,
	"template_key" text NOT NULL,
	"template_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "email_delivery_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_recipient_hash_ck" CHECK ("email_deliveries"."recipient_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_deliveries_attempt_ck" CHECK ("email_deliveries"."attempt_count" >= 0),
	CONSTRAINT "email_deliveries_metadata_ck" CHECK (jsonb_typeof("email_deliveries"."metadata") = 'object'),
	CONSTRAINT "email_deliveries_delivery_ck" CHECK ("email_deliveries"."status" <> 'delivered' OR "email_deliveries"."delivered_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "export_job_status" DEFAULT 'requested' NOT NULL,
	"format" text DEFAULT 'json' NOT NULL,
	"include_media" boolean DEFAULT false NOT NULL,
	"export_asset_id" uuid,
	"manifest_sha256" text,
	"expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_jobs_format_ck" CHECK ("export_jobs"."format" IN ('json', 'zip')),
	CONSTRAINT "export_jobs_manifest_ck" CHECK ("export_jobs"."manifest_sha256" IS NULL OR "export_jobs"."manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "export_jobs_ready_ck" CHECK ("export_jobs"."status" <> 'ready' OR ("export_jobs"."export_asset_id" IS NOT NULL AND "export_jobs"."manifest_sha256" IS NOT NULL AND "export_jobs"."expires_at" IS NOT NULL AND "export_jobs"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "feedback_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitted_by_id" uuid,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"route" text,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"screenshot_asset_id" uuid,
	"user_agent_family" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_submissions_category_ck" CHECK (char_length(btrim("feedback_submissions"."category")) BETWEEN 1 AND 80),
	CONSTRAINT "feedback_submissions_message_ck" CHECK (char_length(btrim("feedback_submissions"."message")) BETWEEN 1 AND 5000),
	CONSTRAINT "feedback_submissions_route_ck" CHECK ("feedback_submissions"."route" IS NULL OR char_length("feedback_submissions"."route") <= 500),
	CONSTRAINT "feedback_submissions_resolution_ck" CHECK ("feedback_submissions"."status" NOT IN ('resolved', 'closed') OR "feedback_submissions"."resolved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" "moderation_action_kind" NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"reversed_by_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_reason_ck" CHECK (char_length(btrim("moderation_actions"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "moderation_actions_not_self_reverse_ck" CHECK ("moderation_actions"."reversed_by_action_id" IS NULL OR "moderation_actions"."reversed_by_action_id" <> "moderation_actions"."id")
);
--> statement-breakpoint
CREATE TABLE "moderation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"reporter_contact_ciphertext" text,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"status" "moderation_report_status" DEFAULT 'open' NOT NULL,
	"assigned_to_id" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_reports_target_type_ck" CHECK ("moderation_reports"."target_type" IN ('profile', 'project', 'update', 'media', 'comment')),
	CONSTRAINT "moderation_reports_reason_ck" CHECK (char_length(btrim("moderation_reports"."reason")) BETWEEN 1 AND 80),
	CONSTRAINT "moderation_reports_details_ck" CHECK ("moderation_reports"."details" IS NULL OR char_length("moderation_reports"."details") <= 5000),
	CONSTRAINT "moderation_reports_urgency_ck" CHECK ("moderation_reports"."urgency" IN ('normal', 'high', 'urgent')),
	CONSTRAINT "moderation_reports_version_ck" CHECK ("moderation_reports"."version" > 0),
	CONSTRAINT "moderation_reports_resolution_ck" CHECK ("moderation_reports"."status" NOT IN ('resolved', 'dismissed') OR "moderation_reports"."resolved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_aggregate_type_ck" CHECK (char_length(btrim("outbox_events"."aggregate_type")) BETWEEN 1 AND 80),
	CONSTRAINT "outbox_events_event_type_ck" CHECK (char_length(btrim("outbox_events"."event_type")) BETWEEN 1 AND 120),
	CONSTRAINT "outbox_events_payload_ck" CHECK (jsonb_typeof("outbox_events"."payload") = 'object'),
	CONSTRAINT "outbox_events_attempt_ck" CHECK ("outbox_events"."attempt_count" >= 0),
	CONSTRAINT "outbox_events_lease_ck" CHECK (("outbox_events"."lease_owner" IS NULL) = ("outbox_events"."lease_expires_at" IS NULL)),
	CONSTRAINT "outbox_events_delivered_ck" CHECK ("outbox_events"."status" <> 'delivered' OR "outbox_events"."delivered_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "provider_event_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"reference" text,
	"payload_sha256" text NOT NULL,
	"payload_ciphertext" text,
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_verified_at" timestamp with time zone NOT NULL,
	"status" "provider_inbox_status" DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"last_error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_event_inbox_provider_ck" CHECK ("provider_event_inbox"."provider" IN ('stripe', 'peecho', 'brevo')),
	CONSTRAINT "provider_event_inbox_environment_ck" CHECK ("provider_event_inbox"."environment" IN ('preview', 'staging', 'production', 'test')),
	CONSTRAINT "provider_event_inbox_event_type_ck" CHECK (char_length(btrim("provider_event_inbox"."event_type")) BETWEEN 1 AND 160),
	CONSTRAINT "provider_event_inbox_hash_ck" CHECK ("provider_event_inbox"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "provider_event_inbox_payload_ck" CHECK (jsonb_typeof("provider_event_inbox"."payload_summary") = 'object'),
	CONSTRAINT "provider_event_inbox_attempt_ck" CHECK ("provider_event_inbox"."attempt_count" >= 0),
	CONSTRAINT "provider_event_inbox_lease_ck" CHECK (("provider_event_inbox"."lease_owner" IS NULL) = ("provider_event_inbox"."lease_expires_at" IS NULL)),
	CONSTRAINT "provider_event_inbox_applied_ck" CHECK ("provider_event_inbox"."status" <> 'applied' OR "provider_event_inbox"."applied_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "photobook_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" "photobook_draft_status" DEFAULT 'draft' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"project_revision" bigint NOT NULL,
	"document" jsonb NOT NULL,
	"document_sha256" text,
	"page_count" integer,
	"selected_format" text DEFAULT 'a4-landscape-hardcover' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photobook_drafts_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "photobook_drafts_schema_revision_ck" CHECK ("photobook_drafts"."schema_version" > 0 AND "photobook_drafts"."project_revision" > 0 AND "photobook_drafts"."version" > 0),
	CONSTRAINT "photobook_drafts_document_object_ck" CHECK (jsonb_typeof("photobook_drafts"."document") = 'object'),
	CONSTRAINT "photobook_drafts_document_sha_ck" CHECK ("photobook_drafts"."document_sha256" IS NULL OR "photobook_drafts"."document_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "photobook_drafts_page_count_ck" CHECK ("photobook_drafts"."page_count" IS NULL OR "photobook_drafts"."page_count" > 0),
	CONSTRAINT "photobook_drafts_format_ck" CHECK (char_length(btrim("photobook_drafts"."selected_format")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "photobook_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" "photobook_exclusion_target" NOT NULL,
	"update_id" uuid,
	"media_asset_id" uuid,
	"chapter_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photobook_exclusions_shape_ck" CHECK (("photobook_exclusions"."target_type" = 'update' AND "photobook_exclusions"."update_id" IS NOT NULL AND "photobook_exclusions"."media_asset_id" IS NULL AND "photobook_exclusions"."chapter_key" IS NULL) OR ("photobook_exclusions"."target_type" = 'media' AND "photobook_exclusions"."update_id" IS NULL AND "photobook_exclusions"."media_asset_id" IS NOT NULL AND "photobook_exclusions"."chapter_key" IS NULL) OR ("photobook_exclusions"."target_type" = 'chapter' AND "photobook_exclusions"."update_id" IS NULL AND "photobook_exclusions"."media_asset_id" IS NULL AND "photobook_exclusions"."chapter_key" IS NOT NULL AND char_length(btrim("photobook_exclusions"."chapter_key")) > 0))
);
--> statement-breakpoint
CREATE TABLE "photobook_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_event_id" text,
	"actor_user_id" uuid,
	"from_status" text,
	"to_status" text,
	"payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photobook_order_events_source_ck" CHECK ("photobook_order_events"."source" IN ('user', 'system', 'stripe', 'peecho', 'admin')),
	CONSTRAINT "photobook_order_events_type_ck" CHECK (char_length(btrim("photobook_order_events"."event_type")) BETWEEN 1 AND 100),
	CONSTRAINT "photobook_order_events_payload_ck" CHECK (jsonb_typeof("photobook_order_events"."payload_summary") = 'object')
);
--> statement-breakpoint
CREATE TABLE "photobook_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"merchant_reference" text NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"proof_revision_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "photobook_order_status" DEFAULT 'draft' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"fulfilment_status" "fulfilment_status" DEFAULT 'unclaimed' NOT NULL,
	"currency" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"shipping_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"shipping_country" text NOT NULL,
	"customer_email_ciphertext" text,
	"shipping_details_ciphertext" text,
	"pii_encryption_key_version" integer DEFAULT 1 NOT NULL,
	"checkout_snapshot" jsonb NOT NULL,
	"seller_snapshot" jsonb NOT NULL,
	"terms_version" text NOT NULL,
	"legal_accepted_at" timestamp with time zone NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"peecho_order_id" text,
	"delivery_estimate" text,
	"fulfilment_lease_owner" text,
	"fulfilment_lease_expires_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error_code" text,
	"paid_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photobook_orders_number_ck" CHECK ("photobook_orders"."order_number" ~ '^BLD-[A-Z0-9-]{8,40}$'),
	CONSTRAINT "photobook_orders_reference_ck" CHECK (char_length("photobook_orders"."merchant_reference") BETWEEN 8 AND 100),
	CONSTRAINT "photobook_orders_currency_country_ck" CHECK ("photobook_orders"."currency" ~ '^[A-Z]{3}$' AND "photobook_orders"."shipping_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "photobook_orders_amounts_ck" CHECK ("photobook_orders"."quantity" > 0 AND "photobook_orders"."subtotal_minor" >= 0 AND "photobook_orders"."shipping_minor" >= 0 AND "photobook_orders"."tax_minor" >= 0 AND "photobook_orders"."total_minor" = "photobook_orders"."subtotal_minor" + "photobook_orders"."shipping_minor" + "photobook_orders"."tax_minor"),
	CONSTRAINT "photobook_orders_snapshots_ck" CHECK (jsonb_typeof("photobook_orders"."checkout_snapshot") = 'object' AND jsonb_typeof("photobook_orders"."seller_snapshot") = 'object'),
	CONSTRAINT "photobook_orders_lease_ck" CHECK (("photobook_orders"."fulfilment_lease_owner" IS NULL) = ("photobook_orders"."fulfilment_lease_expires_at" IS NULL)),
	CONSTRAINT "photobook_orders_retry_version_ck" CHECK ("photobook_orders"."retry_count" >= 0 AND "photobook_orders"."pii_encryption_key_version" > 0 AND "photobook_orders"."version" > 0),
	CONSTRAINT "photobook_orders_paid_ck" CHECK ("photobook_orders"."payment_status" NOT IN ('paid', 'partially_refunded', 'refunded') OR "photobook_orders"."paid_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "photobook_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "photobook_proof_status" DEFAULT 'draft' NOT NULL,
	"schema_version" integer NOT NULL,
	"project_revision" bigint NOT NULL,
	"document" jsonb NOT NULL,
	"document_sha256" text NOT NULL,
	"asset_set" jsonb NOT NULL,
	"asset_set_sha256" text NOT NULL,
	"pdf_asset_id" uuid,
	"pdf_sha256" text,
	"pdf_size_bytes" bigint,
	"page_count" integer,
	"render_engine" text NOT NULL,
	"render_version" text NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photobook_revisions_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "photobook_revisions_number_ck" CHECK ("photobook_revisions"."revision_number" > 0 AND "photobook_revisions"."schema_version" > 0 AND "photobook_revisions"."project_revision" > 0),
	CONSTRAINT "photobook_revisions_document_ck" CHECK (jsonb_typeof("photobook_revisions"."document") = 'object' AND jsonb_typeof("photobook_revisions"."asset_set") = 'array'),
	CONSTRAINT "photobook_revisions_hashes_ck" CHECK ("photobook_revisions"."document_sha256" ~ '^[0-9a-f]{64}$' AND "photobook_revisions"."asset_set_sha256" ~ '^[0-9a-f]{64}$' AND ("photobook_revisions"."pdf_sha256" IS NULL OR "photobook_revisions"."pdf_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "photobook_revisions_pdf_size_ck" CHECK ("photobook_revisions"."pdf_size_bytes" IS NULL OR "photobook_revisions"."pdf_size_bytes" > 0),
	CONSTRAINT "photobook_revisions_ready_proof_ck" CHECK ("photobook_revisions"."status" NOT IN ('ready', 'approved', 'locked') OR ("photobook_revisions"."pdf_asset_id" IS NOT NULL AND "photobook_revisions"."pdf_sha256" IS NOT NULL AND "photobook_revisions"."pdf_size_bytes" IS NOT NULL AND "photobook_revisions"."page_count" IS NOT NULL AND "photobook_revisions"."page_count" >= 24 AND mod("photobook_revisions"."page_count", 2) = 0)),
	CONSTRAINT "photobook_revisions_approval_ck" CHECK ("photobook_revisions"."status" NOT IN ('approved', 'locked') OR ("photobook_revisions"."approved_by_id" IS NOT NULL AND "photobook_revisions"."approved_by_id" = "photobook_revisions"."owner_id" AND "photobook_revisions"."approved_at" IS NOT NULL)),
	CONSTRAINT "photobook_revisions_lock_ck" CHECK ("photobook_revisions"."status" <> 'locked' OR "photobook_revisions"."locked_at" IS NOT NULL),
	CONSTRAINT "photobook_revisions_invalidation_ck" CHECK ("photobook_revisions"."status" <> 'invalidated' OR ("photobook_revisions"."invalidated_at" IS NOT NULL AND "photobook_revisions"."invalidation_reason" IS NOT NULL AND char_length(btrim("photobook_revisions"."invalidation_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "photobook_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"cover_media_asset_id" uuid,
	"selected_format" text DEFAULT 'a4-landscape-hardcover' NOT NULL,
	"title" text,
	"subtitle" text,
	"include_budget" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photobook_settings_title_ck" CHECK ("photobook_settings"."title" IS NULL OR char_length("photobook_settings"."title") <= 160),
	CONSTRAINT "photobook_settings_subtitle_ck" CHECK ("photobook_settings"."subtitle" IS NULL OR char_length("photobook_settings"."subtitle") <= 240),
	CONSTRAINT "photobook_settings_preferences_ck" CHECK (jsonb_typeof("photobook_settings"."preferences") = 'object'),
	CONSTRAINT "photobook_settings_version_ck" CHECK ("photobook_settings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"slug" text NOT NULL,
	"bio" text,
	"location" text,
	"is_private" boolean DEFAULT true NOT NULL,
	"is_pro" boolean DEFAULT false NOT NULL,
	"onboarded_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_display_name_length_ck" CHECK (char_length(btrim("profiles"."display_name")) BETWEEN 1 AND 80),
	CONSTRAINT "profiles_slug_format_ck" CHECK ("profiles"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length("profiles"."slug") <= 80),
	CONSTRAINT "profiles_bio_length_ck" CHECK ("profiles"."bio" IS NULL OR char_length("profiles"."bio") <= 500),
	CONSTRAINT "profiles_location_length_ck" CHECK ("profiles"."location" IS NULL OR char_length("profiles"."location") <= 120),
	CONSTRAINT "profiles_version_positive" CHECK ("profiles"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"project_owner_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_access_requests_not_owner_ck" CHECK ("project_access_requests"."requester_id" <> "project_access_requests"."project_owner_id"),
	CONSTRAINT "project_access_requests_decision_ck" CHECK ("project_access_requests"."status" = 'pending' OR "project_access_requests"."decided_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "project_followers" (
	"project_id" uuid NOT NULL,
	"project_owner_id" uuid NOT NULL,
	"follower_id" uuid NOT NULL,
	"status" "follower_status" DEFAULT 'active' NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_followers_pk" PRIMARY KEY("project_id","follower_id"),
	CONSTRAINT "project_followers_not_owner_ck" CHECK ("project_followers"."follower_id" <> "project_followers"."project_owner_id")
);
--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_phases_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "project_phases_name_length_ck" CHECK (char_length(btrim("project_phases"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "project_phases_sort_nonnegative_ck" CHECK ("project_phases"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_private_details" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"address_line_1_ciphertext" text,
	"address_line_2_ciphertext" text,
	"postal_code_ciphertext" text,
	"city_ciphertext" text,
	"country_code" text,
	"contractor_notes_ciphertext" text,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_private_details_country_ck" CHECK ("project_private_details"."country_code" IS NULL OR "project_private_details"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "project_private_details_key_version_ck" CHECK ("project_private_details"."encryption_key_version" > 0 AND "project_private_details"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"legacy_trip_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_type" text,
	"start_date" date,
	"expected_end_date" date,
	"completed_at" timestamp with time zone,
	"visibility" "project_visibility" DEFAULT 'private' NOT NULL,
	"lifecycle_status" "project_lifecycle_status" DEFAULT 'active' NOT NULL,
	"progress_percentage" integer DEFAULT 0 NOT NULL,
	"content_revision" bigint DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_id_owner_uq" UNIQUE("id","owner_id"),
	CONSTRAINT "projects_slug_format_ck" CHECK ("projects"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "projects_title_length_ck" CHECK (char_length(btrim("projects"."title")) BETWEEN 1 AND 120),
	CONSTRAINT "projects_description_length_ck" CHECK ("projects"."description" IS NULL OR char_length("projects"."description") <= 5000),
	CONSTRAINT "projects_progress_range_ck" CHECK ("projects"."progress_percentage" BETWEEN 0 AND 100),
	CONSTRAINT "projects_revision_positive_ck" CHECK ("projects"."content_revision" > 0 AND "projects"."version" > 0),
	CONSTRAINT "projects_date_order_ck" CHECK ("projects"."start_date" IS NULL OR "projects"."expected_end_date" IS NULL OR "projects"."expected_end_date" >= "projects"."start_date"),
	CONSTRAINT "projects_publication_ck" CHECK ("projects"."visibility" = 'private' OR "projects"."published_at" IS NOT NULL),
	CONSTRAINT "projects_deleted_state_ck" CHECK (("projects"."lifecycle_status" = 'deleted') = ("projects"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"project_owner_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"phase_id" uuid,
	"legacy_step_id" uuid,
	"title" text,
	"room" text,
	"description" text,
	"update_date" date NOT NULL,
	"status" "update_status" DEFAULT 'draft' NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"content_revision" bigint DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "updates_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "updates_id_project_author_uq" UNIQUE("id","project_id","author_id"),
	CONSTRAINT "updates_author_owner_ck" CHECK ("updates"."author_id" = "updates"."project_owner_id"),
	CONSTRAINT "updates_title_length_ck" CHECK ("updates"."title" IS NULL OR char_length(btrim("updates"."title")) BETWEEN 1 AND 120),
	CONSTRAINT "updates_room_length_ck" CHECK ("updates"."room" IS NULL OR char_length("updates"."room") <= 80),
	CONSTRAINT "updates_description_length_ck" CHECK ("updates"."description" IS NULL OR char_length("updates"."description") <= 10000),
	CONSTRAINT "updates_sort_revision_ck" CHECK ("updates"."sort_order" >= 0 AND "updates"."content_revision" > 0 AND "updates"."version" > 0),
	CONSTRAINT "updates_publication_ck" CHECK ("updates"."status" <> 'published' OR "updates"."published_at" IS NOT NULL),
	CONSTRAINT "updates_deleted_state_ck" CHECK (("updates"."status" = 'deleted') = ("updates"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "comment_mentions" (
	"comment_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"body" text NOT NULL,
	"status" "comment_status" DEFAULT 'published' NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_id_update_uq" UNIQUE("id","update_id"),
	CONSTRAINT "comments_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "comments_body_length_ck" CHECK (char_length(btrim("comments"."body")) BETWEEN 1 AND 2000),
	CONSTRAINT "comments_parent_not_self_ck" CHECK ("comments"."parent_comment_id" IS NULL OR "comments"."parent_comment_id" <> "comments"."id"),
	CONSTRAINT "comments_version_ck" CHECK ("comments"."version" > 0),
	CONSTRAINT "comments_deleted_state_ck" CHECK ("comments"."status" <> 'deleted' OR "comments"."deleted_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"project_id" uuid,
	"update_id" uuid,
	"comment_id" uuid,
	"type" text NOT NULL,
	"status" "notification_status" DEFAULT 'unread' NOT NULL,
	"dedupe_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_ck" CHECK (char_length(btrim("notifications"."type")) BETWEEN 1 AND 80),
	CONSTRAINT "notifications_read_state_ck" CHECK ("notifications"."status" <> 'read' OR "notifications"."read_at" IS NOT NULL),
	CONSTRAINT "notifications_payload_object_ck" CHECK (jsonb_typeof("notifications"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"update_id" uuid NOT NULL,
	"comment_id" uuid,
	"actor_id" uuid NOT NULL,
	"target" "reaction_target" NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_target_shape_ck" CHECK (("reactions"."target" = 'update' AND "reactions"."comment_id" IS NULL) OR ("reactions"."target" = 'comment' AND "reactions"."comment_id" IS NOT NULL)),
	CONSTRAINT "reactions_emoji_ck" CHECK ("reactions"."emoji" IN ('👍', '❤️', '🔥', '👏', '🔨'))
);
--> statement-breakpoint
CREATE TABLE "user_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"kind" "relationship_kind" NOT NULL,
	"status" "relationship_status" NOT NULL,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_relationships_not_self_ck" CHECK ("user_relationships"."source_user_id" <> "user_relationships"."target_user_id"),
	CONSTRAINT "user_relationships_version_ck" CHECK ("user_relationships"."version" > 0),
	CONSTRAINT "user_relationships_block_state_ck" CHECK ("user_relationships"."kind" <> 'block' OR "user_relationships"."status" IN ('active', 'revoked')),
	CONSTRAINT "user_relationships_decision_ck" CHECK ("user_relationships"."status" = 'pending' OR "user_relationships"."decided_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identity_mappings" ADD CONSTRAINT "auth_identity_mappings_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identity_mappings" ADD CONSTRAINT "auth_identity_mappings_auth_user_id_auth_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_created_by_id_app_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budget_project_fk" FOREIGN KEY ("budget_id","project_id") REFERENCES "public"."project_budgets"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_pins" ADD CONSTRAINT "floorplan_pins_floorplan_project_fk" FOREIGN KEY ("floorplan_id","project_id") REFERENCES "public"."floorplans"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_pins" ADD CONSTRAINT "floorplan_pins_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_asset_project_fk" FOREIGN KEY ("media_asset_id","project_id") REFERENCES "public"."media_assets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_original_owner_fk" FOREIGN KEY ("original_asset_id","owner_id") REFERENCES "public"."media_assets"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_media" ADD CONSTRAINT "update_media_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_media" ADD CONSTRAINT "update_media_asset_project_fk" FOREIGN KEY ("media_asset_id","project_id") REFERENCES "public"."media_assets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_invite_redemptions" ADD CONSTRAINT "beta_invite_redemptions_invite_id_beta_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."beta_invites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_invite_redemptions" ADD CONSTRAINT "beta_invite_redemptions_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_invite_redemptions" ADD CONSTRAINT "beta_invite_redemptions_auth_user_id_auth_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_invites" ADD CONSTRAINT "beta_invites_created_by_id_app_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_assets" ADD CONSTRAINT "deletion_assets_deletion_job_id_deletion_jobs_id_fk" FOREIGN KEY ("deletion_job_id") REFERENCES "public"."deletion_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_assets" ADD CONSTRAINT "deletion_assets_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_jobs" ADD CONSTRAINT "deletion_jobs_requested_by_id_app_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_recipient_user_id_app_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_export_asset_id_media_assets_id_fk" FOREIGN KEY ("export_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_submitted_by_id_app_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_screenshot_asset_id_media_assets_id_fk" FOREIGN KEY ("screenshot_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_moderation_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."moderation_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_reversal_fk" FOREIGN KEY ("reversed_by_action_id") REFERENCES "public"."moderation_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reporter_id_app_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_assigned_to_id_app_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_drafts" ADD CONSTRAINT "photobook_drafts_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_exclusions" ADD CONSTRAINT "photobook_exclusions_draft_project_fk" FOREIGN KEY ("draft_id","project_id") REFERENCES "public"."photobook_drafts"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_exclusions" ADD CONSTRAINT "photobook_exclusions_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_exclusions" ADD CONSTRAINT "photobook_exclusions_media_project_fk" FOREIGN KEY ("media_asset_id","project_id") REFERENCES "public"."media_assets"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_order_events" ADD CONSTRAINT "photobook_order_events_order_id_photobook_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."photobook_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_order_events" ADD CONSTRAINT "photobook_order_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_orders" ADD CONSTRAINT "photobook_orders_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_orders" ADD CONSTRAINT "photobook_orders_proof_project_fk" FOREIGN KEY ("proof_revision_id","project_id") REFERENCES "public"."photobook_revisions"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_revisions" ADD CONSTRAINT "photobook_revisions_approved_by_id_app_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_revisions" ADD CONSTRAINT "photobook_revisions_draft_project_fk" FOREIGN KEY ("draft_id","project_id") REFERENCES "public"."photobook_drafts"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_revisions" ADD CONSTRAINT "photobook_revisions_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_revisions" ADD CONSTRAINT "photobook_revisions_pdf_project_fk" FOREIGN KEY ("pdf_asset_id","project_id") REFERENCES "public"."media_assets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_settings" ADD CONSTRAINT "photobook_settings_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photobook_settings" ADD CONSTRAINT "photobook_settings_cover_project_fk" FOREIGN KEY ("cover_media_asset_id","project_id") REFERENCES "public"."media_assets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_requests" ADD CONSTRAINT "project_access_requests_requester_id_app_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_requests" ADD CONSTRAINT "project_access_requests_decided_by_id_app_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_requests" ADD CONSTRAINT "project_access_requests_project_owner_fk" FOREIGN KEY ("project_id","project_owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_followers" ADD CONSTRAINT "project_followers_follower_id_app_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_followers" ADD CONSTRAINT "project_followers_project_owner_fk" FOREIGN KEY ("project_id","project_owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_private_details" ADD CONSTRAINT "project_private_details_project_owner_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_author_id_app_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_project_owner_fk" FOREIGN KEY ("project_id","project_owner_id") REFERENCES "public"."projects"("id","owner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "updates" ADD CONSTRAINT "updates_phase_project_fk" FOREIGN KEY ("phase_id","project_id") REFERENCES "public"."project_phases"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_mentioned_user_id_app_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_update_fk" FOREIGN KEY ("comment_id","update_id") REFERENCES "public"."comments"("id","update_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_app_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_update_fk" FOREIGN KEY ("parent_comment_id","update_id") REFERENCES "public"."comments"("id","update_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_app_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_update_fk" FOREIGN KEY ("comment_id","update_id") REFERENCES "public"."comments"("id","update_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_update_project_fk" FOREIGN KEY ("update_id","project_id") REFERENCES "public"."updates"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_comment_update_fk" FOREIGN KEY ("comment_id","update_id") REFERENCES "public"."comments"("id","update_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_source_user_id_app_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_relationships" ADD CONSTRAINT "user_relationships_target_user_id_app_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_uq" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identity_mappings_legacy_uq" ON "auth_identity_mappings" USING btree ("legacy_provider","legacy_subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identity_mappings_auth_user_uq" ON "auth_identity_mappings" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "auth_identity_mappings_app_user_idx" ON "auth_identity_mappings" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_users_email_lower_uq" ON "auth_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verifications_expiry_idx" ON "auth_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "budget_items_budget_kind_idx" ON "budget_items" USING btree ("budget_id","kind","occurred_on");--> statement-breakpoint
CREATE INDEX "budget_items_update_idx" ON "budget_items" USING btree ("update_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_project_uq" ON "project_budgets" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "floorplan_pins_floorplan_update_uq" ON "floorplan_pins" USING btree ("floorplan_id","update_id");--> statement-breakpoint
CREATE INDEX "floorplan_pins_update_idx" ON "floorplan_pins" USING btree ("update_id");--> statement-breakpoint
CREATE UNIQUE INDEX "floorplans_asset_uq" ON "floorplans" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "floorplans_project_sort_uq" ON "floorplans" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_object_uq" ON "media_assets" USING btree ("storage_provider","bucket","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_upload_idempotency_uq" ON "media_assets" USING btree ("upload_idempotency_key");--> statement-breakpoint
CREATE INDEX "media_assets_project_status_idx" ON "media_assets" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_owner_purpose_idx" ON "media_assets" USING btree ("owner_id","purpose","status");--> statement-breakpoint
CREATE INDEX "media_assets_cleanup_idx" ON "media_assets" USING btree ("status","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "update_media_asset_uq" ON "update_media" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "update_media_update_sort_uq" ON "update_media" USING btree ("update_id","sort_order");--> statement-breakpoint
CREATE INDEX "update_media_project_idx" ON "update_media" USING btree ("project_id","update_id");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "beta_invite_redemptions_token_uq" ON "beta_invite_redemptions" USING btree ("reservation_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "beta_invite_redemptions_invite_app_user_uq" ON "beta_invite_redemptions" USING btree ("invite_id","app_user_id");--> statement-breakpoint
CREATE INDEX "beta_invite_redemptions_status_expiry_idx" ON "beta_invite_redemptions" USING btree ("status","reservation_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "beta_invites_code_hash_uq" ON "beta_invites" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "beta_invites_status_expiry_idx" ON "beta_invites" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_assets_job_object_uq" ON "deletion_assets" USING btree ("deletion_job_id","storage_provider","bucket","object_key");--> statement-breakpoint
CREATE INDEX "deletion_assets_status_idx" ON "deletion_assets" USING btree ("deletion_job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_jobs_idempotency_uq" ON "deletion_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_jobs_active_target_uq" ON "deletion_jobs" USING btree ("kind","target_id") WHERE "deletion_jobs"."status" NOT IN ('completed', 'dead_letter');--> statement-breakpoint
CREATE INDEX "deletion_jobs_claim_idx" ON "deletion_jobs" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_idempotency_uq" ON "email_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_provider_message_uq" ON "email_deliveries" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_idempotency_uq" ON "export_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "export_jobs_user_idx" ON "export_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_submissions_status_idx" ON "feedback_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_submissions_user_idx" ON "feedback_submissions" USING btree ("submitted_by_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_report_idx" ON "moderation_actions" USING btree ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_reports_queue_idx" ON "moderation_reports" USING btree ("status","urgency","created_at");--> statement-breakpoint
CREATE INDEX "moderation_reports_target_idx" ON "moderation_reports" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_idempotency_uq" ON "outbox_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_events_claim_idx" ON "outbox_events" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_inbox_provider_event_uq" ON "provider_event_inbox" USING btree ("provider","environment","provider_event_id");--> statement-breakpoint
CREATE INDEX "provider_event_inbox_claim_idx" ON "provider_event_inbox" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "provider_event_inbox_reference_idx" ON "provider_event_inbox" USING btree ("provider","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_drafts_project_uq" ON "photobook_drafts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "photobook_drafts_owner_status_idx" ON "photobook_drafts" USING btree ("owner_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_exclusions_target_uq" ON "photobook_exclusions" USING btree ("draft_id","target_type",coalesce("update_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("media_asset_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("chapter_key", ''));--> statement-breakpoint
CREATE INDEX "photobook_exclusions_project_idx" ON "photobook_exclusions" USING btree ("project_id","draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_order_events_idempotency_uq" ON "photobook_order_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "photobook_order_events_order_time_idx" ON "photobook_order_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
CREATE INDEX "photobook_order_events_provider_idx" ON "photobook_order_events" USING btree ("source","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_order_number_uq" ON "photobook_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_merchant_reference_uq" ON "photobook_orders" USING btree ("merchant_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_idempotency_uq" ON "photobook_orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_proof_revision_uq" ON "photobook_orders" USING btree ("proof_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_stripe_session_uq" ON "photobook_orders" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_stripe_intent_uq" ON "photobook_orders" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_orders_peecho_order_uq" ON "photobook_orders" USING btree ("peecho_order_id");--> statement-breakpoint
CREATE INDEX "photobook_orders_owner_created_idx" ON "photobook_orders" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "photobook_orders_fulfilment_queue_idx" ON "photobook_orders" USING btree ("fulfilment_status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_revisions_draft_number_uq" ON "photobook_revisions" USING btree ("draft_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "photobook_revisions_pdf_asset_uq" ON "photobook_revisions" USING btree ("pdf_asset_id");--> statement-breakpoint
CREATE INDEX "photobook_revisions_project_status_idx" ON "photobook_revisions" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_uq" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_slug_uq" ON "profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "profiles_discovery_idx" ON "profiles" USING btree ("is_private","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_access_requests_project_requester_uq" ON "project_access_requests" USING btree ("project_id","requester_id");--> statement-breakpoint
CREATE INDEX "project_access_requests_owner_status_idx" ON "project_access_requests" USING btree ("project_owner_id","status","created_at");--> statement-breakpoint
CREATE INDEX "project_access_requests_requester_status_idx" ON "project_access_requests" USING btree ("requester_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "project_followers_follower_status_idx" ON "project_followers" USING btree ("follower_id","status","followed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_phases_project_sort_uq" ON "project_phases" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "project_phases_project_name_uq" ON "project_phases" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_uq" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_legacy_trip_uq" ON "projects" USING btree ("legacy_trip_id");--> statement-breakpoint
CREATE INDEX "projects_owner_status_idx" ON "projects" USING btree ("owner_id","lifecycle_status","updated_at");--> statement-breakpoint
CREATE INDEX "projects_public_discovery_idx" ON "projects" USING btree ("visibility","lifecycle_status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "updates_legacy_step_uq" ON "updates" USING btree ("legacy_step_id");--> statement-breakpoint
CREATE INDEX "updates_project_timeline_idx" ON "updates" USING btree ("project_id","status","update_date","sort_order");--> statement-breakpoint
CREATE INDEX "updates_author_idx" ON "updates" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_mentions_comment_user_uq" ON "comment_mentions" USING btree ("comment_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_user_idx" ON "comment_mentions" USING btree ("mentioned_user_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_update_timeline_idx" ON "comments" USING btree ("update_id","status","created_at");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_status_idx" ON "notifications" USING btree ("recipient_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_actor_target_emoji_uq" ON "reactions" USING btree ("actor_id","update_id",coalesce("comment_id", '00000000-0000-0000-0000-000000000000'::uuid),"emoji");--> statement-breakpoint
CREATE INDEX "reactions_update_idx" ON "reactions" USING btree ("update_id","created_at");--> statement-breakpoint
CREATE INDEX "reactions_comment_idx" ON "reactions" USING btree ("comment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_relationships_direction_kind_uq" ON "user_relationships" USING btree ("source_user_id","target_user_id","kind");--> statement-breakpoint
CREATE INDEX "user_relationships_source_status_idx" ON "user_relationships" USING btree ("source_user_id","kind","status");--> statement-breakpoint
CREATE INDEX "user_relationships_target_status_idx" ON "user_relationships" USING btree ("target_user_id","kind","status");

-- The API sets this transaction-local value after authenticating the request.
-- An absent actor intentionally resolves to NULL so anonymous reads fail closed.
CREATE FUNCTION app_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $updated_at_triggers$
DECLARE
  target_table text;
BEGIN
  FOR target_table IN
    SELECT columns.table_name
    FROM information_schema.columns
    WHERE columns.table_schema = 'public'
      AND columns.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      target_table || '_set_updated_at',
      target_table
    );
  END LOOP;
END;
$updated_at_triggers$;

CREATE FUNCTION app_users_are_blocked(left_user uuid, right_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_relationships relationship
    WHERE relationship.kind = 'block'
      AND relationship.status = 'active'
      AND (
        (relationship.source_user_id = left_user AND relationship.target_user_id = right_user)
        OR (relationship.source_user_id = right_user AND relationship.target_user_id = left_user)
      )
  )
$$;

CREATE FUNCTION app_can_view_profile(target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.app_actor_id() = target_user
    OR (
      NOT public.app_users_are_blocked(public.app_actor_id(), target_user)
      AND EXISTS (
        SELECT 1
        FROM public.profiles profile
        WHERE profile.user_id = target_user
          AND (
            profile.is_private = false
            OR EXISTS (
              SELECT 1
              FROM public.user_relationships relationship
              WHERE relationship.source_user_id = public.app_actor_id()
                AND relationship.target_user_id = target_user
                AND relationship.kind = 'follow'
                AND relationship.status = 'active'
            )
          )
      )
    )
$$;

CREATE FUNCTION app_owns_project(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = target_project
      AND project.owner_id = public.app_actor_id()
      AND project.lifecycle_status = 'active'
  )
$$;

CREATE FUNCTION app_can_view_project(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = target_project
      AND project.lifecycle_status = 'active'
      AND NOT public.app_users_are_blocked(public.app_actor_id(), project.owner_id)
      AND (
        project.owner_id = public.app_actor_id()
        OR project.visibility = 'public'
        OR EXISTS (
          SELECT 1
          FROM public.project_access_requests access_request
          WHERE access_request.project_id = project.id
            AND access_request.requester_id = public.app_actor_id()
            AND access_request.status = 'accepted'
        )
      )
  )
$$;

CREATE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER photobook_order_events_append_only
BEFORE UPDATE OR DELETE ON photobook_order_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE FUNCTION validate_photobook_revision_proof()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proof_asset media_assets%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('ready', 'approved', 'locked') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO proof_asset
  FROM media_assets
  WHERE id = NEW.pdf_asset_id
    AND project_id = NEW.project_id
  FOR SHARE;

  IF NOT FOUND
     OR proof_asset.purpose <> 'photobook_pdf'
     OR proof_asset.status <> 'ready'
     OR proof_asset.sha256 IS DISTINCT FROM NEW.pdf_sha256
     OR proof_asset.size_bytes IS DISTINCT FROM NEW.pdf_size_bytes THEN
    RAISE EXCEPTION 'photobook proof metadata does not match immutable PDF bytes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER photobook_revisions_validate_proof
BEFORE INSERT OR UPDATE OF status, pdf_asset_id, pdf_sha256, pdf_size_bytes
ON photobook_revisions
FOR EACH ROW EXECUTE FUNCTION validate_photobook_revision_proof();

CREATE FUNCTION guard_locked_photobook_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('approved', 'locked', 'invalidated') AND (
    NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.project_revision IS DISTINCT FROM OLD.project_revision
    OR NEW.document IS DISTINCT FROM OLD.document
    OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256
    OR NEW.asset_set IS DISTINCT FROM OLD.asset_set
    OR NEW.asset_set_sha256 IS DISTINCT FROM OLD.asset_set_sha256
    OR NEW.pdf_asset_id IS DISTINCT FROM OLD.pdf_asset_id
    OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
    OR NEW.pdf_size_bytes IS DISTINCT FROM OLD.pdf_size_bytes
    OR NEW.page_count IS DISTINCT FROM OLD.page_count
    OR NEW.render_engine IS DISTINCT FROM OLD.render_engine
    OR NEW.render_version IS DISTINCT FROM OLD.render_version
    OR NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'approved photobook proof is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('locked', 'invalidated')
     AND NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
    RAISE EXCEPTION 'photobook proof lock is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER photobook_revisions_guard_locked
BEFORE UPDATE ON photobook_revisions
FOR EACH ROW EXECUTE FUNCTION guard_locked_photobook_revision();

CREATE FUNCTION validate_photobook_order_proof()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM photobook_revisions revision
    WHERE revision.id = NEW.proof_revision_id
      AND revision.project_id = NEW.project_id
      AND revision.owner_id = NEW.owner_id
      AND revision.status = 'locked'
  ) THEN
    RAISE EXCEPTION 'checkout requires a locked photobook proof' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER photobook_orders_validate_proof
BEFORE INSERT OR UPDATE OF proof_revision_id, project_id, owner_id
ON photobook_orders
FOR EACH ROW EXECUTE FUNCTION validate_photobook_order_proof();

CREATE FUNCTION guard_locked_photobook_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM photobook_revisions revision
    WHERE revision.pdf_asset_id = OLD.id
      AND (
        revision.status IN ('approved', 'locked', 'invalidated')
        OR EXISTS (
          SELECT 1 FROM photobook_orders orders
          WHERE orders.proof_revision_id = revision.id
        )
      )
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'asset is bound to a locked or ordered photobook proof' USING ERRCODE = '23514';
    END IF;
    IF NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
       OR NEW.bucket IS DISTINCT FROM OLD.bucket
       OR NEW.object_key IS DISTINCT FROM OLD.object_key
       OR NEW.storage_version IS DISTINCT FROM OLD.storage_version
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
       OR NEW.detected_content_type IS DISTINCT FROM OLD.detected_content_type
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION 'asset is bound to a locked or ordered photobook proof' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER media_assets_guard_locked_proof
BEFORE UPDATE OR DELETE ON media_assets
FOR EACH ROW EXECUTE FUNCTION guard_locked_photobook_asset();

CREATE FUNCTION guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_actor_id() = OLD.user_id AND NEW.is_pro IS DISTINCT FROM OLD.is_pro THEN
    RAISE EXCEPTION 'profile privilege fields are server-managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_guard_privileges
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION guard_profile_privileges();

CREATE FUNCTION guard_relationship_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.source_user_id IS DISTINCT FROM OLD.source_user_id
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'relationship identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_relationships_guard_identity
BEFORE UPDATE ON user_relationships
FOR EACH ROW EXECUTE FUNCTION guard_relationship_identity();

CREATE FUNCTION guard_access_request_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.project_owner_id IS DISTINCT FROM OLD.project_owner_id
     OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'access request identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_access_requests_guard_identity
BEFORE UPDATE ON project_access_requests
FOR EACH ROW EXECUTE FUNCTION guard_access_request_identity();

CREATE FUNCTION guard_notification_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_actor_id() = OLD.recipient_id AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.update_id IS DISTINCT FROM OLD.update_id
    OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'recipient may only update notification read state' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_guard_recipient_update
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION guard_notification_recipient_update();

DO $enable_rls$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'app_users', 'auth_identity_mappings', 'profiles', 'projects',
    'project_private_details', 'project_phases', 'project_access_requests',
    'project_followers', 'updates', 'media_assets', 'update_media',
    'floorplans', 'floorplan_pins', 'project_budgets', 'budget_items',
    'user_relationships', 'comments', 'comment_mentions', 'reactions',
    'notifications', 'photobook_drafts', 'photobook_settings',
    'photobook_exclusions', 'photobook_revisions', 'photobook_orders',
    'photobook_order_events', 'provider_event_inbox', 'outbox_events',
    'deletion_jobs', 'deletion_assets', 'moderation_reports',
    'moderation_actions', 'audit_events', 'beta_invites',
    'beta_invite_redemptions', 'feedback_submissions', 'email_deliveries',
    'export_jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
  END LOOP;
END;
$enable_rls$;

CREATE POLICY app_users_select_self ON app_users FOR SELECT USING (id = app_actor_id());
CREATE POLICY app_users_update_self ON app_users FOR UPDATE USING (id = app_actor_id()) WITH CHECK (id = app_actor_id());
CREATE POLICY identity_mappings_select_self ON auth_identity_mappings FOR SELECT USING (app_user_id = app_actor_id());

CREATE POLICY profiles_select_visible ON profiles FOR SELECT USING (app_can_view_profile(user_id));
CREATE POLICY profiles_insert_self ON profiles FOR INSERT WITH CHECK (user_id = app_actor_id());
CREATE POLICY profiles_update_self ON profiles FOR UPDATE USING (user_id = app_actor_id()) WITH CHECK (user_id = app_actor_id());

CREATE POLICY relationships_select_participant ON user_relationships FOR SELECT
USING (source_user_id = app_actor_id() OR target_user_id = app_actor_id());
CREATE POLICY relationships_insert_source ON user_relationships FOR INSERT
WITH CHECK (
  source_user_id = app_actor_id()
  AND source_user_id <> target_user_id
  AND (
    (kind = 'block' AND status = 'active')
    OR (kind = 'follow' AND status = 'pending' AND NOT app_users_are_blocked(source_user_id, target_user_id))
  )
);
CREATE POLICY relationships_update_target_follow ON user_relationships FOR UPDATE
USING (kind = 'follow' AND target_user_id = app_actor_id())
WITH CHECK (kind = 'follow' AND target_user_id = app_actor_id());
CREATE POLICY relationships_delete_participant ON user_relationships FOR DELETE
USING (source_user_id = app_actor_id() OR (kind = 'follow' AND target_user_id = app_actor_id()));

CREATE POLICY projects_select_visible ON projects FOR SELECT USING (app_can_view_project(id));
CREATE POLICY projects_insert_owner ON projects FOR INSERT WITH CHECK (owner_id = app_actor_id());
CREATE POLICY projects_update_owner ON projects FOR UPDATE USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY projects_delete_owner ON projects FOR DELETE USING (owner_id = app_actor_id());

CREATE POLICY project_private_owner_all ON project_private_details FOR ALL
USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY project_phases_select_visible ON project_phases FOR SELECT USING (app_can_view_project(project_id));
CREATE POLICY project_phases_owner_all ON project_phases FOR ALL
USING (app_owns_project(project_id)) WITH CHECK (app_owns_project(project_id));

CREATE POLICY access_requests_select_participant ON project_access_requests FOR SELECT
USING (requester_id = app_actor_id() OR project_owner_id = app_actor_id());
CREATE POLICY access_requests_insert_requester ON project_access_requests FOR INSERT
WITH CHECK (
  requester_id = app_actor_id()
  AND status = 'pending'
  AND NOT app_users_are_blocked(requester_id, project_owner_id)
);
CREATE POLICY access_requests_update_owner ON project_access_requests FOR UPDATE
USING (project_owner_id = app_actor_id()) WITH CHECK (project_owner_id = app_actor_id());
CREATE POLICY access_requests_delete_participant ON project_access_requests FOR DELETE
USING (requester_id = app_actor_id() OR project_owner_id = app_actor_id());

CREATE POLICY project_followers_select_participant ON project_followers FOR SELECT
USING (follower_id = app_actor_id() OR project_owner_id = app_actor_id());
CREATE POLICY project_followers_insert_self ON project_followers FOR INSERT
WITH CHECK (follower_id = app_actor_id() AND app_can_view_project(project_id));
CREATE POLICY project_followers_delete_self_or_owner ON project_followers FOR DELETE
USING (follower_id = app_actor_id() OR project_owner_id = app_actor_id());

CREATE POLICY updates_select_visible ON updates FOR SELECT USING (app_can_view_project(project_id));
CREATE POLICY updates_insert_owner ON updates FOR INSERT
WITH CHECK (author_id = app_actor_id() AND project_owner_id = app_actor_id());
CREATE POLICY updates_update_owner ON updates FOR UPDATE
USING (project_owner_id = app_actor_id()) WITH CHECK (project_owner_id = app_actor_id());
CREATE POLICY updates_delete_owner ON updates FOR DELETE USING (project_owner_id = app_actor_id());

CREATE POLICY media_select_visible ON media_assets FOR SELECT
USING (
  owner_id = app_actor_id()
  OR (
    project_id IS NOT NULL
    AND purpose IN ('project_media', 'project_cover', 'floorplan')
    AND app_can_view_project(project_id)
  )
  OR (purpose = 'avatar' AND app_can_view_profile(owner_id))
);
CREATE POLICY media_insert_owner ON media_assets FOR INSERT
WITH CHECK (owner_id = app_actor_id() AND (project_id IS NULL OR app_owns_project(project_id)));
CREATE POLICY media_update_owner ON media_assets FOR UPDATE USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY media_delete_owner ON media_assets FOR DELETE USING (owner_id = app_actor_id());
CREATE POLICY update_media_select_visible ON update_media FOR SELECT USING (app_can_view_project(project_id));
CREATE POLICY update_media_owner_all ON update_media FOR ALL
USING (app_owns_project(project_id)) WITH CHECK (app_owns_project(project_id));

CREATE POLICY floorplans_select_visible ON floorplans FOR SELECT USING (app_can_view_project(project_id));
CREATE POLICY floorplans_owner_all ON floorplans FOR ALL
USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY floorplan_pins_select_visible ON floorplan_pins FOR SELECT USING (app_can_view_project(project_id));
CREATE POLICY floorplan_pins_owner_all ON floorplan_pins FOR ALL
USING (app_owns_project(project_id)) WITH CHECK (app_owns_project(project_id));

CREATE POLICY budgets_select_visible ON project_budgets FOR SELECT
USING (owner_id = app_actor_id() OR (is_shared AND app_can_view_project(project_id)));
CREATE POLICY budgets_owner_all ON project_budgets FOR ALL
USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY budget_items_select_visible ON budget_items FOR SELECT
USING (EXISTS (SELECT 1 FROM project_budgets budget WHERE budget.id = budget_id));
CREATE POLICY budget_items_owner_all ON budget_items FOR ALL
USING (app_owns_project(project_id)) WITH CHECK (app_owns_project(project_id));

CREATE POLICY comments_select_visible ON comments FOR SELECT
USING (app_can_view_project(project_id) AND status <> 'deleted');
CREATE POLICY comments_insert_author ON comments FOR INSERT
WITH CHECK (author_id = app_actor_id() AND app_can_view_project(project_id));
CREATE POLICY comments_update_author_or_owner ON comments FOR UPDATE
USING (author_id = app_actor_id() OR app_owns_project(project_id))
WITH CHECK (author_id = app_actor_id() OR app_owns_project(project_id));
CREATE POLICY comments_delete_author_or_owner ON comments FOR DELETE
USING (author_id = app_actor_id() OR app_owns_project(project_id));
CREATE POLICY mentions_select_visible ON comment_mentions FOR SELECT
USING (EXISTS (SELECT 1 FROM comments comment WHERE comment.id = comment_id));
CREATE POLICY mentions_insert_comment_author ON comment_mentions FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM comments comment WHERE comment.id = comment_id AND comment.author_id = app_actor_id()));
CREATE POLICY mentions_delete_comment_author ON comment_mentions FOR DELETE
USING (EXISTS (SELECT 1 FROM comments comment WHERE comment.id = comment_id AND comment.author_id = app_actor_id()));

CREATE POLICY reactions_select_visible ON reactions FOR SELECT USING (app_can_view_project(project_id));
CREATE POLICY reactions_insert_self ON reactions FOR INSERT
WITH CHECK (actor_id = app_actor_id() AND app_can_view_project(project_id));
CREATE POLICY reactions_delete_self ON reactions FOR DELETE USING (actor_id = app_actor_id());
CREATE POLICY notifications_select_recipient ON notifications FOR SELECT USING (recipient_id = app_actor_id());
CREATE POLICY notifications_update_recipient ON notifications FOR UPDATE
USING (recipient_id = app_actor_id()) WITH CHECK (recipient_id = app_actor_id());
CREATE POLICY notifications_delete_recipient ON notifications FOR DELETE USING (recipient_id = app_actor_id());

CREATE POLICY photobook_drafts_owner_all ON photobook_drafts FOR ALL
USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY photobook_settings_owner_all ON photobook_settings FOR ALL
USING (owner_id = app_actor_id()) WITH CHECK (owner_id = app_actor_id());
CREATE POLICY photobook_exclusions_owner_all ON photobook_exclusions FOR ALL
USING (app_owns_project(project_id)) WITH CHECK (app_owns_project(project_id));
CREATE POLICY photobook_revisions_owner_select ON photobook_revisions FOR SELECT USING (owner_id = app_actor_id());
CREATE POLICY photobook_revisions_owner_insert ON photobook_revisions FOR INSERT
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(project_id));
CREATE POLICY photobook_revisions_owner_update_unlocked ON photobook_revisions FOR UPDATE
USING (owner_id = app_actor_id() AND status <> 'locked') WITH CHECK (owner_id = app_actor_id());
CREATE POLICY photobook_orders_owner_select ON photobook_orders FOR SELECT USING (owner_id = app_actor_id());
CREATE POLICY photobook_order_events_owner_select ON photobook_order_events FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM photobook_orders orders
    WHERE orders.id = order_id AND orders.owner_id = app_actor_id()
  )
);

CREATE POLICY moderation_reports_insert_self ON moderation_reports FOR INSERT
WITH CHECK (reporter_id = app_actor_id());
CREATE POLICY moderation_reports_select_self ON moderation_reports FOR SELECT
USING (reporter_id = app_actor_id());
CREATE POLICY feedback_insert_self ON feedback_submissions FOR INSERT
WITH CHECK (submitted_by_id = app_actor_id());
CREATE POLICY feedback_select_self ON feedback_submissions FOR SELECT
USING (submitted_by_id = app_actor_id());
CREATE POLICY email_deliveries_select_recipient ON email_deliveries FOR SELECT
USING (recipient_user_id = app_actor_id());
CREATE POLICY export_jobs_insert_self ON export_jobs FOR INSERT WITH CHECK (user_id = app_actor_id());
CREATE POLICY export_jobs_select_self ON export_jobs FOR SELECT USING (user_id = app_actor_id());

REVOKE EXECUTE ON FUNCTION set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prevent_append_only_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_photobook_revision_proof() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_locked_photobook_revision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_photobook_order_proof() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_locked_photobook_asset() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_profile_privileges() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_relationship_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_access_request_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_notification_recipient_update() FROM PUBLIC;

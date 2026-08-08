CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at_ms" bigint NOT NULL,
	"last_request_at_ms" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_key_hash_ck" CHECK ("auth_rate_limits"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_rate_limits_count_ck" CHECK ("auth_rate_limits"."count" >= 0),
	CONSTRAINT "auth_rate_limits_timestamps_ck" CHECK ("auth_rate_limits"."window_started_at_ms" > 0 AND "auth_rate_limits"."last_request_at_ms" >= "auth_rate_limits"."window_started_at_ms")
);

CREATE INDEX "auth_rate_limits_expiry_idx" ON "auth_rate_limits" USING btree ("expires_at");

REVOKE ALL ON TABLE "auth_rate_limits" FROM PUBLIC;

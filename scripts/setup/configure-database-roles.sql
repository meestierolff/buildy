\set ON_ERROR_STOP on

\if :{?buildy_web_role}
\else
  \echo 'Gebruik -v buildy_web_role=<bestaande-runtime-role>.'
  \quit 2
\endif
\if :{?buildy_email_worker_role}
\else
  \echo 'Gebruik -v buildy_email_worker_role=<bestaande-e-mailworker-role>.'
  \quit 2
\endif
\if :{?buildy_account_worker_role}
\else
  \echo 'Gebruik -v buildy_account_worker_role=<bestaande-accountworker-role>.'
  \quit 2
\endif
\if :{?buildy_media_worker_role}
\else
  \echo 'Gebruik -v buildy_media_worker_role=<bestaande-mediaworker-role>.'
  \quit 2
\endif
\if :{?buildy_photobook_worker_role}
\else
  \echo 'Gebruik -v buildy_photobook_worker_role=<bestaande-bouwboekworker-role>.'
  \quit 2
\endif
\if :{?buildy_payment_worker_role}
\else
  \echo 'Gebruik -v buildy_payment_worker_role=<bestaande-betaalwebhook-role>.'
  \quit 2
\endif
\if :{?buildy_fulfilment_worker_role}
\else
  \echo 'Gebruik -v buildy_fulfilment_worker_role=<bestaande-Peecho-fulfilmentworker-role>.'
  \quit 2
\endif

SELECT format(
  'ALTER ROLE %I NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  role_name
) FROM (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name)
FROM (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', role_name)
FROM (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', role_name)
FROM (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec

-- The web role receives ordinary DML rights. RLS remains the authoritative
-- row boundary; Better Auth's five core tables are server-only and do not use
-- browser-accessible credentials.
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'buildy_web_role'
) \gexec
SELECT format(
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'buildy_web_role'
) \gexec

-- Worker credentials cannot query tables directly. Each only executes its own
-- fixed-search-path, leased SECURITY DEFINER boundary.
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', role_name)
FROM (VALUES
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS worker_roles(role_name) \gexec

-- Reconfiguration is fail-closed for the dedicated Peecho role: remove any
-- historical direct function grants before adding its exact boundary below.
SELECT format(
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
  :'buildy_fulfilment_worker_role'
) \gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name)
FROM (VALUES
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS worker_roles(role_name) \gexec

-- Start from an empty function capability set for every runtime credential.
-- Grants below are the complete allow-list and therefore remain fail-closed
-- when another worker function is added later.
SELECT format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name)
FROM (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec

SELECT format('GRANT EXECUTE ON FUNCTION public.app_resolve_active_user(text) TO %I', :'buildy_web_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_provision_auth_identity(text, uuid, boolean) TO %I', :'buildy_web_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_register_auth_email_recipient(text, text, text) TO %I', :'buildy_web_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_enqueue_auth_email(uuid, text, text, jsonb) TO %I', :'buildy_web_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_ingest_brevo_delivery_event(text, text, text, text, text, timestamptz) TO %I', :'buildy_web_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_resolve_active_user(text) FROM %I, %I', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_provision_auth_identity(text, uuid, boolean) FROM %I, %I', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_register_auth_email_recipient(text, text, text) FROM %I, %I', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_enqueue_auth_email(uuid, text, text, jsonb) FROM %I, %I', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_ingest_brevo_delivery_event(text, text, text, text, text, timestamptz) FROM %I, %I', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec

-- Every SECURITY DEFINER used by browser-backed RLS or a web repository is
-- explicitly web-only. Migration 0008 revokes PostgreSQL's implicit PUBLIC
-- grant, so adding a new helper requires an intentional entry here.
CREATE TEMP TABLE buildy_web_runtime_functions (signature text PRIMARY KEY);
INSERT INTO buildy_web_runtime_functions (signature) VALUES
  ('public.app_users_are_blocked(uuid, uuid)'),
  ('public.app_can_view_profile(uuid)'),
  ('public.app_owns_project(uuid)'),
  ('public.app_can_view_project(uuid)'),
  ('public.app_can_view_update(uuid, uuid)'),
  ('public.app_can_manage_comment(uuid)'),
  ('public.app_can_view_notification_target(uuid, uuid, uuid, uuid)'),
  ('public.app_lock_social_user_pair(uuid)'),
  ('public.app_follow_state_allowed(uuid, relationship_status)'),
  ('public.app_social_project_context(uuid, boolean)'),
  ('public.app_resolve_engagement_mentions(uuid, uuid, uuid[])'),
  ('public.app_enqueue_social_notification(uuid, text, uuid)'),
  ('public.app_enqueue_engagement_notification(uuid, text, uuid)'),
  ('public.app_set_social_access_email_preference(boolean)'),
  ('public.app_request_account_export(text, boolean, text)'),
  ('public.app_request_account_deletion(text, text)'),
  ('public.app_request_project_deletion(uuid, integer, text, text)'),
  ('public.app_replay_moderation_report(text, text)'),
  ('public.app_submit_moderation_report(uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text)'),
  ('public.app_replay_feedback_submission(text, text)'),
  ('public.app_submit_feedback_submission(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text)'),
  ('public.app_moderation_target_hidden(text, uuid)'),
  ('public.app_moderation_media_hidden(uuid)'),
  ('public.app_resolve_moderation_actor(text)'),
  ('public.app_admin_list_moderation_reports(text, text, text, timestamptz, uuid, integer)'),
  ('public.app_admin_load_moderation_report(uuid)'),
  ('public.app_admin_list_moderation_actions(uuid)'),
  ('public.app_admin_apply_moderation_action(uuid, uuid, text, text, text, text, integer, uuid, text)'),
  ('public.app_reserve_beta_invite(text, text, text, text, text, text)'),
  ('public.app_complete_beta_signup(text, text, text, text)'),
  ('public.app_record_client_product_event(uuid, text, text, jsonb)');

SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I', signature, :'buildy_web_role')
FROM buildy_web_runtime_functions \gexec
SELECT format(
  'REVOKE EXECUTE ON FUNCTION %s FROM %I, %I, %I, %I, %I, %I',
  signature,
  :'buildy_account_worker_role',
  :'buildy_email_worker_role',
  :'buildy_media_worker_role',
  :'buildy_photobook_worker_role',
  :'buildy_payment_worker_role',
  :'buildy_fulfilment_worker_role'
)
FROM buildy_web_runtime_functions \gexec
DROP TABLE buildy_web_runtime_functions;

CREATE TEMP TABLE buildy_owner_internal_functions (signature text PRIMARY KEY);
INSERT INTO buildy_owner_internal_functions (signature) VALUES
  ('public.app_create_beta_invite(uuid, text, text, integer, timestamptz, text, text)'),
  ('public.app_revoke_beta_invite(text, text)'),
  ('public.app_product_event_properties_valid(text, jsonb)'),
  ('public.app_product_event_subject_hash(uuid)'),
  ('public.app_insert_product_event(text, text, uuid)'),
  ('public.app_capture_product_event()'),
  ('public.app_migration_grant_role(uuid, uuid, text, text, text, timestamptz, timestamptz)'),
  ('public.app_migration_revoke_role(uuid, uuid, text, text)'),
  ('public.app_project_worker_finalize_deletion(text, uuid)');
SELECT format('REVOKE EXECUTE ON FUNCTION %s FROM %I', signature, role_name)
FROM buildy_owner_internal_functions
CROSS JOIN (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec
DROP TABLE buildy_owner_internal_functions;

SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_claim(text, integer, integer) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_prepare(uuid, text, text, text, text, text) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_acknowledge(uuid, text) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_complete(uuid, text, text, text, timestamptz) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_fail(uuid, text, text, integer, boolean) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_reconcile_brevo_delivery_events(integer) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_load_order(uuid, text) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_load_community_receipt(uuid, text) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_load_account_event(uuid, text) TO %I', :'buildy_email_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_email_worker_prepare_account(uuid, text, text, text, text, text) TO %I', :'buildy_email_worker_role') \gexec
SELECT format(
  'REVOKE EXECUTE ON FUNCTION public.app_email_worker_load_order(uuid, text) FROM %I, %I, %I, %I, %I, %I',
  :'buildy_web_role',
  :'buildy_account_worker_role',
  :'buildy_media_worker_role',
  :'buildy_photobook_worker_role',
  :'buildy_payment_worker_role',
  :'buildy_fulfilment_worker_role'
) \gexec
SELECT format(
  'REVOKE EXECUTE ON FUNCTION public.app_email_worker_load_account_event(uuid, text) FROM %I, %I, %I, %I, %I, %I',
  :'buildy_web_role',
  :'buildy_account_worker_role',
  :'buildy_media_worker_role',
  :'buildy_photobook_worker_role',
  :'buildy_payment_worker_role',
  :'buildy_fulfilment_worker_role'
) \gexec
SELECT format(
  'REVOKE EXECUTE ON FUNCTION public.app_email_worker_prepare_account(uuid, text, text, text, text, text) FROM %I, %I, %I, %I, %I, %I',
  :'buildy_web_role',
  :'buildy_account_worker_role',
  :'buildy_media_worker_role',
  :'buildy_photobook_worker_role',
  :'buildy_payment_worker_role',
  :'buildy_fulfilment_worker_role'
) \gexec

-- The cutover-only migration producer is intentionally granted to none of the
-- long-lived runtime roles. It is callable only through the separately gated
-- database owner credential used by the migration tool.
SELECT format(
  'REVOKE EXECUTE ON FUNCTION public.app_enqueue_migration_account_email(uuid, text, text) FROM %I',
  role_name
) FROM (VALUES
  (:'buildy_web_role'),
  (:'buildy_account_worker_role'),
  (:'buildy_email_worker_role'),
  (:'buildy_media_worker_role'),
  (:'buildy_photobook_worker_role'),
  (:'buildy_payment_worker_role'),
  (:'buildy_fulfilment_worker_role')
) AS runtime_roles(role_name) \gexec
SELECT format(
  'REVOKE EXECUTE ON FUNCTION public.app_email_worker_load_community_receipt(uuid, text) FROM %I, %I, %I, %I, %I, %I',
  :'buildy_web_role',
  :'buildy_account_worker_role',
  :'buildy_media_worker_role',
  :'buildy_photobook_worker_role',
  :'buildy_payment_worker_role',
  :'buildy_fulfilment_worker_role'
) \gexec

SELECT format('GRANT EXECUTE ON FUNCTION public.app_claim_outbox_event(text, text, integer) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_ack_outbox_event(text, uuid) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_retry_outbox_event(text, uuid, text, integer, boolean) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_begin_media_processing_job(text, uuid) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_finalize_media_processing_job(text, uuid, uuid, text, text, bigint, text, integer, integer, jsonb) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_fail_media_processing_job(text, uuid, uuid, text, integer, boolean) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_media_protected_object_keys(text[]) TO %I', :'buildy_media_worker_role') \gexec

SELECT format('GRANT EXECUTE ON FUNCTION public.app_photobook_worker_claim(text, integer) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_begin_photobook_render(text, uuid) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_finalize_photobook_render(text, uuid, uuid, text, bigint, integer, text, text, text, text) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_fail_photobook_render(text, uuid, uuid, text, integer, boolean) TO %I', :'buildy_photobook_worker_role') \gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION public.app_apply_stripe_payment_event(text, text, text, text, timestamptz, uuid, text, text, text, text, text, text, integer, integer, text, text) TO %I',
  :'buildy_payment_worker_role'
) \gexec

CREATE TEMP TABLE buildy_fulfilment_worker_functions (signature text PRIMARY KEY);
INSERT INTO buildy_fulfilment_worker_functions (signature) VALUES
  ('public.app_peecho_worker_claim(text, text, integer)'),
  ('public.app_begin_peecho_fulfilment(text, uuid, text)'),
  ('public.app_begin_peecho_order_create(text, uuid, text, text, text)'),
  ('public.app_persist_peecho_order_created(text, uuid, text, text, text, text)'),
  ('public.app_begin_peecho_order_payment(text, uuid, text, text)'),
  ('public.app_finalize_peecho_order_status(text, uuid, text, text, text, text, text)'),
  ('public.app_retry_peecho_fulfilment(text, uuid, text, integer, boolean)'),
  ('public.app_mark_peecho_manual_review(text, uuid, text)'),
  ('public.app_record_peecho_callback(text, text, text, text, text, text, text, text, text, timestamptz)');
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I', signature, :'buildy_fulfilment_worker_role')
FROM buildy_fulfilment_worker_functions \gexec
SELECT format(
  'REVOKE EXECUTE ON FUNCTION %s FROM %I, %I, %I, %I, %I, %I',
  signature,
  :'buildy_web_role',
  :'buildy_account_worker_role',
  :'buildy_email_worker_role',
  :'buildy_media_worker_role',
  :'buildy_photobook_worker_role',
  :'buildy_payment_worker_role'
)
FROM buildy_fulfilment_worker_functions \gexec
DROP TABLE buildy_fulfilment_worker_functions;

CREATE TEMP TABLE buildy_account_worker_functions (signature text PRIMARY KEY);
INSERT INTO buildy_account_worker_functions (signature) VALUES
  ('public.app_account_worker_claim_export(text, integer)'),
  ('public.app_account_worker_begin_export(text, uuid)'),
  ('public.app_account_worker_finalize_export(text, uuid, text, bigint, text)'),
  ('public.app_account_worker_fail_export(text, uuid, text, integer, boolean)'),
  ('public.app_account_worker_claim_expired_export(text, integer)'),
  ('public.app_account_worker_finalize_export_cleanup(text, uuid)'),
  ('public.app_account_worker_fail_export_cleanup(text, uuid, text, integer, boolean)'),
  ('public.app_account_worker_claim_deletion(text, integer)'),
  ('public.app_account_worker_begin_deletion(text, uuid)'),
  ('public.app_account_worker_verify_deletion_asset(text, uuid, uuid)'),
  ('public.app_account_worker_fail_deletion(text, uuid, uuid, text, integer, boolean)'),
  ('public.app_account_worker_finalize_deletion(text, uuid)'),
  ('public.app_account_worker_finalize_deletion_job(text, uuid)');
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I', signature, :'buildy_account_worker_role')
FROM buildy_account_worker_functions \gexec
DROP TABLE buildy_account_worker_functions;

SELECT format('REVOKE EXECUTE ON FUNCTION public.app_email_worker_claim(text, integer, integer) FROM %I, %I', :'buildy_web_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_email_worker_prepare(uuid, text, text, text, text, text) FROM %I, %I', :'buildy_web_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_email_worker_acknowledge(uuid, text) FROM %I, %I', :'buildy_web_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_email_worker_complete(uuid, text, text, text, timestamptz) FROM %I, %I', :'buildy_web_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_email_worker_fail(uuid, text, text, integer, boolean) FROM %I, %I', :'buildy_web_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_reconcile_brevo_delivery_events(integer) FROM %I, %I', :'buildy_web_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_apply_brevo_delivery_event(uuid) FROM %I, %I, %I', :'buildy_web_role', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_ingest_brevo_delivery_event(text, text, text, text, text, timestamptz) FROM %I, %I', :'buildy_email_worker_role', :'buildy_media_worker_role') \gexec

SELECT format('REVOKE EXECUTE ON FUNCTION public.app_claim_outbox_event(text, text, integer) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_ack_outbox_event(text, uuid) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_retry_outbox_event(text, uuid, text, integer, boolean) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_begin_media_processing_job(text, uuid) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_finalize_media_processing_job(text, uuid, uuid, text, text, bigint, text, integer, integer, jsonb) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_fail_media_processing_job(text, uuid, uuid, text, integer, boolean) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec
SELECT format('REVOKE EXECUTE ON FUNCTION public.app_media_protected_object_keys(text[]) FROM %I, %I', :'buildy_web_role', :'buildy_email_worker_role') \gexec

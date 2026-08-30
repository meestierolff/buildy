\set ON_ERROR_STOP on

\if :{?buildy_web_role}
\else
  \echo 'Gebruik -v buildy_web_role=<bestaande-runtime-role>.'
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

-- Only these five credentials are part of the MVP runtime. Historical e-mail
-- and Peecho roles are deliberately not configuration inputs.
CREATE TEMP TABLE buildy_runtime_roles (
  role_name name PRIMARY KEY,
  role_kind text NOT NULL UNIQUE
);
INSERT INTO buildy_runtime_roles (role_name, role_kind) VALUES
  (:'buildy_web_role', 'web'),
  (:'buildy_account_worker_role', 'account'),
  (:'buildy_media_worker_role', 'media'),
  (:'buildy_photobook_worker_role', 'photobook'),
  (:'buildy_payment_worker_role', 'payment');

-- Runtime roles are provisioned outside this script. Provider-managed admin
-- roles (including Neon) cannot safely normalize SUPERUSER/BYPASSRLS flags on
-- existing SQL-created roles, so configuration validates and fails closed
-- before granting anything instead of relying on ALTER ROLE.
DO $role_boundary$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM buildy_runtime_roles runtime_role
    LEFT JOIN pg_catalog.pg_roles role ON role.rolname = runtime_role.role_name
    WHERE role.oid IS NULL
      OR role.rolsuper
      OR role.rolcreatedb
      OR role.rolcreaterole
      OR role.rolreplication
      OR role.rolbypassrls
      OR role.rolinherit
  ) THEN
    RAISE EXCEPTION 'a runtime role is absent or privileged';
  END IF;

  IF EXISTS (
    WITH RECURSIVE runtime_role_memberships(runtime_role_oid, granted_role_oid) AS (
      SELECT role.oid, membership.roleid
      FROM buildy_runtime_roles runtime_role
      JOIN pg_catalog.pg_roles role ON role.rolname = runtime_role.role_name
      JOIN pg_catalog.pg_auth_members membership ON membership.member = role.oid

      UNION

      SELECT membership_path.runtime_role_oid, membership.roleid
      FROM runtime_role_memberships membership_path
      JOIN pg_catalog.pg_auth_members membership
        ON membership.member = membership_path.granted_role_oid
    )
    SELECT 1 FROM runtime_role_memberships
  ) THEN
    RAISE EXCEPTION 'a runtime role has direct or transitive role membership';
  END IF;
END
$role_boundary$;

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name)
FROM buildy_runtime_roles \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', role_name)
FROM buildy_runtime_roles \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', role_name)
FROM buildy_runtime_roles \gexec

-- The same-origin API role uses ordinary DML under RLS. Browser code never
-- receives this credential and only talks to typed API handlers.
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'buildy_web_role'
) \gexec
SELECT format(
  'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'buildy_web_role'
) \gexec

-- Workers cannot query tables or sequences directly. Every capability is a
-- leased, fixed-search-path SECURITY DEFINER function granted below.
SELECT format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', role_name)
FROM buildy_runtime_roles
WHERE role_kind <> 'web' \gexec
SELECT format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name)
FROM buildy_runtime_roles
WHERE role_kind <> 'web' \gexec

-- Reconfiguration starts with an empty function capability set. This makes a
-- newly added boundary fail closed until it is explicitly classified here.
SELECT format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name)
FROM buildy_runtime_roles \gexec
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TEMP TABLE buildy_web_runtime_functions (signature text PRIMARY KEY);
INSERT INTO buildy_web_runtime_functions (signature) VALUES
  ('public.app_resolve_active_user(text)'),
  ('public.app_provision_auth_identity(text, uuid, boolean)'),
  ('public.app_users_are_blocked(uuid, uuid)'),
  ('public.app_can_view_profile(uuid)'),
  ('public.app_owns_project(uuid)'),
  ('public.app_can_view_project(uuid)'),
  ('public.app_can_view_update(uuid, uuid)'),
  ('public.app_issue_project_share_link(uuid, uuid, text, timestamptz, integer, text, text, text, text)'),
  ('public.app_revoke_project_share_link(uuid, integer, text, text, text)'),
  ('public.app_redeem_project_share_link(text)'),
  ('public.app_can_manage_comment(uuid)'),
  ('public.app_can_view_notification_target(uuid, uuid, uuid, uuid, uuid)'),
  ('public.app_lock_social_user_pair(uuid)'),
  ('public.app_list_profile_connections(text, timestamptz, uuid, integer)'),
  ('public.app_search_profile_identities(text, timestamptz, uuid, integer)'),
  ('public.app_follow_state_allowed(uuid, relationship_status)'),
  ('public.app_resolve_engagement_mentions(uuid, uuid, uuid[])'),
  ('public.app_enqueue_social_notification(uuid, text, uuid)'),
  ('public.app_enqueue_engagement_notification(uuid, text, uuid)'),
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
  ('public.app_admin_list_feedback_submissions(text, text, timestamptz, uuid, integer)'),
  ('public.app_admin_load_feedback_submission(uuid)'),
  ('public.app_admin_list_feedback_reviews(uuid)'),
  ('public.app_admin_update_feedback_status(uuid, uuid, text, integer, text, text, text)'),
  ('public.app_admin_list_paid_orders(text, timestamptz, uuid, integer)'),
  ('public.app_admin_load_paid_order(uuid)'),
  ('public.app_admin_list_order_events(uuid)'),
  ('public.app_admin_apply_manual_fulfilment(uuid, integer, text, text, text, text, text, text, text)'),
  ('public.app_reserve_beta_invite(text, text, text, text, text, text)'),
  ('public.app_complete_beta_signup(text, text, text, text)'),
  ('public.app_record_client_product_event(uuid, text, text, jsonb)');
SELECT format('GRANT EXECUTE ON FUNCTION %s TO %I', signature, :'buildy_web_role')
FROM buildy_web_runtime_functions \gexec

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

SELECT format('GRANT EXECUTE ON FUNCTION public.app_claim_outbox_event(text, text, integer) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_ack_outbox_event(text, uuid) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_retry_outbox_event(text, uuid, text, integer, boolean) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_begin_media_processing_job(text, uuid) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_finalize_media_processing_job(text, uuid, uuid, text, text, bigint, text, integer, integer, jsonb) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_fail_media_processing_job(text, uuid, uuid, text, integer, boolean) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_media_protected_object_keys(text[]) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_claim_media_processing_asset(text, uuid, integer) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_media_worker_claim_orphan_cleanup(text, text, integer) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_media_worker_finalize_orphan_cleanup(text, uuid, text, text, boolean) TO %I', :'buildy_media_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_media_worker_fail_orphan_cleanup(text, uuid, text, text, integer, boolean) TO %I', :'buildy_media_worker_role') \gexec

SELECT format('GRANT EXECUTE ON FUNCTION public.app_photobook_worker_claim(text, integer) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_photobook_worker_claim_revision(text, uuid, integer) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_begin_photobook_render(text, uuid) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_finalize_photobook_render(text, uuid, uuid, text, bigint, integer, text, text, text, text) TO %I', :'buildy_photobook_worker_role') \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.app_fail_photobook_render(text, uuid, uuid, text, integer, boolean) TO %I', :'buildy_photobook_worker_role') \gexec

SELECT format('GRANT EXECUTE ON FUNCTION public.app_apply_stripe_payment_event(text, text, text, text, timestamptz, uuid, text, text, text, text, text, text, integer, integer, text, text) TO %I', :'buildy_payment_worker_role') \gexec

-- Automated e-mail and Peecho fulfilment are retired. Strip every explicit
-- non-owner grant on their historical functions, including grants held by an
-- old role whose environment variable no longer exists. The functions/data
-- remain solely for append-only migration history and negative verification.
CREATE TEMP TABLE buildy_retired_provider_functions (signature text PRIMARY KEY);
INSERT INTO buildy_retired_provider_functions (signature) VALUES
  ('public.app_apply_brevo_delivery_event(uuid)'),
  ('public.app_email_event_is_supported(text, text)'),
  ('public.app_email_worker_acknowledge(uuid, text)'),
  ('public.app_email_worker_claim(text, integer, integer)'),
  ('public.app_email_worker_complete(uuid, text, text, text, timestamptz)'),
  ('public.app_email_worker_fail(uuid, text, text, integer, boolean)'),
  ('public.app_email_worker_load_account_event(uuid, text)'),
  ('public.app_email_worker_load_community_receipt(uuid, text)'),
  ('public.app_email_worker_load_order(uuid, text)'),
  ('public.app_email_worker_prepare(uuid, text, text, text, text, text)'),
  ('public.app_email_worker_prepare_account(uuid, text, text, text, text, text)'),
  ('public.app_enqueue_account_security_email()'),
  ('public.app_enqueue_auth_email(uuid, text, text, jsonb)'),
  ('public.app_enqueue_migration_account_email(uuid, text, text)'),
  ('public.app_enqueue_order_transactional_email()'),
  ('public.app_enqueue_project_access_email()'),
  ('public.app_enqueue_welcome_email()'),
  ('public.app_ingest_brevo_delivery_event(text, text, text, text, text, timestamptz)'),
  ('public.app_reconcile_brevo_delivery_events(integer)'),
  ('public.app_register_auth_email_recipient(text, text, text)'),
  ('public.app_require_email_recipient_before_first_auth()'),
  ('public.app_set_social_access_email_preference(boolean)'),
  ('public.app_peecho_status_rank(text)'),
  ('public.app_peecho_worker_claim(text, text, integer)'),
  ('public.app_begin_peecho_fulfilment(text, uuid, text)'),
  ('public.app_begin_peecho_order_create(text, uuid, text, text, text)'),
  ('public.app_persist_peecho_order_created(text, uuid, text, text, text, text)'),
  ('public.app_begin_peecho_order_payment(text, uuid, text, text)'),
  ('public.app_finalize_peecho_order_status(text, uuid, text, text, text, text, text)'),
  ('public.app_retry_peecho_fulfilment(text, uuid, text, integer, boolean)'),
  ('public.app_mark_peecho_manual_review(text, uuid, text)'),
  ('public.app_record_peecho_callback(text, text, text, text, text, text, text, text, text, timestamptz)');

SELECT format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC', signature)
FROM buildy_retired_provider_functions \gexec
SELECT DISTINCT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I',
  retired.signature,
  grantee.rolname
)
FROM buildy_retired_provider_functions retired
JOIN pg_catalog.pg_proc procedure ON procedure.oid = retired.signature::regprocedure
CROSS JOIN LATERAL pg_catalog.aclexplode(
  coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
) privilege
JOIN pg_catalog.pg_roles grantee ON grantee.oid = privilege.grantee
WHERE privilege.grantee <> procedure.proowner \gexec

DROP TABLE buildy_retired_provider_functions;
DROP TABLE buildy_account_worker_functions;
DROP TABLE buildy_web_runtime_functions;
DROP TABLE buildy_runtime_roles;

\set ON_ERROR_STOP on

\if :{?buildy_web_role}
\else
  \echo 'Gebruik -v buildy_web_role=<runtime-role>.'
  \quit 2
\endif
\if :{?buildy_account_worker_role}
\else
  \echo 'Gebruik -v buildy_account_worker_role=<accountworker-role>.'
  \quit 2
\endif
\if :{?buildy_media_worker_role}
\else
  \echo 'Gebruik -v buildy_media_worker_role=<mediaworker-role>.'
  \quit 2
\endif
\if :{?buildy_photobook_worker_role}
\else
  \echo 'Gebruik -v buildy_photobook_worker_role=<bouwboekworker-role>.'
  \quit 2
\endif
\if :{?buildy_payment_worker_role}
\else
  \echo 'Gebruik -v buildy_payment_worker_role=<betaalwebhook-role>.'
  \quit 2
\endif

SELECT pg_catalog.set_config('buildy.setup.web_role', :'buildy_web_role', false);
SELECT pg_catalog.set_config('buildy.setup.account_worker_role', :'buildy_account_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.media_worker_role', :'buildy_media_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.photobook_worker_role', :'buildy_photobook_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.payment_worker_role', :'buildy_payment_worker_role', false);

CREATE TEMP TABLE buildy_expected_function_grants (
  signature text PRIMARY KEY,
  role_kind text NOT NULL CHECK (role_kind IN ('web', 'account', 'media', 'photobook', 'payment'))
);
INSERT INTO buildy_expected_function_grants (signature, role_kind) VALUES
  ('public.app_resolve_active_user(text)', 'web'),
  ('public.app_provision_auth_identity(text,uuid,boolean)', 'web'),
  ('public.app_users_are_blocked(uuid,uuid)', 'web'),
  ('public.app_can_view_profile(uuid)', 'web'),
  ('public.app_owns_project(uuid)', 'web'),
  ('public.app_can_view_project(uuid)', 'web'),
  ('public.app_can_view_update(uuid,uuid)', 'web'),
  ('public.app_issue_project_share_link(uuid,uuid,text,timestamptz,integer,text,text,text,text)', 'web'),
  ('public.app_revoke_project_share_link(uuid,integer,text,text,text)', 'web'),
  ('public.app_redeem_project_share_link(text)', 'web'),
  ('public.app_can_manage_comment(uuid)', 'web'),
  ('public.app_can_view_notification_target(uuid,uuid,uuid,uuid,uuid)', 'web'),
  ('public.app_lock_social_user_pair(uuid)', 'web'),
  ('public.app_list_profile_connections(text,timestamptz,uuid,integer)', 'web'),
  ('public.app_search_profile_identities(text,timestamptz,uuid,integer)', 'web'),
  ('public.app_follow_state_allowed(uuid,relationship_status)', 'web'),
  ('public.app_resolve_engagement_mentions(uuid,uuid,uuid[])', 'web'),
  ('public.app_enqueue_social_notification(uuid,text,uuid)', 'web'),
  ('public.app_enqueue_engagement_notification(uuid,text,uuid)', 'web'),
  ('public.app_request_account_export(text,boolean,text)', 'web'),
  ('public.app_request_account_deletion(text,text)', 'web'),
  ('public.app_request_project_deletion(uuid,integer,text,text)', 'web'),
  ('public.app_replay_moderation_report(text,text)', 'web'),
  ('public.app_submit_moderation_report(uuid,text,text,text,uuid,text,text,text,text,text,text,text,text,text,text,text)', 'web'),
  ('public.app_replay_feedback_submission(text,text)', 'web'),
  ('public.app_submit_feedback_submission(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'web'),
  ('public.app_moderation_target_hidden(text,uuid)', 'web'),
  ('public.app_moderation_media_hidden(uuid)', 'web'),
  ('public.app_resolve_moderation_actor(text)', 'web'),
  ('public.app_admin_list_moderation_reports(text,text,text,timestamptz,uuid,integer)', 'web'),
  ('public.app_admin_load_moderation_report(uuid)', 'web'),
  ('public.app_admin_list_moderation_actions(uuid)', 'web'),
  ('public.app_admin_apply_moderation_action(uuid,uuid,text,text,text,text,integer,uuid,text)', 'web'),
  ('public.app_admin_list_feedback_submissions(text,text,timestamptz,uuid,integer)', 'web'),
  ('public.app_admin_load_feedback_submission(uuid)', 'web'),
  ('public.app_admin_list_feedback_reviews(uuid)', 'web'),
  ('public.app_admin_update_feedback_status(uuid,uuid,text,integer,text,text,text)', 'web'),
  ('public.app_admin_list_paid_orders(text,timestamptz,uuid,integer)', 'web'),
  ('public.app_admin_load_paid_order(uuid)', 'web'),
  ('public.app_admin_list_order_events(uuid)', 'web'),
  ('public.app_admin_apply_manual_fulfilment(uuid,integer,text,text,text,text,text,text,text)', 'web'),
  ('public.app_reserve_beta_invite(text,text,text,text,text,text)', 'web'),
  ('public.app_complete_beta_signup(text,text,text,text)', 'web'),
  ('public.app_record_client_product_event(uuid,text,text,jsonb)', 'web'),
  ('public.app_account_worker_claim_export(text,integer)', 'account'),
  ('public.app_account_worker_begin_export(text,uuid)', 'account'),
  ('public.app_account_worker_finalize_export(text,uuid,text,bigint,text)', 'account'),
  ('public.app_account_worker_fail_export(text,uuid,text,integer,boolean)', 'account'),
  ('public.app_account_worker_claim_expired_export(text,integer)', 'account'),
  ('public.app_account_worker_finalize_export_cleanup(text,uuid)', 'account'),
  ('public.app_account_worker_fail_export_cleanup(text,uuid,text,integer,boolean)', 'account'),
  ('public.app_account_worker_claim_deletion(text,integer)', 'account'),
  ('public.app_account_worker_begin_deletion(text,uuid)', 'account'),
  ('public.app_account_worker_verify_deletion_asset(text,uuid,uuid)', 'account'),
  ('public.app_account_worker_fail_deletion(text,uuid,uuid,text,integer,boolean)', 'account'),
  ('public.app_account_worker_finalize_deletion(text,uuid)', 'account'),
  ('public.app_account_worker_finalize_deletion_job(text,uuid)', 'account'),
  ('public.app_claim_outbox_event(text,text,integer)', 'media'),
  ('public.app_ack_outbox_event(text,uuid)', 'media'),
  ('public.app_retry_outbox_event(text,uuid,text,integer,boolean)', 'media'),
  ('public.app_begin_media_processing_job(text,uuid)', 'media'),
  ('public.app_finalize_media_processing_job(text,uuid,uuid,text,text,bigint,text,integer,integer,jsonb)', 'media'),
  ('public.app_fail_media_processing_job(text,uuid,uuid,text,integer,boolean)', 'media'),
  ('public.app_media_protected_object_keys(text[])', 'media'),
  ('public.app_claim_media_processing_asset(text,uuid,integer)', 'media'),
  ('public.app_media_worker_claim_orphan_cleanup(text,text,integer)', 'media'),
  ('public.app_media_worker_finalize_orphan_cleanup(text,uuid,text,text,boolean)', 'media'),
  ('public.app_media_worker_fail_orphan_cleanup(text,uuid,text,text,integer,boolean)', 'media'),
  ('public.app_photobook_worker_claim(text,integer)', 'photobook'),
  ('public.app_photobook_worker_claim_revision(text,uuid,integer)', 'photobook'),
  ('public.app_begin_photobook_render(text,uuid)', 'photobook'),
  ('public.app_finalize_photobook_render(text,uuid,uuid,text,bigint,integer,text,text,text,text)', 'photobook'),
  ('public.app_fail_photobook_render(text,uuid,uuid,text,integer,boolean)', 'photobook'),
  ('public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)', 'payment');

CREATE TEMP TABLE buildy_retired_provider_functions (signature text PRIMARY KEY);
INSERT INTO buildy_retired_provider_functions (signature) VALUES
  ('public.app_apply_brevo_delivery_event(uuid)'),
  ('public.app_email_event_is_supported(text,text)'),
  ('public.app_email_worker_acknowledge(uuid,text)'),
  ('public.app_email_worker_claim(text,integer,integer)'),
  ('public.app_email_worker_complete(uuid,text,text,text,timestamptz)'),
  ('public.app_email_worker_fail(uuid,text,text,integer,boolean)'),
  ('public.app_email_worker_load_account_event(uuid,text)'),
  ('public.app_email_worker_load_community_receipt(uuid,text)'),
  ('public.app_email_worker_load_order(uuid,text)'),
  ('public.app_email_worker_prepare(uuid,text,text,text,text,text)'),
  ('public.app_email_worker_prepare_account(uuid,text,text,text,text,text)'),
  ('public.app_enqueue_account_security_email()'),
  ('public.app_enqueue_auth_email(uuid,text,text,jsonb)'),
  ('public.app_enqueue_migration_account_email(uuid,text,text)'),
  ('public.app_enqueue_order_transactional_email()'),
  ('public.app_enqueue_project_access_email()'),
  ('public.app_enqueue_welcome_email()'),
  ('public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)'),
  ('public.app_reconcile_brevo_delivery_events(integer)'),
  ('public.app_register_auth_email_recipient(text,text,text)'),
  ('public.app_require_email_recipient_before_first_auth()'),
  ('public.app_set_social_access_email_preference(boolean)'),
  ('public.app_peecho_status_rank(text)'),
  ('public.app_peecho_worker_claim(text,text,integer)'),
  ('public.app_begin_peecho_fulfilment(text,uuid,text)'),
  ('public.app_begin_peecho_order_create(text,uuid,text,text,text)'),
  ('public.app_persist_peecho_order_created(text,uuid,text,text,text,text)'),
  ('public.app_begin_peecho_order_payment(text,uuid,text,text)'),
  ('public.app_finalize_peecho_order_status(text,uuid,text,text,text,text,text)'),
  ('public.app_retry_peecho_fulfilment(text,uuid,text,integer,boolean)'),
  ('public.app_mark_peecho_manual_review(text,uuid,text)'),
  ('public.app_record_peecho_callback(text,text,text,text,text,text,text,text,text,timestamptz)');

CREATE TEMP TABLE buildy_owner_internal_functions (signature text PRIMARY KEY);
INSERT INTO buildy_owner_internal_functions (signature) VALUES
  ('public.app_share_link_id()'),
  ('public.invalidate_project_share_links_from_project()'),
  ('public.invalidate_project_share_links_from_account()'),
  ('public.app_enqueue_first_update_publication_notifications()'),
  ('public.app_enqueue_photobook_order_event_notification()'),
  ('public.app_create_beta_invite(uuid,text,text,integer,timestamptz,text,text)'),
  ('public.app_revoke_beta_invite(text,text)'),
  ('public.app_product_event_properties_valid(text,jsonb)'),
  ('public.app_product_event_subject_hash(uuid)'),
  ('public.app_insert_product_event(text,text,uuid)'),
  ('public.app_capture_product_event()'),
  ('public.app_migration_grant_role(uuid,uuid,text,text,text,timestamptz,timestamptz)'),
  ('public.app_migration_revoke_role(uuid,uuid,text,text)'),
  ('public.app_redact_request_hashes_on_account_erasure()'),
  ('public.app_redact_request_hashes_on_project_erasure()'),
  ('public.app_project_worker_finalize_deletion(text,uuid)'),
  ('public.guard_feedback_submission_account_erasure()');

DO $verification$
DECLARE
  web_role name := pg_catalog.current_setting('buildy.setup.web_role')::name;
  account_worker_role name := pg_catalog.current_setting('buildy.setup.account_worker_role')::name;
  media_worker_role name := pg_catalog.current_setting('buildy.setup.media_worker_role')::name;
  photobook_worker_role name := pg_catalog.current_setting('buildy.setup.photobook_worker_role')::name;
  payment_worker_role name := pg_catalog.current_setting('buildy.setup.payment_worker_role')::name;
  active_roles name[];
  worker_roles name[];
  expected record;
  runtime_role record;
  unexpected record;
  retired record;
BEGIN
  active_roles := ARRAY[web_role, account_worker_role, media_worker_role, photobook_worker_role, payment_worker_role];
  worker_roles := ARRAY[account_worker_role, media_worker_role, photobook_worker_role, payment_worker_role];

  IF pg_catalog.array_length(active_roles, 1) <> (
    SELECT count(DISTINCT candidate)::integer FROM unnest(active_roles) candidate
  ) THEN
    RAISE EXCEPTION 'runtime roles must be distinct';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(active_roles) candidate(role_name)
    LEFT JOIN pg_catalog.pg_roles role ON role.rolname = candidate.role_name
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
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'S')
      AND owner.rolname = ANY(active_roles)
  ) THEN
    RAISE EXCEPTION 'a runtime role owns a public relation and can bypass its boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants privilege
    WHERE privilege.grantee = ANY(worker_roles::text[])
      AND privilege.table_schema = 'public'
      AND privilege.privilege_type IN (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
  ) THEN
    RAISE EXCEPTION 'a worker role has direct table privileges';
  END IF;

  FOR expected IN SELECT signature, role_kind FROM buildy_expected_function_grants LOOP
    FOR runtime_role IN
      SELECT *
      FROM unnest(
        active_roles,
        ARRAY['web', 'account', 'media', 'photobook', 'payment']::text[]
      ) AS role_map(role_name, role_kind)
    LOOP
      IF pg_catalog.has_function_privilege(runtime_role.role_name, expected.signature, 'EXECUTE')
        <> (runtime_role.role_kind = expected.role_kind) THEN
        CASE expected.role_kind
          WHEN 'web' THEN
            RAISE EXCEPTION 'web-only function grant is incomplete or cross-exposed: %', expected.signature;
          WHEN 'account' THEN
            RAISE EXCEPTION 'account-worker function grant is incomplete or cross-exposed: %', expected.signature;
          WHEN 'media' THEN
            RAISE EXCEPTION 'media-worker function grant is incomplete or cross-exposed: %', expected.signature;
          WHEN 'photobook' THEN
            RAISE EXCEPTION 'photobook-worker function grant is incomplete or cross-exposed: %', expected.signature;
          WHEN 'payment' THEN
            RAISE EXCEPTION 'payment-webhook function grant is incomplete or cross-exposed: %', expected.signature;
        END CASE;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM buildy_owner_internal_functions owner_boundary
    CROSS JOIN unnest(active_roles) role_candidate(role_name)
    WHERE pg_catalog.has_function_privilege(
      role_candidate.role_name,
      owner_boundary.signature,
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'an owner-only function is exposed to a runtime role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) privilege
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'a SECURITY DEFINER function remains executable by PUBLIC';
  END IF;

  SELECT role_map.role_name, role_map.role_kind, procedure.oid::regprocedure::text AS signature
  INTO unexpected
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
  CROSS JOIN LATERAL unnest(
    active_roles,
    ARRAY['web', 'account', 'media', 'photobook', 'payment']::text[]
  ) AS role_map(role_name, role_kind)
  WHERE namespace.nspname = 'public'
    AND procedure.prosecdef
    AND pg_catalog.has_function_privilege(role_map.role_name, procedure.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM buildy_expected_function_grants grant_row
      WHERE grant_row.signature::regprocedure = procedure.oid
        AND grant_row.role_kind = role_map.role_kind
    )
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'a runtime role can execute an unclassified SECURITY DEFINER function: % / %',
      unexpected.role_name,
      unexpected.signature;
  END IF;

  FOR retired IN
    SELECT retired_function.signature, procedure.proowner
    FROM buildy_retired_provider_functions retired_function
    JOIN pg_catalog.pg_proc procedure ON procedure.oid = retired_function.signature::regprocedure
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) privilege
      WHERE procedure.oid = retired.signature::regprocedure
        AND privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee <> retired.proowner
    ) THEN
      IF retired.signature LIKE '%peecho%' THEN
        RAISE EXCEPTION 'retired Peecho-fulfilment function remains executable: %', retired.signature;
      END IF;
      RAISE EXCEPTION 'retired e-mail-provider function remains executable: %', retired.signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    WHERE relation.oid IN (
      'public.projects'::regclass,
      'public.auth_identity_mappings'::regclass
    )
      AND NOT relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'required runtime tables do not have RLS enabled';
  END IF;
END
$verification$;

DROP TABLE buildy_retired_provider_functions;
DROP TABLE buildy_owner_internal_functions;
DROP TABLE buildy_expected_function_grants;

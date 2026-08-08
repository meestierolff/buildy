\set ON_ERROR_STOP on

\if :{?buildy_web_role}
\else
  \echo 'Gebruik -v buildy_web_role=<runtime-role>.'
  \quit 2
\endif
\if :{?buildy_email_worker_role}
\else
  \echo 'Gebruik -v buildy_email_worker_role=<e-mailworker-role>.'
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
\if :{?buildy_fulfilment_worker_role}
\else
  \echo 'Gebruik -v buildy_fulfilment_worker_role=<Peecho-fulfilmentworker-role>.'
  \quit 2
\endif

SELECT pg_catalog.set_config('buildy.setup.web_role', :'buildy_web_role', false);
SELECT pg_catalog.set_config('buildy.setup.account_worker_role', :'buildy_account_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.email_worker_role', :'buildy_email_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.media_worker_role', :'buildy_media_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.photobook_worker_role', :'buildy_photobook_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.payment_worker_role', :'buildy_payment_worker_role', false);
SELECT pg_catalog.set_config('buildy.setup.fulfilment_worker_role', :'buildy_fulfilment_worker_role', false);

DO $verification$
DECLARE
  web_role name := pg_catalog.current_setting('buildy.setup.web_role')::name;
  account_worker_role name := pg_catalog.current_setting('buildy.setup.account_worker_role')::name;
  email_worker_role name := pg_catalog.current_setting('buildy.setup.email_worker_role')::name;
  media_worker_role name := pg_catalog.current_setting('buildy.setup.media_worker_role')::name;
  photobook_worker_role name := pg_catalog.current_setting('buildy.setup.photobook_worker_role')::name;
  payment_worker_role name := pg_catalog.current_setting('buildy.setup.payment_worker_role')::name;
  fulfilment_worker_role name := pg_catalog.current_setting('buildy.setup.fulfilment_worker_role')::name;
  function_signature text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[web_role, account_worker_role, email_worker_role, media_worker_role, photobook_worker_role, payment_worker_role, fulfilment_worker_role]) runtime_role(role_name)
    LEFT JOIN pg_catalog.pg_roles role ON role.rolname = runtime_role.role_name
    WHERE role.oid IS NULL
      OR role.rolsuper
      OR role.rolcreatedb
      OR role.rolcreaterole
      OR role.rolreplication
      OR role.rolbypassrls
  ) THEN
    RAISE EXCEPTION 'a runtime role is absent or privileged';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles owner ON owner.oid = relation.relowner
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND owner.rolname IN (web_role, account_worker_role, email_worker_role, media_worker_role, photobook_worker_role, payment_worker_role, fulfilment_worker_role)
  ) THEN
    RAISE EXCEPTION 'a runtime role owns a public table and can bypass RLS';
  END IF;

  IF NOT pg_catalog.has_function_privilege(web_role, 'public.app_resolve_active_user(text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_provision_auth_identity(text,uuid,boolean)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_register_auth_email_recipient(text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_enqueue_auth_email(uuid,text,text,jsonb)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_users_are_blocked(uuid,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_can_view_profile(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_owns_project(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_can_view_project(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_can_view_update(uuid,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_can_manage_comment(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_can_view_notification_target(uuid,uuid,uuid,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_lock_social_user_pair(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_follow_state_allowed(uuid,relationship_status)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_social_project_context(uuid,boolean)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_resolve_engagement_mentions(uuid,uuid,uuid[])', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_enqueue_social_notification(uuid,text,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_enqueue_engagement_notification(uuid,text,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_set_social_access_email_preference(boolean)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_request_account_export(text,boolean,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_request_account_deletion(text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_request_project_deletion(uuid,integer,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_replay_moderation_report(text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_submit_moderation_report(uuid,text,text,text,uuid,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_replay_feedback_submission(text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_submit_feedback_submission(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_moderation_target_hidden(text,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_moderation_media_hidden(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_resolve_moderation_actor(text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_admin_list_moderation_reports(text,text,text,timestamptz,uuid,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_admin_load_moderation_report(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_admin_list_moderation_actions(uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_admin_apply_moderation_action(uuid,uuid,text,text,text,text,integer,uuid,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_reserve_beta_invite(text,text,text,text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_complete_beta_signup(text,text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(web_role, 'public.app_record_client_product_event(uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'web runtime boundary grants are incomplete';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_resolve_active_user(text)',
    'public.app_provision_auth_identity(text,uuid,boolean)',
    'public.app_register_auth_email_recipient(text,text,text)',
    'public.app_enqueue_auth_email(uuid,text,text,jsonb)',
    'public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)',
    'public.app_users_are_blocked(uuid,uuid)',
    'public.app_can_view_profile(uuid)',
    'public.app_owns_project(uuid)',
    'public.app_can_view_project(uuid)',
    'public.app_can_view_update(uuid,uuid)',
    'public.app_can_manage_comment(uuid)',
    'public.app_can_view_notification_target(uuid,uuid,uuid,uuid)',
    'public.app_lock_social_user_pair(uuid)',
    'public.app_follow_state_allowed(uuid,relationship_status)',
    'public.app_social_project_context(uuid,boolean)',
    'public.app_resolve_engagement_mentions(uuid,uuid,uuid[])',
    'public.app_enqueue_social_notification(uuid,text,uuid)',
    'public.app_enqueue_engagement_notification(uuid,text,uuid)',
    'public.app_set_social_access_email_preference(boolean)',
    'public.app_request_account_export(text,boolean,text)',
    'public.app_request_account_deletion(text,text)',
    'public.app_request_project_deletion(uuid,integer,text,text)',
    'public.app_replay_moderation_report(text,text)',
    'public.app_submit_moderation_report(uuid,text,text,text,uuid,text,text,text,text,text,text,text,text,text,text,text)',
    'public.app_replay_feedback_submission(text,text)',
    'public.app_submit_feedback_submission(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
    'public.app_moderation_target_hidden(text,uuid)',
    'public.app_moderation_media_hidden(uuid)',
    'public.app_resolve_moderation_actor(text)',
    'public.app_admin_list_moderation_reports(text,text,text,timestamptz,uuid,integer)',
    'public.app_admin_load_moderation_report(uuid)',
    'public.app_admin_list_moderation_actions(uuid)',
    'public.app_admin_apply_moderation_action(uuid,uuid,text,text,text,text,integer,uuid,text)',
    'public.app_reserve_beta_invite(text,text,text,text,text,text)',
    'public.app_complete_beta_signup(text,text,text,text)',
    'public.app_record_client_product_event(uuid,text,text,jsonb)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(fulfilment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'web-only function grant is incomplete or cross-exposed: %', function_signature;
    END IF;
  END LOOP;

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

  IF pg_catalog.has_function_privilege(email_worker_role, 'public.app_can_view_update(uuid,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_can_view_update(uuid,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_can_manage_comment(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_can_manage_comment(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_can_view_notification_target(uuid,uuid,uuid,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_can_view_notification_target(uuid,uuid,uuid,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_lock_social_user_pair(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_lock_social_user_pair(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_follow_state_allowed(uuid,relationship_status)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_follow_state_allowed(uuid,relationship_status)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_social_project_context(uuid,boolean)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_social_project_context(uuid,boolean)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_resolve_engagement_mentions(uuid,uuid,uuid[])', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_resolve_engagement_mentions(uuid,uuid,uuid[])', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_enqueue_social_notification(uuid,text,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_enqueue_social_notification(uuid,text,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_enqueue_engagement_notification(uuid,text,uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_enqueue_engagement_notification(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'engagement functions are exposed outside the web role';
  END IF;

  IF pg_catalog.has_function_privilege(web_role, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_claim(text,integer,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_prepare(uuid,text,text,text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_acknowledge(uuid,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_complete(uuid,text,text,text,timestamptz)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_fail(uuid,text,text,integer,boolean)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_reconcile_brevo_delivery_events(integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_load_order(uuid,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_load_community_receipt(uuid,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_load_account_event(uuid,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(email_worker_role, 'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_apply_brevo_delivery_event(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'email worker grants are incomplete or cross-exposed';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_email_worker_claim(text,integer,integer)',
    'public.app_email_worker_prepare(uuid,text,text,text,text,text)',
    'public.app_email_worker_acknowledge(uuid,text)',
    'public.app_email_worker_complete(uuid,text,text,text,timestamptz)',
    'public.app_email_worker_fail(uuid,text,text,integer,boolean)',
    'public.app_reconcile_brevo_delivery_events(integer)',
    'public.app_email_worker_load_order(uuid,text)',
    'public.app_email_worker_load_community_receipt(uuid,text)',
    'public.app_email_worker_load_account_event(uuid,text)',
    'public.app_email_worker_prepare_account(uuid,text,text,text,text,text)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(fulfilment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'email-worker function grant is incomplete or cross-exposed: %', function_signature;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_enqueue_migration_account_email(uuid,text,text)',
    'public.app_email_event_is_supported(text,text)',
    'public.app_migration_grant_role(uuid,uuid,text,text,text,timestamptz,timestamptz)',
    'public.app_migration_revoke_role(uuid,uuid,text,text)',
    'public.app_project_worker_finalize_deletion(text,uuid)',
    'public.app_create_beta_invite(uuid,text,text,integer,timestamptz,text,text)',
    'public.app_revoke_beta_invite(text,text)',
    'public.app_product_event_properties_valid(text,jsonb)',
    'public.app_product_event_subject_hash(uuid)',
    'public.app_insert_product_event(text,text,uuid)',
    'public.app_capture_product_event()'
  ] LOOP
    IF pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(fulfilment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'cutover/internal e-mail function is exposed to a runtime role: %', function_signature;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_function_privilege(web_role, 'public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(web_role, 'public.app_apply_brevo_delivery_event(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, 'public.app_ingest_brevo_delivery_event(text,text,text,text,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Brevo webhook grants are incomplete or cross-exposed';
  END IF;

  IF pg_catalog.has_function_privilege(web_role, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_claim_outbox_event(text,text,integer)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_ack_outbox_event(text,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_retry_outbox_event(text,uuid,text,integer,boolean)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_begin_media_processing_job(text,uuid)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_finalize_media_processing_job(text,uuid,uuid,text,text,bigint,text,integer,integer,jsonb)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_fail_media_processing_job(text,uuid,uuid,text,integer,boolean)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(media_worker_role, 'public.app_media_protected_object_keys(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'media worker grants are incomplete or cross-exposed';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_claim_outbox_event(text,text,integer)',
    'public.app_ack_outbox_event(text,uuid)',
    'public.app_retry_outbox_event(text,uuid,text,integer,boolean)',
    'public.app_begin_media_processing_job(text,uuid)',
    'public.app_finalize_media_processing_job(text,uuid,uuid,text,text,bigint,text,integer,integer,jsonb)',
    'public.app_fail_media_processing_job(text,uuid,uuid,text,integer,boolean)',
    'public.app_media_protected_object_keys(text[])'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'media-worker function grant is incomplete or cross-exposed: %', function_signature;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_photobook_worker_claim(text,integer)',
    'public.app_begin_photobook_render(text,uuid)',
    'public.app_finalize_photobook_render(text,uuid,uuid,text,bigint,integer,text,text,text,text)',
    'public.app_fail_photobook_render(text,uuid,uuid,text,integer,boolean)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'photobook-worker function grant is incomplete or cross-exposed: %', function_signature;
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_account_worker_claim_export(text,integer)',
    'public.app_account_worker_begin_export(text,uuid)',
    'public.app_account_worker_finalize_export(text,uuid,text,bigint,text)',
    'public.app_account_worker_fail_export(text,uuid,text,integer,boolean)',
    'public.app_account_worker_claim_expired_export(text,integer)',
    'public.app_account_worker_finalize_export_cleanup(text,uuid)',
    'public.app_account_worker_fail_export_cleanup(text,uuid,text,integer,boolean)',
    'public.app_account_worker_claim_deletion(text,integer)',
    'public.app_account_worker_begin_deletion(text,uuid)',
    'public.app_account_worker_verify_deletion_asset(text,uuid,uuid)',
    'public.app_account_worker_fail_deletion(text,uuid,uuid,text,integer,boolean)',
    'public.app_account_worker_finalize_deletion(text,uuid)',
    'public.app_account_worker_finalize_deletion_job(text,uuid)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(fulfilment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'account-worker function grant is incomplete or cross-exposed: %', function_signature;
    END IF;
  END LOOP;

  function_signature := 'public.app_apply_stripe_payment_event(text,text,text,text,timestamptz,uuid,text,text,text,text,text,text,integer,integer,text,text)';
  IF NOT pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'payment-webhook function grant is incomplete or cross-exposed';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.app_peecho_worker_claim(text,text,integer)',
    'public.app_begin_peecho_fulfilment(text,uuid,text)',
    'public.app_begin_peecho_order_create(text,uuid,text,text,text)',
    'public.app_persist_peecho_order_created(text,uuid,text,text,text,text)',
    'public.app_begin_peecho_order_payment(text,uuid,text,text)',
    'public.app_finalize_peecho_order_status(text,uuid,text,text,text,text,text)',
    'public.app_retry_peecho_fulfilment(text,uuid,text,integer,boolean)',
    'public.app_mark_peecho_manual_review(text,uuid,text)',
    'public.app_record_peecho_callback(text,text,text,text,text,text,text,text,text,timestamptz)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege(fulfilment_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(web_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(account_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(email_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(media_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(photobook_worker_role, function_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege(payment_worker_role, function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Peecho-fulfilment function grant is incomplete or cross-exposed: %', function_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND pg_catalog.has_function_privilege(fulfilment_worker_role, procedure.oid, 'EXECUTE')
      AND procedure.oid NOT IN (
        'public.app_peecho_worker_claim(text,text,integer)'::regprocedure,
        'public.app_begin_peecho_fulfilment(text,uuid,text)'::regprocedure,
        'public.app_begin_peecho_order_create(text,uuid,text,text,text)'::regprocedure,
        'public.app_persist_peecho_order_created(text,uuid,text,text,text,text)'::regprocedure,
        'public.app_begin_peecho_order_payment(text,uuid,text,text)'::regprocedure,
        'public.app_finalize_peecho_order_status(text,uuid,text,text,text,text,text)'::regprocedure,
        'public.app_retry_peecho_fulfilment(text,uuid,text,integer,boolean)'::regprocedure,
        'public.app_mark_peecho_manual_review(text,uuid,text)'::regprocedure,
        'public.app_record_peecho_callback(text,text,text,text,text,text,text,text,text,timestamptz)'::regprocedure
      )
  ) THEN
    RAISE EXCEPTION 'Peecho fulfilment role can execute an out-of-bound SECURITY DEFINER function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants privilege
    WHERE privilege.grantee IN (
      account_worker_role::text,
      email_worker_role::text,
      media_worker_role::text,
      photobook_worker_role::text,
      payment_worker_role::text,
      fulfilment_worker_role::text
    )
      AND privilege.table_schema = 'public'
      AND privilege.privilege_type IN (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
  ) THEN
    RAISE EXCEPTION 'a worker role has direct table privileges';
  END IF;

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

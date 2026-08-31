-- Already-queued requested-access e-mails must remain preparable after the
-- access request advances to a later state.

CREATE OR REPLACE FUNCTION public.app_email_worker_prepare_account(
  requested_event_id uuid,
  requested_lease_owner text,
  requested_idempotency_key text,
  requested_recipient_hash text,
  requested_template_key text,
  requested_template_version text
)
RETURNS TABLE (status text, first_attempt_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_event public.outbox_events%ROWTYPE;
  selected_delivery public.email_deliveries%ROWTYPE;
  selected_recipient_user_id uuid;
  selected_recipient_hash text;
  expected_idempotency_key text;
  expected_template_key text;
  inserted_count integer;
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR char_length(requested_idempotency_key) NOT BETWEEN 16 AND 160
    OR requested_recipient_hash !~ '^[0-9a-f]{64}$'
    OR requested_template_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid account email preparation';
  END IF;

  SELECT queued.* INTO selected_event
  FROM public.outbox_events queued
  WHERE queued.id = requested_event_id
  FOR UPDATE;
  IF NOT FOUND
    OR selected_event.status <> 'claimed'
    OR selected_event.lease_owner IS DISTINCT FROM requested_lease_owner
    OR selected_event.lease_expires_at <= clock_timestamp()
    OR NOT public.app_email_event_is_supported(selected_event.aggregate_type, selected_event.event_type) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  IF selected_event.aggregate_type = 'account_lifecycle'
    AND selected_event.event_type = 'lifecycle.welcome.requested.v1' THEN
    SELECT account.id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.app_users account
    JOIN public.profiles profile ON profile.user_id = account.id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE account.id = selected_event.aggregate_id
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object('schemaVersion', 1, 'userId', account.id);
    expected_template_key := 'lifecycle.welcome';
    expected_idempotency_key := 'account:' || selected_event.aggregate_id::text || ':email:welcome:v1';
  ELSIF selected_event.aggregate_type = 'project_access'
    AND selected_event.event_type = 'social.access_requested.requested.v1' THEN
    SELECT access_request.project_owner_id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.project_access_requests access_request
    JOIN public.projects project ON project.id = access_request.project_id
    JOIN public.app_users account ON account.id = access_request.project_owner_id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE access_request.id = selected_event.aggregate_id
      AND recipient.social_access_enabled
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1, 'requestId', access_request.id, 'projectId', access_request.project_id
      );
    expected_template_key := 'social.access_requested';
    expected_idempotency_key := 'access-request:' || selected_event.aggregate_id::text || ':email:requested:v1';
  ELSIF selected_event.aggregate_type = 'project_access'
    AND selected_event.event_type = 'social.access_accepted.requested.v1' THEN
    SELECT access_request.requester_id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.project_access_requests access_request
    JOIN public.projects project ON project.id = access_request.project_id
    JOIN public.app_users account ON account.id = access_request.requester_id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE access_request.id = selected_event.aggregate_id
      AND access_request.status = 'accepted'
      AND recipient.social_access_enabled
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1, 'requestId', access_request.id, 'projectId', access_request.project_id
      );
    expected_template_key := 'social.access_accepted';
    expected_idempotency_key := 'access-request:' || selected_event.aggregate_id::text || ':email:accepted:v1';
  ELSIF selected_event.aggregate_type = 'account_security'
    AND selected_event.event_type = 'security.account_alert.requested.v1' THEN
    SELECT job.requested_by_id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.deletion_jobs job
    JOIN public.app_users account ON account.id = job.requested_by_id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE job.id = selected_event.aggregate_id
      AND job.kind = 'account'
      AND account.status IN ('active', 'deletion_pending')
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1, 'deletionJobId', job.id, 'accountAction', 'deletion_requested'
      );
    expected_template_key := 'security.account_alert';
    expected_idempotency_key := 'deletion-job:' || selected_event.aggregate_id::text || ':email:security-requested:v1';
  ELSIF selected_event.aggregate_type = 'identity_migration'
    AND selected_event.event_type = 'migration.account.requested.v1' THEN
    SELECT account.id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.app_users account
    JOIN public.profiles profile ON profile.user_id = account.id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE account.id = selected_event.aggregate_id
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object('schemaVersion', 1, 'userId', account.id);
    expected_template_key := 'migration.account';
    expected_idempotency_key := 'account:' || selected_event.aggregate_id::text || ':email:migration:v1';
  END IF;

  IF selected_recipient_user_id IS NULL
    OR selected_recipient_hash IS NULL
    OR expected_template_key IS NULL
    OR expected_idempotency_key IS NULL
    OR selected_event.idempotency_key IS DISTINCT FROM expected_idempotency_key
    OR requested_idempotency_key IS DISTINCT FROM expected_idempotency_key
    OR requested_recipient_hash IS DISTINCT FROM selected_recipient_hash
    OR requested_template_key IS DISTINCT FROM expected_template_key THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'account email metadata does not match';
  END IF;

  INSERT INTO public.email_deliveries (
    outbox_event_id, recipient_user_id, recipient_hash, provider,
    template_key, template_version, idempotency_key, status, attempt_count
  ) VALUES (
    requested_event_id, selected_recipient_user_id, requested_recipient_hash,
    'brevo', requested_template_key, requested_template_version,
    requested_idempotency_key, 'queued', 1
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT delivery.* INTO selected_delivery
  FROM public.email_deliveries delivery
  WHERE delivery.idempotency_key = requested_idempotency_key
  FOR UPDATE;
  IF NOT FOUND
    OR selected_delivery.outbox_event_id <> requested_event_id
    OR selected_delivery.recipient_user_id IS DISTINCT FROM selected_recipient_user_id
    OR selected_delivery.recipient_hash <> requested_recipient_hash
    OR selected_delivery.template_key <> requested_template_key
    OR selected_delivery.template_version <> requested_template_version THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'email delivery idempotency collision';
  END IF;

  IF inserted_count = 0 AND selected_delivery.status IN ('queued', 'deferred') THEN
    UPDATE public.email_deliveries delivery
    SET status = 'queued',
        attempt_count = delivery.attempt_count + 1,
        failure_code = NULL,
        updated_at = clock_timestamp()
    WHERE delivery.id = selected_delivery.id
    RETURNING delivery.* INTO selected_delivery;
  END IF;
  IF selected_delivery.status NOT IN ('queued', 'deferred', 'submitted', 'delivered') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'email delivery is terminal';
  END IF;

  RETURN QUERY SELECT selected_delivery.status::text, selected_delivery.created_at;
END
$function$;
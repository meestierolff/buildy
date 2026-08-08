CREATE OR REPLACE FUNCTION app_email_worker_claim(
  requested_lease_owner text,
  requested_lease_seconds integer,
  requested_batch_size integer
)
RETURNS TABLE (
  id uuid,
  aggregate_id uuid,
  aggregate_type text,
  event_type text,
  idempotency_key text,
  payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_lease_seconds NOT BETWEEN 30 AND 300
    OR requested_batch_size NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email worker claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT queued.id
    FROM public.outbox_events AS queued
    WHERE queued.aggregate_type = 'auth_email'
      AND queued.event_type IN (
        'auth.email.verify_email',
        'auth.email.magic_link',
        'auth.email.reset_password'
      )
      AND (
        (
          queued.status IN ('pending', 'retry')
          AND queued.available_at <= clock_timestamp()
        )
        OR (
          queued.status = 'claimed'
          AND queued.lease_expires_at <= clock_timestamp()
        )
      )
    ORDER BY queued.available_at, queued.created_at, queued.id
    FOR UPDATE SKIP LOCKED
    LIMIT requested_batch_size
  )
  UPDATE public.outbox_events AS claimed
  SET status = 'claimed',
      attempt_count = claimed.attempt_count + 1,
      lease_owner = requested_lease_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => requested_lease_seconds),
      updated_at = clock_timestamp()
  FROM candidates
  WHERE claimed.id = candidates.id
  RETURNING
    claimed.id,
    claimed.aggregate_id,
    claimed.aggregate_type,
    claimed.event_type,
    claimed.idempotency_key,
    claimed.payload,
    claimed.attempt_count;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_email_worker_prepare(
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
  inserted_count integer;
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_idempotency_key !~ '^auth-email:v1:(verify_email|magic_link|reset_password):[0-9a-f]{64}$'
    OR requested_recipient_hash !~ '^[0-9a-f]{64}$'
    OR requested_template_key !~ '^auth\.(verify_email|magic_link|reset_password)$'
    OR requested_template_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email delivery preparation';
  END IF;

  SELECT queued.* INTO selected_event
  FROM public.outbox_events AS queued
  WHERE queued.id = requested_event_id
  FOR UPDATE;

  IF NOT FOUND
    OR selected_event.aggregate_type <> 'auth_email'
    OR selected_event.status <> 'claimed'
    OR selected_event.lease_owner IS DISTINCT FROM requested_lease_owner
    OR selected_event.lease_expires_at <= clock_timestamp()
    OR selected_event.idempotency_key <> requested_idempotency_key THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  INSERT INTO public.email_deliveries (
    outbox_event_id,
    recipient_hash,
    provider,
    template_key,
    template_version,
    idempotency_key,
    status,
    attempt_count
  ) VALUES (
    requested_event_id,
    requested_recipient_hash,
    'brevo',
    requested_template_key,
    requested_template_version,
    requested_idempotency_key,
    'queued',
    1
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT delivery.* INTO selected_delivery
  FROM public.email_deliveries AS delivery
  WHERE delivery.idempotency_key = requested_idempotency_key
  FOR UPDATE;

  IF NOT FOUND
    OR selected_delivery.outbox_event_id <> requested_event_id
    OR selected_delivery.recipient_hash <> requested_recipient_hash
    OR selected_delivery.template_key <> requested_template_key
    OR selected_delivery.template_version <> requested_template_version THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'email delivery idempotency collision';
  END IF;

  IF inserted_count = 0 AND selected_delivery.status IN ('queued', 'deferred') THEN
    UPDATE public.email_deliveries AS delivery
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_email_worker_acknowledge(
  requested_event_id uuid,
  requested_lease_owner text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR NOT EXISTS (
      SELECT 1
      FROM public.email_deliveries AS delivery
      WHERE delivery.outbox_event_id = requested_event_id
        AND delivery.status IN ('submitted', 'delivered')
        AND delivery.provider_message_id IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email delivery cannot be acknowledged';
  END IF;

  UPDATE public.outbox_events AS queued
  SET status = 'delivered',
      delivered_at = COALESCE(queued.delivered_at, clock_timestamp()),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'auth_email'
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_email_worker_complete(
  requested_event_id uuid,
  requested_lease_owner text,
  requested_provider text,
  requested_provider_message_id text,
  requested_submitted_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_provider <> 'brevo'
    OR char_length(requested_provider_message_id) NOT BETWEEN 1 AND 500
    OR requested_submitted_at NOT BETWEEN clock_timestamp() - interval '1 hour' AND clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email provider receipt';
  END IF;

  PERFORM 1
  FROM public.outbox_events AS queued
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'auth_email'
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  UPDATE public.email_deliveries AS delivery
  SET provider = requested_provider,
      provider_message_id = requested_provider_message_id,
      status = 'submitted',
      submitted_at = requested_submitted_at,
      failed_at = NULL,
      failure_code = NULL,
      updated_at = clock_timestamp()
  WHERE delivery.outbox_event_id = requested_event_id
    AND delivery.status IN ('queued', 'deferred');
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'email delivery is not sendable';
  END IF;

  UPDATE public.outbox_events AS queued
  SET status = 'delivered',
      delivered_at = clock_timestamp(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE queued.id = requested_event_id;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_email_worker_fail(
  requested_event_id uuid,
  requested_lease_owner text,
  requested_error_code text,
  requested_delay_seconds integer,
  requested_dead_letter boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_error_code !~ '^[a-z0-9_]{1,80}$'
    OR requested_delay_seconds NOT BETWEEN 0 AND 900
    OR (requested_dead_letter AND requested_delay_seconds <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email worker failure';
  END IF;

  PERFORM 1
  FROM public.outbox_events AS queued
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'auth_email'
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  UPDATE public.email_deliveries AS delivery
  SET status = CASE WHEN requested_dead_letter THEN 'failed'::email_delivery_status ELSE 'deferred'::email_delivery_status END,
      failed_at = CASE WHEN requested_dead_letter THEN clock_timestamp() ELSE NULL END,
      failure_code = requested_error_code,
      updated_at = clock_timestamp()
  WHERE delivery.outbox_event_id = requested_event_id
    AND delivery.status IN ('queued', 'deferred');

  UPDATE public.outbox_events AS queued
  SET status = CASE WHEN requested_dead_letter THEN 'dead_letter'::outbox_status ELSE 'retry'::outbox_status END,
      available_at = clock_timestamp() + make_interval(secs => requested_delay_seconds),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = requested_error_code,
      updated_at = clock_timestamp()
  WHERE queued.id = requested_event_id;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_worker_claim(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_worker_prepare(uuid, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_worker_acknowledge(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_worker_complete(uuid, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_email_worker_fail(uuid, text, text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_apply_brevo_delivery_event(target_inbox_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  inbox_event public.provider_event_inbox%ROWTYPE;
  delivery public.email_deliveries%ROWTYPE;
  event_at timestamptz;
  previous_event_at timestamptz;
  mapped_status email_delivery_status;
  next_status email_delivery_status;
BEGIN
  SELECT inbox.* INTO inbox_event
  FROM public.provider_event_inbox AS inbox
  WHERE inbox.id = target_inbox_id
  FOR UPDATE;

  IF NOT FOUND
    OR inbox_event.provider <> 'brevo'
    OR inbox_event.environment NOT IN ('preview', 'staging', 'production', 'test') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Brevo inbox event';
  END IF;
  IF inbox_event.status = 'applied' THEN
    RETURN true;
  END IF;
  IF inbox_event.status <> 'received' THEN
    RETURN false;
  END IF;

  SELECT email.* INTO delivery
  FROM public.email_deliveries AS email
  WHERE email.provider = 'brevo'
    AND email.provider_message_id = inbox_event.reference
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  event_at := (inbox_event.payload_summary ->> 'eventAt')::timestamptz;
  IF delivery.metadata ->> 'lastEventAt' ~ '^20[0-9]{2}-' THEN
    previous_event_at := (delivery.metadata ->> 'lastEventAt')::timestamptz;
  END IF;

  mapped_status := CASE inbox_event.event_type
    WHEN 'request' THEN 'submitted'::email_delivery_status
    WHEN 'delivered' THEN 'delivered'::email_delivery_status
    WHEN 'deferred' THEN 'deferred'::email_delivery_status
    WHEN 'soft_bounce' THEN 'deferred'::email_delivery_status
    WHEN 'hard_bounce' THEN 'bounced'::email_delivery_status
    WHEN 'invalid_email' THEN 'bounced'::email_delivery_status
    WHEN 'blocked' THEN 'bounced'::email_delivery_status
    WHEN 'spam' THEN 'complained'::email_delivery_status
    WHEN 'error' THEN 'failed'::email_delivery_status
    ELSE NULL
  END;
  IF mapped_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported Brevo delivery event';
  END IF;

  IF previous_event_at IS NULL OR event_at >= previous_event_at THEN
    next_status := CASE
      WHEN delivery.status = 'complained' THEN delivery.status
      WHEN mapped_status = 'complained' THEN mapped_status
      WHEN delivery.status = 'delivered' THEN delivery.status
      WHEN mapped_status = 'delivered' THEN mapped_status
      WHEN delivery.status = 'bounced' THEN delivery.status
      WHEN mapped_status = 'bounced' THEN mapped_status
      WHEN delivery.status = 'failed' AND mapped_status IN ('submitted', 'deferred') THEN delivery.status
      ELSE mapped_status
    END;

    UPDATE public.email_deliveries AS email
    SET status = next_status,
        delivered_at = CASE
          WHEN next_status = 'delivered' THEN coalesce(email.delivered_at, event_at)
          ELSE email.delivered_at
        END,
        failed_at = CASE
          WHEN next_status IN ('bounced', 'failed', 'complained') THEN coalesce(email.failed_at, event_at)
          ELSE email.failed_at
        END,
        failure_code = CASE
          WHEN next_status IN ('bounced', 'failed', 'complained', 'deferred') THEN 'brevo_' || inbox_event.event_type
          ELSE NULL
        END,
        metadata = email.metadata || pg_catalog.jsonb_build_object(
          'lastEventAt', event_at,
          'lastEventType', inbox_event.event_type
        ),
        updated_at = clock_timestamp()
    WHERE email.id = delivery.id;
  END IF;

  UPDATE public.provider_event_inbox AS inbox
  SET status = 'applied',
      attempt_count = inbox.attempt_count + 1,
      applied_at = clock_timestamp(),
      last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE inbox.id = inbox_event.id;
  RETURN true;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_ingest_brevo_delivery_event(
  requested_environment text,
  requested_provider_event_id text,
  requested_event_type text,
  requested_provider_message_id text,
  requested_payload_sha256 text,
  requested_event_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  inbox_id uuid;
  existing_event public.provider_event_inbox%ROWTYPE;
BEGIN
  IF requested_environment NOT IN ('preview', 'staging', 'production', 'test')
    OR requested_provider_event_id !~ '^[0-9a-f]{64}$'
    OR requested_event_type NOT IN (
      'request', 'delivered', 'deferred', 'soft_bounce', 'hard_bounce',
      'invalid_email', 'blocked', 'spam', 'error'
    )
    OR requested_provider_message_id !~ '^[^[:cntrl:][:space:]]{1,500}$'
    OR requested_payload_sha256 !~ '^[0-9a-f]{64}$'
    OR requested_event_at NOT BETWEEN '2020-01-01T00:00:00Z'::timestamptz AND clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Brevo delivery event';
  END IF;

  INSERT INTO public.provider_event_inbox (
    provider,
    environment,
    provider_event_id,
    event_type,
    reference,
    payload_sha256,
    payload_summary,
    signature_verified_at,
    status
  ) VALUES (
    'brevo',
    requested_environment,
    requested_provider_event_id,
    requested_event_type,
    requested_provider_message_id,
    requested_payload_sha256,
    pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eventAt', requested_event_at,
      'eventStatus', requested_event_type
    ),
    clock_timestamp(),
    'received'
  )
  ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
  RETURNING id INTO inbox_id;

  IF inbox_id IS NULL THEN
    SELECT inbox.* INTO existing_event
    FROM public.provider_event_inbox AS inbox
    WHERE inbox.provider = 'brevo'
      AND inbox.environment = requested_environment
      AND inbox.provider_event_id = requested_provider_event_id;
    IF NOT FOUND
      OR existing_event.event_type <> requested_event_type
      OR existing_event.reference <> requested_provider_message_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Brevo event idempotency collision';
    END IF;
    inbox_id := existing_event.id;
  END IF;

  RETURN public.app_apply_brevo_delivery_event(inbox_id);
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_reconcile_brevo_delivery_events(requested_batch_size integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  event_id uuid;
  applied_count integer := 0;
BEGIN
  IF requested_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid Brevo reconciliation batch';
  END IF;

  FOR event_id IN
    SELECT inbox.id
    FROM public.provider_event_inbox AS inbox
    JOIN public.email_deliveries AS delivery
      ON delivery.provider = 'brevo'
     AND delivery.provider_message_id = inbox.reference
    WHERE inbox.provider = 'brevo'
      AND inbox.status = 'received'
    ORDER BY inbox.received_at, inbox.id
    FOR UPDATE OF inbox SKIP LOCKED
    LIMIT requested_batch_size
  LOOP
    IF public.app_apply_brevo_delivery_event(event_id) THEN
      applied_count := applied_count + 1;
    END IF;
  END LOOP;

  RETURN applied_count;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_apply_brevo_delivery_event(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ingest_brevo_delivery_event(text, text, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_reconcile_brevo_delivery_events(integer) FROM PUBLIC;

-- Extend the existing Brevo outbox worker with legal order confirmations and
-- lifecycle messages. The email role never receives table privileges: this
-- boundary releases encrypted PII only for the exact order event it leased.

CREATE OR REPLACE FUNCTION public.app_email_worker_claim(
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
    WHERE (
        (
          queued.aggregate_type = 'auth_email'
          AND queued.event_type IN (
            'auth.email.verify_email',
            'auth.email.magic_link',
            'auth.email.reset_password'
          )
        ) OR (
          queued.aggregate_type = 'photobook_order'
          AND queued.event_type IN (
            'order.email.confirmation.requested.v1',
            'order.email.payment_failed.requested.v1',
            'order.email.in_production.requested.v1',
            'order.email.shipped.requested.v1',
            'order.email.refund_review.requested.v1'
          )
        ) OR (
          queued.aggregate_type = 'moderation_report'
          AND queued.event_type = 'moderation.report.received.requested.v1'
        ) OR (
          queued.aggregate_type = 'feedback_submission'
          AND queued.event_type = 'support.confirmation.requested.v1'
        )
      )
      AND (
        (
          queued.status IN ('pending', 'retry')
          AND queued.available_at <= clock_timestamp()
        ) OR (
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
CREATE OR REPLACE FUNCTION public.app_email_worker_load_order(
  requested_event_id uuid,
  requested_lease_owner text
)
RETURNS TABLE (
  order_id uuid,
  owner_id uuid,
  order_number text,
  currency text,
  quantity integer,
  subtotal_minor integer,
  shipping_minor integer,
  tax_minor integer,
  total_minor integer,
  refunded_minor integer,
  shipping_country text,
  customer_email_ciphertext text,
  shipping_details_ciphertext text,
  checkout_snapshot jsonb,
  seller_snapshot jsonb,
  terms_version text,
  delivery_estimate text,
  status text,
  payment_status text,
  fulfilment_status text,
  tracking_url text,
  created_at timestamptz,
  paid_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email worker order load';
  END IF;

  RETURN QUERY
  SELECT
    orders.id,
    orders.owner_id,
    orders.order_number,
    orders.currency,
    orders.quantity,
    orders.subtotal_minor,
    orders.shipping_minor,
    orders.tax_minor,
    orders.total_minor,
    orders.refunded_minor,
    orders.shipping_country,
    orders.customer_email_ciphertext,
    orders.shipping_details_ciphertext,
    orders.checkout_snapshot,
    orders.seller_snapshot,
    orders.terms_version,
    orders.delivery_estimate,
    orders.status::text,
    orders.payment_status::text,
    orders.fulfilment_status::text,
    orders.tracking_url,
    orders.created_at,
    orders.paid_at
  FROM public.outbox_events AS queued
  JOIN public.photobook_orders AS orders
    ON orders.id = queued.aggregate_id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'photobook_order'
    AND queued.event_type IN (
      'order.email.confirmation.requested.v1',
      'order.email.payment_failed.requested.v1',
      'order.email.in_production.requested.v1',
      'order.email.shipped.requested.v1',
      'order.email.refund_review.requested.v1'
    )
    AND queued.payload @> jsonb_build_object(
      'schemaVersion', 1,
      'orderId', queued.aggregate_id
    )
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp();
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_prepare(
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
  expected_idempotency_key text;
  expected_template_key text;
  inserted_count integer;
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR char_length(requested_idempotency_key) NOT BETWEEN 16 AND 160
    OR requested_recipient_hash !~ '^[0-9a-f]{64}$'
    OR requested_template_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email delivery preparation';
  END IF;

  SELECT queued.* INTO selected_event
  FROM public.outbox_events AS queued
  WHERE queued.id = requested_event_id
  FOR UPDATE;

  IF NOT FOUND
    OR selected_event.status <> 'claimed'
    OR selected_event.lease_owner IS DISTINCT FROM requested_lease_owner
    OR selected_event.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  IF selected_event.aggregate_type = 'auth_email' THEN
    expected_template_key := CASE selected_event.event_type
      WHEN 'auth.email.verify_email' THEN 'auth.verify_email'
      WHEN 'auth.email.magic_link' THEN 'auth.magic_link'
      WHEN 'auth.email.reset_password' THEN 'auth.reset_password'
      ELSE NULL
    END;
    IF selected_event.idempotency_key !~ '^auth-email:v1:(verify_email|magic_link|reset_password):[0-9a-f]{64}$' THEN
      expected_template_key := NULL;
    END IF;
    expected_idempotency_key := selected_event.idempotency_key;
  ELSIF selected_event.aggregate_type = 'photobook_order' THEN
    SELECT orders.owner_id INTO selected_recipient_user_id
    FROM public.photobook_orders AS orders
    WHERE orders.id = selected_event.aggregate_id;

    expected_template_key := CASE selected_event.event_type
      WHEN 'order.email.confirmation.requested.v1' THEN 'order.confirmation'
      WHEN 'order.email.payment_failed.requested.v1' THEN 'order.payment_failed'
      WHEN 'order.email.in_production.requested.v1' THEN 'order.in_production'
      WHEN 'order.email.shipped.requested.v1' THEN 'order.shipped'
      WHEN 'order.email.refund_review.requested.v1' THEN 'order.refund_review'
      ELSE NULL
    END;
    expected_idempotency_key := CASE selected_event.event_type
      WHEN 'order.email.confirmation.requested.v1' THEN 'order:' || selected_event.aggregate_id::text || ':email:confirmation:v1'
      WHEN 'order.email.payment_failed.requested.v1' THEN 'order:' || selected_event.aggregate_id::text || ':email:payment-failed:v1'
      WHEN 'order.email.in_production.requested.v1' THEN 'order:' || selected_event.aggregate_id::text || ':email:in-production:v1'
      WHEN 'order.email.shipped.requested.v1' THEN 'order:' || selected_event.aggregate_id::text || ':email:shipped:v1'
      WHEN 'order.email.refund_review.requested.v1' THEN 'order:' || selected_event.aggregate_id::text || ':email:refund-review:v1'
      ELSE NULL
    END;
  ELSIF selected_event.aggregate_type = 'moderation_report' THEN
    SELECT report.reporter_id INTO selected_recipient_user_id
    FROM public.moderation_reports AS report
    WHERE report.id = selected_event.aggregate_id
      AND report.reporter_contact_ciphertext IS NOT NULL
      AND report.contact_hash IS NOT NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1,
        'reportId', report.id,
        'receiptCode', report.receipt_code
      );

    IF FOUND THEN
      expected_template_key := CASE selected_event.event_type
        WHEN 'moderation.report.received.requested.v1' THEN 'moderation.report_received'
        ELSE NULL
      END;
      expected_idempotency_key := 'moderation-report:' || selected_event.aggregate_id::text || ':email:received:v1';
    END IF;
  ELSIF selected_event.aggregate_type = 'feedback_submission' THEN
    SELECT submission.submitted_by_id INTO selected_recipient_user_id
    FROM public.feedback_submissions AS submission
    WHERE submission.id = selected_event.aggregate_id
      AND submission.kind IN ('support', 'third_party_request', 'appeal')
      AND submission.contact_ciphertext IS NOT NULL
      AND submission.contact_hash IS NOT NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1,
        'submissionId', submission.id,
        'kind', submission.kind,
        'receiptCode', submission.receipt_code
      );

    IF FOUND THEN
      expected_template_key := CASE selected_event.event_type
        WHEN 'support.confirmation.requested.v1' THEN 'support.confirmation'
        ELSE NULL
      END;
      expected_idempotency_key := 'feedback-submission:' || selected_event.aggregate_id::text || ':email:confirmation:v1';
    END IF;
  END IF;

  IF expected_template_key IS NULL
    OR expected_idempotency_key IS NULL
    OR selected_event.idempotency_key IS DISTINCT FROM expected_idempotency_key
    OR requested_idempotency_key IS DISTINCT FROM expected_idempotency_key
    OR requested_template_key IS DISTINCT FROM expected_template_key
    OR (selected_event.aggregate_type = 'photobook_order' AND selected_recipient_user_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'email event and delivery metadata do not match';
  END IF;

  INSERT INTO public.email_deliveries (
    outbox_event_id,
    recipient_user_id,
    recipient_hash,
    provider,
    template_key,
    template_version,
    idempotency_key,
    status,
    attempt_count
  ) VALUES (
    requested_event_id,
    selected_recipient_user_id,
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
    OR selected_delivery.recipient_user_id IS DISTINCT FROM selected_recipient_user_id
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
CREATE OR REPLACE FUNCTION public.app_email_worker_acknowledge(
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
    AND (
      (
        queued.aggregate_type = 'auth_email'
        AND queued.event_type IN (
          'auth.email.verify_email',
          'auth.email.magic_link',
          'auth.email.reset_password'
        )
      ) OR (
        queued.aggregate_type = 'photobook_order'
        AND queued.event_type IN (
          'order.email.confirmation.requested.v1',
          'order.email.payment_failed.requested.v1',
          'order.email.in_production.requested.v1',
          'order.email.shipped.requested.v1',
          'order.email.refund_review.requested.v1'
        )
      ) OR (
        queued.aggregate_type = 'moderation_report'
        AND queued.event_type = 'moderation.report.received.requested.v1'
      ) OR (
        queued.aggregate_type = 'feedback_submission'
        AND queued.event_type = 'support.confirmation.requested.v1'
      )
    )
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_complete(
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
    AND (
      (
        queued.aggregate_type = 'auth_email'
        AND queued.event_type IN (
          'auth.email.verify_email',
          'auth.email.magic_link',
          'auth.email.reset_password'
        )
      ) OR (
        queued.aggregate_type = 'photobook_order'
        AND queued.event_type IN (
          'order.email.confirmation.requested.v1',
          'order.email.payment_failed.requested.v1',
          'order.email.in_production.requested.v1',
          'order.email.shipped.requested.v1',
          'order.email.refund_review.requested.v1'
        )
      ) OR (
        queued.aggregate_type = 'moderation_report'
        AND queued.event_type = 'moderation.report.received.requested.v1'
      ) OR (
        queued.aggregate_type = 'feedback_submission'
        AND queued.event_type = 'support.confirmation.requested.v1'
      )
    )
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
CREATE OR REPLACE FUNCTION public.app_email_worker_fail(
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
    AND (
      (
        queued.aggregate_type = 'auth_email'
        AND queued.event_type IN (
          'auth.email.verify_email',
          'auth.email.magic_link',
          'auth.email.reset_password'
        )
      ) OR (
        queued.aggregate_type = 'photobook_order'
        AND queued.event_type IN (
          'order.email.confirmation.requested.v1',
          'order.email.payment_failed.requested.v1',
          'order.email.in_production.requested.v1',
          'order.email.shipped.requested.v1',
          'order.email.refund_review.requested.v1'
        )
      ) OR (
        queued.aggregate_type = 'moderation_report'
        AND queued.event_type = 'moderation.report.received.requested.v1'
      ) OR (
        queued.aggregate_type = 'feedback_submission'
        AND queued.event_type = 'support.confirmation.requested.v1'
      )
    )
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
CREATE OR REPLACE FUNCTION public.app_enqueue_order_transactional_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.source = 'stripe'
     AND NEW.event_type = 'order.refund_recorded.v1' THEN
    INSERT INTO public.outbox_events (
      aggregate_type,
      aggregate_id,
      event_type,
      idempotency_key,
      payload
    ) VALUES (
      'photobook_order',
      NEW.order_id,
      'order.email.refund_review.requested.v1',
      'order:' || NEW.order_id::text || ':email:refund-review:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', NEW.order_id)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER photobook_order_events_enqueue_transactional_email
AFTER INSERT ON public.photobook_order_events
FOR EACH ROW EXECUTE FUNCTION public.app_enqueue_order_transactional_email();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_claim(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_load_order(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_prepare(uuid, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_acknowledge(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_complete(uuid, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_fail(uuid, text, text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_order_transactional_email() FROM PUBLIC;

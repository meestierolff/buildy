-- Stripe is authoritative only after raw-body signature verification. This
-- dedicated SECURITY DEFINER boundary accepts normalized, non-PII facts from
-- the payment-webhook role, makes replay durable, and applies one monotonic
-- order transition in the same transaction.

ALTER TABLE public.photobook_orders
  ADD COLUMN stripe_charge_id text,
  ADD COLUMN refunded_minor integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX photobook_orders_stripe_charge_uq
  ON public.photobook_orders (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

ALTER TABLE public.photobook_orders
  ADD CONSTRAINT photobook_orders_stripe_charge_ck
    CHECK (stripe_charge_id IS NULL OR stripe_charge_id ~ '^ch_[A-Za-z0-9_]{3,250}$'),
  ADD CONSTRAINT photobook_orders_refund_amount_ck
    CHECK (
      refunded_minor >= 0
      AND refunded_minor <= total_minor
      AND (
        (payment_status = 'partially_refunded' AND refunded_minor > 0 AND refunded_minor < total_minor)
        OR (payment_status = 'refunded' AND refunded_minor = total_minor)
        OR (payment_status NOT IN ('partially_refunded', 'refunded') AND refunded_minor = 0)
      )
    );

CREATE OR REPLACE FUNCTION public.guard_photobook_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.order_number IS DISTINCT FROM OLD.order_number
     OR NEW.merchant_reference IS DISTINCT FROM OLD.merchant_reference
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.proof_revision_id IS DISTINCT FROM OLD.proof_revision_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
     OR NEW.shipping_minor IS DISTINCT FROM OLD.shipping_minor
     OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor
     OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.shipping_country IS DISTINCT FROM OLD.shipping_country
     OR NEW.customer_email_ciphertext IS DISTINCT FROM OLD.customer_email_ciphertext
     OR NEW.shipping_details_ciphertext IS DISTINCT FROM OLD.shipping_details_ciphertext
     OR NEW.pii_encryption_key_version IS DISTINCT FROM OLD.pii_encryption_key_version
     OR NEW.checkout_snapshot IS DISTINCT FROM OLD.checkout_snapshot
     OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot
     OR NEW.terms_version IS DISTINCT FROM OLD.terms_version
     OR NEW.legal_accepted_at IS DISTINCT FROM OLD.legal_accepted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'photobook order commercial snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'photobook order version must increment exactly once'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'awaiting_payment' AND NEW.status IN ('checkout_open', 'cancelled', 'manual_review'))
    OR (OLD.status = 'checkout_open' AND NEW.status IN ('paid', 'payment_failed', 'expired', 'cancelled', 'manual_review'))
    OR (OLD.status IN ('payment_failed', 'expired', 'cancelled') AND NEW.status IN ('checkout_open', 'cancelled', 'manual_review'))
    OR (OLD.status = 'paid' AND NEW.status IN ('manual_review', 'cancelled'))
    OR (OLD.status = 'manual_review' AND NEW.status IN ('manual_review', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid photobook order status transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NOT (
    (OLD.payment_status = 'unpaid' AND NEW.payment_status IN ('processing', 'paid', 'failed'))
    OR (OLD.payment_status = 'processing' AND NEW.payment_status IN ('paid', 'failed'))
    OR (OLD.payment_status = 'failed' AND NEW.payment_status IN ('processing', 'paid'))
    OR (OLD.payment_status = 'paid' AND NEW.payment_status IN ('partially_refunded', 'refunded'))
    OR (OLD.payment_status = 'partially_refunded' AND NEW.payment_status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'invalid photobook payment status transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.fulfilment_status IS DISTINCT FROM OLD.fulfilment_status AND NOT (
    (OLD.fulfilment_status = 'unclaimed' AND NEW.fulfilment_status IN ('claimed', 'cancelled', 'manual_review'))
    OR (OLD.fulfilment_status = 'claimed' AND NEW.fulfilment_status IN ('peecho_order_created', 'retry_scheduled', 'failed', 'manual_review'))
    OR (OLD.fulfilment_status = 'peecho_order_created' AND NEW.fulfilment_status IN ('peecho_payment_pending', 'retry_scheduled', 'manual_review'))
    OR (OLD.fulfilment_status = 'peecho_payment_pending' AND NEW.fulfilment_status IN ('submitted_to_production', 'retry_scheduled', 'manual_review'))
    OR (OLD.fulfilment_status = 'retry_scheduled' AND NEW.fulfilment_status IN ('claimed', 'manual_review', 'failed'))
    OR (OLD.fulfilment_status = 'submitted_to_production' AND NEW.fulfilment_status IN ('in_production', 'shipped', 'manual_review'))
    OR (OLD.fulfilment_status = 'in_production' AND NEW.fulfilment_status IN ('shipped', 'manual_review'))
    OR (OLD.fulfilment_status = 'shipped' AND NEW.fulfilment_status IN ('delivered', 'manual_review'))
    OR (OLD.fulfilment_status = 'manual_review' AND NEW.fulfilment_status IN ('claimed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid photobook fulfilment status transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.stripe_checkout_session_id IS NOT NULL
     AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'Stripe Checkout Session is immutable once recorded'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.stripe_payment_intent_id IS NOT NULL
     AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'Stripe PaymentIntent is immutable once recorded'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.stripe_charge_id IS NOT NULL
     AND NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id THEN
    RAISE EXCEPTION 'Stripe Charge is immutable once recorded'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor THEN
    RAISE EXCEPTION 'refunded amount may not move backwards'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'checkout_open' AND (
    NEW.stripe_checkout_session_id IS NULL
    OR NEW.stripe_checkout_expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'checkout-open order requires a Stripe session'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.payment_status IN ('paid', 'partially_refunded', 'refunded')
     AND (NEW.paid_at IS NULL OR NEW.stripe_payment_intent_id IS NULL) THEN
    RAISE EXCEPTION 'paid order requires durable payment evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'paid' AND NEW.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'paid order status requires a paid payment status'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_photobook_order_transition() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_apply_stripe_payment_event(
  requested_application_environment text,
  requested_provider_environment text,
  requested_provider_event_id text,
  requested_event_type text,
  requested_event_at timestamptz,
  requested_order_id uuid,
  requested_order_number text,
  requested_merchant_reference text,
  requested_object_id text,
  requested_checkout_session_id text,
  requested_payment_intent_id text,
  requested_payment_status text,
  requested_amount_total_minor integer,
  requested_amount_refunded_minor integer,
  requested_currency text,
  requested_payload_sha256 text
)
RETURNS TABLE (
  applied boolean,
  order_id uuid,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  inserted_inbox_id uuid;
  existing_inbox public.provider_event_inbox%ROWTYPE;
  selected_order public.photobook_orders%ROWTYPE;
  next_status public.photobook_order_status;
  next_payment_status public.payment_status;
  next_fulfilment_status public.fulfilment_status;
  next_payment_intent_id text;
  next_charge_id text;
  next_refunded_minor integer;
  next_paid_at timestamptz;
  next_error_code text;
  event_outcome text := 'ignored';
  ledger_event_type text := 'order.stripe_event_ignored.v1';
  inbox_terminal_status public.provider_inbox_status := 'ignored';
  state_changed boolean := false;
  reference_mismatch boolean := false;
BEGIN
  IF requested_application_environment NOT IN ('preview', 'staging', 'production', 'test')
     OR requested_provider_environment NOT IN ('test', 'live')
     OR requested_provider_event_id !~ '^evt_[A-Za-z0-9_]{3,250}$'
     OR requested_event_type NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded',
       'checkout.session.async_payment_failed',
       'checkout.session.expired',
       'charge.refunded'
     )
     OR requested_event_at < '2020-01-01T00:00:00Z'::timestamptz
     OR requested_event_at > statement_timestamp() + interval '5 minutes'
     OR requested_order_id IS NULL
     OR requested_order_number !~ '^BLD-[A-Z0-9-]{8,40}$'
     OR char_length(requested_merchant_reference) NOT BETWEEN 8 AND 100
     OR char_length(requested_object_id) NOT BETWEEN 4 AND 255
     OR requested_payload_sha256 !~ '^[0-9a-f]{64}$'
     OR (requested_currency IS NOT NULL AND requested_currency !~ '^[A-Z]{3}$')
     OR (requested_amount_total_minor IS NOT NULL AND requested_amount_total_minor < 0)
     OR (requested_amount_refunded_minor IS NOT NULL AND requested_amount_refunded_minor < 0)
     OR (
       requested_event_type LIKE 'checkout.session.%'
       AND requested_checkout_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9_]{3,250}$'
     )
     OR (
       requested_payment_intent_id IS NOT NULL
       AND requested_payment_intent_id !~ '^pi_[A-Za-z0-9_]{3,250}$'
     )
     OR (
       requested_event_type = 'charge.refunded'
       AND requested_object_id !~ '^ch_[A-Za-z0-9_]{3,250}$'
     ) THEN
    RAISE EXCEPTION 'invalid normalized Stripe payment event'
      USING ERRCODE = '22023';
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
    'stripe',
    requested_application_environment,
    requested_provider_event_id,
    requested_event_type,
    requested_order_id::text,
    requested_payload_sha256,
    jsonb_build_object(
      'schemaVersion', 1,
      'providerEnvironment', requested_provider_environment,
      'orderId', requested_order_id,
      'orderNumber', requested_order_number,
      'objectId', requested_object_id
    ),
    statement_timestamp(),
    'received'
  )
  ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
  RETURNING id INTO inserted_inbox_id;

  IF inserted_inbox_id IS NULL THEN
    SELECT inbox.*
    INTO existing_inbox
    FROM public.provider_event_inbox AS inbox
    WHERE inbox.provider = 'stripe'
      AND inbox.environment = requested_application_environment
      AND inbox.provider_event_id = requested_provider_event_id;

    IF existing_inbox.payload_sha256 IS DISTINCT FROM requested_payload_sha256
       OR existing_inbox.event_type IS DISTINCT FROM requested_event_type
       OR existing_inbox.reference IS DISTINCT FROM requested_order_id::text THEN
      RAISE EXCEPTION 'Stripe provider event identity collision'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT false, requested_order_id, 'duplicate'::text;
    RETURN;
  END IF;

  SELECT orders.*
  INTO selected_order
  FROM public.photobook_orders AS orders
  WHERE orders.id = requested_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.provider_event_inbox AS inbox
    SET
      status = 'dead_letter',
      applied_at = statement_timestamp(),
      last_error_code = 'stripe_order_not_found',
      payload_summary = inbox.payload_summary || jsonb_build_object('outcome', 'order_not_found'),
      updated_at = statement_timestamp()
    WHERE inbox.id = inserted_inbox_id;
    RETURN QUERY SELECT false, requested_order_id, 'order_not_found'::text;
    RETURN;
  END IF;

  next_status := selected_order.status;
  next_payment_status := selected_order.payment_status;
  next_fulfilment_status := selected_order.fulfilment_status;
  next_payment_intent_id := selected_order.stripe_payment_intent_id;
  next_charge_id := selected_order.stripe_charge_id;
  next_refunded_minor := selected_order.refunded_minor;
  next_paid_at := selected_order.paid_at;
  next_error_code := selected_order.last_error_code;

  reference_mismatch :=
    selected_order.order_number IS DISTINCT FROM requested_order_number
    OR selected_order.merchant_reference IS DISTINCT FROM requested_merchant_reference
    OR selected_order.currency IS DISTINCT FROM requested_currency
    OR selected_order.total_minor IS DISTINCT FROM requested_amount_total_minor
    OR (
      requested_event_type LIKE 'checkout.session.%'
      AND selected_order.stripe_checkout_session_id IS DISTINCT FROM requested_checkout_session_id
    )
    OR (
      requested_event_type = 'charge.refunded'
      AND (
        selected_order.stripe_payment_intent_id IS NULL
        OR selected_order.stripe_payment_intent_id IS DISTINCT FROM requested_payment_intent_id
        OR (
          selected_order.stripe_charge_id IS NOT NULL
          AND selected_order.stripe_charge_id IS DISTINCT FROM requested_object_id
        )
      )
    );

  IF reference_mismatch THEN
    event_outcome := 'manual_review';
    ledger_event_type := 'order.stripe_reconciliation_failed.v1';
    inbox_terminal_status := 'dead_letter';
    next_error_code := 'stripe_reconciliation_mismatch';
    IF selected_order.status <> 'manual_review' THEN
      next_status := 'manual_review';
    END IF;
    IF selected_order.fulfilment_status IN (
      'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
      'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
    ) THEN
      next_fulfilment_status := 'manual_review';
    END IF;

  ELSIF requested_event_type IN (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded'
  ) THEN
    IF selected_order.payment_status IN ('paid', 'partially_refunded', 'refunded') THEN
      event_outcome := 'ignored';
    ELSIF requested_event_type = 'checkout.session.completed'
          AND requested_payment_status = 'unpaid' THEN
      IF selected_order.status = 'checkout_open'
         AND selected_order.payment_status IN ('unpaid', 'processing') THEN
        next_payment_status := 'processing';
        next_error_code := NULL;
        event_outcome := 'processing';
        ledger_event_type := 'order.payment_processing.v1';
        inbox_terminal_status := 'applied';
      ELSE
        event_outcome := 'ignored';
      END IF;
    ELSIF requested_payment_status = 'paid'
          AND requested_payment_intent_id IS NOT NULL THEN
      IF selected_order.stripe_payment_intent_id IS NOT NULL
         AND selected_order.stripe_payment_intent_id IS DISTINCT FROM requested_payment_intent_id THEN
        event_outcome := 'manual_review';
        ledger_event_type := 'order.stripe_reconciliation_failed.v1';
        inbox_terminal_status := 'dead_letter';
        next_error_code := 'stripe_payment_intent_mismatch';
        next_status := 'manual_review';
        IF selected_order.fulfilment_status IN (
          'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
          'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
        ) THEN
          next_fulfilment_status := 'manual_review';
        END IF;
      ELSE
        next_payment_intent_id := requested_payment_intent_id;
        next_payment_status := 'paid';
        next_paid_at := COALESCE(selected_order.paid_at, requested_event_at);
        next_error_code := NULL;
        IF selected_order.status = 'checkout_open' THEN
          next_status := 'paid';
          event_outcome := 'paid';
          ledger_event_type := 'order.payment_succeeded.v1';
          inbox_terminal_status := 'applied';
        ELSE
          next_status := 'manual_review';
          IF selected_order.fulfilment_status IN (
            'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
            'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
          ) THEN
            next_fulfilment_status := 'manual_review';
          END IF;
          next_error_code := 'stripe_paid_out_of_order';
          event_outcome := 'manual_review';
          ledger_event_type := 'order.payment_succeeded_manual_review.v1';
          inbox_terminal_status := 'dead_letter';
        END IF;
      END IF;
    ELSE
      event_outcome := 'manual_review';
      ledger_event_type := 'order.stripe_reconciliation_failed.v1';
      inbox_terminal_status := 'dead_letter';
      next_error_code := 'stripe_paid_status_invalid';
      next_status := 'manual_review';
      IF selected_order.fulfilment_status IN (
        'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
        'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
      ) THEN
        next_fulfilment_status := 'manual_review';
      END IF;
    END IF;

  ELSIF requested_event_type = 'checkout.session.async_payment_failed' THEN
    IF selected_order.payment_status IN ('paid', 'partially_refunded', 'refunded')
       OR selected_order.status = 'manual_review' THEN
      event_outcome := 'ignored';
    ELSIF selected_order.status = 'checkout_open'
          AND selected_order.payment_status IN ('unpaid', 'processing') THEN
      next_status := 'payment_failed';
      next_payment_status := 'failed';
      next_error_code := 'stripe_async_payment_failed';
      event_outcome := 'payment_failed';
      ledger_event_type := 'order.payment_failed.v1';
      inbox_terminal_status := 'applied';
    ELSE
      event_outcome := 'ignored';
    END IF;

  ELSIF requested_event_type = 'checkout.session.expired' THEN
    IF selected_order.payment_status IN ('paid', 'partially_refunded', 'refunded')
       OR selected_order.status = 'manual_review' THEN
      event_outcome := 'ignored';
    ELSIF selected_order.status = 'checkout_open'
          AND selected_order.payment_status IN ('unpaid', 'processing') THEN
      next_status := 'expired';
      IF selected_order.payment_status = 'processing' THEN
        next_payment_status := 'failed';
      END IF;
      next_error_code := 'stripe_checkout_expired';
      event_outcome := 'expired';
      ledger_event_type := 'order.checkout_expired.v1';
      inbox_terminal_status := 'applied';
    ELSE
      event_outcome := 'ignored';
    END IF;

  ELSIF requested_event_type = 'charge.refunded' THEN
    IF requested_amount_refunded_minor IS NULL
       OR requested_amount_refunded_minor <= 0
       OR requested_amount_refunded_minor > selected_order.total_minor THEN
      event_outcome := 'manual_review';
      ledger_event_type := 'order.refund_reconciliation_failed.v1';
      inbox_terminal_status := 'dead_letter';
      next_error_code := 'stripe_refund_amount_invalid';
      next_status := 'manual_review';
      IF selected_order.fulfilment_status IN (
        'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
        'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
      ) THEN
        next_fulfilment_status := 'manual_review';
      END IF;
    ELSIF selected_order.payment_status NOT IN ('paid', 'partially_refunded', 'refunded') THEN
      event_outcome := 'manual_review';
      ledger_event_type := 'order.refund_out_of_order.v1';
      inbox_terminal_status := 'dead_letter';
      next_error_code := 'stripe_refund_before_payment';
      next_status := 'manual_review';
      IF selected_order.fulfilment_status IN (
        'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
        'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
      ) THEN
        next_fulfilment_status := 'manual_review';
      END IF;
    ELSIF requested_amount_refunded_minor <= selected_order.refunded_minor THEN
      event_outcome := 'ignored';
    ELSE
      next_charge_id := requested_object_id;
      next_refunded_minor := requested_amount_refunded_minor;
      next_payment_status := CASE
        WHEN requested_amount_refunded_minor = selected_order.total_minor
          THEN 'refunded'::public.payment_status
        ELSE 'partially_refunded'::public.payment_status
      END;
      next_status := 'manual_review';
      IF selected_order.fulfilment_status IN (
        'unclaimed', 'claimed', 'peecho_order_created', 'peecho_payment_pending',
        'retry_scheduled', 'submitted_to_production', 'in_production', 'shipped'
      ) THEN
        next_fulfilment_status := 'manual_review';
      END IF;
      next_error_code := 'stripe_refund_manual_review';
      event_outcome := CASE
        WHEN requested_amount_refunded_minor = selected_order.total_minor THEN 'refunded'
        ELSE 'partially_refunded'
      END;
      ledger_event_type := 'order.refund_recorded.v1';
      inbox_terminal_status := 'applied';
    END IF;
  END IF;

  state_changed :=
    next_status IS DISTINCT FROM selected_order.status
    OR next_payment_status IS DISTINCT FROM selected_order.payment_status
    OR next_fulfilment_status IS DISTINCT FROM selected_order.fulfilment_status
    OR next_payment_intent_id IS DISTINCT FROM selected_order.stripe_payment_intent_id
    OR next_charge_id IS DISTINCT FROM selected_order.stripe_charge_id
    OR next_refunded_minor IS DISTINCT FROM selected_order.refunded_minor
    OR next_paid_at IS DISTINCT FROM selected_order.paid_at
    OR next_error_code IS DISTINCT FROM selected_order.last_error_code;

  IF state_changed THEN
    UPDATE public.photobook_orders AS orders
    SET
      status = next_status,
      payment_status = next_payment_status,
      fulfilment_status = next_fulfilment_status,
      stripe_payment_intent_id = next_payment_intent_id,
      stripe_charge_id = next_charge_id,
      refunded_minor = next_refunded_minor,
      paid_at = next_paid_at,
      last_error_code = next_error_code,
      version = orders.version + 1,
      updated_at = statement_timestamp()
    WHERE orders.id = selected_order.id;
  END IF;

  INSERT INTO public.photobook_order_events (
    order_id,
    source,
    event_type,
    idempotency_key,
    provider_event_id,
    actor_user_id,
    from_status,
    to_status,
    payload_summary,
    occurred_at
  ) VALUES (
    selected_order.id,
    'stripe',
    ledger_event_type,
    'stripe:' || requested_provider_event_id,
    requested_provider_event_id,
    NULL,
    selected_order.status::text,
    next_status::text,
    jsonb_build_object(
      'schemaVersion', 1,
      'providerEnvironment', requested_provider_environment,
      'objectId', requested_object_id,
      'amountTotalMinor', requested_amount_total_minor,
      'amountRefundedMinor', requested_amount_refunded_minor,
      'currency', requested_currency,
      'outcome', event_outcome
    ),
    requested_event_at
  );

  IF event_outcome = 'paid' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES
      (
        'photobook_order', selected_order.id, 'photobook_order.paid.v1',
        'order:' || selected_order.id::text || ':paid:v1',
        jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id)
      ),
      (
        'photobook_order', selected_order.id, 'order.email.confirmation.requested.v1',
        'order:' || selected_order.id::text || ':email:confirmation:v1',
        jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id)
      )
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF event_outcome = 'payment_failed' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', selected_order.id, 'order.email.payment_failed.requested.v1',
      'order:' || selected_order.id::text || ':email:payment-failed:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF event_outcome IN ('partially_refunded', 'refunded', 'manual_review') THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', selected_order.id, 'order.support.review.requested.v1',
      'stripe:' || requested_provider_event_id || ':support-review',
      jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id, 'reason', event_outcome)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  UPDATE public.provider_event_inbox AS inbox
  SET
    status = inbox_terminal_status,
    applied_at = statement_timestamp(),
    last_error_code = CASE
      WHEN inbox_terminal_status = 'dead_letter' THEN next_error_code
      ELSE NULL
    END,
    payload_summary = inbox.payload_summary || jsonb_build_object('outcome', event_outcome),
    updated_at = statement_timestamp()
  WHERE inbox.id = inserted_inbox_id;

  RETURN QUERY SELECT state_changed, selected_order.id, event_outcome;
END
$function$;

REVOKE ALL ON FUNCTION public.app_apply_stripe_payment_event(
  text, text, text, text, timestamptz, uuid, text, text, text, text,
  text, text, integer, integer, text, text
) FROM PUBLIC;

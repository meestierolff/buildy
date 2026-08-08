-- Paid Bouwboek orders are fulfilled through a dedicated, least-privilege
-- Peecho worker. The worker roles receive EXECUTE only in deployment setup;
-- these SECURITY DEFINER functions are the complete database boundary.

ALTER TABLE public.photobook_orders
  ADD COLUMN peecho_environment text,
  ADD COLUMN peecho_status text,
  ADD COLUMN peecho_create_started_at timestamptz,
  ADD COLUMN peecho_payment_started_at timestamptz,
  ADD COLUMN peecho_submitted_at timestamptz,
  ADD COLUMN peecho_last_status_at timestamptz,
  ADD COLUMN tracking_code text,
  ADD COLUMN fulfilment_dead_lettered_at timestamptz;

ALTER TABLE public.photobook_orders
  ADD CONSTRAINT photobook_orders_peecho_environment_ck
    CHECK (peecho_environment IS NULL OR peecho_environment IN ('test', 'live')),
  ADD CONSTRAINT photobook_orders_peecho_id_ck
    CHECK (peecho_order_id IS NULL OR peecho_order_id ~ '^[1-9][0-9]{0,15}$'),
  ADD CONSTRAINT photobook_orders_peecho_status_ck
    CHECK (peecho_status IS NULL OR peecho_status ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  ADD CONSTRAINT photobook_orders_peecho_identity_ck
    CHECK ((peecho_order_id IS NULL) OR (peecho_environment IS NOT NULL AND peecho_create_started_at IS NOT NULL)),
  ADD CONSTRAINT photobook_orders_peecho_payment_ck
    CHECK (peecho_payment_started_at IS NULL OR peecho_order_id IS NOT NULL),
  ADD CONSTRAINT photobook_orders_peecho_submission_ck
    CHECK (peecho_submitted_at IS NULL OR peecho_order_id IS NOT NULL),
  ADD CONSTRAINT photobook_orders_tracking_code_ck
    CHECK (tracking_code IS NULL OR char_length(tracking_code) BETWEEN 1 AND 500),
  ADD CONSTRAINT photobook_orders_fulfilment_dead_letter_ck
    CHECK (
      fulfilment_dead_lettered_at IS NULL
      OR (fulfilment_status = 'manual_review' AND status = 'manual_review')
    );

CREATE INDEX photobook_orders_peecho_paid_queue_idx
  ON public.photobook_orders (next_retry_at, fulfilment_lease_expires_at, created_at)
  WHERE status = 'paid'
    AND payment_status = 'paid'
    AND fulfilment_status IN (
      'unclaimed', 'claimed', 'peecho_order_created',
      'peecho_payment_pending', 'retry_scheduled'
    )
    AND fulfilment_dead_lettered_at IS NULL;

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
    OR (OLD.fulfilment_status = 'claimed' AND NEW.fulfilment_status IN (
      'peecho_order_created', 'peecho_payment_pending', 'submitted_to_production',
      'in_production', 'shipped', 'retry_scheduled', 'failed', 'manual_review'
    ))
    OR (OLD.fulfilment_status = 'peecho_order_created' AND NEW.fulfilment_status IN (
      'peecho_payment_pending', 'submitted_to_production', 'in_production',
      'shipped', 'retry_scheduled', 'manual_review'
    ))
    OR (OLD.fulfilment_status = 'peecho_payment_pending' AND NEW.fulfilment_status IN (
      'submitted_to_production', 'in_production', 'shipped', 'retry_scheduled', 'manual_review'
    ))
    OR (OLD.fulfilment_status = 'retry_scheduled' AND NEW.fulfilment_status IN (
      'claimed', 'peecho_payment_pending', 'submitted_to_production',
      'in_production', 'shipped', 'manual_review', 'failed'
    ))
    OR (OLD.fulfilment_status = 'submitted_to_production' AND NEW.fulfilment_status IN ('in_production', 'shipped', 'manual_review'))
    OR (OLD.fulfilment_status = 'in_production' AND NEW.fulfilment_status IN ('shipped', 'manual_review'))
    OR (OLD.fulfilment_status = 'shipped' AND NEW.fulfilment_status IN ('delivered', 'manual_review'))
    OR (OLD.fulfilment_status = 'manual_review' AND NEW.fulfilment_status IN ('claimed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid photobook fulfilment status transition'
      USING ERRCODE = '23514';
  END IF;

  -- Browser mutations always set app.actor_id. Server-owned fulfilment fields
  -- may only be changed through a no-actor backend boundary.
  IF public.app_actor_id() IS NOT NULL AND (
    NEW.fulfilment_status IS DISTINCT FROM OLD.fulfilment_status
    OR NEW.peecho_order_id IS DISTINCT FROM OLD.peecho_order_id
    OR NEW.peecho_environment IS DISTINCT FROM OLD.peecho_environment
    OR NEW.peecho_status IS DISTINCT FROM OLD.peecho_status
    OR NEW.peecho_create_started_at IS DISTINCT FROM OLD.peecho_create_started_at
    OR NEW.peecho_payment_started_at IS DISTINCT FROM OLD.peecho_payment_started_at
    OR NEW.peecho_submitted_at IS DISTINCT FROM OLD.peecho_submitted_at
    OR NEW.peecho_last_status_at IS DISTINCT FROM OLD.peecho_last_status_at
    OR NEW.fulfilment_lease_owner IS DISTINCT FROM OLD.fulfilment_lease_owner
    OR NEW.fulfilment_lease_expires_at IS DISTINCT FROM OLD.fulfilment_lease_expires_at
    OR NEW.retry_count IS DISTINCT FROM OLD.retry_count
    OR NEW.next_retry_at IS DISTINCT FROM OLD.next_retry_at
    OR NEW.fulfilment_dead_lettered_at IS DISTINCT FROM OLD.fulfilment_dead_lettered_at
    OR NEW.tracking_code IS DISTINCT FROM OLD.tracking_code
    OR NEW.tracking_url IS DISTINCT FROM OLD.tracking_url
  ) THEN
    RAISE EXCEPTION 'photobook fulfilment state is server owned'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.stripe_checkout_session_id IS NOT NULL
     AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'Stripe Checkout Session is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD.stripe_payment_intent_id IS NOT NULL
     AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id THEN
    RAISE EXCEPTION 'Stripe PaymentIntent is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD.stripe_charge_id IS NOT NULL
     AND NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id THEN
    RAISE EXCEPTION 'Stripe Charge is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD.peecho_order_id IS NOT NULL
     AND NEW.peecho_order_id IS DISTINCT FROM OLD.peecho_order_id THEN
    RAISE EXCEPTION 'Peecho order identity is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD.peecho_environment IS NOT NULL
     AND NEW.peecho_environment IS DISTINCT FROM OLD.peecho_environment THEN
    RAISE EXCEPTION 'Peecho environment is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF OLD.peecho_create_started_at IS NOT NULL
     AND NEW.peecho_create_started_at IS DISTINCT FROM OLD.peecho_create_started_at THEN
    RAISE EXCEPTION 'Peecho create marker is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.peecho_payment_started_at IS NOT NULL
     AND NEW.peecho_payment_started_at IS DISTINCT FROM OLD.peecho_payment_started_at THEN
    RAISE EXCEPTION 'Peecho payment marker is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.peecho_submitted_at IS NOT NULL
     AND NEW.peecho_submitted_at IS DISTINCT FROM OLD.peecho_submitted_at THEN
    RAISE EXCEPTION 'Peecho submission marker is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.fulfilment_dead_lettered_at IS NOT NULL
     AND NEW.fulfilment_dead_lettered_at IS DISTINCT FROM OLD.fulfilment_dead_lettered_at THEN
    RAISE EXCEPTION 'Peecho dead-letter marker is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor THEN
    RAISE EXCEPTION 'refunded amount may not move backwards' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'checkout_open' AND (
    NEW.stripe_checkout_session_id IS NULL OR NEW.stripe_checkout_expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'checkout-open order requires a Stripe session' USING ERRCODE = '23514';
  END IF;
  IF NEW.payment_status IN ('paid', 'partially_refunded', 'refunded')
     AND (NEW.paid_at IS NULL OR NEW.stripe_payment_intent_id IS NULL) THEN
    RAISE EXCEPTION 'paid order requires durable payment evidence' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'paid' AND NEW.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'paid order status requires a paid payment status' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_photobook_order_transition() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_peecho_worker_claim(
  worker_identifier text,
  requested_environment text,
  lease_seconds integer
)
RETURNS TABLE (order_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR requested_environment IS NULL OR requested_environment NOT IN ('test', 'live')
     OR lease_seconds IS NULL OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid Peecho claim input' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT orders.id
    FROM public.photobook_orders orders
    WHERE orders.status = 'paid'
      AND orders.payment_status = 'paid'
      AND orders.fulfilment_status IN (
        'unclaimed', 'claimed', 'peecho_order_created',
        'peecho_payment_pending', 'retry_scheduled'
      )
      AND orders.fulfilment_dead_lettered_at IS NULL
      AND (orders.peecho_environment IS NULL OR orders.peecho_environment = requested_environment)
      AND (
        (orders.fulfilment_lease_owner IS NULL AND (
          orders.fulfilment_status <> 'retry_scheduled'
          OR orders.next_retry_at <= clock_timestamp()
        ))
        OR orders.fulfilment_lease_expires_at <= clock_timestamp()
        OR orders.fulfilment_lease_owner = worker_identifier
      )
    ORDER BY coalesce(orders.next_retry_at, orders.created_at), orders.created_at, orders.id
    FOR UPDATE OF orders SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.photobook_orders orders
    SET
      fulfilment_status = CASE
        WHEN orders.fulfilment_status IN ('unclaimed', 'retry_scheduled')
          THEN 'claimed'::public.fulfilment_status
        ELSE orders.fulfilment_status
      END,
      peecho_environment = coalesce(orders.peecho_environment, requested_environment),
      fulfilment_lease_owner = worker_identifier,
      fulfilment_lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      retry_count = orders.retry_count + 1,
      next_retry_at = NULL,
      last_error_code = NULL,
      version = orders.version + 1,
      updated_at = statement_timestamp()
    FROM candidate
    WHERE orders.id = candidate.id
    RETURNING orders.id
  )
  SELECT claimed.id FROM claimed;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_begin_peecho_fulfilment(
  worker_identifier text,
  target_order_id uuid,
  requested_environment text
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  merchant_reference text,
  provider_environment text,
  phase text,
  provider_order_id text,
  provider_status text,
  attempt_count integer,
  offering_id text,
  currency text,
  quantity integer,
  page_count integer,
  shipping_country text,
  customer_email_ciphertext text,
  shipping_details_ciphertext text,
  pii_encryption_key_version integer,
  pdf_object_key text,
  pdf_bucket text,
  pdf_size_bytes bigint,
  pdf_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_order public.photobook_orders%ROWTYPE;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR requested_environment IS NULL OR requested_environment NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'invalid Peecho begin input' USING ERRCODE = '22023';
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.status = 'paid'
    AND orders.payment_status = 'paid'
    AND orders.fulfilment_status IN ('claimed', 'peecho_order_created', 'peecho_payment_pending')
    AND orders.peecho_environment = requested_environment
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp()
    AND orders.fulfilment_dead_lettered_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    selected_order.id,
    selected_order.order_number,
    selected_order.merchant_reference,
    selected_order.peecho_environment,
    CASE
      WHEN selected_order.peecho_order_id IS NULL AND selected_order.peecho_create_started_at IS NULL THEN 'create'
      WHEN selected_order.peecho_order_id IS NULL THEN 'reconcile_create'
      WHEN selected_order.peecho_payment_started_at IS NULL THEN 'pay'
      ELSE 'reconcile_payment'
    END,
    selected_order.peecho_order_id,
    selected_order.peecho_status,
    selected_order.retry_count,
    selected_order.checkout_snapshot ->> 'offeringId',
    selected_order.currency,
    selected_order.quantity,
    revision.page_count,
    selected_order.shipping_country,
    selected_order.customer_email_ciphertext,
    selected_order.shipping_details_ciphertext,
    selected_order.pii_encryption_key_version,
    pdf.object_key,
    pdf.bucket,
    pdf.size_bytes,
    pdf.sha256
  FROM public.photobook_revisions revision
  JOIN public.media_assets pdf
    ON pdf.id = revision.pdf_asset_id
   AND pdf.project_id = revision.project_id
   AND pdf.owner_id = revision.owner_id
   AND pdf.purpose = 'photobook_pdf'
   AND pdf.status = 'ready'
   AND pdf.detected_content_type = 'application/pdf'
   AND pdf.sha256 = revision.pdf_sha256
   AND pdf.size_bytes = revision.pdf_size_bytes
   AND pdf.object_key = 'photobook-pdfs/' || left(pdf.id::text, 2) || '/' || pdf.id::text
  WHERE revision.id = selected_order.proof_revision_id
    AND revision.project_id = selected_order.project_id
    AND revision.owner_id = selected_order.owner_id
    AND revision.status = 'locked'
    AND revision.document_sha256 = selected_order.checkout_snapshot ->> 'documentSha256'
    AND revision.pdf_sha256 = selected_order.checkout_snapshot ->> 'pdfSha256'
    AND revision.page_count = (selected_order.checkout_snapshot ->> 'pageCount')::integer
    AND revision.page_count BETWEEN 24 AND 400
    AND mod(revision.page_count, 2) = 0
    AND revision.document ->> 'selectedFormat' = 'a4-landscape-hardcover-v1'
    AND selected_order.checkout_snapshot ->> 'sku' = 'a4-landscape-hardcover-v1'
    AND selected_order.checkout_snapshot ->> 'format' = 'a4-landscape-hardcover-v1'
    AND selected_order.checkout_snapshot ->> 'offeringId' ~ '^[1-9][0-9]{0,15}$'
    AND selected_order.merchant_reference = 'buildy:' || selected_order.id::text
    AND selected_order.currency = 'EUR'
    AND selected_order.quantity BETWEEN 1 AND 5
    AND selected_order.customer_email_ciphertext IS NOT NULL
    AND selected_order.shipping_details_ciphertext IS NOT NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_begin_peecho_order_create(
  worker_identifier text,
  target_order_id uuid,
  requested_environment text,
  requested_merchant_reference text,
  requested_pdf_sha256 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR requested_environment IS NULL OR requested_environment NOT IN ('test', 'live')
     OR requested_merchant_reference IS NULL OR requested_merchant_reference <> 'buildy:' || target_order_id::text
     OR requested_pdf_sha256 IS NULL OR requested_pdf_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid Peecho create marker input' USING ERRCODE = '22023';
  END IF;

  UPDATE public.photobook_orders orders
  SET
    peecho_create_started_at = statement_timestamp(),
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.id = target_order_id
    AND orders.status = 'paid'
    AND orders.payment_status = 'paid'
    AND orders.fulfilment_status = 'claimed'
    AND orders.peecho_environment = requested_environment
    AND orders.peecho_order_id IS NULL
    AND orders.peecho_create_started_at IS NULL
    AND orders.merchant_reference = requested_merchant_reference
    AND orders.checkout_snapshot ->> 'pdfSha256' = requested_pdf_sha256
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN RETURN false; END IF;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, from_status, to_status, payload_summary
  ) VALUES (
    target_order_id, 'system', 'order.peecho_create_started.v1',
    'order:' || target_order_id::text || ':peecho-create-started:v1',
    'claimed', 'claimed',
    jsonb_build_object('schemaVersion', 1, 'providerEnvironment', requested_environment)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_persist_peecho_order_created(
  worker_identifier text,
  target_order_id uuid,
  requested_environment text,
  requested_merchant_reference text,
  requested_provider_order_id text,
  requested_provider_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE selected_order public.photobook_orders%ROWTYPE;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR requested_environment IS NULL OR requested_environment NOT IN ('test', 'live')
     OR requested_merchant_reference IS NULL OR requested_merchant_reference <> 'buildy:' || target_order_id::text
     OR requested_provider_order_id IS NULL OR requested_provider_order_id !~ '^[1-9][0-9]{0,15}$'
     OR requested_provider_status IS NULL OR requested_provider_status !~ '^[A-Z][A-Z0-9_]{0,79}$' THEN
    RAISE EXCEPTION 'invalid Peecho create result' USING ERRCODE = '22023';
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.status = 'paid'
    AND orders.payment_status = 'paid'
    AND orders.fulfilment_status IN ('claimed', 'peecho_order_created')
    AND orders.peecho_environment = requested_environment
    AND orders.merchant_reference = requested_merchant_reference
    AND orders.peecho_create_started_at IS NOT NULL
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF selected_order.peecho_order_id IS NOT NULL THEN
    RETURN selected_order.peecho_order_id = requested_provider_order_id;
  END IF;

  UPDATE public.photobook_orders orders
  SET
    peecho_order_id = requested_provider_order_id,
    peecho_status = requested_provider_status,
    peecho_last_status_at = statement_timestamp(),
    fulfilment_status = 'peecho_order_created',
    last_error_code = NULL,
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.id = target_order_id;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, from_status, to_status, payload_summary
  ) VALUES (
    target_order_id, 'peecho', 'order.peecho_created.v1',
    'order:' || target_order_id::text || ':peecho-created:v1',
    selected_order.fulfilment_status::text, 'peecho_order_created',
    jsonb_build_object(
      'schemaVersion', 1, 'providerEnvironment', requested_environment,
      'providerOrderId', requested_provider_order_id, 'providerStatus', requested_provider_status
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_begin_peecho_order_payment(
  worker_identifier text,
  target_order_id uuid,
  requested_environment text,
  requested_provider_order_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE selected_order public.photobook_orders%ROWTYPE;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR requested_environment IS NULL OR requested_environment NOT IN ('test', 'live')
     OR requested_provider_order_id IS NULL OR requested_provider_order_id !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'invalid Peecho payment marker input' USING ERRCODE = '22023';
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.status = 'paid'
    AND orders.payment_status = 'paid'
    AND orders.fulfilment_status IN ('peecho_order_created', 'peecho_payment_pending')
    AND orders.peecho_environment = requested_environment
    AND orders.peecho_order_id = requested_provider_order_id
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.photobook_orders orders
  SET
    fulfilment_status = 'peecho_payment_pending',
    peecho_payment_started_at = coalesce(orders.peecho_payment_started_at, statement_timestamp()),
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.id = target_order_id;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, from_status, to_status, payload_summary
  ) VALUES (
    target_order_id, 'system', 'order.peecho_payment_started.v1',
    'order:' || target_order_id::text || ':peecho-pay-started:' || selected_order.retry_count::text,
    selected_order.fulfilment_status::text, 'peecho_payment_pending',
    jsonb_build_object(
      'schemaVersion', 1, 'providerEnvironment', requested_environment,
      'providerOrderId', requested_provider_order_id, 'attempt', selected_order.retry_count
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_finalize_peecho_order_status(
  worker_identifier text,
  target_order_id uuid,
  requested_environment text,
  requested_provider_order_id text,
  requested_provider_status text,
  requested_tracking_code text,
  requested_tracking_url text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_order public.photobook_orders%ROWTYPE;
  next_fulfilment public.fulfilment_status;
  outcome text;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR requested_environment IS NULL OR requested_environment NOT IN ('test', 'live')
     OR requested_provider_order_id IS NULL OR requested_provider_order_id !~ '^[1-9][0-9]{0,15}$'
     OR requested_provider_status IS NULL OR requested_provider_status !~ '^[A-Z][A-Z0-9_]{0,79}$'
     OR (requested_tracking_code IS NOT NULL AND char_length(requested_tracking_code) NOT BETWEEN 1 AND 500)
     OR (requested_tracking_url IS NOT NULL AND (char_length(requested_tracking_url) > 2048 OR requested_tracking_url !~ '^https://')) THEN
    RAISE EXCEPTION 'invalid Peecho status result' USING ERRCODE = '22023';
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.peecho_environment = requested_environment
    AND orders.peecho_order_id = requested_provider_order_id
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peecho worker lease lost' USING ERRCODE = '40001'; END IF;

  IF selected_order.status <> 'paid' OR selected_order.payment_status <> 'paid' THEN
    outcome := 'manual_review';
    next_fulfilment := 'manual_review';
  ELSIF requested_provider_status IN ('OPEN', 'PAYMENT_ERROR') THEN
    outcome := 'payment_required';
    next_fulfilment := 'peecho_payment_pending';
  ELSIF requested_provider_status IN ('PAID', 'WAITING_TO_DISPATCH', 'IN_PRINT_QUEUE', 'SUBMITTED') THEN
    outcome := 'submitted';
    next_fulfilment := 'submitted_to_production';
  ELSIF requested_provider_status = 'IN_PRODUCTION' THEN
    outcome := 'in_production';
    next_fulfilment := 'in_production';
  ELSIF requested_provider_status = 'SHIPPED' THEN
    outcome := 'shipped';
    next_fulfilment := 'shipped';
  ELSE
    outcome := 'manual_review';
    next_fulfilment := 'manual_review';
  END IF;

  UPDATE public.photobook_orders orders
  SET
    status = CASE WHEN outcome = 'manual_review' AND orders.status = 'paid'
      THEN 'manual_review'::public.photobook_order_status ELSE orders.status END,
    fulfilment_status = next_fulfilment,
    peecho_status = requested_provider_status,
    peecho_last_status_at = statement_timestamp(),
    peecho_submitted_at = CASE WHEN outcome IN ('submitted', 'in_production', 'shipped')
      THEN coalesce(orders.peecho_submitted_at, statement_timestamp()) ELSE orders.peecho_submitted_at END,
    tracking_code = coalesce(requested_tracking_code, orders.tracking_code),
    tracking_url = coalesce(requested_tracking_url, orders.tracking_url),
    fulfilment_lease_owner = CASE WHEN outcome = 'payment_required' THEN orders.fulfilment_lease_owner ELSE NULL END,
    fulfilment_lease_expires_at = CASE WHEN outcome = 'payment_required' THEN orders.fulfilment_lease_expires_at ELSE NULL END,
    next_retry_at = NULL,
    last_error_code = CASE WHEN outcome = 'manual_review' THEN 'PEECHO_PROVIDER_STATUS_REVIEW' ELSE NULL END,
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.id = target_order_id;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, from_status, to_status, payload_summary
  ) VALUES (
    target_order_id, 'peecho', 'order.peecho_status_reconciled.v1',
    'order:' || target_order_id::text || ':peecho-status:' || selected_order.retry_count::text || ':' || requested_provider_status,
    selected_order.fulfilment_status::text, next_fulfilment::text,
    jsonb_build_object(
      'schemaVersion', 1, 'providerEnvironment', requested_environment,
      'providerOrderId', requested_provider_order_id,
      'providerStatus', requested_provider_status, 'outcome', outcome
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF outcome = 'in_production' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', target_order_id, 'order.email.in_production.requested.v1',
      'order:' || target_order_id::text || ':email:in-production:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', target_order_id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF outcome = 'shipped' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', target_order_id, 'order.email.shipped.requested.v1',
      'order:' || target_order_id::text || ':email:shipped:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', target_order_id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF requested_provider_status = 'REFUNDED' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', target_order_id, 'order.email.refund_review.requested.v1',
      'order:' || target_order_id::text || ':email:refund-review:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', target_order_id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN outcome;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_retry_peecho_fulfilment(
  worker_identifier text,
  target_order_id uuid,
  processing_failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE selected_order public.photobook_orders%ROWTYPE;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR processing_failure_code IS NULL OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
     OR retry_delay_seconds IS NULL OR retry_delay_seconds NOT BETWEEN 1 AND 86400
     OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION 'invalid Peecho retry input' USING ERRCODE = '22023';
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.status = 'paid'
    AND orders.payment_status = 'paid'
    AND orders.fulfilment_status IN ('claimed', 'peecho_order_created', 'peecho_payment_pending')
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.photobook_orders orders
  SET
    status = CASE WHEN move_to_dead_letter THEN 'manual_review'::public.photobook_order_status ELSE orders.status END,
    fulfilment_status = CASE WHEN move_to_dead_letter
      THEN 'manual_review'::public.fulfilment_status ELSE 'retry_scheduled'::public.fulfilment_status END,
    fulfilment_lease_owner = NULL,
    fulfilment_lease_expires_at = NULL,
    next_retry_at = CASE WHEN move_to_dead_letter THEN NULL
      ELSE clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds) END,
    fulfilment_dead_lettered_at = CASE WHEN move_to_dead_letter THEN statement_timestamp()
      ELSE orders.fulfilment_dead_lettered_at END,
    last_error_code = processing_failure_code,
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.id = target_order_id;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, from_status, to_status, payload_summary
  ) VALUES (
    target_order_id, 'system', CASE WHEN move_to_dead_letter
      THEN 'order.peecho_dead_lettered.v1' ELSE 'order.peecho_retry_scheduled.v1' END,
    'order:' || target_order_id::text || ':peecho-failure:' || selected_order.retry_count::text,
    selected_order.fulfilment_status::text,
    CASE WHEN move_to_dead_letter THEN 'manual_review' ELSE 'retry_scheduled' END,
    jsonb_build_object(
      'schemaVersion', 1, 'failureCode', processing_failure_code,
      'attempt', selected_order.retry_count, 'deadLetter', move_to_dead_letter
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_mark_peecho_manual_review(
  worker_identifier text,
  target_order_id uuid,
  review_reason_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE selected_order public.photobook_orders%ROWTYPE;
BEGIN
  IF worker_identifier IS NULL
     OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
     OR target_order_id IS NULL
     OR review_reason_code IS NULL OR review_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'invalid Peecho manual-review input' USING ERRCODE = '22023';
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.status = 'paid'
    AND orders.payment_status = 'paid'
    AND orders.fulfilment_status IN ('claimed', 'peecho_order_created', 'peecho_payment_pending', 'retry_scheduled')
    AND orders.fulfilment_lease_owner = worker_identifier
    AND orders.fulfilment_lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.photobook_orders orders
  SET
    status = 'manual_review',
    fulfilment_status = 'manual_review',
    fulfilment_lease_owner = NULL,
    fulfilment_lease_expires_at = NULL,
    next_retry_at = NULL,
    last_error_code = review_reason_code,
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.id = target_order_id;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, from_status, to_status, payload_summary
  ) VALUES (
    target_order_id, 'system', 'order.peecho_manual_review.v1',
    'order:' || target_order_id::text || ':peecho-review:' || selected_order.retry_count::text,
    selected_order.fulfilment_status::text, 'manual_review',
    jsonb_build_object('schemaVersion', 1, 'reasonCode', review_reason_code, 'attempt', selected_order.retry_count)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_peecho_status_rank(provider_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE provider_status
    WHEN 'OPEN' THEN 10
    WHEN 'PAYMENT_ERROR' THEN 10
    WHEN 'PAID' THEN 20
    WHEN 'WAITING_TO_DISPATCH' THEN 30
    WHEN 'IN_PRINT_QUEUE' THEN 31
    WHEN 'SUBMITTED' THEN 32
    WHEN 'IN_PRODUCTION' THEN 40
    WHEN 'SHIPPED' THEN 50
    WHEN 'CHECK_ORDER' THEN 80
    WHEN 'HOLD_ORDER_CHECK' THEN 80
    WHEN 'NO_PRINT_FACILITY_ERROR' THEN 80
    WHEN 'SUBMISSION_ERROR' THEN 80
    WHEN 'PRODUCTION_ERROR' THEN 80
    WHEN 'CANCELLED' THEN 90
    WHEN 'REFUNDED' THEN 90
    ELSE -1
  END
$function$;

CREATE OR REPLACE FUNCTION public.app_record_peecho_callback(
  requested_application_environment text,
  requested_provider_environment text,
  requested_event_key text,
  requested_provider_order_id text,
  requested_merchant_reference text,
  requested_old_status text,
  requested_new_status text,
  requested_tracking_code text,
  requested_tracking_url text,
  requested_verified_at timestamptz
)
RETURNS TABLE (replayed boolean, applied boolean, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  inserted_inbox_id uuid;
  existing_inbox public.provider_event_inbox%ROWTYPE;
  selected_order public.photobook_orders%ROWTYPE;
  next_fulfilment public.fulfilment_status;
  new_rank integer;
  current_rank integer;
  event_outcome text;
  inbox_status public.provider_inbox_status;
  state_changed boolean := false;
BEGIN
  IF requested_application_environment IS NULL OR requested_application_environment NOT IN ('preview', 'staging', 'production', 'test')
     OR requested_provider_environment IS NULL OR requested_provider_environment NOT IN ('test', 'live')
     OR requested_event_key IS NULL OR requested_event_key !~ '^[0-9a-f]{64}$'
     OR requested_provider_order_id IS NULL OR requested_provider_order_id !~ '^[1-9][0-9]{0,15}$'
     OR requested_merchant_reference IS NULL OR requested_merchant_reference !~ '^buildy:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR requested_old_status IS NULL OR requested_old_status !~ '^[A-Z][A-Z0-9_]{0,79}$'
     OR requested_new_status IS NULL OR requested_new_status !~ '^[A-Z][A-Z0-9_]{0,79}$'
     OR (requested_tracking_code IS NOT NULL AND char_length(requested_tracking_code) NOT BETWEEN 1 AND 500)
     OR (requested_tracking_url IS NOT NULL AND (char_length(requested_tracking_url) > 2048 OR requested_tracking_url !~ '^https://'))
     OR requested_verified_at IS NULL
     OR requested_verified_at < '2020-01-01T00:00:00Z'::timestamptz
     OR requested_verified_at > statement_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid verified Peecho callback' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.provider_event_inbox (
    provider, environment, provider_event_id, event_type, reference,
    payload_sha256, payload_summary, signature_verified_at, status
  ) VALUES (
    'peecho', requested_application_environment, requested_provider_environment || ':' || requested_event_key,
    'peecho.status.' || lower(requested_new_status) || '.v1', requested_merchant_reference,
    requested_event_key,
    jsonb_build_object(
      'schemaVersion', 1, 'providerEnvironment', requested_provider_environment,
      'providerOrderId', requested_provider_order_id,
      'oldStatus', requested_old_status, 'newStatus', requested_new_status
    ),
    requested_verified_at, 'received'
  ) ON CONFLICT (provider, environment, provider_event_id) DO NOTHING
  RETURNING id INTO inserted_inbox_id;

  IF inserted_inbox_id IS NULL THEN
    SELECT inbox.* INTO existing_inbox
    FROM public.provider_event_inbox inbox
    WHERE inbox.provider = 'peecho'
      AND inbox.environment = requested_application_environment
      AND inbox.provider_event_id = requested_provider_environment || ':' || requested_event_key;
    IF existing_inbox.payload_sha256 IS DISTINCT FROM requested_event_key
       OR existing_inbox.reference IS DISTINCT FROM requested_merchant_reference
       OR existing_inbox.event_type IS DISTINCT FROM 'peecho.status.' || lower(requested_new_status) || '.v1' THEN
      RAISE EXCEPTION 'Peecho provider event identity collision' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT true, false, coalesce(existing_inbox.payload_summary ->> 'outcome', 'applied');
    RETURN;
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.merchant_reference = requested_merchant_reference
  FOR UPDATE;

  IF NOT FOUND
     OR selected_order.peecho_order_id IS DISTINCT FROM requested_provider_order_id
     OR selected_order.peecho_environment IS DISTINCT FROM requested_provider_environment THEN
    UPDATE public.provider_event_inbox inbox
    SET status = 'dead_letter', applied_at = statement_timestamp(),
      last_error_code = 'peecho_reference_rejected',
      payload_summary = inbox.payload_summary || jsonb_build_object('outcome', 'reference_rejected'),
      updated_at = statement_timestamp()
    WHERE inbox.id = inserted_inbox_id;
    RETURN QUERY SELECT false, false, 'reference_rejected'::text;
    RETURN;
  END IF;

  new_rank := public.app_peecho_status_rank(requested_new_status);
  current_rank := coalesce(public.app_peecho_status_rank(selected_order.peecho_status), -1);

  IF new_rank < 0 THEN
    event_outcome := 'manual_review';
    inbox_status := 'dead_letter';
    next_fulfilment := 'manual_review';
  ELSIF new_rank < current_rank THEN
    event_outcome := 'ignored_out_of_order';
    inbox_status := 'ignored';
    next_fulfilment := selected_order.fulfilment_status;
  ELSIF selected_order.status <> 'paid' OR selected_order.payment_status <> 'paid' THEN
    event_outcome := 'manual_review';
    inbox_status := 'dead_letter';
    next_fulfilment := 'manual_review';
  ELSIF requested_new_status IN (
    'CHECK_ORDER', 'HOLD_ORDER_CHECK', 'NO_PRINT_FACILITY_ERROR',
    'SUBMISSION_ERROR', 'PRODUCTION_ERROR', 'CANCELLED', 'REFUNDED'
  ) THEN
    event_outcome := 'manual_review';
    inbox_status := 'dead_letter';
    next_fulfilment := 'manual_review';
  ELSIF requested_new_status IN ('OPEN', 'PAYMENT_ERROR') THEN
    event_outcome := 'applied';
    inbox_status := 'applied';
    next_fulfilment := 'peecho_payment_pending';
  ELSIF requested_new_status IN ('PAID', 'WAITING_TO_DISPATCH', 'IN_PRINT_QUEUE', 'SUBMITTED') THEN
    event_outcome := 'applied';
    inbox_status := 'applied';
    next_fulfilment := 'submitted_to_production';
  ELSIF requested_new_status = 'IN_PRODUCTION' THEN
    event_outcome := 'applied';
    inbox_status := 'applied';
    next_fulfilment := 'in_production';
  ELSE
    event_outcome := 'applied';
    inbox_status := 'applied';
    next_fulfilment := 'shipped';
  END IF;

  IF event_outcome <> 'ignored_out_of_order' THEN
    UPDATE public.photobook_orders orders
    SET
      status = CASE WHEN event_outcome = 'manual_review' AND orders.status = 'paid'
        THEN 'manual_review'::public.photobook_order_status ELSE orders.status END,
      fulfilment_status = next_fulfilment,
      peecho_status = requested_new_status,
      peecho_last_status_at = requested_verified_at,
      peecho_submitted_at = CASE WHEN next_fulfilment IN ('submitted_to_production', 'in_production', 'shipped')
        THEN coalesce(orders.peecho_submitted_at, requested_verified_at) ELSE orders.peecho_submitted_at END,
      tracking_code = coalesce(requested_tracking_code, orders.tracking_code),
      tracking_url = coalesce(requested_tracking_url, orders.tracking_url),
      fulfilment_lease_owner = NULL,
      fulfilment_lease_expires_at = NULL,
      next_retry_at = NULL,
      last_error_code = CASE WHEN event_outcome = 'manual_review' THEN 'PEECHO_CALLBACK_REVIEW' ELSE NULL END,
      version = orders.version + 1,
      updated_at = statement_timestamp()
    WHERE orders.id = selected_order.id;
    state_changed := true;
  END IF;

  INSERT INTO public.photobook_order_events (
    order_id, source, event_type, idempotency_key, provider_event_id,
    from_status, to_status, payload_summary, occurred_at
  ) VALUES (
    selected_order.id, 'peecho', 'order.peecho_callback.v1',
    'peecho:' || requested_provider_environment || ':' || requested_event_key,
    requested_provider_environment || ':' || requested_event_key,
    selected_order.fulfilment_status::text, next_fulfilment::text,
    jsonb_build_object(
      'schemaVersion', 1, 'providerEnvironment', requested_provider_environment,
      'providerOrderId', requested_provider_order_id,
      'oldStatus', requested_old_status, 'newStatus', requested_new_status,
      'outcome', event_outcome
    ), requested_verified_at
  );

  IF next_fulfilment = 'in_production' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', selected_order.id, 'order.email.in_production.requested.v1',
      'order:' || selected_order.id::text || ':email:in-production:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF next_fulfilment = 'shipped' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', selected_order.id, 'order.email.shipped.requested.v1',
      'order:' || selected_order.id::text || ':email:shipped:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF requested_new_status = 'REFUNDED' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'photobook_order', selected_order.id, 'order.email.refund_review.requested.v1',
      'order:' || selected_order.id::text || ':email:refund-review:v1',
      jsonb_build_object('schemaVersion', 1, 'orderId', selected_order.id)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  UPDATE public.provider_event_inbox inbox
  SET
    status = inbox_status,
    applied_at = statement_timestamp(),
    last_error_code = CASE WHEN inbox_status = 'dead_letter' THEN 'peecho_callback_review' ELSE NULL END,
    payload_summary = inbox.payload_summary || jsonb_build_object('outcome', event_outcome),
    updated_at = statement_timestamp()
  WHERE inbox.id = inserted_inbox_id;

  RETURN QUERY SELECT false, state_changed, event_outcome;
END
$function$;

REVOKE ALL ON FUNCTION public.app_peecho_worker_claim(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_begin_peecho_fulfilment(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_begin_peecho_order_create(text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_persist_peecho_order_created(text, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_begin_peecho_order_payment(text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_finalize_peecho_order_status(text, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_retry_peecho_fulfilment(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_mark_peecho_manual_review(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_peecho_status_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_record_peecho_callback(
  text, text, text, text, text, text, text, text, text, timestamptz
) FROM PUBLIC;

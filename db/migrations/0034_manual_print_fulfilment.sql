-- Provider-neutral, founder-operated print fulfilment. Historical Peecho
-- columns and events remain readable, but no active worker may claim orders.

CREATE TYPE public.manual_fulfilment_status AS ENUM (
  'awaiting_review',
  'reviewed',
  'ordered_manually',
  'in_production',
  'shipped',
  'completed',
  'manual_review',
  'cancelled',
  'refund_review'
);
--> statement-breakpoint

ALTER TABLE public.photobook_orders
  ADD COLUMN manual_fulfilment_status public.manual_fulfilment_status
    NOT NULL DEFAULT 'awaiting_review',
  ADD COLUMN manual_provider_reference text,
  ADD COLUMN manual_tracking_url text,
  ADD COLUMN fulfilment_notes_ciphertext text,
  ADD COLUMN manual_fulfilment_updated_at timestamptz,
  ADD COLUMN manual_fulfilment_actor_id uuid
    REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN ordered_manually_at timestamptz,
  ADD COLUMN in_production_at timestamptz,
  ADD COLUMN shipped_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN refund_review_at timestamptz,
  ADD CONSTRAINT photobook_orders_manual_provider_reference_ck CHECK (
    manual_provider_reference IS NULL
    OR char_length(btrim(manual_provider_reference)) BETWEEN 1 AND 200
  ),
  ADD CONSTRAINT photobook_orders_manual_tracking_url_ck CHECK (
    manual_tracking_url IS NULL
    OR manual_tracking_url ~ '^https://[^[:space:]]{1,1900}$'
  ),
  ADD CONSTRAINT photobook_orders_fulfilment_notes_ciphertext_ck CHECK (
    fulfilment_notes_ciphertext IS NULL
    OR (
      fulfilment_notes_ciphertext LIKE 'v1.%'
      AND char_length(fulfilment_notes_ciphertext) <= 16000
    )
  ),
  ADD CONSTRAINT photobook_orders_manual_fulfilment_time_ck CHECK (
    manual_fulfilment_updated_at IS NOT NULL
    OR manual_fulfilment_status = 'awaiting_review'
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_manual_photobook_fulfilment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_is_admin boolean := public.app_actor_moderation_role()
    IS NOT DISTINCT FROM 'admin'::public.app_role_kind;
  stripe_refund_transition boolean :=
    OLD.payment_status IN ('paid', 'partially_refunded')
    AND NEW.payment_status IN ('partially_refunded', 'refunded')
    AND NEW.payment_status IS DISTINCT FROM OLD.payment_status;
BEGIN
  -- A verified Stripe refund always enters the founder-operated review queue.
  -- The payment worker has no app.actor_id; browser-backed changes never receive
  -- this exception.
  IF stripe_refund_transition AND public.app_actor_id() IS NULL THEN
    NEW.manual_fulfilment_status := 'refund_review';
    NEW.manual_fulfilment_updated_at := statement_timestamp();
    NEW.refund_review_at := coalesce(OLD.refund_review_at, statement_timestamp());
  END IF;

  IF ROW(
    NEW.manual_fulfilment_status,
    NEW.manual_provider_reference,
    NEW.manual_tracking_url,
    NEW.fulfilment_notes_ciphertext,
    NEW.manual_fulfilment_updated_at,
    NEW.manual_fulfilment_actor_id,
    NEW.reviewed_at,
    NEW.ordered_manually_at,
    NEW.in_production_at,
    NEW.shipped_at,
    NEW.completed_at,
    NEW.refund_review_at
  ) IS DISTINCT FROM ROW(
    OLD.manual_fulfilment_status,
    OLD.manual_provider_reference,
    OLD.manual_tracking_url,
    OLD.fulfilment_notes_ciphertext,
    OLD.manual_fulfilment_updated_at,
    OLD.manual_fulfilment_actor_id,
    OLD.reviewed_at,
    OLD.ordered_manually_at,
    OLD.in_production_at,
    OLD.shipped_at,
    OLD.completed_at,
    OLD.refund_review_at
  ) AND NOT actor_is_admin AND NOT stripe_refund_transition THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'manual fulfilment state is admin owned';
  END IF;

  IF NEW.manual_fulfilment_status IS DISTINCT FROM OLD.manual_fulfilment_status
     AND NOT (
       (OLD.manual_fulfilment_status = 'awaiting_review'
         AND NEW.manual_fulfilment_status IN ('reviewed', 'manual_review', 'cancelled', 'refund_review'))
       OR (OLD.manual_fulfilment_status = 'reviewed'
         AND NEW.manual_fulfilment_status IN ('ordered_manually', 'manual_review', 'cancelled', 'refund_review'))
       OR (OLD.manual_fulfilment_status = 'ordered_manually'
         AND NEW.manual_fulfilment_status IN ('in_production', 'manual_review', 'cancelled', 'refund_review'))
       OR (OLD.manual_fulfilment_status = 'in_production'
         AND NEW.manual_fulfilment_status IN ('shipped', 'manual_review', 'cancelled', 'refund_review'))
       OR (OLD.manual_fulfilment_status = 'shipped'
         AND NEW.manual_fulfilment_status IN ('completed', 'manual_review', 'refund_review'))
       OR (OLD.manual_fulfilment_status IN ('manual_review', 'refund_review')
         AND NEW.manual_fulfilment_status IN ('reviewed', 'cancelled'))
       OR (OLD.manual_fulfilment_status = 'completed'
         AND NEW.manual_fulfilment_status IN ('manual_review', 'refund_review'))
       OR (OLD.manual_fulfilment_status = 'cancelled'
         AND NEW.manual_fulfilment_status = 'refund_review')
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'invalid manual fulfilment transition';
  END IF;

  RETURN NEW;
END
$function$;
--> statement-breakpoint

CREATE TRIGGER photobook_orders_guard_manual_fulfilment
  BEFORE UPDATE ON public.photobook_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_manual_photobook_fulfilment();
--> statement-breakpoint

CREATE INDEX photobook_orders_manual_queue_idx
  ON public.photobook_orders (
    manual_fulfilment_status,
    paid_at DESC,
    id DESC
  )
  WHERE payment_status IN ('paid', 'partially_refunded', 'refunded');
--> statement-breakpoint

DROP INDEX IF EXISTS public.photobook_orders_peecho_paid_queue_idx;
--> statement-breakpoint

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
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'automated Peecho fulfilment is retired';
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_admin_list_paid_orders(
  requested_state text,
  cursor_paid_at timestamptz,
  cursor_order_id uuid,
  page_size integer
)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  customer_name text,
  project_id uuid,
  project_title text,
  paid_at timestamptz,
  quantity integer,
  page_count integer,
  currency text,
  total_minor integer,
  payment_status text,
  fulfilment_state text,
  needs_attention boolean,
  version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_moderation_role() IS DISTINCT FROM 'admin'::public.app_role_kind THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;
  IF requested_state IS NULL
     OR requested_state NOT IN (
       'all', 'awaiting_review', 'reviewed', 'ordered_manually',
       'in_production', 'shipped', 'completed', 'manual_review',
       'cancelled', 'refund_review'
     )
     OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100
     OR ((cursor_paid_at IS NULL) <> (cursor_order_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid order queue query';
  END IF;

  RETURN QUERY
  SELECT
    orders.id,
    orders.order_number,
    profile.display_name,
    orders.project_id,
    project.title,
    orders.paid_at,
    orders.quantity,
    (orders.checkout_snapshot ->> 'pageCount')::integer,
    orders.currency,
    orders.total_minor,
    orders.payment_status::text,
    orders.manual_fulfilment_status::text,
    orders.manual_fulfilment_status IN ('manual_review', 'refund_review'),
    orders.version
  FROM public.photobook_orders orders
  JOIN public.projects project
    ON project.id = orders.project_id
   AND project.owner_id = orders.owner_id
  JOIN public.profiles profile ON profile.user_id = orders.owner_id
  WHERE orders.payment_status IN ('paid', 'partially_refunded', 'refunded')
    AND orders.paid_at IS NOT NULL
    AND (
      requested_state = 'all'
      OR orders.manual_fulfilment_status::text = requested_state
    )
    AND (
      cursor_paid_at IS NULL
      OR (orders.paid_at, orders.id) < (cursor_paid_at, cursor_order_id)
    )
  ORDER BY orders.paid_at DESC, orders.id DESC
  LIMIT page_size + 1;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_admin_load_paid_order(target_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  order_number text,
  owner_id uuid,
  customer_name text,
  customer_email_ciphertext text,
  shipping_details_ciphertext text,
  project_id uuid,
  project_title text,
  proof_revision_id uuid,
  document_sha256 text,
  pdf_sha256 text,
  pdf_object_key text,
  pdf_size_bytes bigint,
  page_count integer,
  quantity integer,
  currency text,
  subtotal_minor integer,
  shipping_minor integer,
  tax_minor integer,
  total_minor integer,
  payment_status text,
  refunded_minor integer,
  fulfilment_state text,
  manual_provider_reference text,
  fulfilment_notes_ciphertext text,
  tracking_url text,
  seller_snapshot jsonb,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  paid_at timestamptz,
  reviewed_at timestamptz,
  ordered_manually_at timestamptz,
  in_production_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  refund_review_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_moderation_role() IS DISTINCT FROM 'admin'::public.app_role_kind THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;
  IF target_order_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid order id';
  END IF;

  RETURN QUERY
  SELECT
    orders.id,
    orders.order_number,
    orders.owner_id,
    profile.display_name,
    orders.customer_email_ciphertext,
    orders.shipping_details_ciphertext,
    orders.project_id,
    project.title,
    orders.proof_revision_id,
    revision.document_sha256,
    revision.pdf_sha256,
    pdf.object_key,
    revision.pdf_size_bytes,
    revision.page_count,
    orders.quantity,
    orders.currency,
    orders.subtotal_minor,
    orders.shipping_minor,
    orders.tax_minor,
    orders.total_minor,
    orders.payment_status::text,
    orders.refunded_minor,
    orders.manual_fulfilment_status::text,
    orders.manual_provider_reference,
    orders.fulfilment_notes_ciphertext,
    orders.manual_tracking_url,
    orders.seller_snapshot,
    orders.stripe_checkout_session_id,
    orders.stripe_payment_intent_id,
    orders.stripe_charge_id,
    orders.paid_at,
    orders.reviewed_at,
    orders.ordered_manually_at,
    orders.in_production_at,
    orders.shipped_at,
    orders.completed_at,
    orders.refund_review_at,
    orders.created_at,
    orders.updated_at,
    orders.version
  FROM public.photobook_orders orders
  JOIN public.projects project
    ON project.id = orders.project_id
   AND project.owner_id = orders.owner_id
  JOIN public.profiles profile ON profile.user_id = orders.owner_id
  JOIN public.photobook_revisions revision
    ON revision.id = orders.proof_revision_id
   AND revision.project_id = orders.project_id
   AND revision.owner_id = orders.owner_id
   AND revision.status = 'locked'
  JOIN public.media_assets pdf
    ON pdf.id = revision.pdf_asset_id
   AND pdf.project_id = orders.project_id
   AND pdf.owner_id = orders.owner_id
   AND pdf.purpose = 'photobook_pdf'
   AND pdf.status = 'ready'
   AND pdf.detected_content_type = 'application/pdf'
   AND pdf.sha256 = revision.pdf_sha256
   AND pdf.size_bytes = revision.pdf_size_bytes
  WHERE orders.id = target_order_id
    AND orders.payment_status IN ('paid', 'partially_refunded', 'refunded')
    AND orders.paid_at IS NOT NULL;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_admin_list_order_events(target_order_id uuid)
RETURNS TABLE (
  event_id uuid,
  event_type text,
  actor_user_id uuid,
  from_status text,
  to_status text,
  payload_summary jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_moderation_role() IS DISTINCT FROM 'admin'::public.app_role_kind THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;
  RETURN QUERY
  SELECT
    event.id,
    event.event_type,
    event.actor_user_id,
    event.from_status,
    event.to_status,
    event.payload_summary,
    event.occurred_at
  FROM public.photobook_order_events event
  WHERE event.order_id = target_order_id
  ORDER BY event.occurred_at ASC, event.id ASC;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_admin_apply_manual_fulfilment(
  target_order_id uuid,
  expected_order_version integer,
  requested_action text,
  requested_external_reference text,
  requested_tracking_url text,
  requested_notes_ciphertext text,
  requested_idempotency_key text,
  requested_request_hash text,
  requested_request_id text
)
RETURNS TABLE (
  order_id uuid,
  fulfilment_state text,
  order_version integer,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user_id uuid := public.app_actor_id();
  selected_order public.photobook_orders%ROWTYPE;
  existing_event public.photobook_order_events%ROWTYPE;
  next_state public.manual_fulfilment_status;
  previous_state public.manual_fulfilment_status;
  action_time timestamptz := statement_timestamp();
BEGIN
  IF public.app_actor_moderation_role() IS DISTINCT FROM 'admin'::public.app_role_kind
     OR actor_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;
  IF target_order_id IS NULL
     OR expected_order_version IS NULL OR expected_order_version < 1
     OR requested_action IS NULL OR requested_action NOT IN (
       'review', 'ordered_manually', 'mark_in_production', 'mark_shipped',
       'mark_completed', 'manual_review', 'cancel', 'refund_review',
       'update_details'
     )
     OR requested_idempotency_key IS NULL
     OR requested_idempotency_key !~ '^manual-fulfilment:v1:[0-9a-f]{64}$'
     OR requested_request_hash IS NULL
     OR requested_request_hash !~ '^[0-9a-f]{64}$'
     OR requested_request_id IS NULL
     OR requested_request_id !~ '^[0-9a-fA-F-]{36}$'
     OR (
       requested_external_reference IS NOT NULL
       AND char_length(btrim(requested_external_reference)) NOT BETWEEN 1 AND 200
     )
     OR (
       requested_tracking_url IS NOT NULL
       AND requested_tracking_url !~ '^https://[^[:space:]]{1,1900}$'
     )
     OR (
       requested_notes_ciphertext IS NOT NULL
       AND (
         requested_notes_ciphertext NOT LIKE 'v1.%'
         OR char_length(requested_notes_ciphertext) > 16000
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid manual fulfilment command';
  END IF;

  SELECT event.* INTO existing_event
  FROM public.photobook_order_events event
  WHERE event.idempotency_key = requested_idempotency_key;
  IF FOUND THEN
    IF existing_event.order_id IS DISTINCT FROM target_order_id
       OR existing_event.payload_summary ->> 'requestHash' IS DISTINCT FROM requested_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'manual fulfilment idempotency collision';
    END IF;
    SELECT orders.* INTO selected_order
    FROM public.photobook_orders orders
    WHERE orders.id = target_order_id;
    RETURN QUERY SELECT
      selected_order.id,
      selected_order.manual_fulfilment_status::text,
      selected_order.version,
      true;
    RETURN;
  END IF;

  SELECT orders.* INTO selected_order
  FROM public.photobook_orders orders
  WHERE orders.id = target_order_id
    AND orders.payment_status IN ('paid', 'partially_refunded', 'refunded')
    AND orders.paid_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'paid order unavailable';
  END IF;
  IF selected_order.version <> expected_order_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'order version conflict';
  END IF;
  previous_state := selected_order.manual_fulfilment_status;

  next_state := CASE requested_action
    WHEN 'review' THEN 'reviewed'::public.manual_fulfilment_status
    WHEN 'ordered_manually' THEN 'ordered_manually'::public.manual_fulfilment_status
    WHEN 'mark_in_production' THEN 'in_production'::public.manual_fulfilment_status
    WHEN 'mark_shipped' THEN 'shipped'::public.manual_fulfilment_status
    WHEN 'mark_completed' THEN 'completed'::public.manual_fulfilment_status
    WHEN 'manual_review' THEN 'manual_review'::public.manual_fulfilment_status
    WHEN 'cancel' THEN 'cancelled'::public.manual_fulfilment_status
    WHEN 'refund_review' THEN 'refund_review'::public.manual_fulfilment_status
    ELSE selected_order.manual_fulfilment_status
  END;

  IF requested_action = 'review'
     AND selected_order.manual_fulfilment_status NOT IN ('awaiting_review', 'manual_review', 'refund_review') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid manual fulfilment transition';
  ELSIF requested_action = 'ordered_manually'
     AND (
       selected_order.manual_fulfilment_status <> 'reviewed'
       OR coalesce(requested_external_reference, selected_order.manual_provider_reference) IS NULL
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid manual fulfilment transition';
  ELSIF requested_action = 'mark_in_production'
     AND selected_order.manual_fulfilment_status <> 'ordered_manually' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid manual fulfilment transition';
  ELSIF requested_action = 'mark_shipped'
     AND selected_order.manual_fulfilment_status <> 'in_production' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid manual fulfilment transition';
  ELSIF requested_action = 'mark_completed'
     AND selected_order.manual_fulfilment_status <> 'shipped' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid manual fulfilment transition';
  ELSIF requested_action = 'cancel'
     AND selected_order.manual_fulfilment_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'invalid manual fulfilment transition';
  ELSIF requested_action = 'update_details'
     AND requested_external_reference IS NULL
     AND requested_tracking_url IS NULL
     AND requested_notes_ciphertext IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'empty manual fulfilment update';
  END IF;

  UPDATE public.photobook_orders orders
  SET
    manual_fulfilment_status = next_state,
    manual_provider_reference = coalesce(
      nullif(btrim(requested_external_reference), ''),
      orders.manual_provider_reference
    ),
    manual_tracking_url = coalesce(requested_tracking_url, orders.manual_tracking_url),
    fulfilment_notes_ciphertext = coalesce(
      requested_notes_ciphertext,
      orders.fulfilment_notes_ciphertext
    ),
    manual_fulfilment_updated_at = action_time,
    manual_fulfilment_actor_id = actor_user_id,
    reviewed_at = CASE
      WHEN requested_action = 'review' THEN coalesce(orders.reviewed_at, action_time)
      ELSE orders.reviewed_at
    END,
    ordered_manually_at = CASE
      WHEN requested_action = 'ordered_manually' THEN coalesce(orders.ordered_manually_at, action_time)
      ELSE orders.ordered_manually_at
    END,
    in_production_at = CASE
      WHEN requested_action = 'mark_in_production' THEN coalesce(orders.in_production_at, action_time)
      ELSE orders.in_production_at
    END,
    shipped_at = CASE
      WHEN requested_action = 'mark_shipped' THEN coalesce(orders.shipped_at, action_time)
      ELSE orders.shipped_at
    END,
    completed_at = CASE
      WHEN requested_action = 'mark_completed' THEN coalesce(orders.completed_at, action_time)
      ELSE orders.completed_at
    END,
    refund_review_at = CASE
      WHEN requested_action = 'refund_review' THEN coalesce(orders.refund_review_at, action_time)
      ELSE orders.refund_review_at
    END,
    version = orders.version + 1,
    updated_at = action_time
  WHERE orders.id = target_order_id
  RETURNING orders.* INTO selected_order;

  INSERT INTO public.photobook_order_events (
    order_id,
    source,
    event_type,
    idempotency_key,
    actor_user_id,
    from_status,
    to_status,
    payload_summary,
    occurred_at
  ) VALUES (
    selected_order.id,
    'admin',
    'manual_fulfilment.' || requested_action || '.v1',
    requested_idempotency_key,
    actor_user_id,
    previous_state::text,
    selected_order.manual_fulfilment_status::text,
    jsonb_build_object(
      'schemaVersion', 1,
      'requestHash', requested_request_hash,
      'hasExternalReference', requested_external_reference IS NOT NULL,
      'hasTrackingUrl', requested_tracking_url IS NOT NULL,
      'hasInternalNotes', requested_notes_ciphertext IS NOT NULL
    ),
    action_time
  );

  INSERT INTO public.audit_events (
    actor_kind,
    actor_user_id,
    action,
    resource_type,
    resource_id,
    request_id,
    metadata
  ) VALUES (
    'admin',
    actor_user_id,
    'order.manual_fulfilment.' || requested_action,
    'photobook_order',
    selected_order.id,
    requested_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'fromState', previous_state::text,
      'toState', next_state::text,
      'version', selected_order.version
    )
  );

  RETURN QUERY SELECT
    selected_order.id,
    selected_order.manual_fulfilment_status::text,
    selected_order.version,
    false;
END
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_peecho_worker_claim(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_manual_photobook_fulfilment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_list_paid_orders(text, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_load_paid_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_list_order_events(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_apply_manual_fulfilment(
  uuid, integer, text, text, text, text, text, text, text
) FROM PUBLIC;

-- Server-owned checkout reservation and owner-scoped order reads/writes. The
-- application credential is not browser-exposed; RLS still binds every
-- mutation to app.actor_id and triggers make commercial snapshots immutable.

ALTER TABLE public.photobook_orders
  ADD COLUMN stripe_checkout_expires_at timestamptz,
  ADD COLUMN tracking_url text;

ALTER TABLE public.photobook_orders
  ADD CONSTRAINT photobook_orders_checkout_session_ck
  CHECK ((stripe_checkout_session_id IS NULL) = (stripe_checkout_expires_at IS NULL)),
  ADD CONSTRAINT photobook_orders_tracking_url_ck
  CHECK (tracking_url IS NULL OR tracking_url ~ '^https://');

CREATE POLICY photobook_orders_owner_insert
ON public.photobook_orders FOR INSERT
WITH CHECK (
  owner_id = public.app_actor_id()
  AND status = 'awaiting_payment'
  AND payment_status = 'unpaid'
  AND fulfilment_status = 'unclaimed'
  AND stripe_checkout_session_id IS NULL
  AND stripe_checkout_expires_at IS NULL
  AND stripe_payment_intent_id IS NULL
  AND peecho_order_id IS NULL
  AND fulfilment_lease_owner IS NULL
  AND fulfilment_lease_expires_at IS NULL
  AND retry_count = 0
  AND paid_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = proof_revision_id
      AND revision.project_id = photobook_orders.project_id
      AND revision.owner_id = public.app_actor_id()
      AND revision.status = 'locked'
      AND revision.pdf_sha256 = checkout_snapshot ->> 'pdfSha256'
      AND revision.document_sha256 = checkout_snapshot ->> 'documentSha256'
      AND revision.page_count = (checkout_snapshot ->> 'pageCount')::integer
  )
);

CREATE POLICY photobook_orders_owner_update_checkout
ON public.photobook_orders FOR UPDATE
USING (owner_id = public.app_actor_id())
WITH CHECK (owner_id = public.app_actor_id());

CREATE POLICY photobook_order_events_owner_insert
ON public.photobook_order_events FOR INSERT
WITH CHECK (
  actor_user_id = public.app_actor_id()
  AND source = 'user'
  AND EXISTS (
    SELECT 1
    FROM public.photobook_orders orders
    WHERE orders.id = order_id
      AND orders.owner_id = public.app_actor_id()
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
    (OLD.status = 'awaiting_payment' AND NEW.status IN ('checkout_open', 'cancelled'))
    OR (OLD.status = 'checkout_open' AND NEW.status IN ('paid', 'payment_failed', 'expired', 'cancelled'))
    OR (OLD.status IN ('payment_failed', 'expired') AND NEW.status IN ('checkout_open', 'cancelled'))
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

  IF NEW.status = 'checkout_open' AND (
    NEW.stripe_checkout_session_id IS NULL
    OR NEW.stripe_checkout_expires_at IS NULL
  ) THEN
    RAISE EXCEPTION 'checkout-open order requires a Stripe session'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'paid' AND (
    NEW.payment_status <> 'paid'
    OR NEW.paid_at IS NULL
  ) THEN
    RAISE EXCEPTION 'paid order requires durable payment evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS photobook_orders_guard_transition ON public.photobook_orders;
CREATE TRIGGER photobook_orders_guard_transition
BEFORE UPDATE ON public.photobook_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_photobook_order_transition();

REVOKE EXECUTE ON FUNCTION public.guard_photobook_order_transition() FROM PUBLIC;

-- Keep personalized print PDFs out of the public trip-media bucket. Peecho gets
-- a short-lived signed URL generated server-side immediately before fulfillment.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('photobook-pdfs', 'photobook-pdfs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Owner uploads photobook PDFs" ON storage.objects;
CREATE POLICY "Owner uploads photobook PDFs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'photobook-pdfs'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND array_length(storage.foldername(name), 1) = 2
  AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = ((storage.foldername(name))[2])::uuid
      AND t.user_id = auth.uid()
  )
  AND lower(storage.extension(name)) = 'pdf'
);

DROP POLICY IF EXISTS "Owner deletes photobook PDFs" ON storage.objects;
CREATE POLICY "Owner deletes photobook PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'photobook-pdfs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

ALTER TABLE public.photobook_orders
  ADD COLUMN IF NOT EXISTS pdf_storage_path text,
  ADD COLUMN IF NOT EXISTS pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS pdf_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS pdf_url_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_delete_after timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS legal_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS checkout_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_subtotal_cents integer,
  ADD COLUMN IF NOT EXISTS payment_shipping_cents integer,
  ADD COLUMN IF NOT EXISTS payment_refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS photobook_orders_pdf_storage_path_key
ON public.photobook_orders(pdf_storage_path)
WHERE pdf_storage_path IS NOT NULL;

ALTER TABLE public.photobook_orders
  DROP CONSTRAINT IF EXISTS photobook_orders_print_page_count_check,
  ADD CONSTRAINT photobook_orders_print_page_count_check
    CHECK (page_count BETWEEN 24 AND 400 AND page_count % 2 = 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS photobook_orders_format_check,
  ADD CONSTRAINT photobook_orders_format_check
    CHECK (format IN ('A4_LANDSCAPE', 'A4_PORTRAIT', 'SQUARE_210')) NOT VALID,
  DROP CONSTRAINT IF EXISTS photobook_orders_payment_amount_check,
  ADD CONSTRAINT photobook_orders_payment_amount_check
    CHECK (
      (payment_amount_cents IS NULL OR payment_amount_cents >= 0)
      AND (payment_subtotal_cents IS NULL OR payment_subtotal_cents >= 0)
      AND (payment_shipping_cents IS NULL OR payment_shipping_cents >= 0)
      AND payment_refunded_cents >= 0
      AND (payment_amount_cents IS NULL OR payment_refunded_cents <= payment_amount_cents)
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS photobook_orders_checkout_snapshot_seller_phone_check,
  ADD CONSTRAINT photobook_orders_checkout_snapshot_seller_phone_check
    CHECK (
      checkout_snapshot = '{}'::jsonb
      OR nullif(btrim(checkout_snapshot #>> '{seller,contactPhone}'), '') IS NOT NULL
    ) NOT VALID;

-- Order state, prices and PDF identity are server-owned. Clients retain SELECT
-- through RLS, but can no longer forge an order before invoking checkout.
DROP POLICY IF EXISTS "Owner can create photobook orders" ON public.photobook_orders;
REVOKE INSERT, UPDATE, DELETE ON public.photobook_orders FROM authenticated;
GRANT SELECT ON public.photobook_orders TO authenticated;

-- Serializes account deletion against new photobook orders. An in-flight
-- checkout that inserts before this lock is visible to the deletion precheck;
-- an insert after the lock is rejected by the trigger below.
CREATE TABLE IF NOT EXISTS public.account_deletion_locks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_locks FROM anon, authenticated, public;
GRANT ALL ON public.account_deletion_locks TO service_role;

-- A final storage sweep runs after auth deletion to catch uploads that were
-- already in flight during the first sweep. Failures cannot be retried by the
-- now-deleted user, so the retention cron owns this service-role-only queue.
CREATE TABLE IF NOT EXISTS public.account_deletion_cleanup_failures (
  user_id uuid PRIMARY KEY,
  failed_buckets text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

ALTER TABLE public.account_deletion_cleanup_failures
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.account_deletion_cleanup_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_cleanup_failures FROM anon, authenticated, public;
GRANT ALL ON public.account_deletion_cleanup_failures TO service_role;

CREATE OR REPLACE FUNCTION public.serialize_account_deletion_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 724932));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_storage_upload_during_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  owner_text text;
  owner_id uuid;
BEGIN
  IF NEW.bucket_id NOT IN ('trip-media', 'trip-private', 'avatars', 'photobook-pdfs') THEN
    RETURN NEW;
  END IF;
  owner_text := (storage.foldername(NEW.name))[1];
  IF owner_text IS NULL OR owner_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;
  owner_id := owner_text::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text, 724932));
  IF EXISTS (SELECT 1 FROM public.account_deletion_locks l WHERE l.user_id = owner_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_IN_PROGRESS: storage upload rejected for user %', owner_id
      USING ERRCODE = 'object_in_use';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.serialize_account_deletion_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_storage_upload_during_account_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS serialize_account_deletion_lock ON public.account_deletion_locks;
CREATE TRIGGER serialize_account_deletion_lock
BEFORE INSERT ON public.account_deletion_locks
FOR EACH ROW EXECUTE FUNCTION public.serialize_account_deletion_lock();

DROP TRIGGER IF EXISTS guard_storage_upload_during_account_deletion ON storage.objects;
CREATE TRIGGER guard_storage_upload_during_account_deletion
BEFORE INSERT ON storage.objects
FOR EACH ROW EXECUTE FUNCTION public.guard_storage_upload_during_account_deletion();

CREATE OR REPLACE FUNCTION public.guard_photobook_order_during_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Serialize the order insert with account deletion and user-owned storage
  -- uploads before checking the deletion marker.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 724932));
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_locks l WHERE l.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_IN_PROGRESS: cannot create photobook order for user %', NEW.user_id
      USING ERRCODE = 'object_in_use';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_photobook_order_during_account_deletion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_photobook_order_during_account_deletion ON public.photobook_orders;
CREATE TRIGGER guard_photobook_order_during_account_deletion
BEFORE INSERT ON public.photobook_orders
FOR EACH ROW EXECUTE FUNCTION public.guard_photobook_order_during_account_deletion();

CREATE OR REPLACE FUNCTION public.photobook_order_status_rank(value text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(value, '')
    WHEN 'pdf_ready' THEN 5
    WHEN 'payment_pending' THEN 5
    WHEN 'paid' THEN 10
    WHEN 'paid_pending_fulfillment' THEN 25
    WHEN 'payment_review' THEN 15
    WHEN 'peecho_open' THEN 20
    WHEN 'submitted_to_peecho' THEN 30
    WHEN 'in_production' THEN 50
    WHEN 'peecho_review' THEN 55
    WHEN 'peecho_payment_failed' THEN 58
    WHEN 'peecho_failed' THEN 58
    WHEN 'shipped' THEN 60
    WHEN 'delivered' THEN 70
    WHEN 'refund_review' THEN 90
    WHEN 'cancelled' THEN 100
    WHEN 'refunded' THEN 100
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.enforce_photobook_order_status_monotonic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.payment_status IN ('partially_refunded', 'refunded')
    AND NEW.payment_status = 'paid'
  THEN
    NEW.payment_status := OLD.payment_status;
    NEW.payment_refunded_cents := OLD.payment_refunded_cents;
    NEW.stripe_refund_id := OLD.stripe_refund_id;
    NEW.refunded_at := OLD.refunded_at;
  END IF;
  IF OLD.payment_status IN ('partially_refunded', 'refunded')
    AND NEW.payment_status = OLD.payment_status
  THEN
    -- Provider fulfillment is stored separately; it must not replace the
    -- customer-facing Stripe refund state, even at the same status rank.
    NEW.status := OLD.status;
  END IF;
  IF (OLD.paid_at IS NOT NULL OR NEW.paid_at IS NOT NULL)
    AND public.photobook_order_status_rank(NEW.status)
      < public.photobook_order_status_rank(OLD.status)
  THEN
    NEW.status := OLD.status;
    -- Stripe refund state and physical Peecho state are independent. Keep the
    -- refund status monotonic while still allowing a later provider-confirmed
    -- shipment, delivery or cancellation to be recorded.
    IF OLD.payment_status NOT IN ('partially_refunded', 'refunded') THEN
      NEW.fulfillment_status := OLD.fulfillment_status;
      NEW.fulfillment_error := OLD.fulfillment_error;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.photobook_order_status_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_photobook_order_status_monotonic() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_photobook_order_status_monotonic ON public.photobook_orders;
CREATE TRIGGER enforce_photobook_order_status_monotonic
BEFORE UPDATE ON public.photobook_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_photobook_order_status_monotonic();

-- A paid sale must survive project/account deletion for the statutory fiscal
-- retention period, without retaining the customer profile, email, address,
-- photos or event payloads. Active fulfillment blocks deletion entirely.
CREATE TABLE IF NOT EXISTS public.photobook_order_archive (
  source_order_id uuid PRIMARY KEY,
  merchant_reference text NOT NULL UNIQUE,
  peecho_id text,
  stripe_payment_intent_id text,
  format text NOT NULL,
  page_count integer NOT NULL,
  payment_subtotal_cents integer,
  payment_shipping_cents integer,
  payment_amount_cents integer,
  payment_refunded_cents integer NOT NULL DEFAULT 0,
  payment_currency text NOT NULL,
  stripe_refund_id text,
  refunded_at timestamptz,
  terms_version text,
  checkout_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  final_status text NOT NULL,
  paid_at timestamptz,
  ordered_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL
);

-- CREATE TABLE IF NOT EXISTS does not add columns when an earlier preview of
-- this migration already created the archive table.
ALTER TABLE public.photobook_order_archive
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS checkout_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE public.photobook_order_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photobook_order_archive FROM anon, authenticated, public;
GRANT ALL ON public.photobook_order_archive TO service_role;

CREATE OR REPLACE FUNCTION public.archive_photobook_order_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_terminal boolean;
BEGIN
  is_terminal := coalesce(OLD.payment_status, '') IN ('cancelled', 'expired', 'failed')
    OR coalesce(OLD.fulfillment_status, '') IN ('shipped', 'delivered', 'cancelled')
    OR OLD.status IN (
      'delivered',
      'shipped',
      'cancelled',
      'payment_cancelled',
      'payment_expired',
      'payment_failed'
    );
  IF NOT is_terminal THEN
    RAISE EXCEPTION 'ACTIVE_PHOTOBOOK_ORDER: order % still has an open checkout or fulfillment', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- A refunded purchase remains a fiscal sale. `paid_at` records whether the
  -- transaction was ever captured, regardless of its current payment state.
  IF OLD.paid_at IS NULL THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.photobook_order_archive (
    source_order_id,
    merchant_reference,
    peecho_id,
    stripe_payment_intent_id,
    format,
    page_count,
    payment_subtotal_cents,
    payment_shipping_cents,
    payment_amount_cents,
    payment_refunded_cents,
    payment_currency,
    stripe_refund_id,
    refunded_at,
    terms_version,
    checkout_snapshot,
    final_status,
    paid_at,
    ordered_at,
    retain_until
  ) VALUES (
    OLD.id,
    OLD.merchant_reference,
    OLD.peecho_id,
    OLD.stripe_payment_intent_id,
    OLD.format,
    OLD.page_count,
    OLD.payment_subtotal_cents,
    OLD.payment_shipping_cents,
    OLD.payment_amount_cents,
    OLD.payment_refunded_cents,
    OLD.payment_currency,
    OLD.stripe_refund_id,
    OLD.refunded_at,
    OLD.terms_version,
    coalesce(OLD.checkout_snapshot, '{}'::jsonb),
    OLD.status,
    OLD.paid_at,
    OLD.ordered_at,
    coalesce(OLD.paid_at, OLD.created_at) + interval '7 years'
  )
  ON CONFLICT (source_order_id) DO UPDATE SET
    peecho_id = EXCLUDED.peecho_id,
    stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
    payment_subtotal_cents = EXCLUDED.payment_subtotal_cents,
    payment_shipping_cents = EXCLUDED.payment_shipping_cents,
    payment_amount_cents = EXCLUDED.payment_amount_cents,
    payment_refunded_cents = EXCLUDED.payment_refunded_cents,
    payment_currency = EXCLUDED.payment_currency,
    stripe_refund_id = EXCLUDED.stripe_refund_id,
    refunded_at = EXCLUDED.refunded_at,
    terms_version = EXCLUDED.terms_version,
    checkout_snapshot = EXCLUDED.checkout_snapshot,
    final_status = EXCLUDED.final_status,
    ordered_at = EXCLUDED.ordered_at,
    retain_until = greatest(public.photobook_order_archive.retain_until, EXCLUDED.retain_until);

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_photobook_order_before_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS archive_photobook_order_before_delete ON public.photobook_orders;
CREATE TRIGGER archive_photobook_order_before_delete
BEFORE DELETE ON public.photobook_orders
FOR EACH ROW EXECUTE FUNCTION public.archive_photobook_order_before_delete();

ALTER TABLE public.photobook_order_events
  ADD COLUMN IF NOT EXISTS provider_event_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'photobook_order_events_provider_event_id_key'
      AND conrelid = 'public.photobook_order_events'::regclass
  ) THEN
    ALTER TABLE public.photobook_order_events
      ADD CONSTRAINT photobook_order_events_provider_event_id_key UNIQUE (provider_event_id);
  END IF;
END $$;

-- Earlier webhook versions stored the Peecho API key, addresses and complete
-- Stripe objects in owner-readable JSON. Remove those legacy copies.
UPDATE public.photobook_orders
SET peecho_order_request = jsonb_build_object('redacted', true)
WHERE peecho_order_request IS NOT NULL
  AND peecho_order_request <> '{}'::jsonb;

UPDATE public.photobook_orders
SET stripe_payload = jsonb_strip_nulls(jsonb_build_object(
  'session_id', stripe_payload->'id',
  'payment_status', stripe_payload->'payment_status',
  'amount_subtotal', stripe_payload->'amount_subtotal',
  'amount_total', stripe_payload->'amount_total',
  'currency', stripe_payload->'currency',
  'redacted', true
))
WHERE stripe_payload IS NOT NULL
  AND stripe_payload <> '{}'::jsonb;

UPDATE public.photobook_order_events
SET payload = jsonb_build_object('redacted', true, 'legacy_event_type', event_type)
WHERE event_type LIKE 'stripe_%'
   OR event_type IN ('peecho_order_submit_attempt', 'peecho_order_created', 'peecho_order_submitted');

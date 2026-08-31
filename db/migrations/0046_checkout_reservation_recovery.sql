-- Checkout reservation recovery. A proof is locked only when the hosted
-- Stripe session has been durably recorded. Terminal orders no longer prevent
-- a later, freshly quoted order for the same immutable proof.

DROP INDEX public.photobook_orders_proof_revision_uq;
--> statement-breakpoint

CREATE UNIQUE INDEX photobook_orders_active_proof_revision_uq
  ON public.photobook_orders (proof_revision_id)
  WHERE status NOT IN ('payment_failed', 'expired', 'cancelled', 'manual_review');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_photobook_order_proof()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = NEW.proof_revision_id
      AND revision.project_id = NEW.project_id
      AND revision.owner_id = NEW.owner_id
      AND revision.status = CASE
        WHEN NEW.status = 'awaiting_payment'
          AND NEW.stripe_checkout_session_id IS NULL
          THEN 'approved'::public.photobook_proof_status
        ELSE 'locked'::public.photobook_proof_status
      END
  ) THEN
    RAISE EXCEPTION 'checkout requires the expected photobook proof state'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint

DROP POLICY photobook_orders_owner_insert ON public.photobook_orders;
--> statement-breakpoint

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
      AND revision.status = 'approved'
      AND revision.pdf_sha256 = checkout_snapshot ->> 'pdfSha256'
      AND revision.document_sha256 = checkout_snapshot ->> 'documentSha256'
      AND revision.page_count = (checkout_snapshot ->> 'pageCount')::integer
  )
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_locked_photobook_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  release_allowed boolean := false;
BEGIN
  IF OLD.status IN ('approved', 'locked', 'invalidated') AND (
    NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.project_revision IS DISTINCT FROM OLD.project_revision
    OR NEW.document IS DISTINCT FROM OLD.document
    OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256
    OR NEW.asset_set IS DISTINCT FROM OLD.asset_set
    OR NEW.asset_set_sha256 IS DISTINCT FROM OLD.asset_set_sha256
    OR NEW.pdf_asset_id IS DISTINCT FROM OLD.pdf_asset_id
    OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
    OR NEW.pdf_size_bytes IS DISTINCT FROM OLD.pdf_size_bytes
    OR NEW.page_count IS DISTINCT FROM OLD.page_count
    OR NEW.render_engine IS DISTINCT FROM OLD.render_engine
    OR NEW.render_version IS DISTINCT FROM OLD.render_version
    OR NEW.font_set_sha256 IS DISTINCT FROM OLD.font_set_sha256
    OR NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'approved photobook proof is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'locked'
     AND NEW.status = 'approved'
     AND NEW.locked_at IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.photobook_orders terminal_order
      WHERE terminal_order.proof_revision_id = OLD.id
        AND terminal_order.owner_id = OLD.owner_id
        AND terminal_order.payment_status NOT IN ('paid', 'partially_refunded', 'refunded')
        AND (
          (
            terminal_order.status = 'cancelled'
            AND terminal_order.payment_status = 'unpaid'
            AND terminal_order.stripe_checkout_session_id IS NULL
            AND terminal_order.owner_id = public.app_actor_id()
          )
          OR (
            terminal_order.status IN ('payment_failed', 'expired')
            AND terminal_order.stripe_checkout_session_id IS NOT NULL
            AND public.app_actor_id() IS NULL
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.photobook_orders active_order
          WHERE active_order.proof_revision_id = OLD.id
            AND active_order.id <> terminal_order.id
            -- A reconciliation review remains a hard lock even though it is
            -- deliberately outside the uniqueness predicate above.
            AND active_order.status NOT IN ('payment_failed', 'expired', 'cancelled')
        )
    ) INTO release_allowed;
  END IF;

  IF OLD.status = 'locked'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT release_allowed THEN
    RAISE EXCEPTION 'locked photobook proof status is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'invalidated' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'invalidated photobook proof status is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'locked', 'invalidated') THEN
    RAISE EXCEPTION 'approved photobook proof has an invalid transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('locked', 'invalidated')
     AND NEW.locked_at IS DISTINCT FROM OLD.locked_at
     AND NOT release_allowed THEN
    RAISE EXCEPTION 'photobook proof lock is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.release_terminal_checkout_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NOT (
    (
      NEW.status = 'cancelled'
      AND NEW.payment_status = 'unpaid'
      AND NEW.stripe_checkout_session_id IS NULL
      AND NEW.owner_id = public.app_actor_id()
    )
    OR (
      NEW.status IN ('payment_failed', 'expired')
      AND NEW.payment_status NOT IN ('paid', 'partially_refunded', 'refunded')
      AND NEW.stripe_checkout_session_id IS NOT NULL
      AND public.app_actor_id() IS NULL
    )
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE public.photobook_revisions revision
  SET
    status = 'approved',
    locked_at = NULL,
    updated_at = NEW.updated_at
  WHERE revision.id = NEW.proof_revision_id
    AND revision.owner_id = NEW.owner_id
    AND revision.status = 'locked'
    AND NOT EXISTS (
      SELECT 1
      FROM public.photobook_orders active_order
      WHERE active_order.proof_revision_id = revision.id
        AND active_order.id <> NEW.id
        AND active_order.status NOT IN ('payment_failed', 'expired', 'cancelled')
    );
  RETURN NULL;
END
$function$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS photobook_orders_release_terminal_proof
ON public.photobook_orders;
--> statement-breakpoint

CREATE TRIGGER photobook_orders_release_terminal_proof
AFTER UPDATE OF status ON public.photobook_orders
FOR EACH ROW
EXECUTE FUNCTION public.release_terminal_checkout_proof();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.lock_payment_truth_photobook_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  requires_lock boolean := false;
BEGIN
  requires_lock := NEW.payment_status IN ('paid', 'partially_refunded', 'refunded')
    OR COALESCE((
      NEW.status = 'manual_review'
      AND left(NEW.last_error_code, 7) = 'stripe_'
      AND public.app_actor_id() IS NULL
    ), false);
  IF NOT requires_lock THEN
    RETURN NULL;
  END IF;

  UPDATE public.photobook_revisions revision
  SET
    status = 'locked',
    locked_at = COALESCE(revision.locked_at, NEW.paid_at, NEW.updated_at),
    updated_at = NEW.updated_at
  WHERE revision.id = NEW.proof_revision_id
    AND revision.project_id = NEW.project_id
    AND revision.owner_id = NEW.owner_id
    AND revision.status = 'approved'
    AND revision.document_sha256 = NEW.checkout_snapshot ->> 'documentSha256'
    AND revision.pdf_sha256 = NEW.checkout_snapshot ->> 'pdfSha256'
    AND revision.page_count = (NEW.checkout_snapshot ->> 'pageCount')::integer
    AND revision.document ->> 'selectedFormat' = NEW.checkout_snapshot ->> 'format';

  IF NOT EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = NEW.proof_revision_id
      AND revision.project_id = NEW.project_id
      AND revision.owner_id = NEW.owner_id
      AND revision.status = 'locked'
      AND revision.document_sha256 = NEW.checkout_snapshot ->> 'documentSha256'
      AND revision.pdf_sha256 = NEW.checkout_snapshot ->> 'pdfSha256'
      AND revision.page_count = (NEW.checkout_snapshot ->> 'pageCount')::integer
      AND revision.document ->> 'selectedFormat' = NEW.checkout_snapshot ->> 'format'
  ) THEN
    RAISE EXCEPTION 'payment truth requires the exact locked photobook proof'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$function$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS photobook_orders_lock_payment_truth_proof
ON public.photobook_orders;
--> statement-breakpoint

CREATE TRIGGER photobook_orders_lock_payment_truth_proof
AFTER UPDATE OF status, payment_status, last_error_code ON public.photobook_orders
FOR EACH ROW
EXECUTE FUNCTION public.lock_payment_truth_photobook_proof();
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.validate_photobook_order_proof() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_locked_photobook_revision() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_terminal_checkout_proof() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lock_payment_truth_photobook_proof() FROM PUBLIC;

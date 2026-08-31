-- Request hashes for user-authored and private content are keyed blind indexes
-- from v2 onward. Remove legacy, offline-guessable fingerprints and make
-- erasure remove even keyed correlation material. Missing hash/version fields
-- deliberately make legacy idempotency replay fail closed.

UPDATE public.outbox_events event
SET payload = (event.payload - ARRAY['requestHash', 'requestHashVersion']::text[])
  || jsonb_build_object(
    'requestHashRedacted', true,
    'requestHashRedactionReason', 'LEGACY_UNKEYED_FINGERPRINT'
  ),
  updated_at = statement_timestamp()
WHERE event.event_type = ANY (ARRAY[
  'project.created.v1',
  'project.update.created.v1',
  'project.update.edited.v1',
  'project.update.published.v1',
  'project.update.deleted.v1',
  'project.phase.created.v1',
  'profile.updated.v1',
  'engagement.comment.created.v1',
  'engagement.comment.deleted.v1',
  'floorplan.created.v1',
  'floorplan.updated.v1',
  'floorplan.deleted.v1',
  'floorplan.pin.created.v1',
  'floorplan.pin.updated.v1',
  'floorplan.pin.deleted.v1',
  'budget.created.v1',
  'budget.updated.v1',
  'budget.deleted.v1',
  'budget.item.created.v1',
  'budget.item.updated.v1',
  'budget.item.deleted.v1',
  'media.upload.intent.created.v1',
  'photobook.proof.requested.v1',
  'photobook.proof.approved.v1'
]::text[])
  AND event.payload ? 'requestHash'
  AND event.payload ->> 'requestHashVersion' IS DISTINCT FROM '2';

-- Commercial and legal facts remain immutable. The only permitted snapshot
-- change is an exact request-hash removal performed from the nested account
-- erasure trigger after its owner has become a deleted tombstone.
CREATE OR REPLACE FUNCTION public.guard_photobook_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  checkout_request_hash_erasure boolean := false;
BEGIN
  checkout_request_hash_erasure :=
    NEW.checkout_snapshot IS DISTINCT FROM OLD.checkout_snapshot
    AND pg_trigger_depth() > 1
    AND EXISTS (
      SELECT 1
      FROM public.app_users account
      WHERE account.id = OLD.owner_id
        AND account.status = 'deleted'
        AND account.deleted_at IS NOT NULL
    )
    AND NEW.checkout_snapshot =
      (OLD.checkout_snapshot - ARRAY['requestHash', 'requestHashScheme']::text[])
      || jsonb_build_object(
        'requestHashRedacted', true,
        'requestHashRedactionReason', 'ACCOUNT_ERASURE'
      );

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
     OR (
       NEW.checkout_snapshot IS DISTINCT FROM OLD.checkout_snapshot
       AND NOT checkout_request_hash_erasure
     )
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

CREATE OR REPLACE FUNCTION public.app_redact_request_hashes_on_account_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status <> 'deleted' OR OLD.status = 'deleted' THEN
    RETURN NEW;
  END IF;

  UPDATE public.photobook_orders orders
  SET checkout_snapshot =
      (orders.checkout_snapshot - ARRAY['requestHash', 'requestHashScheme']::text[])
      || jsonb_build_object(
        'requestHashRedacted', true,
        'requestHashRedactionReason', 'ACCOUNT_ERASURE'
      ),
    version = orders.version + 1,
    updated_at = statement_timestamp()
  WHERE orders.owner_id = NEW.id
    AND (
      orders.checkout_snapshot ? 'requestHash'
      OR orders.checkout_snapshot ? 'requestHashScheme'
    )
    AND orders.checkout_snapshot ->> 'requestHashRedacted' IS DISTINCT FROM 'true';

  UPDATE public.outbox_events event
  SET payload = (event.payload - ARRAY['requestHash', 'requestHashVersion']::text[])
      || jsonb_build_object(
        'requestHashRedacted', true,
        'requestHashRedactionReason', 'ACCOUNT_ERASURE'
      ),
    updated_at = statement_timestamp()
  WHERE event.payload ? 'requestHash'
    AND (
      (
        event.aggregate_type = 'profile'
        AND event.event_type = 'profile.updated.v1'
        AND event.aggregate_id = NEW.id
      )
      OR (
        event.aggregate_type = 'project'
        AND event.event_type = ANY (ARRAY[
          'project.created.v1',
          'project.phase.created.v1',
          'floorplan.created.v1',
          'floorplan.updated.v1',
          'floorplan.deleted.v1',
          'floorplan.pin.created.v1',
          'floorplan.pin.updated.v1',
          'floorplan.pin.deleted.v1',
          'budget.created.v1',
          'budget.updated.v1',
          'budget.deleted.v1',
          'budget.item.created.v1',
          'budget.item.updated.v1',
          'budget.item.deleted.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT project.id
          FROM public.projects project
          WHERE project.owner_id = NEW.id
        )
      )
      OR (
        event.aggregate_type = 'update'
        AND event.event_type = ANY (ARRAY[
          'project.update.created.v1',
          'project.update.edited.v1',
          'project.update.published.v1',
          'project.update.deleted.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT item.id
          FROM public.updates item
          WHERE item.author_id = NEW.id OR item.project_owner_id = NEW.id
        )
      )
      OR (
        event.aggregate_type = 'comment'
        AND event.event_type = ANY (ARRAY[
          'engagement.comment.created.v1',
          'engagement.comment.deleted.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT comment.id
          FROM public.comments comment
          WHERE comment.author_id = NEW.id
            OR comment.project_id IN (
              SELECT project.id
              FROM public.projects project
              WHERE project.owner_id = NEW.id
            )
        )
      )
      OR (
        event.aggregate_type = 'media'
        AND event.event_type = 'media.upload.intent.created.v1'
        AND event.aggregate_id IN (
          SELECT asset.id
          FROM public.media_assets asset
          WHERE asset.owner_id = NEW.id
        )
      )
      OR (
        event.aggregate_type = 'photobook_proof'
        AND event.event_type = ANY (ARRAY[
          'photobook.proof.requested.v1',
          'photobook.proof.approved.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT revision.id
          FROM public.photobook_revisions revision
          WHERE revision.owner_id = NEW.id
        )
      )
    );

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_redact_request_hashes_on_project_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.lifecycle_status <> 'deleted' OR OLD.lifecycle_status = 'deleted' THEN
    RETURN NEW;
  END IF;

  UPDATE public.outbox_events event
  SET payload = (event.payload - ARRAY['requestHash', 'requestHashVersion']::text[])
      || jsonb_build_object(
        'requestHashRedacted', true,
        'requestHashRedactionReason', 'PROJECT_ERASURE'
      ),
    updated_at = statement_timestamp()
  WHERE event.payload ? 'requestHash'
    AND (
      (
        event.aggregate_type = 'project'
        AND event.event_type = ANY (ARRAY[
          'project.created.v1',
          'project.phase.created.v1',
          'floorplan.created.v1',
          'floorplan.updated.v1',
          'floorplan.deleted.v1',
          'floorplan.pin.created.v1',
          'floorplan.pin.updated.v1',
          'floorplan.pin.deleted.v1',
          'budget.created.v1',
          'budget.updated.v1',
          'budget.deleted.v1',
          'budget.item.created.v1',
          'budget.item.updated.v1',
          'budget.item.deleted.v1'
        ]::text[])
        AND event.aggregate_id = NEW.id
      )
      OR (
        event.aggregate_type = 'update'
        AND event.event_type = ANY (ARRAY[
          'project.update.created.v1',
          'project.update.edited.v1',
          'project.update.published.v1',
          'project.update.deleted.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT item.id FROM public.updates item WHERE item.project_id = NEW.id
        )
      )
      OR (
        event.aggregate_type = 'comment'
        AND event.event_type = ANY (ARRAY[
          'engagement.comment.created.v1',
          'engagement.comment.deleted.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT comment.id FROM public.comments comment WHERE comment.project_id = NEW.id
        )
      )
      OR (
        event.aggregate_type = 'media'
        AND event.event_type = 'media.upload.intent.created.v1'
        AND event.aggregate_id IN (
          SELECT asset.id FROM public.media_assets asset WHERE asset.project_id = NEW.id
        )
      )
      OR (
        event.aggregate_type = 'photobook_proof'
        AND event.event_type = ANY (ARRAY[
          'photobook.proof.requested.v1',
          'photobook.proof.approved.v1'
        ]::text[])
        AND event.aggregate_id IN (
          SELECT revision.id
          FROM public.photobook_revisions revision
          WHERE revision.project_id = NEW.id
        )
      )
    );

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS app_users_redact_request_hashes_on_erasure ON public.app_users;
CREATE TRIGGER app_users_redact_request_hashes_on_erasure
AFTER UPDATE OF status ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION public.app_redact_request_hashes_on_account_erasure();

DROP TRIGGER IF EXISTS projects_redact_request_hashes_on_erasure ON public.projects;
CREATE TRIGGER projects_redact_request_hashes_on_erasure
AFTER UPDATE OF lifecycle_status ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.app_redact_request_hashes_on_project_erasure();

-- The v2 payload marker is part of the narrow owner-write policies. It is
-- also what makes a pre-v2 or redacted replay unambiguously conflict.
DROP POLICY IF EXISTS outbox_events_insert_engagement_comment ON public.outbox_events;
CREATE POLICY outbox_events_insert_engagement_comment
ON public.outbox_events FOR INSERT
WITH CHECK (
  aggregate_type = 'comment'
  AND event_type IN ('engagement.comment.created.v1', 'engagement.comment.deleted.v1')
  AND public.app_can_manage_comment(aggregate_id)
  AND idempotency_key ~ '^engagement-command:v1:comment\.(create|delete):[0-9a-f]{64}$'
  AND payload ->> 'schemaVersion' = '1'
  AND payload ->> 'requestHashVersion' = '2'
  AND payload ->> 'requestHash' ~ '^[0-9a-f]{64}$'
  AND payload - ARRAY['schemaVersion', 'requestHashVersion', 'requestHash'] = '{}'::jsonb
);

DROP POLICY IF EXISTS outbox_events_insert_profile_mutation ON public.outbox_events;
CREATE POLICY outbox_events_insert_profile_mutation
ON public.outbox_events
FOR INSERT
WITH CHECK (
  aggregate_type = 'profile'
  AND aggregate_id = public.app_actor_id()
  AND event_type = 'profile.updated.v1'
  AND idempotency_key ~ '^profile-command:v1:profile\.update:[0-9a-f]{64}$'
  AND payload ->> 'schemaVersion' = '1'
  AND payload ->> 'requestHashVersion' = '2'
  AND payload ->> 'requestHash' ~ '^[0-9a-f]{64}$'
  AND payload ->> 'profileVersion' ~ '^[1-9][0-9]*$'
  AND payload - ARRAY[
    'schemaVersion',
    'requestHashVersion',
    'requestHash',
    'profileVersion'
  ] = '{}'::jsonb
);

REVOKE ALL ON FUNCTION public.app_redact_request_hashes_on_account_erasure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_redact_request_hashes_on_project_erasure() FROM PUBLIC;

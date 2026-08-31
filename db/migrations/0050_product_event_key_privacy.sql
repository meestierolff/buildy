-- Product analytics keeps aggregate facts, never stable account identifiers in
-- event keys. Typed source identity provides exact retry semantics while an
-- account exists and is narrowly scrubbed as part of account erasure.

ALTER TABLE public.product_events
ADD COLUMN subject_user_id uuid,
ADD COLUMN source_kind text,
ADD COLUMN source_id uuid,
ADD COLUMN client_event_id uuid;
--> statement-breakpoint
ALTER TABLE public.product_events
ADD CONSTRAINT product_events_source_shape_ck CHECK (
  (source_kind IS NULL) = (source_id IS NULL)
  AND source_kind IS DISTINCT FROM ''
  AND NOT (source_id IS NOT NULL AND client_event_id IS NOT NULL)
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.product_events
VALIDATE CONSTRAINT product_events_source_shape_ck;
--> statement-breakpoint

-- The historical guard is deliberately removed only for this one-time privacy
-- rewrite. A stricter, product-event-specific append-only guard is installed
-- again before any runtime emitter is replaced.
DROP TRIGGER product_events_append_only ON public.product_events;
--> statement-breakpoint

UPDATE public.product_events event
SET client_event_id = substring(
  event.event_key
  FROM '([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
)::uuid
WHERE event.event_key ~ '^product-event:client:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
--> statement-breakpoint

UPDATE public.product_events event
SET
  source_kind = CASE event.event_name
    WHEN 'signup_completed' THEN 'app_user'
    WHEN 'onboarding_completed' THEN 'app_user'
    WHEN 'project_created' THEN 'project'
    WHEN 'first_update_created' THEN 'project'
    WHEN 'photo_upload_completed' THEN 'media_asset'
    WHEN 'follow_requested' THEN 'relationship'
    WHEN 'follow_accepted' THEN 'relationship'
    WHEN 'comment_created' THEN 'comment'
    WHEN 'photobook_draft_generated' THEN 'photobook_draft'
    WHEN 'proof_generated' THEN 'photobook_revision'
    WHEN 'proof_approved' THEN 'photobook_revision'
    WHEN 'checkout_started' THEN 'photobook_order'
    WHEN 'checkout_completed' THEN 'photobook_order'
    WHEN 'feedback_submitted' THEN 'feedback_submission'
    ELSE NULL
  END,
  source_id = substring(
    event.event_key
    FROM '([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
  )::uuid
WHERE event.event_name IN (
    'signup_completed',
    'onboarding_completed',
    'project_created',
    'first_update_created',
    'photo_upload_completed',
    'follow_requested',
    'follow_accepted',
    'comment_created',
    'photobook_draft_generated',
    'proof_generated',
    'proof_approved',
    'checkout_started',
    'checkout_completed',
    'feedback_submitted'
  )
  AND event.event_key =
    'product-event:' || replace(event.event_name, '_', '-') || ':' || substring(
      event.event_key
      FROM '([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
    );
--> statement-breakpoint

-- Resolve only the historical unkeyed authenticated pseudonym while its
-- account tombstone still exists. Anonymous keyed subjects deliberately do not
-- match this domain and are redacted below with every other legacy hash.
UPDATE public.product_events event
SET subject_user_id = account.id
FROM public.app_users account
WHERE event.subject_hash = encode(
  public.digest(
    'buildy-product-event-subject-v1:' || account.id::text,
    'sha256'
  ),
  'hex'
);
--> statement-breakpoint

UPDATE public.product_events event
SET
  subject_hash = NULL,
  event_key = 'product-event:v2:' || gen_random_uuid()::text;
--> statement-breakpoint

-- Rows belonging to an already-erased account must not regain typed linkage
-- during backfill. Current active accounts are scrubbed by the triggers below.
UPDATE public.product_events event
SET
  subject_user_id = NULL,
  source_kind = NULL,
  source_id = NULL,
  client_event_id = NULL
FROM public.app_users account
WHERE event.subject_user_id = account.id
  AND (account.status <> 'active' OR account.deleted_at IS NOT NULL);
--> statement-breakpoint

CREATE UNIQUE INDEX product_events_client_event_id_uq
ON public.product_events(client_event_id)
WHERE client_event_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX product_events_server_source_uq
ON public.product_events(event_name, source_kind, source_id)
WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX product_events_subject_user_idx
ON public.product_events(subject_user_id, occurred_at, id)
WHERE subject_user_id IS NOT NULL;
--> statement-breakpoint

CREATE FUNCTION public.guard_product_event_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.subject_user_id IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.event_name IS NOT DISTINCT FROM OLD.event_name
     AND NEW.event_key IS NOT DISTINCT FROM OLD.event_key
     AND NEW.properties IS NOT DISTINCT FROM OLD.properties
     AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.subject_hash IS NULL
     AND NEW.subject_user_id IS NULL
     AND NEW.source_kind IS NULL
     AND NEW.source_id IS NULL
     AND NEW.client_event_id IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.app_users account
       WHERE account.id = OLD.subject_user_id
         AND (account.status IN ('deletion_pending', 'deleted') OR account.deleted_at IS NOT NULL)
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'append-only relation cannot be changed';
END
$function$;
--> statement-breakpoint
CREATE TRIGGER product_events_append_only
BEFORE UPDATE OR DELETE ON public.product_events
FOR EACH ROW EXECUTE FUNCTION public.guard_product_event_append_only();
--> statement-breakpoint

CREATE FUNCTION public.app_redact_product_events_on_account_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  target_user_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status NOT IN ('deletion_pending', 'deleted')
       AND NEW.deleted_at IS NULL THEN
      RETURN NEW;
    END IF;
    target_user_id := NEW.id;
  ELSE
    IF OLD.status <> 'deleted'::public.app_user_status THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account erasure required before delete';
    END IF;
    target_user_id := OLD.id;
  END IF;

  UPDATE public.product_events event
  SET
    subject_hash = NULL,
    subject_user_id = NULL,
    source_kind = NULL,
    source_id = NULL,
    client_event_id = NULL
  WHERE event.subject_user_id = target_user_id;

  RETURN CASE WHEN TG_OP = 'UPDATE' THEN NEW ELSE OLD END;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER app_users_redact_product_events_on_erasure
AFTER UPDATE OF status, deleted_at ON public.app_users
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
)
EXECUTE FUNCTION public.app_redact_product_events_on_account_erasure();
--> statement-breakpoint
CREATE TRIGGER app_users_redact_product_events_before_delete
BEFORE DELETE ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION public.app_redact_product_events_on_account_erasure();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_product_event_subject_hash(requested_subject_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT NULL::text
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_insert_product_event(
  requested_event_name text,
  requested_event_key text,
  requested_subject_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '0A000',
    MESSAGE = 'legacy product event emitter is disabled';
END
$function$;
--> statement-breakpoint

CREATE FUNCTION public.app_insert_product_event(
  requested_event_name text,
  requested_source_kind text,
  requested_source_id uuid,
  requested_subject_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_source_kind NOT IN (
      'app_user',
      'project',
      'media_asset',
      'relationship',
      'comment',
      'photobook_draft',
      'photobook_revision',
      'photobook_order',
      'feedback_submission'
    )
    OR requested_source_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid product event source';
  END IF;

  INSERT INTO public.product_events (
    event_name,
    event_key,
    subject_hash,
    subject_user_id,
    source_kind,
    source_id,
    properties,
    occurred_at
  ) VALUES (
    requested_event_name,
    'product-event:v2:' || gen_random_uuid()::text,
    NULL,
    requested_subject_id,
    requested_source_kind,
    requested_source_id,
    '{"schemaVersion":1}'::jsonb,
    clock_timestamp()
  )
  ON CONFLICT DO NOTHING;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_record_client_product_event(
  requested_event_id uuid,
  requested_event_name text,
  requested_anonymous_subject_hash text,
  requested_properties jsonb
)
RETURNS TABLE (accepted boolean, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor uuid := public.app_actor_id();
  inserted_count integer;
  selected_event public.product_events%ROWTYPE;
BEGIN
  IF requested_event_id IS NULL
    OR requested_event_name NOT IN (
      'signup_started', 'project_shared', 'photobook_opened', 'error_encountered'
    )
    OR public.app_product_event_properties_valid(
      requested_event_name,
      requested_properties
    ) IS DISTINCT FROM true
    OR (
      actor IS NULL
      AND requested_event_name NOT IN ('signup_started', 'error_encountered')
    )
    OR (
      actor IS NULL
      AND requested_anonymous_subject_hash !~ '^[0-9a-f]{64}$'
    )
    OR (
      actor IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.app_users account
        WHERE account.id = actor
          AND account.status = 'active'
          AND account.deleted_at IS NULL
      )
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid client product event';
  END IF;

  INSERT INTO public.product_events (
    event_name,
    event_key,
    subject_hash,
    subject_user_id,
    client_event_id,
    properties
  ) VALUES (
    requested_event_name,
    'product-event:v2:' || gen_random_uuid()::text,
    CASE WHEN actor IS NULL THEN requested_anonymous_subject_hash ELSE NULL END,
    actor,
    requested_event_id,
    requested_properties
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT event.* INTO selected_event
  FROM public.product_events event
  WHERE event.client_event_id = requested_event_id;

  IF selected_event.id IS NULL
    OR selected_event.event_name <> requested_event_name
    OR selected_event.properties <> requested_properties
    OR (
      actor IS NULL
      AND selected_event.subject_user_id IS NOT NULL
    )
    OR (
      actor IS NULL
      AND selected_event.subject_hash IS NOT NULL
      AND selected_event.subject_hash <> requested_anonymous_subject_hash
    )
    OR (
      actor IS NOT NULL
      AND selected_event.subject_user_id IS DISTINCT FROM actor
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'product event idempotency collision';
  END IF;

  RETURN QUERY SELECT true, inserted_count = 0;
END
$function$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_capture_product_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'auth_identity_mappings' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'signup_completed', 'app_user', NEW.app_user_id, NEW.app_user_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'profiles' AND TG_OP = 'UPDATE' THEN
    IF OLD.onboarded_at IS NULL AND NEW.onboarded_at IS NOT NULL THEN
      PERFORM public.app_insert_product_event(
        'onboarding_completed', 'app_user', NEW.user_id, NEW.user_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'projects' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'project_created', 'project', NEW.id, NEW.owner_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'updates' AND TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.updates sibling
      WHERE sibling.project_id = NEW.project_id AND sibling.id <> NEW.id
    ) THEN
      PERFORM public.app_insert_product_event(
        'first_update_created', 'project', NEW.project_id, NEW.author_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'media_assets' THEN
    IF NEW.purpose = 'project_media' AND NEW.status = 'ready' THEN
      IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'photo_upload_completed', 'media_asset', NEW.id, NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_relationships' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind = 'follow' AND NEW.status = 'pending' THEN
        PERFORM public.app_insert_product_event(
          'follow_requested', 'relationship', NEW.id, NEW.source_user_id
        );
      END IF;
    ELSE
      IF NEW.kind = 'follow' AND NEW.status = 'pending'
        AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'follow_requested', 'relationship', NEW.id, NEW.source_user_id
        );
      END IF;
      IF NEW.kind = 'follow' AND OLD.status = 'pending' AND NEW.status = 'active' THEN
        PERFORM public.app_insert_product_event(
          'follow_accepted', 'relationship', NEW.id, NEW.source_user_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'comments' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'comment_created', 'comment', NEW.id, NEW.author_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_drafts' THEN
    IF NEW.status = 'ready'
      AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      PERFORM public.app_insert_product_event(
        'photobook_draft_generated', 'photobook_draft', NEW.id, NEW.owner_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_revisions' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated', 'photobook_revision', NEW.id, NEW.owner_id
        );
      END IF;
      IF NEW.approved_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved', 'photobook_revision', NEW.id, NEW.owner_id
        );
      END IF;
    ELSE
      IF NEW.status IN ('ready', 'approved', 'locked')
        AND OLD.status NOT IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated', 'photobook_revision', NEW.id, NEW.owner_id
        );
      END IF;
      IF NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved', 'photobook_revision', NEW.id, NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.stripe_checkout_session_id IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_started', 'photobook_order', NEW.id, NEW.owner_id
        );
      END IF;
      IF NEW.paid_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_completed', 'photobook_order', NEW.id, NEW.owner_id
        );
      END IF;
    ELSE
      IF NEW.stripe_checkout_session_id IS NOT NULL
        AND OLD.stripe_checkout_session_id IS NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_started', 'photobook_order', NEW.id, NEW.owner_id
        );
      END IF;
      IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_completed', 'photobook_order', NEW.id, NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'feedback_submissions' AND TG_OP = 'INSERT' THEN
    IF NEW.kind = 'feedback' THEN
      PERFORM public.app_insert_product_event(
        'feedback_submitted', 'feedback_submission', NEW.id, NEW.submitted_by_id
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.guard_product_event_append_only() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_redact_product_events_on_account_erasure() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_product_event_subject_hash(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_insert_product_event(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_insert_product_event(text, text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_record_client_product_event(uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_capture_product_event() FROM PUBLIC;

ALTER TABLE public.feedback_submissions
  ADD COLUMN assigned_to_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT feedback_submissions_version_ck CHECK (version > 0);
--> statement-breakpoint
CREATE TABLE public.feedback_submission_reviews (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES public.feedback_submissions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  actor_role public.app_role_kind NOT NULL,
  from_status public.feedback_status NOT NULL,
  to_status public.feedback_status NOT NULL,
  expected_version integer NOT NULL,
  submission_version integer NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT feedback_submission_reviews_transition_ck CHECK (from_status <> to_status),
  CONSTRAINT feedback_submission_reviews_versions_ck CHECK (
    expected_version > 0 AND submission_version = expected_version + 1
  ),
  CONSTRAINT feedback_submission_reviews_idempotency_ck CHECK (
    idempotency_key ~ '^feedback-admin-command:v1:[0-9a-f]{64}$'
  ),
  CONSTRAINT feedback_submission_reviews_request_hash_ck CHECK (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT feedback_submission_reviews_request_id_ck CHECK (
    request_id ~ '^[0-9a-f-]{36}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX feedback_submission_reviews_idempotency_uq
  ON public.feedback_submission_reviews (idempotency_key);
--> statement-breakpoint
CREATE INDEX feedback_submission_reviews_submission_idx
  ON public.feedback_submission_reviews (submission_id, created_at, id);
--> statement-breakpoint
ALTER TABLE public.feedback_submission_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER feedback_submission_reviews_append_only
BEFORE UPDATE OR DELETE ON public.feedback_submission_reviews
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_feedback_submission_account_erasure()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.submitted_by_id IS NULL
    OR NEW.submitted_by_id IS NOT NULL
    OR NEW.submitted_by_id IS NOT DISTINCT FROM OLD.submitted_by_id THEN
    RETURN NEW;
  END IF;

  IF public.app_actor_id() IS DISTINCT FROM OLD.submitted_by_id
    OR NOT EXISTS (
      SELECT 1
      FROM public.app_users account
      WHERE account.id = OLD.submitted_by_id
        AND account.status IN ('deletion_pending', 'deleted')
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'feedback erasure boundary required';
  END IF;

  NEW.message := '[verwijderd na accountverwijdering]';
  NEW.message_ciphertext := NULL;
  NEW.contact_ciphertext := NULL;
  NEW.contact_hash := NULL;
  NEW.idempotency_key := NULL;
  NEW.request_hash := NULL;
  NEW.source_fingerprint_hash := NULL;
  NEW.route := NULL;
  NEW.screenshot_asset_id := NULL;
  NEW.user_agent_family := NULL;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER feedback_submissions_guard_account_erasure
BEFORE UPDATE OF submitted_by_id ON public.feedback_submissions
FOR EACH ROW EXECUTE FUNCTION public.guard_feedback_submission_account_erasure();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_list_feedback_submissions(
  requested_status text,
  requested_kind text,
  cursor_created_at timestamptz,
  cursor_id uuid,
  requested_limit integer
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  kind text,
  category text,
  status public.feedback_status,
  version integer,
  has_contact boolean,
  authenticated boolean,
  created_at timestamptz,
  updated_at timestamptz
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
  IF requested_status NOT IN ('new', 'triaged', 'planned', 'resolved', 'closed')
    OR (requested_kind IS NOT NULL AND requested_kind NOT IN (
      'feedback', 'support', 'third_party_request', 'appeal'
    ))
    OR requested_limit NOT BETWEEN 1 AND 51
    OR ((cursor_created_at IS NULL) <> (cursor_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid feedback queue input';
  END IF;

  RETURN QUERY
  SELECT
    submission.id,
    submission.receipt_code,
    submission.kind,
    CASE
      WHEN submission.kind = 'feedback'
        AND submission.category IN ('bug', 'idea', 'usability', 'other')
        THEN submission.category
      WHEN submission.kind <> 'feedback'
        AND submission.category IN (
          'account', 'privacy', 'safety', 'order', 'technical', 'content_appeal', 'other'
        )
        THEN submission.category
      ELSE 'other'
    END,
    submission.status,
    submission.version,
    submission.contact_ciphertext IS NOT NULL,
    submission.submitted_by_id IS NOT NULL,
    submission.created_at,
    submission.updated_at
  FROM public.feedback_submissions submission
  WHERE submission.status::text = requested_status
    AND submission.receipt_code IS NOT NULL
    AND (submission.message_ciphertext IS NOT NULL OR submission.message IS NOT NULL)
    AND (requested_kind IS NULL OR submission.kind = requested_kind)
    AND (
      cursor_created_at IS NULL
      OR (submission.created_at, submission.id) < (cursor_created_at, cursor_id)
    )
  ORDER BY submission.created_at DESC, submission.id DESC
  LIMIT requested_limit;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_load_feedback_submission(
  requested_submission_id uuid
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  kind text,
  category text,
  status public.feedback_status,
  version integer,
  has_contact boolean,
  authenticated boolean,
  created_at timestamptz,
  updated_at timestamptz,
  message_ciphertext text,
  legacy_message text,
  contact_ciphertext text,
  resolved_at timestamptz
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
    submission.id,
    submission.receipt_code,
    submission.kind,
    submission.category,
    submission.status,
    submission.version,
    submission.contact_ciphertext IS NOT NULL,
    submission.submitted_by_id IS NOT NULL,
    submission.created_at,
    submission.updated_at,
    submission.message_ciphertext,
    submission.message,
    submission.contact_ciphertext,
    submission.resolved_at
  FROM public.feedback_submissions submission
  WHERE submission.id = requested_submission_id
    AND submission.receipt_code IS NOT NULL
    AND (submission.message_ciphertext IS NOT NULL OR submission.message IS NOT NULL)
  LIMIT 1;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_list_feedback_reviews(
  requested_submission_id uuid
)
RETURNS TABLE (
  id uuid,
  actor_id uuid,
  actor_role public.app_role_kind,
  from_status public.feedback_status,
  to_status public.feedback_status,
  submission_version integer,
  created_at timestamptz
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
    review.id,
    review.actor_id,
    review.actor_role,
    review.from_status,
    review.to_status,
    review.submission_version,
    review.created_at
  FROM public.feedback_submission_reviews review
  WHERE review.submission_id = requested_submission_id
  ORDER BY review.created_at ASC, review.id ASC;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_update_feedback_status(
  requested_submission_id uuid,
  requested_review_id uuid,
  requested_status text,
  requested_expected_version integer,
  requested_idempotency_key text,
  requested_request_hash text,
  requested_request_id text
)
RETURNS TABLE (
  review_id uuid,
  submission_id uuid,
  status public.feedback_status,
  version integer,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user_id uuid := public.app_actor_id();
  actor_role public.app_role_kind := public.app_actor_moderation_role();
  selected_submission public.feedback_submissions%ROWTYPE;
  replay_review public.feedback_submission_reviews%ROWTYPE;
  next_status public.feedback_status;
  next_version integer;
BEGIN
  IF actor_role IS DISTINCT FROM 'admin'::public.app_role_kind THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;
  IF requested_status NOT IN ('new', 'triaged', 'planned', 'resolved', 'closed')
    OR requested_expected_version < 1
    OR requested_idempotency_key !~ '^feedback-admin-command:v1:[0-9a-f]{64}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$'
    OR requested_request_id !~ '^[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid feedback review input';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(requested_idempotency_key, 0)
  );
  SELECT review.* INTO replay_review
  FROM public.feedback_submission_reviews review
  WHERE review.idempotency_key = requested_idempotency_key;
  IF FOUND THEN
    IF replay_review.actor_id IS DISTINCT FROM actor_user_id
      OR replay_review.submission_id IS DISTINCT FROM requested_submission_id
      OR replay_review.request_hash IS DISTINCT FROM requested_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'feedback review idempotency collision';
    END IF;
    RETURN QUERY SELECT
      replay_review.id,
      replay_review.submission_id,
      replay_review.to_status,
      replay_review.submission_version,
      true;
    RETURN;
  END IF;

  SELECT submission.* INTO selected_submission
  FROM public.feedback_submissions submission
  WHERE submission.id = requested_submission_id
    AND submission.receipt_code IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'feedback submission missing';
  END IF;
  IF selected_submission.version <> requested_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'feedback version conflict';
  END IF;

  next_status := requested_status::public.feedback_status;
  IF NOT (
    (selected_submission.status = 'new' AND next_status = 'triaged')
    OR (selected_submission.status = 'triaged' AND next_status IN ('planned', 'resolved', 'closed'))
    OR (selected_submission.status = 'planned' AND next_status IN ('triaged', 'resolved', 'closed'))
    OR (selected_submission.status = 'resolved' AND next_status IN ('triaged', 'closed'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'feedback status transition unavailable';
  END IF;

  next_version := selected_submission.version + 1;
  INSERT INTO public.feedback_submission_reviews (
    id, submission_id, actor_id, actor_role, from_status, to_status,
    expected_version, submission_version, idempotency_key, request_hash, request_id
  ) VALUES (
    requested_review_id, selected_submission.id, actor_user_id, actor_role,
    selected_submission.status, next_status, requested_expected_version,
    next_version, requested_idempotency_key, requested_request_hash, requested_request_id
  );

  UPDATE public.feedback_submissions
  SET status = next_status,
      assigned_to_id = actor_user_id,
      resolved_at = CASE
        WHEN next_status IN ('resolved', 'closed') THEN statement_timestamp()
        ELSE NULL
      END,
      version = next_version,
      updated_at = statement_timestamp()
  WHERE id = selected_submission.id;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id,
    request_id, metadata
  ) VALUES (
    'admin', actor_user_id, 'feedback.review.status_changed',
    'feedback_submission', selected_submission.id, requested_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'reviewId', requested_review_id,
      'actorRole', actor_role,
      'fromStatus', selected_submission.status,
      'toStatus', next_status,
      'submissionVersion', next_version
    )
  );

  RETURN QUERY SELECT requested_review_id, selected_submission.id, next_status, next_version, false;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON TABLE public.feedback_submission_reviews FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.guard_feedback_submission_account_erasure() FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_admin_list_feedback_submissions(text, text, timestamptz, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_admin_load_feedback_submission(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_admin_list_feedback_reviews(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_admin_update_feedback_status(uuid, uuid, text, integer, text, text, text) FROM PUBLIC;

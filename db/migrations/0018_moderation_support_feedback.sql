-- Privacy-first community reports, beta feedback and public support intake.
-- User-generated text and contact details are encrypted by the application
-- before this boundary. Moderator actions remain unavailable until a real
-- server-side moderator RBAC model exists.

ALTER TABLE public.moderation_reports
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD COLUMN contact_hash text,
  ADD COLUMN source_fingerprint_hash text,
  ADD COLUMN details_ciphertext text,
  ADD COLUMN target_snapshot_ciphertext text,
  ADD COLUMN policy_version text,
  ADD COLUMN route text,
  ADD COLUMN receipt_code text;
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_reports_idempotency_uq
  ON public.moderation_reports (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_reports_receipt_code_uq
  ON public.moderation_reports (receipt_code)
  WHERE receipt_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_reports_source_created_idx
  ON public.moderation_reports (source_fingerprint_hash, created_at)
  WHERE source_fingerprint_hash IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.moderation_reports
  ADD CONSTRAINT moderation_reports_request_hash_ck
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT moderation_reports_contact_hash_ck
    CHECK (contact_hash IS NULL OR contact_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT moderation_reports_source_hash_ck
    CHECK (source_fingerprint_hash IS NULL OR source_fingerprint_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT moderation_reports_contact_pair_ck
    CHECK ((reporter_contact_ciphertext IS NULL) = (contact_hash IS NULL)),
  ADD CONSTRAINT moderation_reports_details_storage_ck
    CHECK (details IS NULL OR details_ciphertext IS NULL),
  ADD CONSTRAINT moderation_reports_policy_version_ck
    CHECK (policy_version IS NULL OR policy_version ~ '^[A-Za-z0-9._-]{1,80}$'),
  ADD CONSTRAINT moderation_reports_route_safe_ck
    CHECK (route IS NULL OR (char_length(route) <= 500 AND route ~ '^/([A-Za-z0-9._~-]+/?)*$')),
  ADD CONSTRAINT moderation_reports_receipt_code_ck
    CHECK (receipt_code IS NULL OR receipt_code ~ '^MELD-[A-Z0-9]{8}$'),
  ADD CONSTRAINT moderation_reports_envelope_ck
    CHECK (
      (reporter_contact_ciphertext IS NULL OR reporter_contact_ciphertext LIKE 'v1.%')
      AND (details_ciphertext IS NULL OR details_ciphertext LIKE 'v1.%')
      AND (target_snapshot_ciphertext IS NULL OR target_snapshot_ciphertext LIKE 'v1.%')
    ),
  ADD CONSTRAINT moderation_reports_api_shape_ck
    CHECK (
      idempotency_key IS NULL
      OR (
        request_hash IS NOT NULL
        AND source_fingerprint_hash IS NOT NULL
        AND target_snapshot_ciphertext IS NOT NULL
        AND policy_version IS NOT NULL
        AND receipt_code IS NOT NULL
      )
    );
--> statement-breakpoint
ALTER TABLE public.feedback_submissions
  ALTER COLUMN message DROP NOT NULL,
  ADD COLUMN kind text NOT NULL DEFAULT 'feedback',
  ADD COLUMN message_ciphertext text,
  ADD COLUMN contact_ciphertext text,
  ADD COLUMN contact_hash text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD COLUMN source_fingerprint_hash text,
  ADD COLUMN privacy_notice_version text,
  ADD COLUMN receipt_code text;
--> statement-breakpoint
CREATE UNIQUE INDEX feedback_submissions_idempotency_uq
  ON public.feedback_submissions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX feedback_submissions_receipt_code_uq
  ON public.feedback_submissions (receipt_code)
  WHERE receipt_code IS NOT NULL;
--> statement-breakpoint
CREATE INDEX feedback_submissions_source_created_idx
  ON public.feedback_submissions (source_fingerprint_hash, created_at)
  WHERE source_fingerprint_hash IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.feedback_submissions
  ADD CONSTRAINT feedback_submissions_kind_ck
    CHECK (kind IN ('feedback', 'support', 'third_party_request', 'appeal')),
  ADD CONSTRAINT feedback_submissions_message_storage_ck
    CHECK ((message IS NOT NULL OR message_ciphertext IS NOT NULL) AND NOT (message IS NOT NULL AND message_ciphertext IS NOT NULL)),
  ADD CONSTRAINT feedback_submissions_contact_pair_ck
    CHECK ((contact_ciphertext IS NULL) = (contact_hash IS NULL)),
  ADD CONSTRAINT feedback_submissions_contact_hash_ck
    CHECK (contact_hash IS NULL OR contact_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT feedback_submissions_request_hash_ck
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT feedback_submissions_source_hash_ck
    CHECK (source_fingerprint_hash IS NULL OR source_fingerprint_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT feedback_submissions_privacy_version_ck
    CHECK (privacy_notice_version IS NULL OR privacy_notice_version ~ '^[A-Za-z0-9._-]{1,80}$'),
  ADD CONSTRAINT feedback_submissions_receipt_code_ck
    CHECK (receipt_code IS NULL OR receipt_code ~ '^HELP-[A-Z0-9]{8}$'),
  ADD CONSTRAINT feedback_submissions_envelope_ck
    CHECK (
      (message_ciphertext IS NULL OR message_ciphertext LIKE 'v1.%')
      AND (contact_ciphertext IS NULL OR contact_ciphertext LIKE 'v1.%')
    ),
  ADD CONSTRAINT feedback_submissions_api_shape_ck
    CHECK (
      idempotency_key IS NULL
      OR (
        request_hash IS NOT NULL
        AND source_fingerprint_hash IS NOT NULL
        AND message_ciphertext IS NOT NULL
        AND privacy_notice_version IS NOT NULL
        AND receipt_code IS NOT NULL
      )
    );
--> statement-breakpoint
DROP POLICY IF EXISTS moderation_reports_insert_self ON public.moderation_reports;
--> statement-breakpoint
DROP POLICY IF EXISTS feedback_insert_self ON public.feedback_submissions;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_moderation_target_visible(
  requested_target_type text,
  requested_target_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE requested_target_type
    WHEN 'profile' THEN EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.user_id = requested_target_id
        AND public.app_can_view_profile(profile.user_id)
    )
    WHEN 'project' THEN EXISTS (
      SELECT 1
      FROM public.projects project
      WHERE project.id = requested_target_id
        AND project.lifecycle_status = 'active'
        AND public.app_can_view_project(project.id)
    )
    WHEN 'update' THEN EXISTS (
      SELECT 1
      FROM public.updates item
      WHERE item.id = requested_target_id
        AND public.app_can_view_update(item.id, item.project_id)
    )
    WHEN 'media' THEN EXISTS (
      SELECT 1
      FROM public.media_assets asset
      WHERE asset.id = requested_target_id
        AND asset.project_id IS NOT NULL
        AND asset.status = 'ready'
        AND asset.deleted_at IS NULL
        AND public.app_can_view_project(asset.project_id)
    )
    WHEN 'comment' THEN EXISTS (
      SELECT 1
      FROM public.comments comment
      WHERE comment.id = requested_target_id
        AND comment.status <> 'deleted'
        AND public.app_can_view_update(comment.update_id, comment.project_id)
        AND NOT public.app_users_are_blocked(public.app_actor_id(), comment.author_id)
        AND (
          comment.status = 'published'
          OR comment.author_id = public.app_actor_id()
          OR public.app_owns_project(comment.project_id)
        )
    )
    ELSE false
  END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_replay_moderation_report(
  requested_idempotency_key text,
  requested_request_hash text
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  status text,
  submitted_at timestamptz,
  replayed boolean,
  email_confirmation_queued boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_report public.moderation_reports%ROWTYPE;
BEGIN
  IF requested_idempotency_key !~ '^community-command:v1:moderation[.]report:[0-9a-f]{64}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid moderation replay request';
  END IF;

  SELECT report.* INTO selected_report
  FROM public.moderation_reports report
  WHERE report.idempotency_key = requested_idempotency_key;

  IF NOT FOUND THEN RETURN; END IF;
  IF selected_report.request_hash IS DISTINCT FROM requested_request_hash
    OR selected_report.reporter_id IS DISTINCT FROM public.app_actor_id() THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'moderation idempotency collision';
  END IF;

  RETURN QUERY SELECT
    selected_report.id,
    selected_report.receipt_code,
    'received'::text,
    selected_report.created_at,
    true,
    EXISTS (
      SELECT 1 FROM public.outbox_events event
      WHERE event.idempotency_key = 'moderation-report:' || selected_report.id::text || ':email:received:v1'
    );
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_submit_moderation_report(
  requested_id uuid,
  requested_idempotency_key text,
  requested_request_hash text,
  requested_target_type text,
  requested_target_id uuid,
  requested_reason text,
  requested_details_ciphertext text,
  requested_contact_ciphertext text,
  requested_contact_hash text,
  requested_source_fingerprint_hash text,
  requested_target_snapshot_ciphertext text,
  requested_policy_version text,
  requested_route text,
  requested_receipt_code text,
  requested_ip_hash text,
  requested_user_agent_hash text
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  status text,
  submitted_at timestamptz,
  replayed boolean,
  email_confirmation_queued boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_report public.moderation_reports%ROWTYPE;
  resolved_actor_id uuid := public.app_actor_id();
  resolved_urgency text;
  confirmation_queued boolean := false;
BEGIN
  IF requested_idempotency_key !~ '^community-command:v1:moderation[.]report:[0-9a-f]{64}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$'
    OR requested_source_fingerprint_hash !~ '^[0-9a-f]{64}$'
    OR requested_target_type NOT IN ('profile', 'project', 'update', 'media', 'comment')
    OR requested_reason NOT IN ('privacy', 'harassment', 'hate', 'violence', 'sexual_content', 'illegal_content', 'impersonation', 'copyright', 'spam', 'other')
    OR requested_target_snapshot_ciphertext NOT LIKE 'v1.%'
    OR char_length(requested_target_snapshot_ciphertext) > 196000
    OR requested_policy_version !~ '^[A-Za-z0-9._-]{1,80}$'
    OR requested_receipt_code !~ '^MELD-[A-Z0-9]{8}$'
    OR (requested_details_ciphertext IS NOT NULL AND (requested_details_ciphertext NOT LIKE 'v1.%' OR char_length(requested_details_ciphertext) > 16000))
    OR ((requested_contact_ciphertext IS NULL) <> (requested_contact_hash IS NULL))
    OR (requested_contact_ciphertext IS NOT NULL AND (requested_contact_ciphertext NOT LIKE 'v1.%' OR char_length(requested_contact_ciphertext) > 2048))
    OR (requested_contact_hash IS NOT NULL AND requested_contact_hash !~ '^[0-9a-f]{64}$')
    OR (requested_ip_hash IS NOT NULL AND requested_ip_hash !~ '^[0-9a-f]{64}$')
    OR (requested_user_agent_hash IS NOT NULL AND requested_user_agent_hash !~ '^[0-9a-f]{64}$')
    OR (requested_route IS NOT NULL AND (char_length(requested_route) > 500 OR requested_route !~ '^/([A-Za-z0-9._~-]+/?)*$')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid moderation submission';
  END IF;
  IF resolved_actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.app_users actor
    WHERE actor.id = resolved_actor_id AND actor.status = 'active' AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inactive moderation actor';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_idempotency_key, 0));
  SELECT report.* INTO selected_report
  FROM public.moderation_reports report
  WHERE report.idempotency_key = requested_idempotency_key;
  IF FOUND THEN
    IF selected_report.request_hash IS DISTINCT FROM requested_request_hash
      OR selected_report.reporter_id IS DISTINCT FROM resolved_actor_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'moderation idempotency collision';
    END IF;
    RETURN QUERY SELECT
      selected_report.id,
      selected_report.receipt_code,
      'received'::text,
      selected_report.created_at,
      true,
      EXISTS (
        SELECT 1 FROM public.outbox_events event
        WHERE event.idempotency_key = 'moderation-report:' || selected_report.id::text || ':email:received:v1'
      );
    RETURN;
  END IF;

  IF NOT public.app_moderation_target_visible(requested_target_type, requested_target_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation target is not visible';
  END IF;

  resolved_urgency := CASE
    WHEN requested_reason = 'violence' THEN 'urgent'
    WHEN requested_reason IN ('privacy', 'sexual_content', 'illegal_content') THEN 'high'
    ELSE 'normal'
  END;

  INSERT INTO public.moderation_reports (
    id, reporter_id, reporter_contact_ciphertext, target_type, target_id,
    reason, details, urgency, status, version, idempotency_key, request_hash,
    contact_hash, source_fingerprint_hash, details_ciphertext,
    target_snapshot_ciphertext, policy_version, route, receipt_code
  ) VALUES (
    requested_id, resolved_actor_id, requested_contact_ciphertext,
    requested_target_type, requested_target_id, requested_reason, NULL,
    resolved_urgency, 'open', 1, requested_idempotency_key,
    requested_request_hash, requested_contact_hash,
    requested_source_fingerprint_hash, requested_details_ciphertext,
    requested_target_snapshot_ciphertext, requested_policy_version,
    requested_route, requested_receipt_code
  )
  RETURNING * INTO selected_report;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id,
    ip_hash, user_agent_hash, metadata
  ) VALUES (
    CASE WHEN resolved_actor_id IS NULL THEN 'system'::public.audit_actor_kind ELSE 'user'::public.audit_actor_kind END,
    resolved_actor_id,
    'moderation.report_submitted',
    'moderation_report',
    selected_report.id,
    requested_ip_hash,
    requested_user_agent_hash,
    jsonb_build_object(
      'schemaVersion', 1,
      'targetType', requested_target_type,
      'reason', requested_reason,
      'urgency', resolved_urgency,
      'anonymous', resolved_actor_id IS NULL,
      'hasContact', requested_contact_ciphertext IS NOT NULL
    )
  );

  IF requested_contact_ciphertext IS NOT NULL THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'moderation_report',
      selected_report.id,
      'moderation.report.received.requested.v1',
      'moderation-report:' || selected_report.id::text || ':email:received:v1',
      jsonb_build_object(
        'schemaVersion', 1,
        'reportId', selected_report.id,
        'receiptCode', selected_report.receipt_code
      )
    );
    confirmation_queued := true;
  END IF;

  RETURN QUERY SELECT
    selected_report.id,
    selected_report.receipt_code,
    'received'::text,
    selected_report.created_at,
    false,
    confirmation_queued;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_replay_feedback_submission(
  requested_idempotency_key text,
  requested_request_hash text
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  status text,
  submitted_at timestamptz,
  replayed boolean,
  email_confirmation_queued boolean,
  kind text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_submission public.feedback_submissions%ROWTYPE;
BEGIN
  IF requested_idempotency_key !~ '^community-command:v1:(feedback[.]submit|support[.]submit):[0-9a-f]{64}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid feedback replay request';
  END IF;
  SELECT submission.* INTO selected_submission
  FROM public.feedback_submissions submission
  WHERE submission.idempotency_key = requested_idempotency_key;
  IF NOT FOUND THEN RETURN; END IF;
  IF selected_submission.request_hash IS DISTINCT FROM requested_request_hash
    OR selected_submission.submitted_by_id IS DISTINCT FROM public.app_actor_id() THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'feedback idempotency collision';
  END IF;
  RETURN QUERY SELECT
    selected_submission.id,
    selected_submission.receipt_code,
    'received'::text,
    selected_submission.created_at,
    true,
    EXISTS (
      SELECT 1 FROM public.outbox_events event
      WHERE event.idempotency_key = 'feedback-submission:' || selected_submission.id::text || ':email:confirmation:v1'
    ),
    selected_submission.kind;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_submit_feedback_submission(
  requested_id uuid,
  requested_idempotency_key text,
  requested_request_hash text,
  requested_kind text,
  requested_category text,
  requested_message_ciphertext text,
  requested_contact_ciphertext text,
  requested_contact_hash text,
  requested_source_fingerprint_hash text,
  requested_route text,
  requested_user_agent_family text,
  requested_privacy_notice_version text,
  requested_receipt_code text,
  requested_ip_hash text,
  requested_user_agent_hash text
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  status text,
  submitted_at timestamptz,
  replayed boolean,
  email_confirmation_queued boolean,
  kind text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_submission public.feedback_submissions%ROWTYPE;
  resolved_actor_id uuid := public.app_actor_id();
  confirmation_queued boolean := false;
BEGIN
  IF requested_idempotency_key !~ '^community-command:v1:(feedback[.]submit|support[.]submit):[0-9a-f]{64}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$'
    OR requested_source_fingerprint_hash !~ '^[0-9a-f]{64}$'
    OR requested_kind NOT IN ('feedback', 'support', 'third_party_request', 'appeal')
    OR requested_message_ciphertext NOT LIKE 'v1.%'
    OR char_length(requested_message_ciphertext) > 16000
    OR requested_privacy_notice_version !~ '^[A-Za-z0-9._-]{1,80}$'
    OR requested_receipt_code !~ '^HELP-[A-Z0-9]{8}$'
    OR requested_user_agent_family NOT IN ('chrome', 'edge', 'firefox', 'safari', 'other', 'unknown')
    OR ((requested_contact_ciphertext IS NULL) <> (requested_contact_hash IS NULL))
    OR (requested_contact_ciphertext IS NOT NULL AND (requested_contact_ciphertext NOT LIKE 'v1.%' OR char_length(requested_contact_ciphertext) > 2048))
    OR (requested_contact_hash IS NOT NULL AND requested_contact_hash !~ '^[0-9a-f]{64}$')
    OR (requested_ip_hash IS NOT NULL AND requested_ip_hash !~ '^[0-9a-f]{64}$')
    OR (requested_user_agent_hash IS NOT NULL AND requested_user_agent_hash !~ '^[0-9a-f]{64}$')
    OR (requested_route IS NOT NULL AND (char_length(requested_route) > 500 OR requested_route !~ '^/([A-Za-z0-9._~-]+/?)*$'))
    OR (requested_kind = 'feedback' AND requested_category NOT IN ('bug', 'idea', 'usability', 'other'))
    OR (requested_kind <> 'feedback' AND requested_category NOT IN ('account', 'privacy', 'safety', 'order', 'technical', 'content_appeal', 'other'))
    OR (requested_kind = 'feedback' AND resolved_actor_id IS NULL)
    OR (requested_kind <> 'feedback' AND requested_contact_ciphertext IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid feedback submission';
  END IF;
  IF resolved_actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.app_users actor
    WHERE actor.id = resolved_actor_id AND actor.status = 'active' AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'inactive feedback actor';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_idempotency_key, 0));
  SELECT submission.* INTO selected_submission
  FROM public.feedback_submissions submission
  WHERE submission.idempotency_key = requested_idempotency_key;
  IF FOUND THEN
    IF selected_submission.request_hash IS DISTINCT FROM requested_request_hash
      OR selected_submission.submitted_by_id IS DISTINCT FROM resolved_actor_id THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'feedback idempotency collision';
    END IF;
    RETURN QUERY SELECT
      selected_submission.id,
      selected_submission.receipt_code,
      'received'::text,
      selected_submission.created_at,
      true,
      EXISTS (
        SELECT 1 FROM public.outbox_events event
        WHERE event.idempotency_key = 'feedback-submission:' || selected_submission.id::text || ':email:confirmation:v1'
      ),
      selected_submission.kind;
    RETURN;
  END IF;

  INSERT INTO public.feedback_submissions (
    id, submitted_by_id, kind, category, message, message_ciphertext,
    contact_ciphertext, contact_hash, idempotency_key, request_hash,
    source_fingerprint_hash, route, user_agent_family,
    privacy_notice_version, receipt_code, status
  ) VALUES (
    requested_id, resolved_actor_id, requested_kind, requested_category,
    NULL, requested_message_ciphertext, requested_contact_ciphertext,
    requested_contact_hash, requested_idempotency_key,
    requested_request_hash, requested_source_fingerprint_hash,
    requested_route, requested_user_agent_family,
    requested_privacy_notice_version, requested_receipt_code, 'new'
  )
  RETURNING * INTO selected_submission;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id,
    ip_hash, user_agent_hash, metadata
  ) VALUES (
    CASE WHEN resolved_actor_id IS NULL THEN 'system'::public.audit_actor_kind ELSE 'user'::public.audit_actor_kind END,
    resolved_actor_id,
    CASE WHEN requested_kind = 'feedback' THEN 'feedback.submitted' ELSE 'support.submitted' END,
    'feedback_submission',
    selected_submission.id,
    requested_ip_hash,
    requested_user_agent_hash,
    jsonb_build_object(
      'schemaVersion', 1,
      'kind', requested_kind,
      'category', requested_category,
      'anonymous', resolved_actor_id IS NULL,
      'hasContact', requested_contact_ciphertext IS NOT NULL
    )
  );

  IF requested_kind <> 'feedback' THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'feedback_submission',
      selected_submission.id,
      'support.confirmation.requested.v1',
      'feedback-submission:' || selected_submission.id::text || ':email:confirmation:v1',
      jsonb_build_object(
        'schemaVersion', 1,
        'submissionId', selected_submission.id,
        'kind', selected_submission.kind,
        'receiptCode', selected_submission.receipt_code
      )
    );
    confirmation_queued := true;
  END IF;

  RETURN QUERY SELECT
    selected_submission.id,
    selected_submission.receipt_code,
    'received'::text,
    selected_submission.created_at,
    false,
    confirmation_queued,
    selected_submission.kind;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_load_community_receipt(
  requested_event_id uuid,
  requested_lease_owner text
)
RETURNS TABLE (
  aggregate_type text,
  aggregate_id uuid,
  recipient_ciphertext text,
  contact_hash text,
  receipt_code text,
  kind text,
  created_at timestamptz,
  target_type text,
  category text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid community email receipt load';
  END IF;

  RETURN QUERY
  SELECT
    queued.aggregate_type,
    report.id,
    report.reporter_contact_ciphertext,
    report.contact_hash,
    report.receipt_code,
    NULL::text,
    report.created_at,
    report.target_type,
    NULL::text
  FROM public.outbox_events queued
  JOIN public.moderation_reports report ON report.id = queued.aggregate_id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'moderation_report'
    AND queued.event_type = 'moderation.report.received.requested.v1'
    AND queued.idempotency_key = 'moderation-report:' || report.id::text || ':email:received:v1'
    AND queued.payload = jsonb_build_object(
      'schemaVersion', 1,
      'reportId', report.id,
      'receiptCode', report.receipt_code
    )
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
    AND report.reporter_contact_ciphertext IS NOT NULL
    AND report.contact_hash IS NOT NULL
  UNION ALL
  SELECT
    queued.aggregate_type,
    submission.id,
    submission.contact_ciphertext,
    submission.contact_hash,
    submission.receipt_code,
    submission.kind,
    submission.created_at,
    NULL::text,
    submission.category
  FROM public.outbox_events queued
  JOIN public.feedback_submissions submission ON submission.id = queued.aggregate_id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'feedback_submission'
    AND queued.event_type = 'support.confirmation.requested.v1'
    AND queued.idempotency_key = 'feedback-submission:' || submission.id::text || ':email:confirmation:v1'
    AND queued.payload = jsonb_build_object(
      'schemaVersion', 1,
      'submissionId', submission.id,
      'kind', submission.kind,
      'receiptCode', submission.receipt_code
    )
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
    AND submission.kind IN ('support', 'third_party_request', 'appeal')
    AND submission.contact_ciphertext IS NOT NULL
    AND submission.contact_hash IS NOT NULL;
END
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_moderation_target_visible(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_replay_moderation_report(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_submit_moderation_report(uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_replay_feedback_submission(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_submit_feedback_submission(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_email_worker_load_community_receipt(uuid, text) FROM PUBLIC;

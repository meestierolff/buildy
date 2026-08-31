-- Active worker failure transitions must assign explicitly typed enum values.
-- PostgreSQL otherwise resolves CASE expressions containing only string
-- literals as text, which makes real transient failures fail before their
-- retry/dead-letter state can be persisted.

CREATE OR REPLACE FUNCTION public.app_account_worker_fail_export(
  worker_identifier text,
  target_job_id uuid,
  processing_failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_asset_id uuid;
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL
    OR processing_failure_code IS NULL
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export failure input';
  END IF;

  UPDATE public.export_jobs job
  SET
    status = CASE
      WHEN move_to_dead_letter THEN 'dead_letter'::public.export_job_status
      ELSE 'retry_scheduled'::public.export_job_status
    END,
    available_at = CASE
      WHEN move_to_dead_letter THEN job.available_at
      ELSE clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds)
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = processing_failure_code,
    updated_at = statement_timestamp()
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  RETURNING job.export_asset_id INTO selected_asset_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RETURN false;
  END IF;

  IF move_to_dead_letter THEN
    UPDATE public.media_assets asset
    SET
      status = 'failed',
      failure_code = processing_failure_code,
      version = asset.version + 1,
      updated_at = statement_timestamp()
    WHERE asset.id = selected_asset_id
      AND asset.status = 'processing';
  END IF;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_fail_export_cleanup(
  worker_identifier text,
  target_job_id uuid,
  processing_failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL
    OR processing_failure_code IS NULL
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export cleanup failure input';
  END IF;

  UPDATE public.export_jobs job
  SET
    status = CASE
      WHEN move_to_dead_letter THEN 'dead_letter'::public.export_job_status
      ELSE 'expired'::public.export_job_status
    END,
    available_at = clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds),
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = processing_failure_code,
    updated_at = statement_timestamp()
  WHERE job.id = target_job_id
    AND job.status = 'expired'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_fail_photobook_render(
  worker_identifier text,
  target_event_id uuid,
  target_revision_id uuid,
  processing_failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_revision public.photobook_revisions%ROWTYPE;
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL
    OR target_revision_id IS NULL
    OR processing_failure_code IS NULL
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid photobook failure input';
  END IF;

  SELECT revision.*
  INTO selected_revision
  FROM public.photobook_revisions revision
  JOIN public.outbox_events event
    ON event.id = target_event_id
   AND event.aggregate_id = revision.id
   AND event.aggregate_type = 'photobook_proof'
   AND event.event_type = 'photobook.proof.requested.v1'
   AND event.status = 'claimed'
   AND event.lease_owner = worker_identifier
   AND event.lease_expires_at > clock_timestamp()
  WHERE revision.id = target_revision_id
    AND revision.status = 'rendering'
  FOR UPDATE OF revision, event;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.photobook_revisions revision
  SET
    status = CASE
      WHEN move_to_dead_letter THEN 'failed'::public.photobook_proof_status
      ELSE 'rendering'::public.photobook_proof_status
    END,
    failure_code = processing_failure_code,
    updated_at = statement_timestamp()
  WHERE revision.id = selected_revision.id;

  IF move_to_dead_letter THEN
    UPDATE public.media_assets asset
    SET
      status = 'failed',
      failure_code = processing_failure_code,
      version = asset.version + 1,
      updated_at = statement_timestamp()
    WHERE asset.id = selected_revision.pdf_asset_id
      AND asset.status = 'processing';

    UPDATE public.photobook_drafts draft
    SET status = 'draft', updated_at = statement_timestamp()
    WHERE draft.id = selected_revision.draft_id
      AND draft.document_sha256 = selected_revision.document_sha256;
  END IF;

  UPDATE public.outbox_events event
  SET
    status = CASE
      WHEN move_to_dead_letter THEN 'dead_letter'::public.outbox_status
      ELSE 'retry'::public.outbox_status
    END,
    available_at = CASE
      WHEN move_to_dead_letter THEN event.available_at
      ELSE clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds)
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = processing_failure_code,
    updated_at = statement_timestamp()
  WHERE event.id = target_event_id
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'photobook worker lease lost';
  END IF;

  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_fail_deletion(
  worker_identifier text,
  target_job_id uuid,
  target_deletion_asset_id uuid,
  processing_failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_job public.deletion_jobs%ROWTYPE;
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL
    OR processing_failure_code IS NULL
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid deletion failure input';
  END IF;

  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.id = target_job_id
    AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF target_deletion_asset_id IS NOT NULL THEN
    UPDATE public.deletion_assets asset
    SET
      status = CASE
        WHEN move_to_dead_letter THEN 'failed'::public.deletion_asset_status
        ELSE 'retry'::public.deletion_asset_status
      END,
      attempt_count = asset.attempt_count + 1,
      last_error_code = processing_failure_code,
      updated_at = statement_timestamp()
    WHERE asset.id = target_deletion_asset_id
      AND asset.deletion_job_id = target_job_id;
  END IF;

  UPDATE public.deletion_jobs job
  SET
    status = CASE
      WHEN move_to_dead_letter AND selected_job.kind = 'update' THEN 'manual_review'::public.deletion_status
      WHEN move_to_dead_letter THEN 'dead_letter'::public.deletion_status
      ELSE 'retry_scheduled'::public.deletion_status
    END,
    available_at = CASE
      WHEN move_to_dead_letter THEN job.available_at
      ELSE clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds)
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = processing_failure_code,
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id
    AND job.lease_owner = worker_identifier;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN RETURN false; END IF;

  IF move_to_dead_letter AND selected_job.kind = 'update' THEN
    INSERT INTO public.audit_events (
      actor_kind, actor_user_id, action, resource_type, resource_id, metadata
    ) SELECT
      'system', NULL, 'update.deletion_manual_review', 'deletion_job', selected_job.id,
      jsonb_build_object(
        'schemaVersion', 1,
        'updateId', selected_job.target_id,
        'failureCode', processing_failure_code,
        'attemptCount', selected_job.attempt_count
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_events event
      WHERE event.action = 'update.deletion_manual_review'
        AND event.resource_type = 'deletion_job'
        AND event.resource_id = selected_job.id
    );
  END IF;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.app_account_worker_fail_export(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_fail_export_cleanup(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_fail_photobook_render(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_fail_deletion(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;

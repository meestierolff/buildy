-- Canonical Bouwboek revisions and their source assets are private. The web
-- role can enqueue only owner-scoped render events through RLS; the dedicated
-- worker has no table privileges and can act solely through the functions
-- below.

UPDATE public.photobook_drafts
SET selected_format = 'a4-landscape-hardcover-v1'
WHERE selected_format = 'a4-landscape-hardcover';

UPDATE public.photobook_settings
SET selected_format = 'a4-landscape-hardcover-v1'
WHERE selected_format = 'a4-landscape-hardcover';

ALTER TABLE public.photobook_drafts
  ALTER COLUMN selected_format SET DEFAULT 'a4-landscape-hardcover-v1';
ALTER TABLE public.photobook_settings
  ALTER COLUMN selected_format SET DEFAULT 'a4-landscape-hardcover-v1';

ALTER TABLE public.photobook_revisions
  ADD COLUMN font_set_sha256 text;
ALTER TABLE public.photobook_revisions
  ADD CONSTRAINT photobook_revisions_font_hash_ck
  CHECK (font_set_sha256 IS NULL OR font_set_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.photobook_revisions
  DROP CONSTRAINT photobook_revisions_ready_proof_ck;
ALTER TABLE public.photobook_revisions
  ADD CONSTRAINT photobook_revisions_ready_proof_ck
  CHECK (
    status NOT IN ('ready', 'approved', 'locked')
    OR (
      pdf_asset_id IS NOT NULL
      AND pdf_sha256 IS NOT NULL
      AND pdf_size_bytes IS NOT NULL
      AND page_count IS NOT NULL
      AND font_set_sha256 IS NOT NULL
      AND page_count >= 24
      AND mod(page_count, 2) = 0
    )
  );

CREATE POLICY outbox_events_select_photobook_owner
ON public.outbox_events FOR SELECT
USING (
  aggregate_type = 'photobook_proof'
  AND event_type IN (
    'photobook.proof.requested.v1',
    'photobook.proof.approved.v1'
  )
  AND EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = aggregate_id
      AND revision.owner_id = public.app_actor_id()
  )
);

CREATE POLICY outbox_events_insert_photobook_owner
ON public.outbox_events FOR INSERT
WITH CHECK (
  aggregate_type = 'photobook_proof'
  AND event_type IN (
    'photobook.proof.requested.v1',
    'photobook.proof.approved.v1'
  )
  AND payload ->> 'schemaVersion' = '1'
  AND payload ->> 'revisionId' = aggregate_id::text
  AND EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = aggregate_id
      AND revision.owner_id = public.app_actor_id()
      AND revision.project_id::text = payload ->> 'projectId'
  )
);

CREATE POLICY outbox_events_update_photobook_owner
ON public.outbox_events FOR UPDATE
USING (
  aggregate_type = 'photobook_proof'
  AND event_type = 'photobook.proof.requested.v1'
  AND EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = aggregate_id
      AND revision.owner_id = public.app_actor_id()
  )
)
WITH CHECK (
  aggregate_type = 'photobook_proof'
  AND event_type = 'photobook.proof.requested.v1'
  AND EXISTS (
    SELECT 1
    FROM public.photobook_revisions revision
    WHERE revision.id = aggregate_id
      AND revision.owner_id = public.app_actor_id()
  )
);

CREATE OR REPLACE FUNCTION public.guard_locked_photobook_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

  IF OLD.status = 'locked' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'locked photobook proof status is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'invalidated' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'invalidated photobook proof status is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'locked', 'invalidated') THEN
    RAISE EXCEPTION 'approved photobook proof has an invalid transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('locked', 'invalidated')
     AND NEW.locked_at IS DISTINCT FROM OLD.locked_at THEN
    RAISE EXCEPTION 'photobook proof lock is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_photobook_worker_claim(
  worker_identifier text,
  lease_seconds integer
)
RETURNS TABLE (
  event_id uuid,
  revision_id uuid,
  attempt_count integer,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid photobook claim input';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      event.id,
      event.status = 'claimed'
        AND event.lease_owner = worker_identifier
        AND event.lease_expires_at > clock_timestamp() AS is_resume
    FROM public.outbox_events event
    JOIN public.photobook_revisions revision
      ON revision.id = event.aggregate_id
     AND revision.status = 'rendering'
    JOIN public.photobook_drafts draft
      ON draft.id = revision.draft_id
     AND draft.document_sha256 = revision.document_sha256
     AND draft.status = 'rendering'
    JOIN public.projects project
      ON project.id = revision.project_id
     AND project.lifecycle_status = 'active'
     AND project.deleted_at IS NULL
    WHERE event.aggregate_type = 'photobook_proof'
      AND event.event_type = 'photobook.proof.requested.v1'
      AND (
        (event.status IN ('pending', 'retry') AND event.available_at <= clock_timestamp())
        OR (
          event.status = 'claimed'
          AND (
            event.lease_expires_at <= clock_timestamp()
            OR event.lease_owner = worker_identifier
          )
        )
      )
    ORDER BY
      CASE
        WHEN event.status = 'claimed'
          AND event.lease_owner = worker_identifier
          AND event.lease_expires_at > clock_timestamp()
        THEN 0 ELSE 1
      END,
      event.available_at,
      event.created_at,
      event.id
    FOR UPDATE OF event SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.outbox_events event
    SET
      status = 'claimed',
      attempt_count = CASE
        WHEN candidate.is_resume THEN event.attempt_count
        ELSE event.attempt_count + 1
      END,
      lease_owner = worker_identifier,
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      updated_at = statement_timestamp()
    FROM candidate
    WHERE event.id = candidate.id
    RETURNING event.id, event.aggregate_id, event.attempt_count, event.lease_expires_at
  )
  SELECT claimed.id, claimed.aggregate_id, claimed.attempt_count, claimed.lease_expires_at
  FROM claimed;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_begin_photobook_render(
  worker_identifier text,
  target_event_id uuid
)
RETURNS TABLE (
  event_id uuid,
  revision_id uuid,
  pdf_asset_id uuid,
  pdf_object_key text,
  document jsonb,
  source_assets jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_revision public.photobook_revisions%ROWTYPE;
  selected_event public.outbox_events%ROWTYPE;
  selected_pdf public.media_assets%ROWTYPE;
  selected_assets jsonb;
  expected_asset_count integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid photobook render input';
  END IF;

  SELECT event.*
  INTO selected_event
  FROM public.outbox_events event
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'photobook_proof'
    AND event.event_type = 'photobook.proof.requested.v1'
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT revision.*
  INTO selected_revision
  FROM public.photobook_revisions revision
  JOIN public.photobook_drafts draft
    ON draft.id = revision.draft_id
   AND draft.document_sha256 = revision.document_sha256
   AND draft.status = 'rendering'
  WHERE revision.id = selected_event.aggregate_id
    AND revision.status = 'rendering'
  FOR UPDATE OF revision;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT asset.*
  INTO selected_pdf
  FROM public.media_assets asset
  WHERE asset.id = selected_revision.pdf_asset_id
    AND asset.project_id = selected_revision.project_id
    AND asset.owner_id = selected_revision.owner_id
    AND asset.purpose = 'photobook_pdf'
    AND asset.status = 'processing'
    AND asset.original_asset_id IS NULL
    AND asset.object_key = 'photobook-pdfs/' || left(asset.id::text, 2) || '/' || asset.id::text
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  expected_asset_count := jsonb_array_length(selected_revision.document -> 'sourceAssetIds');
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', asset.id,
      'objectKey', asset.object_key,
      'sizeBytes', asset.size_bytes,
      'sha256', asset.sha256,
      'contentType', asset.detected_content_type,
      'widthPixels', asset.width_pixels,
      'heightPixels', asset.height_pixels
    ) ORDER BY source.ordinality
  ), '[]'::jsonb)
  INTO selected_assets
  FROM jsonb_array_elements_text(selected_revision.document -> 'sourceAssetIds')
    WITH ORDINALITY AS source(asset_id, ordinality)
  JOIN public.media_assets asset
    ON asset.id = source.asset_id::uuid
   AND asset.project_id = selected_revision.project_id
   AND asset.owner_id = selected_revision.owner_id
   AND asset.original_asset_id IS NULL
   AND asset.status = 'ready'
   AND asset.is_current
   AND asset.purpose IN ('project_media', 'project_cover')
   AND asset.object_key LIKE 'originals/%'
   AND asset.sha256 = selected_revision.document #>> ARRAY[
     'sourceAssets', (source.ordinality - 1)::text, 'sha256'
   ];

  IF jsonb_array_length(selected_assets) <> expected_asset_count THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT
    selected_event.id,
    selected_revision.id,
    selected_pdf.id,
    selected_pdf.object_key,
    selected_revision.document,
    selected_assets,
    selected_event.attempt_count;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_finalize_photobook_render(
  worker_identifier text,
  target_event_id uuid,
  target_revision_id uuid,
  rendered_pdf_sha256 text,
  rendered_pdf_size_bytes bigint,
  rendered_page_count integer,
  rendered_asset_set_sha256 text,
  rendered_font_set_sha256 text,
  rendered_engine text,
  rendered_version text
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
    OR rendered_pdf_sha256 IS NULL
    OR rendered_pdf_sha256 !~ '^[0-9a-f]{64}$'
    OR rendered_pdf_size_bytes IS NULL
    OR rendered_pdf_size_bytes NOT BETWEEN 1 AND 157286400
    OR rendered_page_count IS NULL
    OR rendered_page_count NOT BETWEEN 24 AND 400
    OR mod(rendered_page_count, 2) <> 0
    OR rendered_asset_set_sha256 IS NULL
    OR rendered_asset_set_sha256 !~ '^[0-9a-f]{64}$'
    OR rendered_font_set_sha256 IS NULL
    OR rendered_font_set_sha256 !~ '^[0-9a-f]{64}$'
    OR rendered_engine IS NULL
    OR rendered_engine !~ '^[a-z0-9._-]{1,80}$'
    OR rendered_version IS NULL
    OR rendered_version !~ '^[A-Za-z0-9._-]{1,120}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid photobook finalization input';
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
    AND revision.asset_set_sha256 = rendered_asset_set_sha256
    AND revision.render_engine = rendered_engine
    AND revision.render_version = rendered_version
  FOR UPDATE OF revision, event;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.media_assets asset
  SET
    status = 'ready',
    storage_version = 'photobook-pdf-v1',
    claimed_content_type = 'application/pdf',
    detected_content_type = 'application/pdf',
    size_bytes = rendered_pdf_size_bytes,
    sha256 = rendered_pdf_sha256,
    width_pixels = NULL,
    height_pixels = NULL,
    exif_stripped = false,
    ready_at = statement_timestamp(),
    failure_code = NULL,
    version = asset.version + 1,
    updated_at = statement_timestamp()
  WHERE asset.id = selected_revision.pdf_asset_id
    AND asset.project_id = selected_revision.project_id
    AND asset.owner_id = selected_revision.owner_id
    AND asset.purpose = 'photobook_pdf'
    AND asset.status = 'processing'
    AND asset.object_key = 'photobook-pdfs/' || left(asset.id::text, 2) || '/' || asset.id::text;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RETURN false;
  END IF;

  UPDATE public.photobook_revisions revision
  SET
    status = 'ready',
    pdf_sha256 = rendered_pdf_sha256,
    pdf_size_bytes = rendered_pdf_size_bytes,
    page_count = rendered_page_count,
    font_set_sha256 = rendered_font_set_sha256,
    failure_code = NULL,
    updated_at = statement_timestamp()
  WHERE revision.id = selected_revision.id
    AND revision.status = 'rendering';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'photobook revision changed';
  END IF;

  UPDATE public.photobook_drafts draft
  SET status = 'ready', updated_at = statement_timestamp()
  WHERE draft.id = selected_revision.draft_id
    AND draft.document_sha256 = selected_revision.document_sha256
    AND draft.status = 'rendering';

  UPDATE public.outbox_events event
  SET
    status = 'delivered',
    delivered_at = statement_timestamp(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
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
    status = CASE WHEN move_to_dead_letter THEN 'failed' ELSE 'rendering' END,
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
    status = CASE WHEN move_to_dead_letter THEN 'dead_letter' ELSE 'retry' END,
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

REVOKE ALL ON FUNCTION public.app_photobook_worker_claim(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_begin_photobook_render(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_finalize_photobook_render(text, uuid, uuid, text, bigint, integer, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_fail_photobook_render(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;

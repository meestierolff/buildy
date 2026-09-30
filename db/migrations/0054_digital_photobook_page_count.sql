-- Digital Bouwboeken contain their covers and actual story pages, without
-- physical-print padding or an even-page requirement. Existing PDF metadata,
-- worker leases, grants and historical locked-revision guards remain intact.
ALTER TABLE public.photobook_revisions
  DROP CONSTRAINT photobook_revisions_ready_proof_ck;
--> statement-breakpoint
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
      AND page_count BETWEEN 2 AND 400
    )
  );
--> statement-breakpoint

-- CREATE OR REPLACE preserves the existing dedicated-worker EXECUTE grant.
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
    OR rendered_page_count NOT BETWEEN 2 AND 400
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_finalize_photobook_render(text, uuid, uuid, text, bigint, integer, text, text, text, text) FROM PUBLIC;

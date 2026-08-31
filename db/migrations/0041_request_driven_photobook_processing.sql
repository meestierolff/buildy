-- Claim one exact Bouwboek proof revision from an authenticated request path.
-- Rendering still runs under the isolated worker role; the web role never gets
-- direct access to proof, media or outbox rows.

CREATE OR REPLACE FUNCTION public.app_photobook_worker_claim_revision(
  worker_identifier text,
  target_revision_id uuid,
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
    OR target_revision_id IS NULL
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid targeted photobook claim input';
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
     AND revision.id = target_revision_id
     AND revision.status = 'rendering'
    JOIN public.photobook_drafts draft
      ON draft.id = revision.draft_id
     AND draft.project_id = revision.project_id
     AND draft.owner_id = revision.owner_id
     AND draft.document_sha256 = revision.document_sha256
     AND draft.status = 'rendering'
    JOIN public.projects project
      ON project.id = revision.project_id
     AND project.owner_id = revision.owner_id
     AND project.lifecycle_status = 'active'
     AND project.deleted_at IS NULL
    WHERE event.aggregate_type = 'photobook_proof'
      AND event.event_type = 'photobook.proof.requested.v1'
      AND event.aggregate_id = target_revision_id
      AND event.payload ->> 'revisionId' = target_revision_id::text
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
      AND event.aggregate_id = target_revision_id
    RETURNING event.id, event.aggregate_id, event.attempt_count, event.lease_expires_at
  )
  SELECT claimed.id, claimed.aggregate_id, claimed.attempt_count, claimed.lease_expires_at
  FROM claimed;
END
$function$;

REVOKE ALL ON FUNCTION public.app_photobook_worker_claim_revision(text, uuid, integer) FROM PUBLIC;

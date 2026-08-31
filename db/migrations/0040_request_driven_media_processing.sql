-- Core uploads are processed by the authenticated request that completes or
-- polls the exact asset. The generic claim remains available only as bounded
-- maintenance/recovery. This helper grants no table access: runtime roles get
-- only explicit EXECUTE capabilities from the separate role setup workflow.

CREATE OR REPLACE FUNCTION public.app_claim_media_processing_asset(
  worker_identifier text,
  target_asset_id uuid,
  lease_seconds integer
)
RETURNS TABLE (
  event_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  event_type text,
  payload jsonb,
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
    OR target_asset_id IS NULL
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid targeted media claim input';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      event.id,
      event.status = 'claimed'
        AND event.lease_owner = worker_identifier
        AND event.lease_expires_at > clock_timestamp() AS is_resume
    FROM public.outbox_events event
    JOIN public.media_assets asset
      ON asset.id = event.aggregate_id
    WHERE event.aggregate_type = 'media'
      AND event.aggregate_id = target_asset_id
      AND event.event_type = 'media.processing.requested.v1'
      AND asset.id = target_asset_id
      AND asset.project_id IS NOT NULL
      AND asset.original_asset_id IS NULL
      AND asset.purpose IN ('project_media', 'project_cover', 'floorplan')
      AND asset.claimed_content_type IS NOT NULL
      AND asset.size_bytes BETWEEN 1 AND 52428800
      AND asset.sha256 ~ '^[0-9a-f]{64}$'
      AND (
        (
          event.status IN ('pending', 'retry')
          AND event.available_at <= clock_timestamp()
          AND asset.status = 'uploaded'
        )
        OR (
          event.status = 'claimed'
          AND asset.status = 'processing'
          AND (
            event.lease_expires_at <= clock_timestamp()
            OR event.lease_owner = worker_identifier
          )
        )
      )
    ORDER BY event.created_at, event.id
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
    RETURNING
      event.id,
      event.aggregate_type,
      event.aggregate_id,
      event.event_type,
      event.payload,
      event.attempt_count,
      event.lease_expires_at
  )
  SELECT
    claimed.id,
    claimed.aggregate_type,
    claimed.aggregate_id,
    claimed.event_type,
    claimed.payload,
    claimed.attempt_count,
    claimed.lease_expires_at
  FROM claimed;
END
$function$;

-- The original retry helper used a CASE expression whose branches resolved to
-- text. PostgreSQL does not implicitly assign that expression to enum columns,
-- so a real transient media failure could never become retryable. Keep the
-- existing lease and target checks, but make both state transitions explicit.
CREATE OR REPLACE FUNCTION public.app_fail_media_processing_job(
  worker_identifier text,
  target_event_id uuid,
  target_asset_id uuid,
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
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL
    OR target_asset_id IS NULL
    OR processing_failure_code IS NULL
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media failure input';
  END IF;

  UPDATE public.media_assets asset
  SET
    status = CASE
      WHEN move_to_dead_letter THEN 'failed'::public.media_status
      ELSE 'uploaded'::public.media_status
    END,
    failure_code = processing_failure_code,
    version = asset.version + 1,
    updated_at = statement_timestamp()
  FROM public.outbox_events event
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'media'
    AND event.aggregate_id = target_asset_id
    AND event.event_type = 'media.processing.requested.v1'
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp()
    AND asset.id = target_asset_id
    AND asset.status = 'processing';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RETURN false;
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
    AND event.aggregate_type = 'media'
    AND event.event_type = 'media.processing.requested.v1'
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'media worker lease lost';
  END IF;

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.app_claim_media_processing_asset(text, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_fail_media_processing_job(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;

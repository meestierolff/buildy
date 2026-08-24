-- Persist a privacy-free pagination checkpoint for each private Blob purpose
-- that can contain temporary or generated image objects. The existing outbox
-- supplies lease, retry and dead-letter state without introducing a second
-- maintenance queue or a new scheduled endpoint.

INSERT INTO public.outbox_events (
  id,
  aggregate_type,
  aggregate_id,
  event_type,
  idempotency_key,
  payload,
  status,
  available_at
) VALUES
  (
    'f0000000-0000-4000-8000-000000000001'::uuid,
    'maintenance',
    'f0000000-0000-4000-8000-000000000001'::uuid,
    'media.orphan_cleanup.maintenance.v1',
    'media-orphan-cleanup:v1:temporary',
    '{"schemaVersion":1,"purpose":"temporary","cursor":null}'::jsonb,
    'pending',
    statement_timestamp()
  ),
  (
    'f0000000-0000-4000-8000-000000000002'::uuid,
    'maintenance',
    'f0000000-0000-4000-8000-000000000002'::uuid,
    'media.orphan_cleanup.maintenance.v1',
    'media-orphan-cleanup:v1:originals',
    '{"schemaVersion":1,"purpose":"originals","cursor":null}'::jsonb,
    'pending',
    statement_timestamp()
  ),
  (
    'f0000000-0000-4000-8000-000000000003'::uuid,
    'maintenance',
    'f0000000-0000-4000-8000-000000000003'::uuid,
    'media.orphan_cleanup.maintenance.v1',
    'media-orphan-cleanup:v1:display',
    '{"schemaVersion":1,"purpose":"display","cursor":null}'::jsonb,
    'pending',
    statement_timestamp()
  )
ON CONFLICT (idempotency_key) DO NOTHING;

DO $checkpoint_contract$
BEGIN
  IF (
    SELECT count(*)
    FROM public.outbox_events event
    WHERE event.aggregate_type = 'maintenance'
      AND event.event_type = 'media.orphan_cleanup.maintenance.v1'
      AND event.idempotency_key IN (
        'media-orphan-cleanup:v1:temporary',
        'media-orphan-cleanup:v1:originals',
        'media-orphan-cleanup:v1:display'
      )
      AND event.payload ->> 'purpose' IN ('temporary', 'originals', 'display')
      AND event.payload ->> 'schemaVersion' = '1'
  ) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid media cleanup checkpoint seed';
  END IF;
END
$checkpoint_contract$;

CREATE OR REPLACE FUNCTION public.app_media_worker_claim_orphan_cleanup(
  worker_identifier text,
  requested_purpose text,
  lease_seconds integer
)
RETURNS TABLE (
  event_id uuid,
  cleanup_purpose text,
  provider_cursor text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR requested_purpose IS NULL
    OR requested_purpose NOT IN ('temporary', 'originals', 'display')
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media cleanup claim input';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      event.id,
      event.status = 'claimed'
        AND event.lease_owner = worker_identifier
        AND event.lease_expires_at > clock_timestamp() AS is_resume
    FROM public.outbox_events event
    WHERE event.aggregate_type = 'maintenance'
      AND event.event_type = 'media.orphan_cleanup.maintenance.v1'
      AND event.idempotency_key = 'media-orphan-cleanup:v1:' || requested_purpose
      AND event.payload ->> 'schemaVersion' = '1'
      AND event.payload ->> 'purpose' = requested_purpose
      AND (
        jsonb_typeof(event.payload -> 'cursor') = 'null'
        OR (
          jsonb_typeof(event.payload -> 'cursor') = 'string'
          AND char_length(event.payload ->> 'cursor') BETWEEN 1 AND 2048
        )
      )
      AND (
        (
          event.status IN ('pending', 'retry')
          AND event.available_at <= clock_timestamp()
        )
        OR (
          event.status = 'claimed'
          AND (
            event.lease_expires_at <= clock_timestamp()
            OR event.lease_owner = worker_identifier
          )
        )
      )
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
    RETURNING event.id, event.payload, event.attempt_count
  )
  SELECT
    claimed.id,
    claimed.payload ->> 'purpose',
    claimed.payload ->> 'cursor',
    claimed.attempt_count
  FROM claimed;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_media_worker_finalize_orphan_cleanup(
  worker_identifier text,
  target_event_id uuid,
  expected_purpose text,
  next_provider_cursor text,
  scan_complete boolean
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
    OR expected_purpose IS NULL
    OR expected_purpose NOT IN ('temporary', 'originals', 'display')
    OR scan_complete IS NULL
    OR (scan_complete AND next_provider_cursor IS NOT NULL)
    OR (
      next_provider_cursor IS NOT NULL
      AND char_length(next_provider_cursor) NOT BETWEEN 1 AND 2048
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media cleanup finalize input';
  END IF;

  UPDATE public.outbox_events event
  SET
    payload = jsonb_build_object(
      'schemaVersion', 1,
      'purpose', expected_purpose,
      'cursor', CASE
        WHEN scan_complete THEN 'null'::jsonb
        ELSE to_jsonb(next_provider_cursor)
      END
    ),
    status = 'pending',
    attempt_count = 0,
    available_at = CASE
      WHEN scan_complete THEN clock_timestamp() + interval '20 hours'
      ELSE clock_timestamp()
    END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    delivered_at = NULL,
    last_error_code = NULL,
    updated_at = statement_timestamp()
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'maintenance'
    AND event.event_type = 'media.orphan_cleanup.maintenance.v1'
    AND event.idempotency_key = 'media-orphan-cleanup:v1:' || expected_purpose
    AND event.payload ->> 'purpose' = expected_purpose
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_media_worker_fail_orphan_cleanup(
  worker_identifier text,
  target_event_id uuid,
  expected_purpose text,
  cleanup_failure_code text,
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
    OR expected_purpose IS NULL
    OR expected_purpose NOT IN ('temporary', 'originals', 'display')
    OR cleanup_failure_code IS NULL
    OR cleanup_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media cleanup failure input';
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
    delivered_at = NULL,
    last_error_code = cleanup_failure_code,
    updated_at = statement_timestamp()
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'maintenance'
    AND event.event_type = 'media.orphan_cleanup.maintenance.v1'
    AND event.idempotency_key = 'media-orphan-cleanup:v1:' || expected_purpose
    AND event.payload ->> 'purpose' = expected_purpose
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

REVOKE ALL ON FUNCTION public.app_media_worker_claim_orphan_cleanup(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_media_worker_finalize_orphan_cleanup(text, uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_media_worker_fail_orphan_cleanup(text, uuid, text, text, integer, boolean) FROM PUBLIC;

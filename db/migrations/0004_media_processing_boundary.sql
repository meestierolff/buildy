CREATE POLICY outbox_events_select_media_owner
ON outbox_events
FOR SELECT
USING (
  aggregate_type = 'media'
  AND EXISTS (
    SELECT 1
    FROM media_assets asset
    WHERE asset.id = aggregate_id
      AND asset.owner_id = app_actor_id()
  )
);

CREATE POLICY outbox_events_insert_media_owner
ON outbox_events
FOR INSERT
WITH CHECK (
  aggregate_type = 'media'
  AND EXISTS (
    SELECT 1
    FROM media_assets asset
    WHERE asset.id = aggregate_id
      AND asset.owner_id = app_actor_id()
  )
);

DROP POLICY media_select_visible ON media_assets;
CREATE POLICY media_select_visible ON media_assets FOR SELECT
USING (
  owner_id = app_actor_id()
  OR (
    status = 'ready'
    AND is_current
    AND project_id IS NOT NULL
    AND purpose IN ('project_media', 'project_cover', 'floorplan')
    AND app_can_view_project(project_id)
    AND (
      purpose <> 'project_media'
      OR EXISTS (
        SELECT 1
        FROM update_media attachment
        JOIN updates project_update
          ON project_update.id = attachment.update_id
         AND project_update.project_id = attachment.project_id
        WHERE attachment.media_asset_id = coalesce(media_assets.original_asset_id, media_assets.id)
          AND project_update.status = 'published'
      )
    )
  )
  OR (
    purpose = 'avatar'
    AND status = 'ready'
    AND is_current
    AND app_can_view_profile(owner_id)
  )
);

DROP POLICY update_media_select_visible ON update_media;
CREATE POLICY update_media_select_visible ON update_media FOR SELECT
USING (
  app_owns_project(project_id)
  OR (
    app_can_view_project(project_id)
    AND EXISTS (
      SELECT 1
      FROM updates project_update
      WHERE project_update.id = update_media.update_id
        AND project_update.project_id = update_media.project_id
        AND project_update.status = 'published'
    )
  )
);

CREATE OR REPLACE FUNCTION app_claim_outbox_event(
  worker_identifier text,
  requested_event_type text,
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
    OR requested_event_type IS DISTINCT FROM 'media.processing.requested.v1'
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid outbox claim input';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      event.id,
      event.status = 'claimed'
        AND event.lease_owner = worker_identifier
        AND event.lease_expires_at > clock_timestamp() AS is_resume
    FROM public.outbox_events event
    WHERE event.event_type = requested_event_type
      AND event.aggregate_type = 'media'
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
    FOR UPDATE SKIP LOCKED
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

CREATE OR REPLACE FUNCTION app_ack_outbox_event(
  worker_identifier text,
  target_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  acknowledged boolean;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid outbox acknowledgement';
  END IF;

  UPDATE public.outbox_events event
  SET
    status = 'delivered',
    delivered_at = statement_timestamp(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
    updated_at = statement_timestamp()
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'media'
    AND event.event_type = 'media.processing.requested.v1'
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp()
  RETURNING true INTO acknowledged;

  RETURN coalesce(acknowledged, false);
END
$function$;

CREATE OR REPLACE FUNCTION app_retry_outbox_event(
  worker_identifier text,
  target_event_id uuid,
  failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  scheduled boolean;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL
    OR failure_code IS NULL
    OR failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds IS NULL
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid outbox retry input';
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
    last_error_code = failure_code,
    updated_at = statement_timestamp()
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'media'
    AND event.event_type = 'media.processing.requested.v1'
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp()
  RETURNING true INTO scheduled;

  RETURN coalesce(scheduled, false);
END
$function$;

CREATE OR REPLACE FUNCTION app_begin_media_processing_job(
  worker_identifier text,
  target_event_id uuid
)
RETURNS TABLE (
  event_id uuid,
  asset_id uuid,
  owner_id uuid,
  project_id uuid,
  purpose media_purpose,
  temporary_object_key text,
  bucket_name text,
  claimed_content_type text,
  expected_size_bytes bigint,
  expected_sha256_hex text,
  privacy_version integer,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media processing claim';
  END IF;

  RETURN QUERY
  WITH processing_asset AS (
    UPDATE public.media_assets asset
    SET
      status = 'processing',
      failure_code = NULL,
      version = CASE WHEN asset.status = 'uploaded' THEN asset.version + 1 ELSE asset.version END,
      updated_at = statement_timestamp()
    FROM public.outbox_events event
    WHERE event.id = target_event_id
      AND event.aggregate_type = 'media'
      AND event.event_type = 'media.processing.requested.v1'
      AND event.status = 'claimed'
      AND event.lease_owner = worker_identifier
      AND event.lease_expires_at > clock_timestamp()
      AND asset.id = event.aggregate_id
      AND asset.project_id IS NOT NULL
      AND asset.original_asset_id IS NULL
      AND asset.purpose IN ('project_media', 'project_cover', 'floorplan')
      AND asset.status IN ('uploaded', 'processing')
      AND asset.claimed_content_type IS NOT NULL
      AND asset.size_bytes IS NOT NULL
      AND asset.size_bytes BETWEEN 1 AND 52428800
      AND asset.sha256 ~ '^[0-9a-f]{64}$'
    RETURNING
      event.id AS event_id,
      asset.id AS asset_id,
      asset.owner_id,
      asset.project_id,
      asset.purpose,
      asset.object_key,
      asset.bucket,
      asset.claimed_content_type,
      asset.size_bytes,
      asset.sha256,
      asset.privacy_version,
      event.attempt_count
  )
  SELECT
    processing_asset.event_id,
    processing_asset.asset_id,
    processing_asset.owner_id,
    processing_asset.project_id,
    processing_asset.purpose,
    processing_asset.object_key,
    processing_asset.bucket,
    processing_asset.claimed_content_type,
    processing_asset.size_bytes,
    processing_asset.sha256,
    processing_asset.privacy_version,
    processing_asset.attempt_count
  FROM processing_asset;
END
$function$;

CREATE OR REPLACE FUNCTION app_media_protected_object_keys(candidate_keys text[])
RETURNS TABLE (object_key text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF candidate_keys IS NULL
    OR cardinality(candidate_keys) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media cleanup candidates';
  END IF;

  RETURN QUERY
  SELECT candidate.object_key
  FROM unnest(candidate_keys) AS candidate(object_key)
  WHERE EXISTS (
    SELECT 1
    FROM public.media_assets asset
    WHERE asset.object_key = candidate.object_key
      AND asset.status NOT IN ('deletion_pending', 'deleted', 'failed')
  )
  OR EXISTS (
    SELECT 1
    FROM public.media_assets parent
    WHERE parent.original_asset_id IS NULL
      AND parent.status IN ('uploaded', 'processing')
      AND candidate.object_key IN (
        'originals/' || left(parent.id::text, 2) || '/' || parent.id::text,
        'display/' || left(parent.id::text, 2) || '/' || parent.id::text || '/small.webp',
        'display/' || left(parent.id::text, 2) || '/' || parent.id::text || '/medium.webp',
        'display/' || left(parent.id::text, 2) || '/' || parent.id::text || '/large.webp'
      )
  );
END
$function$;

CREATE OR REPLACE FUNCTION app_finalize_media_processing_job(
  worker_identifier text,
  target_event_id uuid,
  target_asset_id uuid,
  original_object_key text,
  original_content_type text,
  original_size_bytes bigint,
  original_sha256_hex text,
  original_width_pixels integer,
  original_height_pixels integer,
  derivative_records jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  parent public.media_assets%ROWTYPE;
  derivative jsonb;
  derivative_size text;
  derivative_id uuid;
  expected_key text;
  seen_sizes text[] := ARRAY[]::text[];
  seen_ids uuid[] := ARRAY[]::uuid[];
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_event_id IS NULL
    OR target_asset_id IS NULL
    OR original_object_key IS NULL
    OR original_content_type IS NULL
    OR original_content_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
    OR original_size_bytes IS NULL
    OR original_size_bytes NOT BETWEEN 1 AND 52428800
    OR original_sha256_hex IS NULL
    OR original_sha256_hex !~ '^[0-9a-f]{64}$'
    OR original_width_pixels IS NULL
    OR original_width_pixels <= 0
    OR original_height_pixels IS NULL
    OR original_height_pixels <= 0
    OR original_width_pixels::bigint * original_height_pixels::bigint > 100000000
    OR derivative_records IS NULL
    OR jsonb_typeof(derivative_records) <> 'array'
    OR jsonb_array_length(derivative_records) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid media finalization input';
  END IF;

  SELECT asset.*
  INTO parent
  FROM public.media_assets asset
  JOIN public.outbox_events event ON event.aggregate_id = asset.id
  WHERE event.id = target_event_id
    AND event.aggregate_type = 'media'
    AND event.event_type = 'media.processing.requested.v1'
    AND event.status = 'claimed'
    AND event.lease_owner = worker_identifier
    AND event.lease_expires_at > clock_timestamp()
    AND asset.id = target_asset_id
    AND asset.original_asset_id IS NULL
    AND asset.status = 'processing'
  FOR UPDATE OF asset, event;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  expected_key := 'originals/' || left(parent.id::text, 2) || '/' || parent.id::text;
  IF original_object_key IS DISTINCT FROM expected_key THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid original object key';
  END IF;

  FOR derivative IN SELECT value FROM jsonb_array_elements(derivative_records)
  LOOP
    IF jsonb_typeof(derivative) <> 'object'
      OR NOT (derivative ?& ARRAY[
        'id', 'size', 'objectKey', 'contentType', 'sizeBytes', 'sha256', 'widthPixels', 'heightPixels'
      ])
      OR derivative - ARRAY[
        'id', 'size', 'objectKey', 'contentType', 'sizeBytes', 'sha256', 'widthPixels', 'heightPixels'
      ] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid derivative record';
    END IF;

    derivative_size := derivative ->> 'size';
    derivative_id := (derivative ->> 'id')::uuid;
    IF derivative_size IS NULL
      OR derivative_size NOT IN ('small', 'medium', 'large')
      OR derivative_size = ANY(seen_sizes)
      OR derivative_id IS NULL
      OR derivative_id = parent.id
      OR derivative_id = ANY(seen_ids)
      OR derivative ->> 'objectKey' IS NULL
      OR derivative ->> 'contentType' IS NULL
      OR derivative ->> 'contentType' <> 'image/webp'
      OR derivative ->> 'sizeBytes' IS NULL
      OR (derivative ->> 'sizeBytes')::bigint NOT BETWEEN 1 AND 15728640
      OR derivative ->> 'sha256' IS NULL
      OR derivative ->> 'sha256' !~ '^[0-9a-f]{64}$'
      OR derivative ->> 'widthPixels' IS NULL
      OR (derivative ->> 'widthPixels')::integer <= 0
      OR derivative ->> 'heightPixels' IS NULL
      OR (derivative ->> 'heightPixels')::integer <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid derivative metadata';
    END IF;

    expected_key := 'display/' || left(parent.id::text, 2) || '/' || parent.id::text || '/' || derivative_size || '.webp';
    IF derivative ->> 'objectKey' IS DISTINCT FROM expected_key THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid derivative object key';
    END IF;
    seen_sizes := array_append(seen_sizes, derivative_size);
    seen_ids := array_append(seen_ids, derivative_id);

    INSERT INTO public.media_assets (
      id, owner_id, project_id, original_asset_id, purpose, status,
      storage_provider, bucket, object_key, storage_version,
      upload_idempotency_key, claimed_content_type, detected_content_type,
      size_bytes, sha256, width_pixels, height_pixels, exif_stripped,
      is_current, privacy_version, ready_at, version
    ) VALUES (
      derivative_id,
      parent.owner_id,
      parent.project_id,
      parent.id,
      parent.purpose,
      'ready',
      parent.storage_provider,
      parent.bucket,
      derivative ->> 'objectKey',
      'display-' || derivative_size || '-v1',
      'media-derivative:v1:' || parent.id::text || ':' || derivative_size,
      derivative ->> 'contentType',
      derivative ->> 'contentType',
      (derivative ->> 'sizeBytes')::bigint,
      derivative ->> 'sha256',
      (derivative ->> 'widthPixels')::integer,
      (derivative ->> 'heightPixels')::integer,
      true,
      true,
      parent.privacy_version,
      statement_timestamp(),
      1
    )
    ON CONFLICT (id) DO UPDATE SET
      status = 'ready',
      object_key = excluded.object_key,
      storage_version = excluded.storage_version,
      claimed_content_type = excluded.claimed_content_type,
      detected_content_type = excluded.detected_content_type,
      size_bytes = excluded.size_bytes,
      sha256 = excluded.sha256,
      width_pixels = excluded.width_pixels,
      height_pixels = excluded.height_pixels,
      exif_stripped = true,
      is_current = true,
      privacy_version = excluded.privacy_version,
      ready_at = excluded.ready_at,
      failure_code = NULL,
      version = media_assets.version + 1,
      updated_at = statement_timestamp()
    WHERE media_assets.owner_id = excluded.owner_id
      AND media_assets.project_id = excluded.project_id
      AND media_assets.original_asset_id = excluded.original_asset_id;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'derivative ownership changed';
    END IF;
  END LOOP;

  UPDATE public.media_assets asset
  SET
    status = 'ready',
    object_key = original_object_key,
    storage_version = 'sanitized-original-v1',
    detected_content_type = original_content_type,
    size_bytes = original_size_bytes,
    sha256 = original_sha256_hex,
    width_pixels = original_width_pixels,
    height_pixels = original_height_pixels,
    exif_stripped = true,
    ready_at = statement_timestamp(),
    failure_code = NULL,
    version = asset.version + 1,
    updated_at = statement_timestamp()
  WHERE asset.id = parent.id
    AND asset.status = 'processing';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RETURN false;
  END IF;

  UPDATE public.outbox_events event
  SET
    status = 'delivered',
    delivered_at = statement_timestamp(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = NULL,
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

CREATE OR REPLACE FUNCTION app_fail_media_processing_job(
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
    status = CASE WHEN move_to_dead_letter THEN 'failed' ELSE 'uploaded' END,
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

REVOKE ALL ON FUNCTION app_claim_outbox_event(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_ack_outbox_event(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_retry_outbox_event(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_begin_media_processing_job(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_media_protected_object_keys(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_finalize_media_processing_job(text, uuid, uuid, text, text, bigint, text, integer, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_media_processing_job(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;

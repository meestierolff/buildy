-- Update erasure reuses the bounded account-lifecycle worker credential. The
-- web runtime can only request a manifest-backed transition; storage cleanup
-- and database redaction remain separate, leased and replay-safe operations.

CREATE OR REPLACE FUNCTION public.app_request_update_deletion(
  target_project_id uuid,
  target_update_id uuid,
  expected_update_version integer,
  scoped_idempotency_key text,
  policy_version text
)
RETURNS TABLE (
  job_id uuid,
  job_status public.deletion_status,
  active_order_count integer,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor uuid := public.app_actor_id();
  selected_update public.updates%ROWTYPE;
  selected_job public.deletion_jobs%ROWTYPE;
  count_active_orders integer;
  manifest_hash text;
  replayed_request boolean := false;
BEGIN
  IF actor IS NULL
    OR target_project_id IS NULL
    OR target_update_id IS NULL
    OR expected_update_version IS NULL
    OR expected_update_version < 1
    OR scoped_idempotency_key IS NULL
    OR scoped_idempotency_key !~ '^project-command:v1:update[.]delete:[0-9a-f]{64}$'
    OR policy_version IS NULL
    OR policy_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid update deletion request';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('update-deletion:' || target_update_id::text, 0)
  );

  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.kind = 'update'
    AND job.target_id = target_update_id
    AND job.requested_by_id = actor
    AND job.idempotency_key = scoped_idempotency_key
  LIMIT 1
  FOR UPDATE;
  replayed_request := FOUND;
  IF FOUND AND selected_job.status <> 'blocked_active_order' THEN
    RETURN QUERY SELECT selected_job.id, selected_job.status,
      selected_job.active_order_count, true;
    RETURN;
  END IF;

  SELECT item.* INTO selected_update
  FROM public.updates item
  JOIN public.projects project
    ON project.id = item.project_id
   AND project.owner_id = item.project_owner_id
  WHERE item.id = target_update_id
    AND item.project_id = target_project_id
    AND item.project_owner_id = actor
    AND item.author_id = actor
    AND item.status IN ('draft', 'published')
    AND item.deleted_at IS NULL
    AND project.owner_id = actor
    AND project.lifecycle_status = 'active'
    AND project.deleted_at IS NULL
  FOR UPDATE OF item, project;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'update is not active or owned by actor';
  END IF;
  IF selected_update.version <> expected_update_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'update version conflict';
  END IF;

  IF selected_job.id IS NULL THEN
    SELECT job.* INTO selected_job
    FROM public.deletion_jobs job
    WHERE job.kind = 'update'
      AND job.target_id = target_update_id
      AND job.status NOT IN ('completed', 'dead_letter')
    ORDER BY job.created_at DESC, job.id DESC
    LIMIT 1
    FOR UPDATE;
    replayed_request := FOUND;
  END IF;

  -- Only a physical order whose immutable proof contains this update blocks
  -- the request. The project row lock and revision bump below close the race
  -- with checkout from an older draft/proof.
  SELECT count(*)::integer INTO count_active_orders
  FROM public.photobook_orders orders
  JOIN public.photobook_revisions revision
    ON revision.id = orders.proof_revision_id
   AND revision.project_id = orders.project_id
  WHERE orders.project_id = target_project_id
    AND public.app_account_order_is_active(orders)
    AND (
      revision.document @> jsonb_build_object(
        'pages', jsonb_build_array(jsonb_build_object('updateId', target_update_id::text))
      )
      OR EXISTS (
        SELECT 1
        FROM public.update_media link
        WHERE link.update_id = target_update_id
          AND link.project_id = target_project_id
          AND revision.asset_set @> jsonb_build_array(
            jsonb_build_object('id', link.media_asset_id::text)
          )
      )
    );

  IF selected_job.id IS NULL THEN
    INSERT INTO public.deletion_jobs (
      kind, target_id, requested_by_id, status, idempotency_key,
      retention_policy_version, active_order_count, available_at
    ) VALUES (
      'update', target_update_id, actor,
      CASE WHEN count_active_orders > 0 THEN 'blocked_active_order' ELSE 'requested' END,
      scoped_idempotency_key, policy_version, count_active_orders,
      statement_timestamp()
    ) RETURNING * INTO selected_job;
  ELSE
    UPDATE public.deletion_jobs job
    SET status = CASE WHEN count_active_orders > 0 THEN 'blocked_active_order' ELSE 'requested' END,
      active_order_count = count_active_orders,
      retention_policy_version = policy_version,
      available_at = statement_timestamp(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = statement_timestamp()
    WHERE job.id = selected_job.id
    RETURNING * INTO selected_job;
  END IF;

  IF count_active_orders > 0 THEN
    INSERT INTO public.audit_events (
      actor_kind, actor_user_id, action, resource_type, resource_id, metadata
    ) SELECT
      'user', actor, 'update.deletion_blocked', 'deletion_job', selected_job.id,
      jsonb_build_object(
        'schemaVersion', 1,
        'projectId', target_project_id,
        'updateId', target_update_id,
        'activeOrderCount', count_active_orders,
        'retentionPolicyVersion', policy_version
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_events event
      WHERE event.action = 'update.deletion_blocked'
        AND event.resource_type = 'deletion_job'
        AND event.resource_id = selected_job.id
    );
    RETURN QUERY SELECT selected_job.id, selected_job.status,
      count_active_orders, replayed_request;
    RETURN;
  END IF;

  WITH RECURSIVE linked_assets(id) AS (
    SELECT link.media_asset_id
    FROM public.update_media link
    WHERE link.update_id = target_update_id
      AND link.project_id = target_project_id
    UNION
    SELECT child.id
    FROM public.media_assets child
    JOIN linked_assets parent ON child.original_asset_id = parent.id
    WHERE child.project_id = target_project_id
      AND child.owner_id = actor
  )
  INSERT INTO public.deletion_assets (
    deletion_job_id, media_asset_id, storage_provider, bucket, object_key,
    expected_sha256, status
  )
  SELECT selected_job.id, asset.id, asset.storage_provider, asset.bucket,
    asset.object_key, asset.sha256, 'pending'
  FROM linked_assets linked
  JOIN public.media_assets asset ON asset.id = linked.id
  WHERE asset.owner_id = actor
    AND asset.project_id = target_project_id
    AND asset.status <> 'deleted'
  ON CONFLICT (deletion_job_id, storage_provider, bucket, object_key) DO NOTHING;

  SELECT encode(digest(coalesce(string_agg(
    asset.storage_provider || E'\n' || asset.bucket || E'\n' || asset.object_key || E'\n'
      || coalesce(asset.expected_sha256, ''),
    E'\n---\n' ORDER BY asset.storage_provider, asset.bucket, asset.object_key
  ), ''), 'sha256'), 'hex')
  INTO manifest_hash
  FROM public.deletion_assets asset
  WHERE asset.deletion_job_id = selected_job.id;

  UPDATE public.media_assets asset
  SET status = 'deletion_pending', is_current = false,
    version = asset.version + 1, updated_at = statement_timestamp()
  WHERE asset.id IN (
    SELECT manifest.media_asset_id
    FROM public.deletion_assets manifest
    WHERE manifest.deletion_job_id = selected_job.id
      AND manifest.media_asset_id IS NOT NULL
  )
    AND asset.status NOT IN ('deletion_pending', 'deleted');

  UPDATE public.updates item
  SET status = 'deletion_pending',
    version = item.version + 1,
    content_revision = item.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE item.id = target_update_id
    AND item.project_id = target_project_id
    AND item.project_owner_id = actor
    AND item.status IN ('draft', 'published');

  UPDATE public.projects project
  SET content_revision = project.content_revision + 1,
    version = project.version + 1,
    updated_at = statement_timestamp()
  WHERE project.id = target_project_id
    AND project.owner_id = actor
    AND project.lifecycle_status = 'active';

  UPDATE public.deletion_jobs job
  SET status = 'deletion_pending',
    asset_manifest_sha256 = manifest_hash,
    active_order_count = 0,
    available_at = statement_timestamp(),
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id
  RETURNING * INTO selected_job;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, metadata
  ) SELECT
    'user', actor, 'update.deletion_requested', 'deletion_job', selected_job.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', target_project_id,
      'updateId', target_update_id,
      'assetManifestSha256', manifest_hash,
      'retentionPolicyVersion', policy_version
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_events event
    WHERE event.action = 'update.deletion_requested'
      AND event.resource_type = 'deletion_job'
      AND event.resource_id = selected_job.id
  );

  RETURN QUERY SELECT selected_job.id, selected_job.status, 0, replayed_request;
END
$function$;

-- Account, project and update jobs all use the same bounded lease and
-- one-object-at-a-time deletion protocol.
CREATE OR REPLACE FUNCTION public.app_account_worker_claim_deletion(
  worker_identifier text,
  lease_seconds integer
)
RETURNS TABLE (job_id uuid, target_id uuid, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid deletion worker claim';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.deletion_jobs job
    WHERE job.kind IN ('account', 'project', 'update')
      AND (
        (job.kind = 'account' AND EXISTS (
          SELECT 1 FROM public.app_users account
          WHERE account.id = job.target_id AND account.status = 'deletion_pending'
        ))
        OR (job.kind = 'project' AND EXISTS (
          SELECT 1 FROM public.projects project
          WHERE project.id = job.target_id AND project.lifecycle_status = 'deletion_pending'
        ))
        OR (job.kind = 'update' AND EXISTS (
          SELECT 1
          FROM public.updates item
          WHERE item.id = job.target_id
            AND item.status IN ('deletion_pending', 'deleted')
        ))
      )
      AND job.status IN ('deletion_pending', 'storage_cleanup', 'retry_scheduled')
      AND job.available_at <= clock_timestamp()
      AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
    ORDER BY job.available_at, job.created_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.deletion_jobs job
    SET status = 'storage_cleanup',
      attempt_count = job.attempt_count + 1,
      lease_owner = worker_identifier,
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      started_at = coalesce(job.started_at, statement_timestamp()),
      last_error_code = NULL,
      updated_at = statement_timestamp()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*
  )
  SELECT claimed.id, claimed.target_id, claimed.attempt_count FROM claimed;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_update_worker_finalize_deletion(
  worker_identifier text,
  target_job_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_job public.deletion_jobs%ROWTYPE;
  selected_update public.updates%ROWTYPE;
  count_active_orders integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid update deletion finalization';
  END IF;

  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.id = target_job_id
    AND job.kind = 'update'
    AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM public.deletion_assets asset
      WHERE asset.deletion_job_id = job.id AND asset.status <> 'verified'
    )
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('update-deletion:' || selected_job.target_id::text, 0)
  );
  SELECT item.* INTO selected_update
  FROM public.updates item
  WHERE item.id = selected_job.target_id
    AND item.project_owner_id = selected_job.requested_by_id
    AND item.status IN ('deletion_pending', 'deleted')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- A project/account saga may already have produced the same tombstone. In
  -- that case storage readback was still independently verified for this job,
  -- and only the idempotent job/audit completion remains.
  IF selected_update.status = 'deleted' THEN
    UPDATE public.deletion_jobs job
    SET status = 'completed', active_order_count = 0,
      lease_owner = NULL, lease_expires_at = NULL,
      completed_at = coalesce(job.completed_at, statement_timestamp()),
      last_error_code = NULL, updated_at = statement_timestamp()
    WHERE job.id = selected_job.id;
    RETURN 'completed';
  END IF;

  SELECT count(*)::integer INTO count_active_orders
  FROM public.photobook_orders orders
  JOIN public.photobook_revisions revision
    ON revision.id = orders.proof_revision_id
   AND revision.project_id = orders.project_id
  WHERE orders.project_id = selected_update.project_id
    AND public.app_account_order_is_active(orders)
    AND (
      revision.document @> jsonb_build_object(
        'pages', jsonb_build_array(jsonb_build_object('updateId', selected_update.id::text))
      )
      OR EXISTS (
        SELECT 1 FROM public.update_media link
        WHERE link.update_id = selected_update.id
          AND link.project_id = selected_update.project_id
          AND revision.asset_set @> jsonb_build_array(
            jsonb_build_object('id', link.media_asset_id::text)
          )
      )
    );
  IF count_active_orders > 0 THEN
    UPDATE public.deletion_jobs job
    SET status = 'blocked_active_order',
      active_order_count = count_active_orders,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = 'ACTIVE_ORDER',
      updated_at = statement_timestamp()
    WHERE job.id = selected_job.id;
    RETURN 'blocked_active_order';
  END IF;

  UPDATE public.deletion_jobs
  SET status = 'database_redaction', updated_at = statement_timestamp()
  WHERE id = selected_job.id;

  DELETE FROM public.notifications notification
  WHERE notification.update_id = selected_update.id;
  DELETE FROM public.reactions reaction
  WHERE reaction.update_id = selected_update.id;
  DELETE FROM public.comment_mentions mention
  WHERE mention.update_id = selected_update.id;
  UPDATE public.comments comment
  SET body = '[verwijderd]', status = 'deleted',
    deleted_at = coalesce(comment.deleted_at, statement_timestamp()),
    version = comment.version + 1, updated_at = statement_timestamp()
  WHERE comment.update_id = selected_update.id
    AND (comment.status <> 'deleted' OR comment.body <> '[verwijderd]');

  DELETE FROM public.floorplan_pins pin
  WHERE pin.update_id = selected_update.id;
  UPDATE public.budget_items item
  SET update_id = NULL, version = item.version + 1,
    updated_at = statement_timestamp()
  WHERE item.update_id = selected_update.id;

  UPDATE public.outbox_events event
  SET status = 'dead_letter',
    payload = jsonb_build_object('schemaVersion', 1, 'reason', 'UPDATE_DELETION'),
    lease_owner = NULL, lease_expires_at = NULL,
    last_error_code = 'UPDATE_DELETION', updated_at = statement_timestamp()
  WHERE event.aggregate_type = 'photobook_proof'
    AND event.aggregate_id IN (
      SELECT revision.id
      FROM public.photobook_revisions revision
      WHERE revision.project_id = selected_update.project_id
        AND revision.document @> jsonb_build_object(
          'pages', jsonb_build_array(jsonb_build_object('updateId', selected_update.id::text))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.photobook_orders orders
          WHERE orders.proof_revision_id = revision.id
        )
    )
    AND event.status IN ('pending', 'claimed', 'retry');

  DELETE FROM public.photobook_revisions revision
  WHERE revision.project_id = selected_update.project_id
    AND revision.document @> jsonb_build_object(
      'pages', jsonb_build_array(jsonb_build_object('updateId', selected_update.id::text))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.photobook_orders orders
      WHERE orders.proof_revision_id = revision.id
    );
  DELETE FROM public.photobook_drafts draft
  WHERE draft.project_id = selected_update.project_id
    AND draft.document @> jsonb_build_object(
      'pages', jsonb_build_array(jsonb_build_object('updateId', selected_update.id::text))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.photobook_revisions revision
      WHERE revision.draft_id = draft.id
    );

  UPDATE public.photobook_settings setting
  SET cover_media_asset_id = NULL,
    version = setting.version + 1,
    updated_at = statement_timestamp()
  WHERE setting.cover_media_asset_id IN (
    SELECT asset.media_asset_id
    FROM public.deletion_assets asset
    WHERE asset.deletion_job_id = selected_job.id
      AND asset.media_asset_id IS NOT NULL
  );
  DELETE FROM public.photobook_exclusions exclusion
  WHERE exclusion.update_id = selected_update.id
    OR exclusion.media_asset_id IN (
      SELECT asset.media_asset_id
      FROM public.deletion_assets asset
      WHERE asset.deletion_job_id = selected_job.id
        AND asset.media_asset_id IS NOT NULL
    );
  DELETE FROM public.update_media link
  WHERE link.update_id = selected_update.id;

  UPDATE public.media_assets media
  SET status = 'deleted', is_current = false,
    deleted_at = coalesce(media.deleted_at, statement_timestamp()),
    version = media.version + 1, updated_at = statement_timestamp()
  WHERE media.id IN (
    SELECT asset.media_asset_id FROM public.deletion_assets asset
    WHERE asset.deletion_job_id = selected_job.id
      AND asset.status = 'verified'
      AND asset.media_asset_id IS NOT NULL
  )
    AND media.status <> 'deleted';

  UPDATE public.updates item
  SET legacy_step_id = NULL,
    phase_id = NULL,
    title = NULL,
    room = NULL,
    description = NULL,
    update_date = DATE '1970-01-01',
    status = 'deleted',
    is_milestone = false,
    published_at = NULL,
    deleted_at = coalesce(item.deleted_at, statement_timestamp()),
    version = item.version + 1,
    content_revision = item.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE item.id = selected_update.id
    AND item.status = 'deletion_pending';

  UPDATE public.projects project
  SET content_revision = project.content_revision + 1,
    version = project.version + 1,
    updated_at = statement_timestamp()
  WHERE project.id = selected_update.project_id
    AND project.lifecycle_status <> 'deleted';

  UPDATE public.deletion_jobs job
  SET status = 'completed', active_order_count = 0,
    lease_owner = NULL, lease_expires_at = NULL,
    completed_at = statement_timestamp(), last_error_code = NULL,
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, metadata
  ) SELECT
    'system', NULL, 'update.deletion_completed', 'deletion_job', selected_job.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', selected_update.project_id,
      'updateId', selected_update.id,
      'assetManifestSha256', selected_job.asset_manifest_sha256,
      'retentionPolicyVersion', selected_job.retention_policy_version
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_events event
    WHERE event.action = 'update.deletion_completed'
      AND event.resource_type = 'deletion_job'
      AND event.resource_id = selected_job.id
  );
  RETURN 'completed';
END
$function$;

-- Exhausted update cleanup is a terminal manual-review queue. Account and
-- project jobs preserve their existing dead-letter behavior.
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
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
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
    SET status = CASE WHEN move_to_dead_letter THEN 'failed' ELSE 'retry' END,
      attempt_count = asset.attempt_count + 1,
      last_error_code = processing_failure_code,
      updated_at = statement_timestamp()
    WHERE asset.id = target_deletion_asset_id
      AND asset.deletion_job_id = target_job_id;
  END IF;

  UPDATE public.deletion_jobs job
  SET status = CASE
        WHEN move_to_dead_letter AND selected_job.kind = 'update' THEN 'manual_review'
        WHEN move_to_dead_letter THEN 'dead_letter'
        ELSE 'retry_scheduled'
      END,
    available_at = CASE WHEN move_to_dead_letter THEN job.available_at
      ELSE clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds) END,
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

CREATE OR REPLACE FUNCTION public.app_account_worker_finalize_deletion_job(
  worker_identifier text,
  target_job_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE selected_kind public.deletion_kind;
BEGIN
  SELECT job.kind INTO selected_kind
  FROM public.deletion_jobs job
  WHERE job.id = target_job_id
    AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF selected_kind = 'account' THEN
    RETURN public.app_account_worker_finalize_deletion(worker_identifier, target_job_id);
  END IF;
  IF selected_kind = 'project' THEN
    RETURN public.app_project_worker_finalize_deletion(worker_identifier, target_job_id);
  END IF;
  IF selected_kind = 'update' THEN
    RETURN public.app_update_worker_finalize_deletion(worker_identifier, target_job_id);
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.app_request_update_deletion(uuid, uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_update_worker_finalize_deletion(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_claim_deletion(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_fail_deletion(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_finalize_deletion_job(text, uuid) FROM PUBLIC;

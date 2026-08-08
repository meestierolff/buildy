-- Project erasure is an owner-bound, resumable saga. The browser can only
-- request the transition; a least-privilege account-lifecycle worker removes
-- one private object per lease and redacts the database only after readback
-- confirms that every non-archived object is absent.

CREATE OR REPLACE FUNCTION public.app_request_project_deletion(
  target_project_id uuid,
  expected_project_version integer,
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
  selected_project public.projects%ROWTYPE;
  selected_job public.deletion_jobs%ROWTYPE;
  count_active_orders integer;
  manifest_hash text;
  replayed_request boolean := false;
BEGIN
  IF actor IS NULL
    OR target_project_id IS NULL
    OR expected_project_version IS NULL
    OR expected_project_version < 1
    OR scoped_idempotency_key IS NULL
    OR scoped_idempotency_key !~ '^project-command:v1:project[.]delete:[0-9a-f]{64}$'
    OR policy_version IS NULL
    OR policy_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid project deletion request';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('project-deletion:' || target_project_id::text, 0)
  );

  -- A committed request remains safely replayable after the project becomes
  -- invisible. Ownership is proven by requested_by_id, never by client input.
  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.kind = 'project'
    AND job.target_id = target_project_id
    AND job.requested_by_id = actor
    AND job.idempotency_key = scoped_idempotency_key
  LIMIT 1
  FOR UPDATE;
  replayed_request := FOUND;
  IF FOUND AND selected_job.status <> 'blocked_active_order' THEN
    RETURN QUERY SELECT
      selected_job.id,
      selected_job.status,
      selected_job.active_order_count,
      true;
    RETURN;
  END IF;

  SELECT project.* INTO selected_project
  FROM public.projects project
  WHERE project.id = target_project_id
    AND project.owner_id = actor
    AND project.lifecycle_status = 'active'
    AND project.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project is not active or owned by actor';
  END IF;
  IF selected_project.version <> expected_project_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'project version conflict';
  END IF;

  IF selected_job.id IS NULL THEN
    SELECT job.* INTO selected_job
    FROM public.deletion_jobs job
    WHERE job.kind = 'project'
      AND job.target_id = target_project_id
      AND job.status NOT IN ('completed', 'dead_letter')
    ORDER BY job.created_at DESC, job.id DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  SELECT count(*)::integer INTO count_active_orders
  FROM public.photobook_orders orders
  WHERE orders.project_id = target_project_id
    AND public.app_account_order_is_active(orders);

  IF selected_job.id IS NULL THEN
    INSERT INTO public.deletion_jobs (
      kind, target_id, requested_by_id, status, idempotency_key,
      retention_policy_version, active_order_count, available_at
    ) VALUES (
      'project', target_project_id, actor,
      CASE WHEN count_active_orders > 0 THEN 'blocked_active_order' ELSE 'requested' END,
      scoped_idempotency_key, policy_version, count_active_orders,
      statement_timestamp()
    ) RETURNING * INTO selected_job;
  ELSE
    UPDATE public.deletion_jobs job
    SET status = CASE
          WHEN count_active_orders > 0 THEN 'blocked_active_order'
          ELSE 'requested'
        END,
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
      'user', actor, 'project.deletion_blocked', 'deletion_job', selected_job.id,
      jsonb_build_object(
        'schemaVersion', 1,
        'projectId', target_project_id,
        'activeOrderCount', count_active_orders,
        'retentionPolicyVersion', policy_version
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_events event
      WHERE event.action = 'project.deletion_blocked'
        AND event.resource_type = 'deletion_job'
        AND event.resource_id = selected_job.id
    );
    RETURN QUERY SELECT
      selected_job.id,
      selected_job.status,
      count_active_orders,
      replayed_request;
    RETURN;
  END IF;

  INSERT INTO public.deletion_assets (
    deletion_job_id, media_asset_id, storage_provider, bucket, object_key,
    expected_sha256, status
  )
  SELECT selected_job.id, asset.id, asset.storage_provider, asset.bucket,
    asset.object_key, asset.sha256, 'pending'
  FROM public.media_assets asset
  WHERE asset.project_id = target_project_id
    AND asset.status <> 'deleted'
    -- The exact proof used by any physical order is a retained fiscal and
    -- customer-support record. All other project objects enter the manifest.
    AND NOT EXISTS (
      SELECT 1
      FROM public.photobook_revisions revision
      JOIN public.photobook_orders orders ON orders.proof_revision_id = revision.id
      WHERE revision.pdf_asset_id = asset.id
        AND orders.project_id = target_project_id
    )
  ON CONFLICT (deletion_job_id, storage_provider, bucket, object_key) DO NOTHING;

  SELECT encode(digest(coalesce(string_agg(
    asset.storage_provider || E'\n' || asset.bucket || E'\n' || asset.object_key || E'\n'
      || coalesce(asset.expected_sha256, ''),
    E'\n---\n' ORDER BY asset.storage_provider, asset.bucket, asset.object_key
  ), ''), 'sha256'), 'hex')
  INTO manifest_hash
  FROM public.deletion_assets asset
  WHERE asset.deletion_job_id = selected_job.id;

  -- A previously claimed renderer loses its event lease before it can commit.
  -- The renderer's compensation path removes a PDF written after that point.
  UPDATE public.outbox_events event
  SET status = 'dead_letter',
    payload = jsonb_build_object('schemaVersion', 1, 'reason', 'PROJECT_DELETION'),
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error_code = 'PROJECT_DELETION',
    updated_at = statement_timestamp()
  WHERE event.aggregate_type = 'photobook_proof'
    AND event.aggregate_id IN (
      SELECT revision.id
      FROM public.photobook_revisions revision
      WHERE revision.project_id = target_project_id
        AND NOT EXISTS (
          SELECT 1 FROM public.photobook_orders orders
          WHERE orders.proof_revision_id = revision.id
        )
    )
    AND event.status IN ('pending', 'claimed', 'retry');

  UPDATE public.media_assets asset
  SET status = 'deletion_pending', is_current = false,
    version = asset.version + 1, updated_at = statement_timestamp()
  WHERE asset.id IN (
    SELECT manifest.media_asset_id
    FROM public.deletion_assets manifest
    WHERE manifest.deletion_job_id = selected_job.id
      AND manifest.media_asset_id IS NOT NULL
  )
    AND asset.status NOT IN ('deletion_pending', 'deleted')
    AND NOT EXISTS (
      SELECT 1 FROM public.photobook_revisions revision
      WHERE revision.pdf_asset_id = asset.id
        AND revision.status IN ('approved', 'locked', 'invalidated')
    );

  UPDATE public.projects project
  SET lifecycle_status = 'deletion_pending', visibility = 'private',
    version = project.version + 1,
    content_revision = project.content_revision + 1,
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
  ) VALUES (
    'user', actor, 'project.deletion_requested', 'deletion_job', selected_job.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', target_project_id,
      'assetManifestSha256', manifest_hash,
      'retentionPolicyVersion', policy_version
    )
  );

  RETURN QUERY SELECT selected_job.id, selected_job.status, 0, false;
END
$function$;

-- Extend the existing account-lifecycle claimant without broadening its table
-- privileges. Account and project jobs share the same asset deletion protocol.
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
    WHERE job.kind IN ('account', 'project')
      AND (
        (
          job.kind = 'account'
          AND EXISTS (
            SELECT 1 FROM public.app_users account
            WHERE account.id = job.target_id AND account.status = 'deletion_pending'
          )
        )
        OR (
          job.kind = 'project'
          AND EXISTS (
            SELECT 1 FROM public.projects project
            WHERE project.id = job.target_id AND project.lifecycle_status = 'deletion_pending'
          )
        )
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

CREATE OR REPLACE FUNCTION public.app_project_worker_finalize_deletion(
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
  count_active_orders integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid project deletion finalization';
  END IF;

  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.id = target_job_id
    AND job.kind = 'project'
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
    hashtextextended('project-deletion:' || selected_job.target_id::text, 0)
  );
  PERFORM 1
  FROM public.projects project
  WHERE project.id = selected_job.target_id
    AND project.owner_id = selected_job.requested_by_id
    AND project.lifecycle_status = 'deletion_pending'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*)::integer INTO count_active_orders
  FROM public.photobook_orders orders
  WHERE orders.project_id = selected_job.target_id
    AND public.app_account_order_is_active(orders);
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
  PERFORM set_config('app.actor_id', selected_job.requested_by_id::text, true);

  DELETE FROM public.notifications notification
  WHERE notification.project_id = selected_job.target_id;
  DELETE FROM public.reactions reaction
  WHERE reaction.project_id = selected_job.target_id;
  DELETE FROM public.comment_mentions mention
  WHERE mention.comment_id IN (
    SELECT comment.id FROM public.comments comment
    WHERE comment.project_id = selected_job.target_id
  );
  UPDATE public.comments comment
  SET body = '[verwijderd]', status = 'deleted',
    deleted_at = coalesce(comment.deleted_at, statement_timestamp()),
    version = comment.version + 1, updated_at = statement_timestamp()
  WHERE comment.project_id = selected_job.target_id
    AND (comment.status <> 'deleted' OR comment.body <> '[verwijderd]');

  DELETE FROM public.project_access_requests request
  WHERE request.project_id = selected_job.target_id;
  DELETE FROM public.project_followers follower
  WHERE follower.project_id = selected_job.target_id;
  DELETE FROM public.budget_items item
  WHERE item.project_id = selected_job.target_id;
  DELETE FROM public.project_budgets budget
  WHERE budget.project_id = selected_job.target_id;
  DELETE FROM public.floorplan_pins pin
  WHERE pin.project_id = selected_job.target_id;
  DELETE FROM public.floorplans floorplan
  WHERE floorplan.project_id = selected_job.target_id;
  DELETE FROM public.update_media link
  WHERE link.project_id = selected_job.target_id;
  DELETE FROM public.photobook_exclusions exclusion
  WHERE exclusion.project_id = selected_job.target_id;
  DELETE FROM public.photobook_settings setting
  WHERE setting.project_id = selected_job.target_id;

  UPDATE public.outbox_events event
  SET status = 'dead_letter',
    payload = jsonb_build_object('schemaVersion', 1, 'reason', 'PROJECT_DELETION'),
    lease_owner = NULL, lease_expires_at = NULL,
    last_error_code = 'PROJECT_DELETION', updated_at = statement_timestamp()
  WHERE event.aggregate_type = 'photobook_proof'
    AND event.aggregate_id IN (
      SELECT revision.id FROM public.photobook_revisions revision
      WHERE revision.project_id = selected_job.target_id
        AND NOT EXISTS (
          SELECT 1 FROM public.photobook_orders orders
          WHERE orders.proof_revision_id = revision.id
        )
    );

  DELETE FROM public.photobook_revisions revision
  WHERE revision.project_id = selected_job.target_id
    AND NOT EXISTS (
      SELECT 1 FROM public.photobook_orders orders
      WHERE orders.proof_revision_id = revision.id
    );
  DELETE FROM public.photobook_drafts draft
  WHERE draft.project_id = selected_job.target_id
    AND NOT EXISTS (
      SELECT 1 FROM public.photobook_revisions revision
      WHERE revision.draft_id = draft.id
    );

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
  SET phase_id = NULL, title = NULL, room = NULL, description = NULL,
    status = 'deleted', is_milestone = false,
    deleted_at = coalesce(item.deleted_at, statement_timestamp()),
    version = item.version + 1,
    content_revision = item.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE item.project_id = selected_job.target_id
    AND (
      item.status <> 'deleted'
      OR item.title IS NOT NULL
      OR item.room IS NOT NULL
      OR item.description IS NOT NULL
    );
  DELETE FROM public.project_phases phase
  WHERE phase.project_id = selected_job.target_id;
  DELETE FROM public.project_private_details details
  WHERE details.project_id = selected_job.target_id;

  UPDATE public.projects project
  SET slug = 'verwijderd-' || replace(project.id::text, '-', ''),
    title = 'Verwijderd project', description = NULL, project_type = NULL,
    start_date = NULL, expected_end_date = NULL, completed_at = NULL,
    visibility = 'private', lifecycle_status = 'deleted',
    progress_percentage = 0, published_at = NULL,
    deleted_at = statement_timestamp(),
    version = project.version + 1,
    content_revision = project.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE project.id = selected_job.target_id
    AND project.owner_id = selected_job.requested_by_id
    AND project.lifecycle_status = 'deletion_pending';

  UPDATE public.deletion_jobs job
  SET status = 'completed', active_order_count = 0,
    lease_owner = NULL, lease_expires_at = NULL,
    completed_at = statement_timestamp(), last_error_code = NULL,
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    'system', NULL, 'project.deletion_completed', 'deletion_job', selected_job.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', selected_job.target_id,
      'assetManifestSha256', selected_job.asset_manifest_sha256,
      'retentionPolicyVersion', selected_job.retention_policy_version
    )
  );
  RETURN 'completed';
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
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.app_request_project_deletion(uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_project_worker_finalize_deletion(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_finalize_deletion_job(text, uuid) FROM PUBLIC;

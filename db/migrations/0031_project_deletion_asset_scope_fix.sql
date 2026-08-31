-- Project deletion may only mark assets that entered the deletion manifest.
-- Ordered or locked proof assets remain retained records and must stay untouched.

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
      CASE
        WHEN count_active_orders > 0 THEN 'blocked_active_order'::public.deletion_status
        ELSE 'requested'::public.deletion_status
      END,
      scoped_idempotency_key, policy_version, count_active_orders,
      statement_timestamp()
    ) RETURNING * INTO selected_job;
  ELSE
    UPDATE public.deletion_jobs job
    SET status = CASE
          WHEN count_active_orders > 0 THEN 'blocked_active_order'::public.deletion_status
          ELSE 'requested'::public.deletion_status
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
  ) ON CONFLICT DO NOTHING;

  RETURN QUERY SELECT selected_job.id, selected_job.status, 0, replayed_request;
END
$function$;
-- Repair lifecycle SECURITY DEFINER functions after schema and PostgreSQL
-- behavior changes exposed enum-cast gaps and composite-field lookup issues.

CREATE OR REPLACE FUNCTION public.app_request_account_deletion(
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
  selected_job public.deletion_jobs%ROWTYPE;
  count_active_orders integer;
  manifest_hash text;
BEGIN
  IF actor IS NULL
    OR scoped_idempotency_key IS NULL
    OR scoped_idempotency_key !~ '^[0-9a-f]{64}$'
    OR policy_version IS NULL
    OR policy_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid account deletion request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor::text, 0));
  PERFORM 1
  FROM public.app_users account
  WHERE account.id = actor
    AND account.status = 'active'
    AND account.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account is not active';
  END IF;

  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.requested_by_id = actor
    AND job.idempotency_key = scoped_idempotency_key
  LIMIT 1;
  IF FOUND AND selected_job.status <> 'blocked_active_order' THEN
    RETURN QUERY SELECT selected_job.id, selected_job.status, selected_job.active_order_count, true;
    RETURN;
  END IF;

  IF NOT FOUND THEN
    SELECT job.* INTO selected_job
    FROM public.deletion_jobs job
    WHERE job.kind = 'account'
      AND job.target_id = actor
      AND job.status NOT IN ('completed', 'dead_letter')
    ORDER BY job.created_at DESC, job.id DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  SELECT count(*)::integer INTO count_active_orders
  FROM public.photobook_orders orders
  WHERE orders.owner_id = actor
    AND public.app_account_order_is_active(orders);

  IF selected_job.id IS NULL THEN
    INSERT INTO public.deletion_jobs (
      kind, target_id, requested_by_id, status, idempotency_key,
      retention_policy_version, active_order_count, available_at
    ) VALUES (
      'account', actor, actor,
      CASE
        WHEN count_active_orders > 0 THEN 'blocked_active_order'::public.deletion_status
        ELSE 'requested'::public.deletion_status
      END,
      scoped_idempotency_key, policy_version, count_active_orders,
      statement_timestamp()
    ) RETURNING * INTO selected_job;
  ELSE
    UPDATE public.deletion_jobs job
    SET
      status = CASE
        WHEN count_active_orders > 0 THEN 'blocked_active_order'::public.deletion_status
        ELSE 'requested'::public.deletion_status
      END,
      active_order_count = count_active_orders,
      retention_policy_version = policy_version,
      available_at = statement_timestamp(),
      last_error_code = NULL,
      updated_at = statement_timestamp()
    WHERE job.id = selected_job.id
    RETURNING * INTO selected_job;
  END IF;

  IF count_active_orders > 0 THEN
    INSERT INTO public.audit_events (
      actor_kind, actor_user_id, action, resource_type, resource_id, metadata
    ) SELECT
      'user', actor, 'account.deletion_blocked', 'deletion_job', selected_job.id,
      jsonb_build_object(
        'schemaVersion', 1,
        'activeOrderCount', count_active_orders,
        'retentionPolicyVersion', policy_version
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_events event
      WHERE event.action = 'account.deletion_blocked'
        AND event.resource_type = 'deletion_job'
        AND event.resource_id = selected_job.id
    );
    RETURN QUERY SELECT selected_job.id, selected_job.status, count_active_orders, selected_job.idempotency_key = scoped_idempotency_key;
    RETURN;
  END IF;

  INSERT INTO public.deletion_assets (
    deletion_job_id, media_asset_id, storage_provider, bucket, object_key,
    expected_sha256, status
  )
  SELECT
    selected_job.id, asset.id, asset.storage_provider, asset.bucket,
    asset.object_key, asset.sha256, 'pending'
  FROM public.media_assets asset
  WHERE asset.owner_id = actor
    AND asset.status <> 'deleted'
    AND NOT EXISTS (
      SELECT 1
      FROM public.photobook_revisions revision
      JOIN public.photobook_orders orders ON orders.proof_revision_id = revision.id
      WHERE revision.pdf_asset_id = asset.id
    )
  ON CONFLICT (deletion_job_id, storage_provider, bucket, object_key) DO NOTHING;

  SELECT encode(digest(coalesce(string_agg(
    asset.storage_provider || E'\n' || asset.bucket || E'\n' || asset.object_key || E'\n' || coalesce(asset.expected_sha256, ''),
    E'\n---\n' ORDER BY asset.storage_provider, asset.bucket, asset.object_key
  ), ''), 'sha256'), 'hex')
  INTO manifest_hash
  FROM public.deletion_assets asset
  WHERE asset.deletion_job_id = selected_job.id;

  UPDATE public.export_jobs export
  SET
    status = 'deleted',
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = 'ACCOUNT_DELETION',
    updated_at = statement_timestamp()
  WHERE export.user_id = actor
    AND export.status IN ('requested', 'processing', 'retry_scheduled', 'ready', 'expired');

  UPDATE public.profiles profile
  SET avatar_asset_id = NULL, version = profile.version + 1, updated_at = statement_timestamp()
  WHERE profile.user_id = actor
    AND profile.avatar_asset_id IS NOT NULL;

  UPDATE public.projects project
  SET
    lifecycle_status = 'deletion_pending',
    visibility = 'private',
    version = project.version + 1,
    content_revision = project.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE project.owner_id = actor
    AND project.lifecycle_status = 'active';

  UPDATE public.app_users account
  SET
    status = 'deletion_pending',
    deletion_requested_at = statement_timestamp(),
    authz_version = account.authz_version + 1,
    version = account.version + 1,
    updated_at = statement_timestamp()
  WHERE account.id = actor
    AND account.status = 'active';

  UPDATE public.deletion_jobs job
  SET
    status = 'deletion_pending',
    asset_manifest_sha256 = manifest_hash,
    active_order_count = 0,
    available_at = statement_timestamp(),
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id
  RETURNING * INTO selected_job;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, metadata
  ) SELECT
    'user', actor, 'account.deletion_requested', 'deletion_job', selected_job.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'assetManifestSha256', manifest_hash,
      'retentionPolicyVersion', policy_version
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_events event
    WHERE event.action = 'account.deletion_requested'
      AND event.resource_type = 'deletion_job'
      AND event.resource_id = selected_job.id
  );

  RETURN QUERY SELECT selected_job.id, selected_job.status, 0, false;
END
$function$;

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
    RETURN QUERY SELECT selected_job.id, selected_job.status,
      selected_job.active_order_count, true;
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

  UPDATE public.media_assets asset
  SET status = 'deletion_pending', is_current = false,
    version = asset.version + 1, updated_at = statement_timestamp()
  WHERE asset.project_id = target_project_id
    AND asset.status NOT IN ('deletion_pending', 'deleted');

  UPDATE public.projects project
  SET lifecycle_status = 'deletion_pending',
    visibility = 'private',
    content_revision = project.content_revision + 1,
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
    'user', actor, 'project.deletion_requested', 'deletion_job', selected_job.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', target_project_id,
      'assetManifestSha256', manifest_hash,
      'retentionPolicyVersion', policy_version
    )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_events event
    WHERE event.action = 'project.deletion_requested'
      AND event.resource_type = 'deletion_job'
      AND event.resource_id = selected_job.id
  );

  RETURN QUERY SELECT selected_job.id, selected_job.status, 0, replayed_request;
END
$function$;

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

CREATE OR REPLACE FUNCTION public.app_account_worker_begin_export(
  worker_identifier text,
  target_job_id uuid
)
RETURNS TABLE (
  payload jsonb,
  source_assets jsonb,
  requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_job public.export_jobs%ROWTYPE;
  selected_auth_user_id text;
  selected_user_id uuid;
  selected_export_asset_id uuid;
  selected_include_media boolean;
  selected_requested_at timestamptz;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export worker input';
  END IF;

  SELECT job.* INTO selected_job
  FROM public.export_jobs job
  JOIN public.app_users account
    ON account.id = job.user_id
   AND account.status = 'active'
   AND account.deleted_at IS NULL
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  selected_user_id := selected_job.user_id;
  selected_export_asset_id := selected_job.export_asset_id;
  selected_include_media := selected_job.include_media;
  selected_requested_at := selected_job.created_at;

  SELECT mapping.auth_user_id INTO selected_auth_user_id
  FROM public.auth_identity_mappings mapping
  WHERE mapping.app_user_id = selected_user_id
    AND mapping.migration_status = 'linked'
    AND mapping.auth_user_id IS NOT NULL
  LIMIT 1;

  RETURN QUERY SELECT
    jsonb_build_object(
      'schemaVersion', 1,
      'requestedAt', selected_requested_at,
      'account', (
        SELECT (to_jsonb(account) - 'authz_version') || jsonb_build_object(
          'auth', (
            SELECT jsonb_build_object(
              'id', auth_user.id,
              'name', auth_user.name,
              'email', auth_user.email,
              'emailVerified', auth_user.email_verified,
              'createdAt', auth_user.created_at,
              'updatedAt', auth_user.updated_at
            )
            FROM public.auth_users auth_user
            WHERE auth_user.id = selected_auth_user_id
          ),
          'sessions', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', session.id,
              'createdAt', session.created_at,
              'updatedAt', session.updated_at,
              'expiresAt', session.expires_at,
              'ipAddress', session.ip_address,
              'userAgent', session.user_agent
            ) ORDER BY session.created_at, session.id)
            FROM public.auth_sessions session
            WHERE session.user_id = selected_auth_user_id
          ), '[]'::jsonb)
        )
        FROM public.app_users account
        WHERE account.id = selected_user_id
      ),
      'profile', (
        SELECT to_jsonb(profile)
        FROM public.profiles profile
        WHERE profile.user_id = selected_user_id
      ),
      'projects', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.projects row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'projectPrivateDetails', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id)
        FROM public.project_private_details row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'projectPhases', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.sort_order, row.id)
        FROM public.project_phases row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_user_id), '[]'::jsonb),
      'updates', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.update_date, row.sort_order, row.id)
        FROM public.updates row WHERE row.author_id = selected_user_id), '[]'::jsonb),
      'media', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'object_key' - 'upload_idempotency_key') ORDER BY row.created_at, row.id)
        FROM public.media_assets row WHERE row.owner_id = selected_user_id AND row.purpose <> 'export_archive'), '[]'::jsonb),
      'updateMedia', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.update_id, row.sort_order)
        FROM public.update_media row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_user_id), '[]'::jsonb),
      'floorplans', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.sort_order, row.id)
        FROM public.floorplans row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'floorplanPins', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.floorplan_id, row.id)
        FROM public.floorplan_pins row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_user_id), '[]'::jsonb),
      'budgets', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.id)
        FROM public.project_budgets row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'budgetItems', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.sort_order, row.id)
        FROM public.budget_items row WHERE row.created_by_id = selected_user_id), '[]'::jsonb),
      'relationships', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.user_relationships row WHERE row.source_user_id = selected_user_id OR row.target_user_id = selected_user_id), '[]'::jsonb),
      'accessRequests', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.project_access_requests row WHERE row.requester_id = selected_user_id OR row.project_owner_id = selected_user_id), '[]'::jsonb),
      'projectFollowers', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.followed_at, row.project_id)
        FROM public.project_followers row WHERE row.follower_id = selected_user_id OR row.project_owner_id = selected_user_id), '[]'::jsonb),
      'comments', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.comments row WHERE row.author_id = selected_user_id), '[]'::jsonb),
      'mentions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.comment_id)
        FROM public.comment_mentions row WHERE row.mentioned_user_id = selected_user_id), '[]'::jsonb),
      'reactions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.reactions row WHERE row.actor_id = selected_user_id), '[]'::jsonb),
      'notifications', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.notifications row WHERE row.recipient_id = selected_user_id), '[]'::jsonb),
      'photobookSettings', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id)
        FROM public.photobook_settings row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'photobookDrafts', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.photobook_drafts row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'photobookExclusions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.photobook_exclusions row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_user_id), '[]'::jsonb),
      'photobookRevisions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.photobook_revisions row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'photobookOrders', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'idempotency_key' - 'stripe_checkout_session_id' - 'stripe_payment_intent_id' - 'peecho_order_id' - 'fulfilment_lease_owner') ORDER BY row.created_at, row.id)
        FROM public.photobook_orders row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
      'photobookOrderEvents', coalesce((SELECT jsonb_agg(to_jsonb(event) ORDER BY event.created_at, event.id)
        FROM public.photobook_order_events event JOIN public.photobook_orders orders ON orders.id = event.order_id
        WHERE orders.owner_id = selected_user_id), '[]'::jsonb),
      'feedback', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.feedback_submissions row WHERE row.submitted_by_id = selected_user_id), '[]'::jsonb),
      'moderationReports', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.moderation_reports row WHERE row.reporter_id = selected_user_id), '[]'::jsonb),
      'auditEvents', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.audit_events row WHERE row.actor_user_id = selected_user_id), '[]'::jsonb),
      'emailDeliveries', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'provider_message_id') ORDER BY row.created_at, row.id)
        FROM public.email_deliveries row WHERE row.recipient_user_id = selected_user_id), '[]'::jsonb),
      'betaInviteRedemptions', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'reservation_token_hash' - 'auth_user_id') ORDER BY row.created_at, row.id)
        FROM public.beta_invite_redemptions row WHERE row.app_user_id = selected_user_id), '[]'::jsonb)
    ),
    CASE WHEN selected_include_media THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', asset.id,
        'storageProvider', asset.storage_provider,
        'bucket', asset.bucket,
        'objectKey', asset.object_key,
        'contentType', asset.detected_content_type,
        'sizeBytes', asset.size_bytes,
        'sha256', asset.sha256,
        'purpose', asset.purpose
      ) ORDER BY asset.created_at, asset.id)
      FROM public.media_assets asset
      WHERE asset.owner_id = selected_user_id
        AND asset.id <> selected_export_asset_id
        AND asset.status = 'ready'
        AND asset.is_current
        AND asset.purpose NOT IN ('export_archive', 'temporary_upload')
        AND asset.size_bytes IS NOT NULL
        AND asset.sha256 IS NOT NULL
        AND asset.detected_content_type IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    selected_requested_at;
END
$function$;
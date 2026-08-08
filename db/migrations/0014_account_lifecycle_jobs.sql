-- Account data access and erasure are asynchronous, actor-bound workflows.
-- Browser requests can only enqueue work; a dedicated account worker owns the
-- leased SECURITY DEFINER boundaries and has no direct table privileges.

ALTER TYPE public.export_job_status ADD VALUE IF NOT EXISTS 'retry_scheduled';
ALTER TYPE public.export_job_status ADD VALUE IF NOT EXISTS 'dead_letter';

ALTER TABLE public.export_jobs
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz;

ALTER TABLE public.export_jobs
  ADD CONSTRAINT export_jobs_attempt_ck CHECK (attempt_count >= 0),
  ADD CONSTRAINT export_jobs_lease_ck CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL));

CREATE INDEX export_jobs_claim_idx
  ON public.export_jobs (status, available_at, lease_expires_at, created_at);

DROP POLICY IF EXISTS export_jobs_insert_self ON public.export_jobs;
CREATE POLICY export_jobs_insert_self ON public.export_jobs FOR INSERT
WITH CHECK (
  user_id = public.app_actor_id()
  AND status = 'requested'
  AND format = 'zip'
  AND export_asset_id IS NULL
  AND manifest_sha256 IS NULL
  AND expires_at IS NULL
  AND started_at IS NULL
  AND completed_at IS NULL
  AND failure_code IS NULL
  AND attempt_count = 0
  AND lease_owner IS NULL
  AND lease_expires_at IS NULL
);

DROP POLICY IF EXISTS deletion_jobs_select_self ON public.deletion_jobs;
CREATE POLICY deletion_jobs_select_self ON public.deletion_jobs FOR SELECT
USING (requested_by_id = public.app_actor_id());

CREATE OR REPLACE FUNCTION public.app_account_order_is_active(target_order public.photobook_orders)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT NOT (
    (
      target_order.status IN ('expired', 'cancelled')
      AND target_order.payment_status IN ('unpaid', 'failed', 'refunded')
      AND target_order.fulfilment_status IN ('unclaimed', 'failed', 'cancelled')
    )
    OR (
      target_order.status = 'paid'
      AND target_order.payment_status IN ('paid', 'partially_refunded', 'refunded')
      AND target_order.fulfilment_status = 'delivered'
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.app_request_account_export(
  scoped_idempotency_key text,
  include_source_media boolean,
  export_bucket text
)
RETURNS TABLE (
  job_id uuid,
  job_status public.export_job_status,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor uuid := public.app_actor_id();
  selected_job public.export_jobs%ROWTYPE;
  new_job_id uuid := gen_random_uuid();
  new_asset_id uuid := gen_random_uuid();
BEGIN
  IF actor IS NULL
    OR scoped_idempotency_key IS NULL
    OR scoped_idempotency_key !~ '^[0-9a-f]{64}$'
    OR include_source_media IS NULL
    OR export_bucket IS NULL
    OR export_bucket !~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid account export request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-export:' || actor::text, 0));
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
  FROM public.export_jobs job
  WHERE job.user_id = actor
    AND job.idempotency_key = scoped_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT selected_job.id, selected_job.status, true;
    RETURN;
  END IF;

  SELECT job.* INTO selected_job
  FROM public.export_jobs job
  WHERE job.user_id = actor
    AND job.status IN ('requested', 'processing', 'retry_scheduled')
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT selected_job.id, selected_job.status, true;
    RETURN;
  END IF;

  INSERT INTO public.media_assets (
    id, owner_id, project_id, purpose, status, storage_provider, bucket,
    object_key, upload_idempotency_key, claimed_content_type, exif_stripped,
    is_current
  ) VALUES (
    new_asset_id, actor, NULL, 'export_archive', 'processing', 'r2', export_bucket,
    'exports/' || left(new_asset_id::text, 2) || '/' || new_asset_id::text || '/buildy-export.zip',
    'account-export:v1:' || new_job_id::text,
    'application/zip', false, true
  );

  INSERT INTO public.export_jobs (
    id, user_id, idempotency_key, status, format, include_media,
    export_asset_id, available_at
  ) VALUES (
    new_job_id, actor, scoped_idempotency_key, 'requested', 'zip',
    include_source_media, new_asset_id, statement_timestamp()
  ) RETURNING * INTO selected_job;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    'user', actor, 'account.export_requested', 'export_job', selected_job.id,
    jsonb_build_object('schemaVersion', 1, 'includeMedia', include_source_media)
  );

  RETURN QUERY SELECT selected_job.id, selected_job.status, false;
END
$function$;

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
      CASE WHEN count_active_orders > 0 THEN 'blocked_active_order' ELSE 'requested' END,
      scoped_idempotency_key, policy_version, count_active_orders,
      statement_timestamp()
    ) RETURNING * INTO selected_job;
  ELSE
    UPDATE public.deletion_jobs job
    SET
      status = CASE WHEN count_active_orders > 0 THEN 'blocked_active_order' ELSE 'requested' END,
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

  -- Cancel outstanding exports before changing lifecycle state. A concurrently
  -- leased exporter must compensate by deleting any archive it already wrote.
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

CREATE OR REPLACE FUNCTION public.app_account_worker_claim_export(
  worker_identifier text,
  lease_seconds integer
)
RETURNS TABLE (
  job_id uuid,
  user_id uuid,
  export_asset_id uuid,
  object_key text,
  include_media boolean,
  attempt_count integer
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export worker claim';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.export_jobs job
    JOIN public.app_users account
      ON account.id = job.user_id
     AND account.status = 'active'
     AND account.deleted_at IS NULL
    JOIN public.media_assets asset
      ON asset.id = job.export_asset_id
     AND asset.owner_id = job.user_id
     AND asset.purpose = 'export_archive'
     AND asset.status = 'processing'
    WHERE job.status IN ('requested', 'processing', 'retry_scheduled')
      AND job.available_at <= clock_timestamp()
      AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
    ORDER BY job.available_at, job.created_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.export_jobs job
    SET
      status = 'processing',
      attempt_count = job.attempt_count + 1,
      lease_owner = worker_identifier,
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      started_at = coalesce(job.started_at, statement_timestamp()),
      failure_code = NULL,
      updated_at = statement_timestamp()
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*
  )
  SELECT claimed.id, claimed.user_id, claimed.export_asset_id, asset.object_key,
    claimed.include_media, claimed.attempt_count
  FROM claimed
  JOIN public.media_assets asset ON asset.id = claimed.export_asset_id;
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

  SELECT mapping.auth_user_id INTO selected_auth_user_id
  FROM public.auth_identity_mappings mapping
  WHERE mapping.app_user_id = selected_job.user_id
    AND mapping.migration_status = 'linked'
    AND mapping.auth_user_id IS NOT NULL
  LIMIT 1;

  RETURN QUERY SELECT
    jsonb_build_object(
      'schemaVersion', 1,
      'requestedAt', selected_job.created_at,
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
        WHERE account.id = selected_job.user_id
      ),
      'profile', (
        SELECT to_jsonb(profile)
        FROM public.profiles profile
        WHERE profile.user_id = selected_job.user_id
      ),
      'projects', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.projects row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'projectPrivateDetails', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id)
        FROM public.project_private_details row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'projectPhases', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.sort_order, row.id)
        FROM public.project_phases row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_job.user_id), '[]'::jsonb),
      'updates', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.update_date, row.sort_order, row.id)
        FROM public.updates row WHERE row.author_id = selected_job.user_id), '[]'::jsonb),
      'media', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'object_key' - 'upload_idempotency_key') ORDER BY row.created_at, row.id)
        FROM public.media_assets row WHERE row.owner_id = selected_job.user_id AND row.purpose <> 'export_archive'), '[]'::jsonb),
      'updateMedia', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.update_id, row.sort_order)
        FROM public.update_media row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_job.user_id), '[]'::jsonb),
      'floorplans', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.sort_order, row.id)
        FROM public.floorplans row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'floorplanPins', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.floorplan_id, row.id)
        FROM public.floorplan_pins row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_job.user_id), '[]'::jsonb),
      'budgets', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.id)
        FROM public.project_budgets row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'budgetItems', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id, row.sort_order, row.id)
        FROM public.budget_items row WHERE row.created_by_id = selected_job.user_id), '[]'::jsonb),
      'relationships', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.user_relationships row WHERE row.source_user_id = selected_job.user_id OR row.target_user_id = selected_job.user_id), '[]'::jsonb),
      'accessRequests', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.project_access_requests row WHERE row.requester_id = selected_job.user_id OR row.project_owner_id = selected_job.user_id), '[]'::jsonb),
      'projectFollowers', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.followed_at, row.project_id)
        FROM public.project_followers row WHERE row.follower_id = selected_job.user_id OR row.project_owner_id = selected_job.user_id), '[]'::jsonb),
      'comments', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.comments row WHERE row.author_id = selected_job.user_id), '[]'::jsonb),
      'mentions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.comment_id)
        FROM public.comment_mentions row WHERE row.mentioned_user_id = selected_job.user_id), '[]'::jsonb),
      'reactions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.reactions row WHERE row.actor_id = selected_job.user_id), '[]'::jsonb),
      'notifications', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.notifications row WHERE row.recipient_id = selected_job.user_id), '[]'::jsonb),
      'photobookSettings', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.project_id)
        FROM public.photobook_settings row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'photobookDrafts', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.photobook_drafts row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'photobookExclusions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.photobook_exclusions row JOIN public.projects project ON project.id = row.project_id
        WHERE project.owner_id = selected_job.user_id), '[]'::jsonb),
      'photobookRevisions', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.photobook_revisions row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'photobookOrders', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'idempotency_key' - 'stripe_checkout_session_id' - 'stripe_payment_intent_id' - 'peecho_order_id' - 'fulfilment_lease_owner') ORDER BY row.created_at, row.id)
        FROM public.photobook_orders row WHERE row.owner_id = selected_job.user_id), '[]'::jsonb),
      'photobookOrderEvents', coalesce((SELECT jsonb_agg(to_jsonb(event) ORDER BY event.created_at, event.id)
        FROM public.photobook_order_events event JOIN public.photobook_orders orders ON orders.id = event.order_id
        WHERE orders.owner_id = selected_job.user_id), '[]'::jsonb),
      'feedback', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.feedback_submissions row WHERE row.submitted_by_id = selected_job.user_id), '[]'::jsonb),
      'moderationReports', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.moderation_reports row WHERE row.reporter_id = selected_job.user_id), '[]'::jsonb),
      'auditEvents', coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.created_at, row.id)
        FROM public.audit_events row WHERE row.actor_user_id = selected_job.user_id), '[]'::jsonb),
      'emailDeliveries', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'provider_message_id') ORDER BY row.created_at, row.id)
        FROM public.email_deliveries row WHERE row.recipient_user_id = selected_job.user_id), '[]'::jsonb),
      'betaInviteRedemptions', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'reservation_token_hash' - 'auth_user_id') ORDER BY row.created_at, row.id)
        FROM public.beta_invite_redemptions row WHERE row.app_user_id = selected_job.user_id), '[]'::jsonb)
    ),
    CASE WHEN selected_job.include_media THEN coalesce((
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
      WHERE asset.owner_id = selected_job.user_id
        AND asset.id <> selected_job.export_asset_id
        AND asset.status = 'ready'
        AND asset.is_current
        AND asset.purpose NOT IN ('export_archive', 'temporary_upload')
        AND asset.size_bytes IS NOT NULL
        AND asset.sha256 IS NOT NULL
        AND asset.detected_content_type IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    selected_job.created_at;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_finalize_export(
  worker_identifier text,
  target_job_id uuid,
  archive_sha256 text,
  archive_size_bytes bigint,
  archive_manifest_sha256 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_job public.export_jobs%ROWTYPE;
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL
    OR archive_sha256 !~ '^[0-9a-f]{64}$'
    OR archive_manifest_sha256 !~ '^[0-9a-f]{64}$'
    OR archive_size_bytes NOT BETWEEN 1 AND 262144000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export finalization input';
  END IF;

  SELECT job.* INTO selected_job
  FROM public.export_jobs job
  JOIN public.app_users account ON account.id = job.user_id AND account.status = 'active'
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.media_assets asset
  SET
    status = 'ready',
    storage_version = 'account-export-v1',
    detected_content_type = 'application/zip',
    size_bytes = archive_size_bytes,
    sha256 = archive_sha256,
    ready_at = statement_timestamp(),
    failure_code = NULL,
    version = asset.version + 1,
    updated_at = statement_timestamp()
  WHERE asset.id = selected_job.export_asset_id
    AND asset.owner_id = selected_job.user_id
    AND asset.purpose = 'export_archive'
    AND asset.status = 'processing';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RETURN false;
  END IF;

  UPDATE public.export_jobs job
  SET
    status = 'ready',
    manifest_sha256 = archive_manifest_sha256,
    expires_at = statement_timestamp() + interval '7 days',
    completed_at = statement_timestamp(),
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = NULL,
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_fail_export(
  worker_identifier text,
  target_job_id uuid,
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
  selected_asset_id uuid;
  changed_rows integer;
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR target_job_id IS NULL
    OR processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400
    OR move_to_dead_letter IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export failure input';
  END IF;

  UPDATE public.export_jobs job
  SET
    status = CASE WHEN move_to_dead_letter THEN 'dead_letter' ELSE 'retry_scheduled' END,
    available_at = CASE WHEN move_to_dead_letter THEN job.available_at
      ELSE clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds) END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    failure_code = processing_failure_code,
    updated_at = statement_timestamp()
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  RETURNING job.export_asset_id INTO selected_asset_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RETURN false;
  END IF;

  IF move_to_dead_letter THEN
    UPDATE public.media_assets asset
    SET status = 'failed', failure_code = processing_failure_code,
      version = asset.version + 1, updated_at = statement_timestamp()
    WHERE asset.id = selected_asset_id AND asset.status = 'processing';
  END IF;
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_claim_expired_export(
  worker_identifier text,
  lease_seconds integer
)
RETURNS TABLE (job_id uuid, export_asset_id uuid, object_key text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF worker_identifier IS NULL
    OR worker_identifier !~ '^[A-Za-z0-9:_-]{3,120}$'
    OR lease_seconds IS NULL
    OR lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export cleanup claim';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.export_jobs job
    JOIN public.media_assets asset ON asset.id = job.export_asset_id
    WHERE job.status IN ('ready', 'expired')
      AND job.expires_at <= clock_timestamp()
      AND job.available_at <= clock_timestamp()
      AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
    ORDER BY job.expires_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.export_jobs job
    SET status = 'expired', attempt_count = job.attempt_count + 1,
      lease_owner = worker_identifier,
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      updated_at = statement_timestamp()
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.*
  )
  SELECT claimed.id, claimed.export_asset_id, asset.object_key, claimed.attempt_count
  FROM claimed JOIN public.media_assets asset ON asset.id = claimed.export_asset_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_finalize_export_cleanup(
  worker_identifier text,
  target_job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_asset_id uuid;
  changed_rows integer;
BEGIN
  UPDATE public.export_jobs job
  SET status = 'deleted', lease_owner = NULL, lease_expires_at = NULL,
    failure_code = NULL, updated_at = statement_timestamp()
  WHERE job.id = target_job_id
    AND job.status = 'expired'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  RETURNING job.export_asset_id INTO selected_asset_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN RETURN false; END IF;

  UPDATE public.media_assets asset
  SET status = 'deleted', is_current = false, deleted_at = statement_timestamp(),
    version = asset.version + 1, updated_at = statement_timestamp()
  WHERE asset.id = selected_asset_id AND asset.purpose = 'export_archive';
  RETURN true;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_fail_export_cleanup(
  worker_identifier text,
  target_job_id uuid,
  processing_failure_code text,
  retry_delay_seconds integer,
  move_to_dead_letter boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE changed_rows integer;
BEGIN
  IF processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid export cleanup failure input';
  END IF;
  UPDATE public.export_jobs job
  SET status = CASE WHEN move_to_dead_letter THEN 'dead_letter' ELSE 'expired' END,
    available_at = clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds),
    lease_owner = NULL, lease_expires_at = NULL,
    failure_code = processing_failure_code, updated_at = statement_timestamp()
  WHERE job.id = target_job_id AND job.status = 'expired'
    AND job.lease_owner = worker_identifier AND job.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

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
    JOIN public.app_users account ON account.id = job.target_id
      AND account.status = 'deletion_pending'
    WHERE job.kind = 'account'
      AND job.status IN ('deletion_pending', 'storage_cleanup', 'retry_scheduled')
      AND job.available_at <= clock_timestamp()
      AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
    ORDER BY job.available_at, job.created_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.deletion_jobs job
    SET status = 'storage_cleanup', attempt_count = job.attempt_count + 1,
      lease_owner = worker_identifier,
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => lease_seconds),
      started_at = coalesce(job.started_at, statement_timestamp()),
      last_error_code = NULL, updated_at = statement_timestamp()
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.*
  )
  SELECT claimed.id, claimed.target_id, claimed.attempt_count FROM claimed;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_begin_deletion(
  worker_identifier text,
  target_job_id uuid
)
RETURNS TABLE (
  deletion_asset_id uuid,
  media_asset_id uuid,
  storage_provider text,
  bucket text,
  object_key text,
  expected_sha256 text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RETURN QUERY
  SELECT asset.id, asset.media_asset_id, asset.storage_provider, asset.bucket,
    asset.object_key, asset.expected_sha256, asset.attempt_count
  FROM public.deletion_jobs job
  JOIN public.deletion_assets asset ON asset.deletion_job_id = job.id
  WHERE job.id = target_job_id
    AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
    AND asset.status IN ('pending', 'retry', 'deleted')
  ORDER BY asset.created_at, asset.id
  LIMIT 1
  FOR UPDATE OF job, asset;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_verify_deletion_asset(
  worker_identifier text,
  target_job_id uuid,
  target_deletion_asset_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_media_id uuid;
  changed_rows integer;
BEGIN
  UPDATE public.deletion_assets asset
  SET status = 'verified', verified_at = statement_timestamp(),
    last_error_code = NULL, updated_at = statement_timestamp()
  FROM public.deletion_jobs job
  WHERE asset.id = target_deletion_asset_id
    AND asset.deletion_job_id = target_job_id
    AND asset.status IN ('pending', 'retry', 'deleted')
    AND job.id = asset.deletion_job_id
    AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
  RETURNING asset.media_asset_id INTO selected_media_id;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN RETURN false; END IF;

  -- Protected proof rows are removed during database redaction. Ordered proof
  -- assets never enter deletion_assets and remain under legal retention.
  UPDATE public.media_assets media
  SET status = 'deleted', is_current = false, deleted_at = statement_timestamp(),
    version = media.version + 1, updated_at = statement_timestamp()
  WHERE media.id = selected_media_id
    AND NOT EXISTS (
      SELECT 1 FROM public.photobook_revisions revision
      WHERE revision.pdf_asset_id = media.id
        AND revision.status IN ('approved', 'locked', 'invalidated')
    );

  UPDATE public.deletion_jobs job
  SET status = 'storage_cleanup', available_at = statement_timestamp(),
    lease_owner = NULL, lease_expires_at = NULL, updated_at = statement_timestamp()
  WHERE job.id = target_job_id AND job.lease_owner = worker_identifier;
  RETURN true;
END
$function$;

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
DECLARE changed_rows integer;
BEGIN
  IF processing_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR retry_delay_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid deletion failure input';
  END IF;
  IF target_deletion_asset_id IS NOT NULL THEN
    UPDATE public.deletion_assets asset
    SET status = CASE WHEN move_to_dead_letter THEN 'failed' ELSE 'retry' END,
      attempt_count = asset.attempt_count + 1,
      last_error_code = processing_failure_code, updated_at = statement_timestamp()
    WHERE asset.id = target_deletion_asset_id AND asset.deletion_job_id = target_job_id;
  END IF;
  UPDATE public.deletion_jobs job
  SET status = CASE WHEN move_to_dead_letter THEN 'dead_letter' ELSE 'retry_scheduled' END,
    available_at = clock_timestamp() + pg_catalog.make_interval(secs => retry_delay_seconds),
    lease_owner = NULL, lease_expires_at = NULL,
    last_error_code = processing_failure_code, updated_at = statement_timestamp()
  WHERE job.id = target_job_id AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier AND job.lease_expires_at > clock_timestamp();
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows = 1;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_account_worker_finalize_deletion(
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
  auth_user_ids text[];
BEGIN
  SELECT job.* INTO selected_job
  FROM public.deletion_jobs job
  WHERE job.id = target_job_id
    AND job.kind = 'account'
    AND job.status = 'storage_cleanup'
    AND job.lease_owner = worker_identifier
    AND job.lease_expires_at > clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM public.deletion_assets asset
      WHERE asset.deletion_job_id = job.id AND asset.status <> 'verified'
    )
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*)::integer INTO count_active_orders
  FROM public.photobook_orders orders
  WHERE orders.owner_id = selected_job.target_id
    AND public.app_account_order_is_active(orders);
  IF count_active_orders > 0 THEN
    UPDATE public.deletion_jobs job
    SET status = 'blocked_active_order', active_order_count = count_active_orders,
      lease_owner = NULL, lease_expires_at = NULL,
      last_error_code = 'ACTIVE_ORDER', updated_at = statement_timestamp()
    WHERE job.id = selected_job.id;
    RETURN 'blocked_active_order';
  END IF;

  UPDATE public.deletion_jobs SET status = 'database_redaction', updated_at = statement_timestamp()
  WHERE id = selected_job.id;
  PERFORM set_config('app.actor_id', selected_job.target_id::text, true);

  DELETE FROM public.notifications notification
  WHERE notification.recipient_id = selected_job.target_id
    OR notification.actor_id = selected_job.target_id
    OR notification.project_id IN (SELECT id FROM public.projects WHERE owner_id = selected_job.target_id);
  DELETE FROM public.reactions reaction
  WHERE reaction.actor_id = selected_job.target_id
    OR reaction.project_id IN (SELECT id FROM public.projects WHERE owner_id = selected_job.target_id);
  DELETE FROM public.comment_mentions mention
  WHERE mention.mentioned_user_id = selected_job.target_id
    OR mention.comment_id IN (SELECT id FROM public.comments WHERE author_id = selected_job.target_id);
  UPDATE public.comments comment
  SET body = '[verwijderd]', status = 'deleted', deleted_at = statement_timestamp(),
    version = comment.version + 1, updated_at = statement_timestamp()
  WHERE comment.author_id = selected_job.target_id AND comment.status <> 'deleted';

  DELETE FROM public.user_relationships relationship
  WHERE relationship.source_user_id = selected_job.target_id OR relationship.target_user_id = selected_job.target_id;
  DELETE FROM public.project_access_requests request
  WHERE request.requester_id = selected_job.target_id OR request.project_owner_id = selected_job.target_id;
  DELETE FROM public.project_followers follower
  WHERE follower.follower_id = selected_job.target_id OR follower.project_owner_id = selected_job.target_id;
  DELETE FROM public.budget_items item WHERE item.created_by_id = selected_job.target_id;
  DELETE FROM public.project_budgets budget WHERE budget.owner_id = selected_job.target_id;
  DELETE FROM public.floorplan_pins pin
  WHERE pin.project_id IN (SELECT id FROM public.projects WHERE owner_id = selected_job.target_id);
  DELETE FROM public.floorplans floorplan WHERE floorplan.owner_id = selected_job.target_id;
  DELETE FROM public.update_media link
  WHERE link.project_id IN (SELECT id FROM public.projects WHERE owner_id = selected_job.target_id);
  DELETE FROM public.photobook_exclusions exclusion
  WHERE exclusion.project_id IN (SELECT id FROM public.projects WHERE owner_id = selected_job.target_id);
  DELETE FROM public.photobook_settings setting WHERE setting.owner_id = selected_job.target_id;

  DELETE FROM public.outbox_events event
  WHERE event.aggregate_type = 'photobook_proof'
    AND event.aggregate_id IN (
      SELECT revision.id FROM public.photobook_revisions revision
      WHERE revision.owner_id = selected_job.target_id
        AND NOT EXISTS (SELECT 1 FROM public.photobook_orders orders WHERE orders.proof_revision_id = revision.id)
    );
  DELETE FROM public.photobook_revisions revision
  WHERE revision.owner_id = selected_job.target_id
    AND NOT EXISTS (SELECT 1 FROM public.photobook_orders orders WHERE orders.proof_revision_id = revision.id);
  DELETE FROM public.photobook_drafts draft
  WHERE draft.owner_id = selected_job.target_id
    AND NOT EXISTS (SELECT 1 FROM public.photobook_revisions revision WHERE revision.draft_id = draft.id);

  UPDATE public.media_assets media
  SET status = 'deleted', is_current = false, deleted_at = statement_timestamp(),
    version = media.version + 1, updated_at = statement_timestamp()
  WHERE media.id IN (
    SELECT asset.media_asset_id FROM public.deletion_assets asset
    WHERE asset.deletion_job_id = selected_job.id AND asset.status = 'verified'
      AND asset.media_asset_id IS NOT NULL
  ) AND media.status <> 'deleted';

  UPDATE public.updates item
  SET phase_id = NULL, title = NULL, room = NULL, description = NULL,
    status = 'deleted', is_milestone = false,
    deleted_at = coalesce(item.deleted_at, statement_timestamp()),
    version = item.version + 1, content_revision = item.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE item.author_id = selected_job.target_id AND item.status <> 'deleted';
  DELETE FROM public.project_phases phase
  WHERE phase.project_id IN (SELECT id FROM public.projects WHERE owner_id = selected_job.target_id);
  DELETE FROM public.project_private_details details WHERE details.owner_id = selected_job.target_id;

  UPDATE public.projects project
  SET slug = 'verwijderd-' || replace(project.id::text, '-', ''),
    title = 'Verwijderd project', description = NULL, project_type = NULL,
    start_date = NULL, expected_end_date = NULL, visibility = 'private',
    lifecycle_status = 'deleted', progress_percentage = 0,
    deleted_at = coalesce(project.deleted_at, statement_timestamp()),
    version = project.version + 1, content_revision = project.content_revision + 1,
    updated_at = statement_timestamp()
  WHERE project.owner_id = selected_job.target_id AND project.lifecycle_status <> 'deleted';

  UPDATE public.profiles profile
  SET display_name = 'Verwijderde gebruiker',
    slug = 'verwijderd-' || replace(selected_job.target_id::text, '-', ''),
    bio = NULL, location = NULL, avatar_asset_id = NULL, is_private = true,
    version = profile.version + 1, updated_at = statement_timestamp()
  WHERE profile.user_id = selected_job.target_id;

  UPDATE public.feedback_submissions feedback
  SET submitted_by_id = NULL, route = NULL, user_agent_family = NULL, updated_at = statement_timestamp()
  WHERE feedback.submitted_by_id = selected_job.target_id;
  UPDATE public.moderation_reports report
  SET reporter_id = NULL, reporter_contact_ciphertext = NULL, updated_at = statement_timestamp()
  WHERE report.reporter_id = selected_job.target_id;
  -- Audit events are append-only by design. They retain the stable tombstone
  -- actor id but never raw IP/user-agent values (only keyed hashes).
  UPDATE public.email_deliveries delivery
  SET recipient_user_id = NULL, metadata = '{}'::jsonb, updated_at = statement_timestamp()
  WHERE delivery.recipient_user_id = selected_job.target_id;
  DELETE FROM public.beta_invite_redemptions redemption WHERE redemption.app_user_id = selected_job.target_id;

  SELECT coalesce(array_agg(mapping.auth_user_id) FILTER (WHERE mapping.auth_user_id IS NOT NULL), ARRAY[]::text[])
  INTO auth_user_ids
  FROM public.auth_identity_mappings mapping
  WHERE mapping.app_user_id = selected_job.target_id;
  DELETE FROM public.auth_identity_mappings mapping WHERE mapping.app_user_id = selected_job.target_id;
  DELETE FROM public.auth_users auth_user WHERE auth_user.id = ANY(auth_user_ids);

  UPDATE public.app_users account
  SET status = 'deleted', deleted_at = statement_timestamp(),
    authz_version = account.authz_version + 1, version = account.version + 1,
    updated_at = statement_timestamp()
  WHERE account.id = selected_job.target_id AND account.status = 'deletion_pending';

  UPDATE public.deletion_jobs job
  SET status = 'completed', active_order_count = 0,
    lease_owner = NULL, lease_expires_at = NULL,
    completed_at = statement_timestamp(), last_error_code = NULL,
    updated_at = statement_timestamp()
  WHERE job.id = selected_job.id;
  RETURN 'completed';
END
$function$;

REVOKE ALL ON FUNCTION public.app_account_order_is_active(public.photobook_orders) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_request_account_export(text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_request_account_deletion(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_claim_export(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_begin_export(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_finalize_export(text, uuid, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_fail_export(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_claim_expired_export(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_finalize_export_cleanup(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_fail_export_cleanup(text, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_claim_deletion(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_begin_deletion(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_verify_deletion_asset(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_fail_deletion(text, uuid, uuid, text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_account_worker_finalize_deletion(text, uuid) FROM PUBLIC;

-- Fix the deletion-asset path guard to reject only path traversal segments and
-- keep export snapshots stable on the current beta-invite schema.

ALTER TABLE public.deletion_assets
  DROP CONSTRAINT deletion_assets_object_key_ck;

ALTER TABLE public.deletion_assets
  ADD CONSTRAINT deletion_assets_object_key_ck
  CHECK (
    length(object_key) BETWEEN 1 AND 1024
    AND object_key !~ '(^|/)\.\.(/|$)'
  );

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
      'betaInviteRedemptions', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'reservation_token_hash' - 'auth_user_id') ORDER BY row.reserved_at, row.id)
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
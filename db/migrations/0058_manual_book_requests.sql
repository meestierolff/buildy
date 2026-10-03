-- Manual requests freeze the canonical book. There is no checkout/payment or printer API.
CREATE TABLE public.book_requests (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  document jsonb NOT NULL,
  document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  delivery_ciphertext text NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'printing', 'shipped', 'cancelled')),
  reply text NOT NULL DEFAULT '' CHECK (char_length(reply) <= 1500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT book_requests_project_owner_fk FOREIGN KEY (project_id, owner_id) REFERENCES public.projects(id, owner_id) ON DELETE CASCADE,
  CONSTRAINT book_requests_document_ck CHECK (jsonb_typeof(document) = 'object' AND document->>'checksumSha256' = document_sha256)
);
CREATE INDEX book_requests_owner_idx ON public.book_requests(owner_id, created_at);
CREATE INDEX book_requests_project_idx ON public.book_requests(project_id);
CREATE UNIQUE INDEX book_requests_open_project_uq ON public.book_requests(project_id) WHERE status NOT IN ('cancelled', 'shipped');
ALTER TABLE public.book_requests ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.app_can_read_book_request(target_project_id uuid, target_owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT EXISTS (SELECT 1 FROM public.projects project JOIN public.app_users account ON account.id = project.owner_id
    WHERE project.id = target_project_id AND project.owner_id = target_owner_id
      AND project.lifecycle_status = 'active' AND project.deleted_at IS NULL
      AND account.status = 'active' AND account.deleted_at IS NULL
      AND (project.owner_id = public.app_actor_id() OR public.app_actor_moderation_role() = 'admin'::public.app_role_kind))
$function$;
CREATE FUNCTION public.app_can_manage_book_requests()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
  SELECT public.app_actor_moderation_role() = 'admin'::public.app_role_kind
$function$;
CREATE POLICY book_requests_read ON public.book_requests FOR SELECT USING (public.app_can_read_book_request(project_id, owner_id));
CREATE POLICY book_requests_create ON public.book_requests FOR INSERT WITH CHECK (
  owner_id = public.app_actor_id() AND public.app_owns_project(project_id) AND status = 'requested' AND version = 1 AND reply = ''
);
CREATE POLICY book_requests_admin_update ON public.book_requests FOR UPDATE
  USING (public.app_can_manage_book_requests() AND public.app_can_read_book_request(project_id, owner_id))
  WITH CHECK (public.app_can_manage_book_requests() AND public.app_can_read_book_request(project_id, owner_id));

CREATE FUNCTION public.guard_book_request_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.document IS DISTINCT FROM OLD.document
    OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256 OR NEW.quantity IS DISTINCT FROM OLD.quantity
    OR NEW.delivery_ciphertext IS DISTINCT FROM OLD.delivery_ciphertext OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'book request snapshot is immutable';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER book_requests_snapshot BEFORE UPDATE ON public.book_requests FOR EACH ROW EXECUTE FUNCTION public.guard_book_request_snapshot();

-- Revocation is immediate through RLS. Existing lifecycle cleanup erases each
-- project's bounded request history when its project is physically redacted.
CREATE FUNCTION public.erase_project_book_requests()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NEW.lifecycle_status = 'deleted' AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status THEN
    DELETE FROM public.book_requests WHERE project_id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER projects_erase_book_requests AFTER UPDATE OF lifecycle_status ON public.projects FOR EACH ROW EXECUTE FUNCTION public.erase_project_book_requests();

CREATE FUNCTION public.app_admin_book_order_assets(target_order_id uuid, target_request_id uuid)
RETURNS TABLE (id uuid, object_key text, size_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE selected_order public.book_requests%ROWTYPE;
BEGIN
  IF NOT coalesce(public.app_can_manage_book_requests(), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;
  SELECT request.* INTO selected_order FROM public.book_requests request
    WHERE request.id = target_order_id AND request.status <> 'cancelled'
      AND public.app_can_read_book_request(request.project_id, request.owner_id);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'book request unavailable'; END IF;
  INSERT INTO public.audit_events (actor_kind, actor_user_id, action, resource_type, resource_id, request_id, metadata)
    VALUES ('admin', public.app_actor_id(), 'book_order.pdf_requested', 'book_request', selected_order.id,
      target_request_id::text, '{"schemaVersion":1}'::jsonb);
  RETURN QUERY SELECT asset.id, asset.object_key, asset.size_bytes FROM public.media_assets asset
    JOIN jsonb_array_elements(selected_order.document->'sourceAssets') source ON source->>'id' = asset.id::text
    WHERE asset.owner_id = selected_order.owner_id AND asset.project_id = selected_order.project_id
      AND asset.sha256 = source->>'sha256' AND asset.status = 'ready'
      AND asset.purpose IN ('project_media', 'project_cover') AND asset.original_asset_id IS NULL
      AND NOT public.app_moderation_media_hidden(asset.id);
END $function$;
REVOKE ALL ON TABLE public.book_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_read_book_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_can_manage_book_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_book_request_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.erase_project_book_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_admin_book_order_assets(uuid, uuid) FROM PUBLIC;

-- Account exports retain content and request data, without customer PDF downloads.
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
      'bookRequests', coalesce((SELECT jsonb_agg((to_jsonb(row) - 'idempotency_key' - 'request_hash') ORDER BY row.created_at, row.id)
        FROM public.book_requests row WHERE row.owner_id = selected_user_id), '[]'::jsonb),
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
        AND asset.purpose NOT IN ('export_archive', 'temporary_upload', 'photobook_pdf')
        AND asset.size_bytes IS NOT NULL
        AND asset.sha256 IS NOT NULL
        AND asset.detected_content_type IS NOT NULL
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    selected_requested_at;
END
$function$;

-- Replaced cover originals stay protected by the existing orphan worker while
-- ready, even when no longer current. Explicit deletion revokes source use.
CREATE FUNCTION public.cancel_book_requests_on_source_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF NEW.status IN ('deletion_pending', 'deleted', 'failed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.book_requests request SET status = 'cancelled',
      reply = 'Deze aanvraag is geannuleerd omdat een originele foto is verwijderd. Controleer je boek en dien zo nodig een nieuwe aanvraag in.',
      version = request.version + 1, updated_at = statement_timestamp()
    WHERE request.project_id = NEW.project_id AND request.status IN ('requested', 'accepted', 'printing')
      AND request.document->'sourceAssetIds' @> jsonb_build_array(NEW.id::text);
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER media_cancel_book_requests AFTER UPDATE OF status ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.cancel_book_requests_on_source_removal();
REVOKE ALL ON FUNCTION public.cancel_book_requests_on_source_removal() FROM PUBLIC;

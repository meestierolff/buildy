-- Authoritative moderator/admin RBAC, PII-minimised queue reads and reversible
-- moderation actions. Browser-facing callers only receive purpose-built
-- SECURITY DEFINER functions; role administration remains migration-owner-only.

CREATE TYPE public.app_role_kind AS ENUM ('moderator', 'admin');
--> statement-breakpoint
CREATE TYPE public.moderation_target_state_kind AS ENUM ('hidden', 'visible');
--> statement-breakpoint
CREATE TYPE public.moderation_account_restriction_kind AS ENUM ('suspended', 'blocked');
--> statement-breakpoint
ALTER TYPE public.moderation_action_kind ADD VALUE 'resolve';
--> statement-breakpoint
CREATE TABLE public.app_role_grants (
  id uuid PRIMARY KEY,
  app_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  role public.app_role_kind NOT NULL,
  operator_reference text NOT NULL,
  reason_code text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_operation_id uuid,
  revoked_operator_reference text,
  revoked_reason_code text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT app_role_grants_operator_reference_ck CHECK (
    operator_reference ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{2,119}$'
  ),
  CONSTRAINT app_role_grants_reason_code_ck CHECK (
    reason_code ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  CONSTRAINT app_role_grants_window_ck CHECK (
    expires_at IS NULL OR expires_at > starts_at
  ),
  CONSTRAINT app_role_grants_revocation_ck CHECK (
    (revoked_at IS NULL AND revocation_operation_id IS NULL AND revoked_operator_reference IS NULL AND revoked_reason_code IS NULL)
    OR
    (revoked_at IS NOT NULL AND revocation_operation_id IS NOT NULL AND revoked_operator_reference IS NOT NULL AND revoked_reason_code IS NOT NULL)
  ),
  CONSTRAINT app_role_grants_revoked_operator_ck CHECK (
    revoked_operator_reference IS NULL
    OR revoked_operator_reference ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{2,119}$'
  ),
  CONSTRAINT app_role_grants_revoked_reason_ck CHECK (
    revoked_reason_code IS NULL OR revoked_reason_code ~ '^[a-z][a-z0-9_.-]{2,79}$'
  ),
  CONSTRAINT app_role_grants_version_ck CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX app_role_grants_active_user_idx
  ON public.app_role_grants (app_user_id, role, expires_at)
  WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX app_role_grants_revocation_operation_uq
  ON public.app_role_grants (revocation_operation_id)
  WHERE revocation_operation_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.moderation_target_states (
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  state public.moderation_target_state_kind NOT NULL,
  current_action_id uuid NOT NULL REFERENCES public.moderation_actions(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  hidden_at timestamptz,
  restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (target_type, target_id),
  CONSTRAINT moderation_target_states_type_ck CHECK (
    target_type IN ('profile', 'project', 'update', 'media', 'comment')
  ),
  CONSTRAINT moderation_target_states_state_ck CHECK (
    (state = 'hidden' AND hidden_at IS NOT NULL AND restored_at IS NULL)
    OR (state = 'visible' AND restored_at IS NOT NULL)
  ),
  CONSTRAINT moderation_target_states_version_ck CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX moderation_target_states_hidden_idx
  ON public.moderation_target_states (target_type, target_id)
  WHERE state = 'hidden';
--> statement-breakpoint
CREATE TABLE public.moderation_account_restrictions (
  app_user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE RESTRICT,
  kind public.moderation_account_restriction_kind NOT NULL,
  current_action_id uuid NOT NULL UNIQUE REFERENCES public.moderation_actions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
--> statement-breakpoint
ALTER TABLE public.app_role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_target_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_account_restrictions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_reason_ck,
  ALTER COLUMN reason DROP NOT NULL,
  ADD COLUMN reason_ciphertext text,
  ADD COLUMN actor_role public.app_role_kind NOT NULL DEFAULT 'moderator',
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text,
  ADD COLUMN expected_report_version integer,
  ADD COLUMN report_version integer NOT NULL DEFAULT 1,
  ADD COLUMN reverses_action_id uuid REFERENCES public.moderation_actions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT moderation_actions_target_type_ck CHECK (
    target_type IN ('profile', 'project', 'update', 'media', 'comment')
  ),
  ADD CONSTRAINT moderation_actions_reason_storage_ck CHECK (
    (reason IS NOT NULL AND reason_ciphertext IS NULL AND char_length(btrim(reason)) BETWEEN 1 AND 1000)
    OR
    (reason IS NULL AND reason_ciphertext IS NOT NULL AND reason_ciphertext LIKE 'v1.%' AND char_length(reason_ciphertext) <= 16000)
  ),
  ADD CONSTRAINT moderation_actions_request_hash_ck CHECK (
    request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT moderation_actions_api_shape_ck CHECK (
    idempotency_key IS NULL
    OR (
      idempotency_key ~ '^moderation-admin-command:v1:[0-9a-f]{64}$'
      AND request_hash IS NOT NULL
      AND expected_report_version IS NOT NULL
      AND expected_report_version > 0
      AND report_version > 0
    )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX moderation_actions_idempotency_uq
  ON public.moderation_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX moderation_actions_reverses_idx
  ON public.moderation_actions (reverses_action_id)
  WHERE reverses_action_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_moderation_target_hidden(
  requested_target_type text,
  requested_target_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.moderation_target_states target_state
    WHERE target_state.target_type = requested_target_type
      AND target_state.target_id = requested_target_id
      AND target_state.state = 'hidden'
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_moderation_media_hidden(requested_media_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    public.app_moderation_target_hidden('media', requested_media_id)
    OR EXISTS (
      SELECT 1
      FROM public.media_assets asset
      JOIN public.moderation_target_states target_state
        ON target_state.target_type = 'media'
       AND target_state.state = 'hidden'
       AND target_state.target_id = coalesce(asset.original_asset_id, asset.id)
      WHERE asset.id = requested_media_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.media_assets asset
      JOIN public.update_media attachment
        ON attachment.media_asset_id = coalesce(asset.original_asset_id, asset.id)
      JOIN public.moderation_target_states target_state
        ON target_state.target_type = 'update'
       AND target_state.target_id = attachment.update_id
       AND target_state.state = 'hidden'
      WHERE asset.id = requested_media_id
    )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_profile(target_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users target
    JOIN public.profiles profile ON profile.user_id = target.id
    WHERE target.id = target_user
      AND target.status = 'active'
      AND target.deleted_at IS NULL
      AND NOT public.app_moderation_target_hidden('profile', target.id)
      AND (
        public.app_actor_id() = target.id
        OR (
          NOT public.app_users_are_blocked(public.app_actor_id(), target.id)
          AND (
            profile.is_private = false
            OR EXISTS (
              SELECT 1
              FROM public.user_relationships relationship
              WHERE relationship.source_user_id = public.app_actor_id()
                AND relationship.target_user_id = target.id
                AND relationship.kind = 'follow'
                AND relationship.status = 'active'
            )
          )
        )
      )
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_project(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects project
    JOIN public.app_users owner_account ON owner_account.id = project.owner_id
    WHERE project.id = target_project
      AND project.lifecycle_status = 'active'
      AND owner_account.status = 'active'
      AND owner_account.deleted_at IS NULL
      AND NOT public.app_moderation_target_hidden('profile', project.owner_id)
      AND NOT public.app_moderation_target_hidden('project', project.id)
      AND NOT public.app_users_are_blocked(public.app_actor_id(), project.owner_id)
      AND (
        project.owner_id = public.app_actor_id()
        OR project.visibility = 'public'
        OR EXISTS (
          SELECT 1
          FROM public.project_access_requests access_request
          WHERE access_request.project_id = project.id
            AND access_request.requester_id = public.app_actor_id()
            AND access_request.status = 'accepted'
        )
      )
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_owns_project(target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects project
    JOIN public.app_users owner_account ON owner_account.id = project.owner_id
    WHERE project.id = target_project
      AND project.owner_id = public.app_actor_id()
      AND project.lifecycle_status = 'active'
      AND owner_account.status = 'active'
      AND owner_account.deleted_at IS NULL
      AND NOT public.app_moderation_target_hidden('profile', project.owner_id)
      AND NOT public.app_moderation_target_hidden('project', project.id)
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_view_update(target_update uuid, target_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.updates item
    JOIN public.projects project ON project.id = item.project_id
    WHERE item.id = target_update
      AND item.project_id = target_project
      AND item.status IN ('draft', 'published')
      AND NOT public.app_moderation_target_hidden('update', item.id)
      AND public.app_can_view_project(project.id)
      AND (
        project.owner_id = public.app_actor_id()
        OR item.status = 'published'
      )
  )
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_can_manage_comment(target_comment uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.comments comment
    JOIN public.projects project ON project.id = comment.project_id
    WHERE comment.id = target_comment
      AND NOT public.app_moderation_target_hidden('comment', comment.id)
      AND public.app_can_view_update(comment.update_id, comment.project_id)
      AND (
        comment.author_id = public.app_actor_id()
        OR project.owner_id = public.app_actor_id()
      )
  )
$function$;
--> statement-breakpoint
DROP POLICY IF EXISTS projects_update_owner ON public.projects;
CREATE POLICY projects_update_owner ON public.projects FOR UPDATE
USING (owner_id = app_actor_id() AND app_owns_project(id))
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(id));
DROP POLICY IF EXISTS projects_delete_owner ON public.projects;
CREATE POLICY projects_delete_owner ON public.projects FOR DELETE
USING (owner_id = app_actor_id() AND app_owns_project(id));
--> statement-breakpoint
DROP POLICY IF EXISTS project_private_owner_all ON public.project_private_details;
CREATE POLICY project_private_owner_all ON public.project_private_details FOR ALL
USING (owner_id = app_actor_id() AND app_owns_project(project_id))
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(project_id));
--> statement-breakpoint
DROP POLICY IF EXISTS access_requests_select_participant ON public.project_access_requests;
CREATE POLICY access_requests_select_participant ON public.project_access_requests FOR SELECT
USING (
  (requester_id = app_actor_id() OR project_owner_id = app_actor_id())
  AND app_can_view_project(project_id)
);
DROP POLICY IF EXISTS project_followers_select_participant ON public.project_followers;
CREATE POLICY project_followers_select_participant ON public.project_followers FOR SELECT
USING (
  (follower_id = app_actor_id() OR project_owner_id = app_actor_id())
  AND app_can_view_project(project_id)
);
--> statement-breakpoint
DROP POLICY IF EXISTS media_select_visible ON public.media_assets;
CREATE POLICY media_select_visible ON public.media_assets FOR SELECT
USING (
  NOT app_moderation_media_hidden(id)
  AND NOT app_moderation_target_hidden('profile', owner_id)
  AND (project_id IS NULL OR app_can_view_project(project_id))
  AND (
    owner_id = app_actor_id()
    OR (
      status = 'ready'
      AND is_current
      AND project_id IS NOT NULL
      AND purpose IN ('project_media', 'project_cover', 'floorplan')
      AND (
        purpose <> 'project_media'
        OR EXISTS (
          SELECT 1
          FROM public.update_media attachment
          JOIN public.updates project_update
            ON project_update.id = attachment.update_id
           AND project_update.project_id = attachment.project_id
          WHERE attachment.media_asset_id = coalesce(media_assets.original_asset_id, media_assets.id)
            AND app_can_view_update(project_update.id, project_update.project_id)
        )
      )
    )
    OR (
      purpose = 'avatar'
      AND status = 'ready'
      AND is_current
      AND app_can_view_profile(owner_id)
    )
  )
);
DROP POLICY IF EXISTS media_update_owner ON public.media_assets;
CREATE POLICY media_update_owner ON public.media_assets FOR UPDATE
USING (owner_id = app_actor_id() AND NOT app_moderation_media_hidden(id))
WITH CHECK (owner_id = app_actor_id() AND NOT app_moderation_media_hidden(id));
DROP POLICY IF EXISTS media_delete_owner ON public.media_assets;
CREATE POLICY media_delete_owner ON public.media_assets FOR DELETE
USING (owner_id = app_actor_id() AND NOT app_moderation_media_hidden(id));
--> statement-breakpoint
DROP POLICY IF EXISTS comments_select_visible ON public.comments;
CREATE POLICY comments_select_visible ON public.comments FOR SELECT
USING (
  NOT app_moderation_target_hidden('comment', id)
  AND app_can_view_update(update_id, project_id)
  AND NOT app_users_are_blocked(app_actor_id(), author_id)
  AND status <> 'deleted'
  AND (
    status = 'published'
    OR author_id = app_actor_id()
    OR app_owns_project(project_id)
  )
);
DROP POLICY IF EXISTS comments_update_author_or_owner ON public.comments;
CREATE POLICY comments_update_author_or_owner ON public.comments FOR UPDATE
USING (
  NOT app_moderation_target_hidden('comment', id)
  AND app_can_view_update(update_id, project_id)
  AND (author_id = app_actor_id() OR app_owns_project(project_id))
)
WITH CHECK (
  NOT app_moderation_target_hidden('comment', id)
  AND app_can_view_update(update_id, project_id)
  AND (author_id = app_actor_id() OR app_owns_project(project_id))
);
DROP POLICY IF EXISTS comments_delete_author_or_owner ON public.comments;
CREATE POLICY comments_delete_author_or_owner ON public.comments FOR DELETE
USING (
  NOT app_moderation_target_hidden('comment', id)
  AND app_can_view_update(update_id, project_id)
  AND (author_id = app_actor_id() OR app_owns_project(project_id))
);
--> statement-breakpoint
DROP POLICY IF EXISTS reactions_select_visible ON public.reactions;
CREATE POLICY reactions_select_visible ON public.reactions FOR SELECT
USING (
  app_can_view_update(update_id, project_id)
  AND (
    target = 'update'
    OR EXISTS (
      SELECT 1 FROM public.comments target_comment
      WHERE target_comment.id = reactions.comment_id
        AND NOT app_moderation_target_hidden('comment', target_comment.id)
        AND target_comment.status <> 'deleted'
    )
  )
);
--> statement-breakpoint
DROP POLICY IF EXISTS photobook_drafts_owner_all ON public.photobook_drafts;
CREATE POLICY photobook_drafts_owner_all ON public.photobook_drafts FOR ALL
USING (owner_id = app_actor_id() AND app_owns_project(project_id))
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(project_id));
DROP POLICY IF EXISTS photobook_settings_owner_all ON public.photobook_settings;
CREATE POLICY photobook_settings_owner_all ON public.photobook_settings FOR ALL
USING (owner_id = app_actor_id() AND app_owns_project(project_id))
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(project_id));
DROP POLICY IF EXISTS photobook_exclusions_owner_all ON public.photobook_exclusions;
CREATE POLICY photobook_exclusions_owner_all ON public.photobook_exclusions FOR ALL
USING (app_owns_project(project_id))
WITH CHECK (app_owns_project(project_id));
DROP POLICY IF EXISTS photobook_revisions_owner_select ON public.photobook_revisions;
CREATE POLICY photobook_revisions_owner_select ON public.photobook_revisions FOR SELECT
USING (owner_id = app_actor_id() AND app_owns_project(project_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_actor_moderation_role()
RETURNS public.app_role_kind
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT role_grant.role
  FROM public.app_role_grants role_grant
  JOIN public.app_users app_user ON app_user.id = role_grant.app_user_id
  WHERE role_grant.app_user_id = public.app_actor_id()
    AND app_user.status = 'active'
    AND app_user.deleted_at IS NULL
    AND role_grant.revoked_at IS NULL
    AND role_grant.starts_at <= statement_timestamp()
    AND (role_grant.expires_at IS NULL OR role_grant.expires_at > statement_timestamp())
  ORDER BY CASE role_grant.role WHEN 'admin' THEN 0 ELSE 1 END, role_grant.expires_at DESC NULLS FIRST
  LIMIT 1
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_resolve_moderation_actor(subject_auth_user_id text)
RETURNS TABLE (
  app_user_id uuid,
  role public.app_role_kind,
  grant_expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT mapping.app_user_id, role_grant.role, role_grant.expires_at
  FROM public.auth_identity_mappings mapping
  JOIN public.app_users app_user ON app_user.id = mapping.app_user_id
  JOIN public.app_role_grants role_grant ON role_grant.app_user_id = mapping.app_user_id
  WHERE mapping.auth_user_id = subject_auth_user_id
    AND mapping.migration_status = 'linked'
    AND app_user.status = 'active'
    AND app_user.deleted_at IS NULL
    AND role_grant.revoked_at IS NULL
    AND role_grant.starts_at <= statement_timestamp()
    AND (role_grant.expires_at IS NULL OR role_grant.expires_at > statement_timestamp())
  ORDER BY CASE role_grant.role WHEN 'admin' THEN 0 ELSE 1 END, role_grant.expires_at DESC NULLS FIRST
  LIMIT 1
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_moderation_target_owner(
  requested_target_type text,
  requested_target_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE requested_target_type
    WHEN 'profile' THEN (
      SELECT profile.user_id FROM public.profiles profile WHERE profile.user_id = requested_target_id
    )
    WHEN 'project' THEN (
      SELECT project.owner_id FROM public.projects project WHERE project.id = requested_target_id
    )
    WHEN 'update' THEN (
      SELECT item.project_owner_id FROM public.updates item WHERE item.id = requested_target_id
    )
    WHEN 'media' THEN (
      SELECT asset.owner_id FROM public.media_assets asset WHERE asset.id = requested_target_id
    )
    WHEN 'comment' THEN (
      SELECT comment.author_id FROM public.comments comment WHERE comment.id = requested_target_id
    )
    ELSE NULL::uuid
  END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_list_moderation_reports(
  requested_status text,
  requested_urgency text,
  requested_target_type text,
  cursor_created_at timestamptz,
  cursor_id uuid,
  requested_limit integer
)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  target_type text,
  target_id uuid,
  reason text,
  urgency text,
  status public.moderation_report_status,
  version integer,
  target_hidden boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_moderation_role() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation role required';
  END IF;
  IF requested_status NOT IN ('open', 'triaged', 'investigating', 'resolved', 'dismissed')
    OR (requested_urgency IS NOT NULL AND requested_urgency NOT IN ('normal', 'high', 'urgent'))
    OR (requested_target_type IS NOT NULL AND requested_target_type NOT IN ('profile', 'project', 'update', 'media', 'comment'))
    OR requested_limit NOT BETWEEN 1 AND 51
    OR ((cursor_created_at IS NULL) <> (cursor_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid moderation queue input';
  END IF;

  RETURN QUERY
  SELECT
    report.id,
    report.receipt_code,
    report.target_type,
    report.target_id,
    report.reason,
    report.urgency,
    report.status,
    report.version,
    CASE
      WHEN report.target_type = 'media' THEN public.app_moderation_media_hidden(report.target_id)
      ELSE public.app_moderation_target_hidden(report.target_type, report.target_id)
    END,
    report.created_at,
    report.updated_at
  FROM public.moderation_reports report
  WHERE report.status::text = requested_status
    AND report.receipt_code IS NOT NULL
    AND (requested_urgency IS NULL OR report.urgency = requested_urgency)
    AND (requested_target_type IS NULL OR report.target_type = requested_target_type)
    AND (
      cursor_created_at IS NULL
      OR (report.created_at, report.id) < (cursor_created_at, cursor_id)
    )
  ORDER BY report.created_at DESC, report.id DESC
  LIMIT requested_limit;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_load_moderation_report(requested_report_id uuid)
RETURNS TABLE (
  id uuid,
  receipt_code text,
  target_type text,
  target_id uuid,
  reason text,
  urgency text,
  status public.moderation_report_status,
  version integer,
  target_hidden boolean,
  created_at timestamptz,
  updated_at timestamptz,
  details_ciphertext text,
  legacy_details text,
  target_snapshot_ciphertext text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_moderation_role() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation role required';
  END IF;

  RETURN QUERY
  SELECT
    report.id,
    report.receipt_code,
    report.target_type,
    report.target_id,
    report.reason,
    report.urgency,
    report.status,
    report.version,
    CASE
      WHEN report.target_type = 'media' THEN public.app_moderation_media_hidden(report.target_id)
      ELSE public.app_moderation_target_hidden(report.target_type, report.target_id)
    END,
    report.created_at,
    report.updated_at,
    report.details_ciphertext,
    report.details,
    report.target_snapshot_ciphertext
  FROM public.moderation_reports report
  WHERE report.id = requested_report_id
    AND report.receipt_code IS NOT NULL
    AND report.target_snapshot_ciphertext IS NOT NULL
  LIMIT 1;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_list_moderation_actions(requested_report_id uuid)
RETURNS TABLE (
  id uuid,
  kind public.moderation_action_kind,
  actor_id uuid,
  actor_role public.app_role_kind,
  reason_ciphertext text,
  reverses_action_id uuid,
  reversed_by_action_id uuid,
  report_version integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_moderation_role() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation role required';
  END IF;

  RETURN QUERY
  SELECT
    action.id,
    action.kind,
    action.actor_id,
    action.actor_role,
    action.reason_ciphertext,
    action.reverses_action_id,
    action.reversed_by_action_id,
    action.report_version,
    action.created_at
  FROM public.moderation_actions action
  WHERE action.report_id = requested_report_id
    AND action.reason_ciphertext IS NOT NULL
  ORDER BY action.created_at ASC, action.id ASC;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_admin_apply_moderation_action(
  requested_report_id uuid,
  requested_action_id uuid,
  requested_kind text,
  requested_reason_ciphertext text,
  requested_idempotency_key text,
  requested_request_hash text,
  requested_expected_report_version integer,
  requested_reverse_action_id uuid,
  requested_request_id text
)
RETURNS TABLE (
  action_id uuid,
  report_id uuid,
  report_status public.moderation_report_status,
  report_version integer,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user_id uuid := public.app_actor_id();
  actor_role public.app_role_kind := public.app_actor_moderation_role();
  selected_report public.moderation_reports%ROWTYPE;
  replay_action public.moderation_actions%ROWTYPE;
  original_action public.moderation_actions%ROWTYPE;
  target_owner_id uuid;
  next_status public.moderation_report_status;
  next_version integer;
BEGIN
  IF actor_role IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation role required';
  END IF;
  IF requested_kind NOT IN ('hide', 'restore', 'warn', 'suspend', 'block', 'dismiss', 'resolve')
    OR requested_reason_ciphertext NOT LIKE 'v1.%'
    OR char_length(requested_reason_ciphertext) > 16000
    OR requested_idempotency_key !~ '^moderation-admin-command:v1:[0-9a-f]{64}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$'
    OR requested_expected_report_version < 1
    OR requested_request_id !~ '^[0-9a-f-]{36}$'
    OR (requested_kind = 'restore') <> (requested_reverse_action_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid moderation action input';
  END IF;
  IF requested_kind IN ('suspend', 'block') AND actor_role <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(requested_idempotency_key, 0)
  );
  SELECT action.* INTO replay_action
  FROM public.moderation_actions action
  WHERE action.idempotency_key = requested_idempotency_key;
  IF FOUND THEN
    IF replay_action.actor_id IS DISTINCT FROM actor_user_id
      OR replay_action.report_id IS DISTINCT FROM requested_report_id
      OR replay_action.request_hash IS DISTINCT FROM requested_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'moderation action idempotency collision';
    END IF;
    RETURN QUERY
    SELECT
      replay_action.id,
      replay_action.report_id,
      report.status,
      replay_action.report_version,
      true
    FROM public.moderation_reports report
    WHERE report.id = replay_action.report_id;
    RETURN;
  END IF;

  SELECT report.* INTO selected_report
  FROM public.moderation_reports report
  WHERE report.id = requested_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'moderation report missing';
  END IF;
  IF selected_report.version <> requested_expected_report_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'moderation version conflict';
  END IF;

  target_owner_id := public.app_moderation_target_owner(
    selected_report.target_type,
    selected_report.target_id
  );
  IF target_owner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation target unavailable';
  END IF;
  IF requested_kind <> 'restore'
    AND requested_kind NOT IN ('dismiss', 'resolve')
    AND selected_report.status IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation report is final';
  END IF;

  IF requested_kind = 'hide' THEN
    IF EXISTS (
      SELECT 1 FROM public.moderation_target_states target_state
      WHERE target_state.target_type = selected_report.target_type
        AND target_state.target_id = selected_report.target_id
        AND target_state.state = 'hidden'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation target already hidden';
    END IF;
  ELSIF requested_kind = 'restore' THEN
    SELECT action.* INTO original_action
    FROM public.moderation_actions action
    WHERE action.id = requested_reverse_action_id
      AND action.report_id = selected_report.id
      AND action.target_type = selected_report.target_type
      AND action.target_id = selected_report.target_id
    FOR UPDATE;
    IF NOT FOUND
      OR original_action.kind NOT IN ('hide', 'suspend', 'block')
      OR original_action.reversed_by_action_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation reversal unavailable';
    END IF;
    IF original_action.kind IN ('suspend', 'block') AND actor_role <> 'admin' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin role required';
    END IF;
  ELSIF requested_kind IN ('suspend', 'block') THEN
    IF target_owner_id = actor_user_id
      OR EXISTS (
        SELECT 1 FROM public.moderation_account_restrictions restriction
        WHERE restriction.app_user_id = target_owner_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.app_users target
        WHERE target.id = target_owner_id
          AND target.status = 'active'
          AND target.deleted_at IS NULL
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation account restriction unavailable';
    END IF;
  END IF;

  next_version := selected_report.version + 1;
  next_status := CASE requested_kind
    WHEN 'hide' THEN 'investigating'::public.moderation_report_status
    WHEN 'dismiss' THEN 'dismissed'::public.moderation_report_status
    WHEN 'restore' THEN selected_report.status
    ELSE 'resolved'::public.moderation_report_status
  END;

  INSERT INTO public.moderation_actions (
    id, report_id, actor_id, actor_role, kind, target_type, target_id,
    reason, reason_ciphertext, idempotency_key, request_hash,
    expected_report_version, report_version, reverses_action_id
  ) VALUES (
    requested_action_id, selected_report.id, actor_user_id, actor_role,
    requested_kind::public.moderation_action_kind,
    selected_report.target_type, selected_report.target_id,
    NULL, requested_reason_ciphertext, requested_idempotency_key,
    requested_request_hash, requested_expected_report_version,
    next_version, requested_reverse_action_id
  );

  IF requested_kind = 'hide' THEN
    INSERT INTO public.moderation_target_states (
      target_type, target_id, state, current_action_id, hidden_at
    ) VALUES (
      selected_report.target_type, selected_report.target_id,
      'hidden', requested_action_id, statement_timestamp()
    )
    ON CONFLICT (target_type, target_id) DO UPDATE SET
      state = 'hidden',
      current_action_id = EXCLUDED.current_action_id,
      hidden_at = statement_timestamp(),
      restored_at = NULL,
      version = public.moderation_target_states.version + 1,
      updated_at = statement_timestamp();
  ELSIF requested_kind = 'restore' THEN
    UPDATE public.moderation_actions
    SET reversed_by_action_id = requested_action_id
    WHERE id = original_action.id
      AND reversed_by_action_id IS NULL;
    IF original_action.kind = 'hide' THEN
      UPDATE public.moderation_target_states
      SET state = 'visible',
          current_action_id = requested_action_id,
          restored_at = statement_timestamp(),
          version = version + 1,
          updated_at = statement_timestamp()
      WHERE target_type = selected_report.target_type
        AND target_id = selected_report.target_id
        AND state = 'hidden'
        AND current_action_id = original_action.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation hidden state changed';
      END IF;
    ELSE
      DELETE FROM public.moderation_account_restrictions restriction
      WHERE restriction.app_user_id = target_owner_id
        AND restriction.current_action_id = original_action.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation restriction state changed';
      END IF;
      UPDATE public.app_users
      SET status = 'active',
          authz_version = authz_version + 1,
          version = version + 1,
          updated_at = statement_timestamp()
      WHERE id = target_owner_id
        AND status = 'suspended'
        AND deleted_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation account state changed';
      END IF;
    END IF;
  ELSIF requested_kind = 'warn' THEN
    INSERT INTO public.notifications (
      recipient_id, actor_id, project_id, update_id, comment_id,
      type, dedupe_key, payload
    ) VALUES (
      target_owner_id, NULL, NULL, NULL, NULL,
      'moderation.warning',
      'moderation-warning:' || requested_action_id::text,
      jsonb_build_object(
        'schemaVersion', 1,
        'actionId', requested_action_id,
        'receiptCode', selected_report.receipt_code
      )
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  ELSIF requested_kind IN ('suspend', 'block') THEN
    UPDATE public.app_users
    SET status = 'suspended',
        authz_version = authz_version + 1,
        version = version + 1,
        updated_at = statement_timestamp()
    WHERE id = target_owner_id
      AND status = 'active'
      AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'moderation account state changed';
    END IF;
    INSERT INTO public.moderation_account_restrictions (
      app_user_id, kind, current_action_id
    ) VALUES (
      target_owner_id,
      CASE requested_kind
        WHEN 'block' THEN 'blocked'::public.moderation_account_restriction_kind
        ELSE 'suspended'::public.moderation_account_restriction_kind
      END,
      requested_action_id
    );
    DELETE FROM public.auth_sessions session
    USING public.auth_identity_mappings mapping
    WHERE mapping.app_user_id = target_owner_id
      AND mapping.auth_user_id = session.user_id;
  END IF;

  UPDATE public.moderation_reports
  SET status = next_status,
      assigned_to_id = actor_user_id,
      resolved_at = CASE
        WHEN next_status IN ('resolved', 'dismissed') THEN coalesce(resolved_at, statement_timestamp())
        ELSE NULL
      END,
      version = next_version,
      updated_at = statement_timestamp()
  WHERE id = selected_report.id;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id,
    request_id, metadata
  ) VALUES (
    'admin', actor_user_id,
    'moderation.action.' || requested_kind,
    'moderation_report', selected_report.id,
    requested_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'actionId', requested_action_id,
      'actorRole', actor_role,
      'kind', requested_kind,
      'targetType', selected_report.target_type,
      'reportVersion', next_version,
      'reversesActionId', requested_reverse_action_id
    )
  );

  RETURN QUERY SELECT requested_action_id, selected_report.id, next_status, next_version, false;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_migration_grant_role(
  requested_grant_id uuid,
  requested_app_user_id uuid,
  requested_role text,
  requested_operator_reference text,
  requested_reason_code text,
  requested_starts_at timestamptz,
  requested_expires_at timestamptz
)
RETURNS TABLE (
  grant_id uuid,
  granted_role public.app_role_kind,
  active boolean,
  expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_grant public.app_role_grants%ROWTYPE;
BEGIN
  IF requested_role NOT IN ('moderator', 'admin')
    OR requested_operator_reference !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{2,119}$'
    OR requested_reason_code !~ '^[a-z][a-z0-9_.-]{2,79}$'
    OR (requested_expires_at IS NOT NULL AND requested_expires_at <= coalesce(requested_starts_at, statement_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid role grant input';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(requested_app_user_id::text, 0)
  );
  SELECT role_grant.* INTO selected_grant
  FROM public.app_role_grants role_grant
  WHERE role_grant.id = requested_grant_id;
  IF FOUND THEN
    IF selected_grant.app_user_id IS DISTINCT FROM requested_app_user_id
      OR selected_grant.role::text IS DISTINCT FROM requested_role
      OR selected_grant.operator_reference IS DISTINCT FROM requested_operator_reference
      OR selected_grant.reason_code IS DISTINCT FROM requested_reason_code
      OR (requested_starts_at IS NOT NULL AND selected_grant.starts_at IS DISTINCT FROM requested_starts_at)
      OR selected_grant.expires_at IS DISTINCT FROM requested_expires_at THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'role grant idempotency collision';
    END IF;
    RETURN QUERY SELECT
      selected_grant.id,
      selected_grant.role,
      selected_grant.revoked_at IS NULL
        AND selected_grant.starts_at <= statement_timestamp()
        AND (selected_grant.expires_at IS NULL OR selected_grant.expires_at > statement_timestamp()),
      selected_grant.expires_at,
      true;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users target
    WHERE target.id = requested_app_user_id
      AND target.status = 'active'
      AND target.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'role grant target unavailable';
  END IF;

  INSERT INTO public.app_role_grants (
    id, app_user_id, role, operator_reference, reason_code, starts_at, expires_at
  ) VALUES (
    requested_grant_id, requested_app_user_id,
    requested_role::public.app_role_kind,
    requested_operator_reference, requested_reason_code,
    coalesce(requested_starts_at, statement_timestamp()), requested_expires_at
  ) RETURNING * INTO selected_grant;

  UPDATE public.app_users
  SET authz_version = authz_version + 1,
      version = version + 1,
      updated_at = statement_timestamp()
  WHERE id = requested_app_user_id;

  INSERT INTO public.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) VALUES (
    'system', 'app_role.granted', 'app_role_grant', selected_grant.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'appUserId', requested_app_user_id,
      'role', requested_role,
      'operatorReference', requested_operator_reference,
      'reasonCode', requested_reason_code,
      'startsAt', selected_grant.starts_at,
      'expiresAt', requested_expires_at
    )
  );

  RETURN QUERY SELECT
    selected_grant.id,
    selected_grant.role,
    selected_grant.starts_at <= statement_timestamp()
      AND (selected_grant.expires_at IS NULL OR selected_grant.expires_at > statement_timestamp()),
    selected_grant.expires_at,
    false;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_migration_revoke_role(
  requested_revocation_operation_id uuid,
  requested_grant_id uuid,
  requested_operator_reference text,
  requested_reason_code text
)
RETURNS TABLE (
  grant_id uuid,
  revoked_role public.app_role_kind,
  revoked_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_grant public.app_role_grants%ROWTYPE;
BEGIN
  IF requested_operator_reference !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{2,119}$'
    OR requested_reason_code !~ '^[a-z][a-z0-9_.-]{2,79}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid role revocation input';
  END IF;
  SELECT role_grant.* INTO selected_grant
  FROM public.app_role_grants role_grant
  WHERE role_grant.id = requested_grant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'role grant unavailable';
  END IF;
  IF selected_grant.revoked_at IS NOT NULL THEN
    IF selected_grant.revocation_operation_id IS DISTINCT FROM requested_revocation_operation_id
      OR selected_grant.revoked_operator_reference IS DISTINCT FROM requested_operator_reference
      OR selected_grant.revoked_reason_code IS DISTINCT FROM requested_reason_code THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'role grant already revoked';
    END IF;
    RETURN QUERY SELECT selected_grant.id, selected_grant.role, selected_grant.revoked_at, true;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_role_grants role_grant
    WHERE role_grant.revocation_operation_id = requested_revocation_operation_id
      AND role_grant.id <> requested_grant_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'role revocation idempotency collision';
  END IF;
  IF selected_grant.role = 'admin'
    AND selected_grant.starts_at <= statement_timestamp()
    AND (selected_grant.expires_at IS NULL OR selected_grant.expires_at > statement_timestamp())
    AND NOT EXISTS (
      SELECT 1
      FROM public.app_role_grants other_grant
      JOIN public.app_users other_user ON other_user.id = other_grant.app_user_id
      WHERE other_grant.id <> selected_grant.id
        AND other_grant.role = 'admin'
        AND other_grant.revoked_at IS NULL
        AND other_grant.starts_at <= statement_timestamp()
        AND (other_grant.expires_at IS NULL OR other_grant.expires_at > statement_timestamp())
        AND other_user.status = 'active'
        AND other_user.deleted_at IS NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'cannot revoke last active admin';
  END IF;

  UPDATE public.app_role_grants
  SET revoked_at = statement_timestamp(),
      revocation_operation_id = requested_revocation_operation_id,
      revoked_operator_reference = requested_operator_reference,
      revoked_reason_code = requested_reason_code,
      version = version + 1,
      updated_at = statement_timestamp()
  WHERE id = selected_grant.id
  RETURNING * INTO selected_grant;

  UPDATE public.app_users
  SET authz_version = authz_version + 1,
      version = version + 1,
      updated_at = statement_timestamp()
  WHERE id = selected_grant.app_user_id;

  INSERT INTO public.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) VALUES (
    'system', 'app_role.revoked', 'app_role_grant', selected_grant.id,
    jsonb_build_object(
      'schemaVersion', 1,
      'appUserId', selected_grant.app_user_id,
      'role', selected_grant.role,
      'operatorReference', requested_operator_reference,
      'reasonCode', requested_reason_code,
      'revocationOperationId', requested_revocation_operation_id
    )
  );

  RETURN QUERY SELECT selected_grant.id, selected_grant.role, selected_grant.revoked_at, false;
END
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.app_moderation_target_hidden(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_moderation_media_hidden(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_actor_moderation_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_resolve_moderation_actor(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_moderation_target_owner(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_admin_list_moderation_reports(text, text, text, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_admin_load_moderation_report(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_admin_list_moderation_actions(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_admin_apply_moderation_action(uuid, uuid, text, text, text, text, integer, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_migration_grant_role(uuid, uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_migration_revoke_role(uuid, uuid, text, text) FROM PUBLIC;

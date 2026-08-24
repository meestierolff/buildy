-- Unlisted projects are bearer-capability resources. A project UUID is not a
-- capability: only a current, expiring, owner-issued share grant may cross the
-- anonymous read boundary. Raw tokens never enter PostgreSQL.

CREATE TABLE public.project_share_links (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  token_hash text NOT NULL,
  issue_idempotency_hash text NOT NULL,
  issue_request_hash text NOT NULL,
  revoke_idempotency_hash text,
  revoke_request_hash text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_share_links_project_owner_fk
    FOREIGN KEY (project_id, owner_id)
    REFERENCES public.projects(id, owner_id)
    ON DELETE CASCADE,
  CONSTRAINT project_share_links_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT project_share_links_issue_idempotency_hash_ck CHECK (issue_idempotency_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT project_share_links_issue_request_hash_ck CHECK (issue_request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT project_share_links_revoke_hash_pair_ck CHECK (
    (revoke_idempotency_hash IS NULL) = (revoke_request_hash IS NULL)
    AND (revoke_idempotency_hash IS NULL OR revoke_idempotency_hash ~ '^[0-9a-f]{64}$')
    AND (revoke_request_hash IS NULL OR revoke_request_hash ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT project_share_links_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT project_share_links_revocation_ck CHECK (
    (revoked_at IS NULL) = (revoke_idempotency_hash IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_idempotency_hash IS NULL)
  ),
  CONSTRAINT project_share_links_version_ck CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_share_links_token_hash_uq
ON public.project_share_links(token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX project_share_links_issue_idempotency_uq
ON public.project_share_links(issue_idempotency_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX project_share_links_revoke_idempotency_uq
ON public.project_share_links(revoke_idempotency_hash)
WHERE revoke_idempotency_hash IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX project_share_links_current_project_uq
ON public.project_share_links(project_id)
WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX project_share_links_owner_created_idx
ON public.project_share_links(owner_id, created_at DESC, id DESC);
--> statement-breakpoint

CREATE TRIGGER project_share_links_set_updated_at
BEFORE UPDATE ON public.project_share_links
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

ALTER TABLE public.project_share_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_share_links_owner_select
ON public.project_share_links
FOR SELECT
USING (owner_id = public.app_actor_id());
--> statement-breakpoint

CREATE FUNCTION public.app_share_link_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN current_setting('app.share_link_id', true)
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN current_setting('app.share_link_id', true)::uuid
    ELSE NULL::uuid
  END
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
        OR project.visibility = 'public'::public.project_visibility
        OR (
          project.visibility = 'followers'::public.project_visibility
          AND EXISTS (
            SELECT 1
            FROM public.user_relationships profile_follow
            WHERE profile_follow.source_user_id = public.app_actor_id()
              AND profile_follow.target_user_id = project.owner_id
              AND profile_follow.kind = 'follow'
              AND profile_follow.status = 'active'
          )
        )
        OR (
          project.visibility = 'unlisted'::public.project_visibility
          AND EXISTS (
            SELECT 1
            FROM public.project_share_links share_link
            WHERE share_link.id = public.app_share_link_id()
              AND share_link.project_id = project.id
              AND share_link.owner_id = project.owner_id
              AND share_link.revoked_at IS NULL
              AND share_link.expires_at > statement_timestamp()
          )
        )
      )
  )
$function$;
--> statement-breakpoint

CREATE FUNCTION public.app_issue_project_share_link(
  target_project uuid,
  new_link_id uuid,
  issue_operation text,
  requested_expires_at timestamptz,
  expected_current_version integer,
  requested_token_hash text,
  requested_idempotency_hash text,
  requested_request_hash text,
  audit_request_id text
)
RETURNS TABLE(
  id uuid,
  project_id uuid,
  expires_at timestamptz,
  created_at timestamptz,
  revoked_at timestamptz,
  version integer,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  selected_project public.projects%ROWTYPE;
  existing_link public.project_share_links%ROWTYPE;
  current_link public.project_share_links%ROWTYPE;
  inserted_link public.project_share_links%ROWTYPE;
BEGIN
  IF actor_user IS NULL
     OR target_project IS NULL
     OR new_link_id IS NULL
     OR issue_operation NOT IN ('create', 'rotate')
     OR requested_expires_at <= statement_timestamp() + interval '5 minutes'
     OR requested_expires_at > statement_timestamp() + interval '90 days'
     OR requested_token_hash !~ '^[0-9a-f]{64}$'
     OR requested_idempotency_hash !~ '^[0-9a-f]{64}$'
     OR requested_request_hash !~ '^[0-9a-f]{64}$'
     OR audit_request_id !~ '^[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'invalid project share issue request' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_users account
    WHERE account.id = actor_user
      AND account.status = 'active'
      AND account.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project share owner unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT link.* INTO existing_link
  FROM public.project_share_links link
  WHERE link.owner_id = actor_user
    AND link.issue_idempotency_hash = requested_idempotency_hash;
  IF FOUND THEN
    IF existing_link.issue_request_hash <> requested_request_hash THEN
      RAISE EXCEPTION 'project share idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      existing_link.id, existing_link.project_id, existing_link.expires_at,
      existing_link.created_at, existing_link.revoked_at, existing_link.version, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('project-share:' || target_project::text, 0));

  -- A concurrent exact retry can only become visible after the project lock
  -- was acquired. Re-read the idempotency record before evaluating current
  -- project/link state so that it replays instead of failing on the state
  -- transition completed by the first transaction.
  SELECT link.* INTO existing_link
  FROM public.project_share_links link
  WHERE link.owner_id = actor_user
    AND link.issue_idempotency_hash = requested_idempotency_hash;
  IF FOUND THEN
    IF existing_link.issue_request_hash <> requested_request_hash THEN
      RAISE EXCEPTION 'project share idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      existing_link.id, existing_link.project_id, existing_link.expires_at,
      existing_link.created_at, existing_link.revoked_at, existing_link.version, true;
    RETURN;
  END IF;

  SELECT project.* INTO selected_project
  FROM public.projects project
  WHERE project.id = target_project
    AND project.owner_id = actor_user
    AND project.lifecycle_status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project share owner unavailable' USING ERRCODE = '42501';
  END IF;
  IF selected_project.visibility <> 'unlisted'::public.project_visibility THEN
    RAISE EXCEPTION 'project is not unlisted' USING ERRCODE = '55000';
  END IF;

  SELECT link.* INTO current_link
  FROM public.project_share_links link
  WHERE link.project_id = target_project
    AND link.revoked_at IS NULL
  FOR UPDATE;

  IF issue_operation = 'create' AND FOUND THEN
    RAISE EXCEPTION 'project share already exists' USING ERRCODE = '55000';
  END IF;
  IF issue_operation = 'rotate' THEN
    IF current_link.id IS NULL THEN
      RAISE EXCEPTION 'project share link missing' USING ERRCODE = '55000';
    END IF;
    IF expected_current_version IS NULL OR current_link.version <> expected_current_version THEN
      RAISE EXCEPTION 'project share version conflict' USING ERRCODE = '40001';
    END IF;
    UPDATE public.project_share_links link
    SET revoked_at = statement_timestamp(), version = link.version + 1
    WHERE link.id = current_link.id;
  ELSIF expected_current_version IS NOT NULL THEN
    RAISE EXCEPTION 'invalid project share create version' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_share_links (
    id, project_id, owner_id, token_hash, issue_idempotency_hash,
    issue_request_hash, expires_at
  ) VALUES (
    new_link_id, target_project, actor_user, requested_token_hash,
    requested_idempotency_hash, requested_request_hash, requested_expires_at
  ) RETURNING * INTO inserted_link;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, request_id, metadata
  ) VALUES (
    'user', actor_user,
    CASE WHEN issue_operation = 'rotate' THEN 'project.share_link_rotated' ELSE 'project.share_link_created' END,
    'project_share_link', inserted_link.id, audit_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', target_project,
      'expiresAt', inserted_link.expires_at,
      'version', inserted_link.version,
      'rotatedLinkId', current_link.id
    )
  );

  RETURN QUERY SELECT
    inserted_link.id, inserted_link.project_id, inserted_link.expires_at,
    inserted_link.created_at, inserted_link.revoked_at, inserted_link.version, false;
END
$function$;
--> statement-breakpoint

CREATE FUNCTION public.app_revoke_project_share_link(
  target_project uuid,
  expected_current_version integer,
  requested_idempotency_hash text,
  requested_request_hash text,
  audit_request_id text
)
RETURNS TABLE(project_id uuid, link_id uuid, version integer, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  selected_link public.project_share_links%ROWTYPE;
BEGIN
  IF actor_user IS NULL
     OR target_project IS NULL
     OR expected_current_version IS NULL
     OR requested_idempotency_hash !~ '^[0-9a-f]{64}$'
     OR requested_request_hash !~ '^[0-9a-f]{64}$'
     OR audit_request_id !~ '^[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'invalid project share revoke request' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_users account
    WHERE account.id = actor_user
      AND account.status = 'active'
      AND account.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project share owner unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT link.* INTO selected_link
  FROM public.project_share_links link
  WHERE link.owner_id = actor_user
    AND link.revoke_idempotency_hash = requested_idempotency_hash;
  IF FOUND THEN
    IF selected_link.revoke_request_hash <> requested_request_hash THEN
      RAISE EXCEPTION 'project share idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT selected_link.project_id, selected_link.id, selected_link.version, true;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('project-share:' || target_project::text, 0));

  -- Re-check after waiting for the project lock: an exact concurrent retry
  -- may have recorded its revoke hashes while this transaction was blocked.
  SELECT link.* INTO selected_link
  FROM public.project_share_links link
  WHERE link.owner_id = actor_user
    AND link.revoke_idempotency_hash = requested_idempotency_hash;
  IF FOUND THEN
    IF selected_link.revoke_request_hash <> requested_request_hash THEN
      RAISE EXCEPTION 'project share idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT selected_link.project_id, selected_link.id, selected_link.version, true;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.projects project
    JOIN public.app_users account ON account.id = project.owner_id
    WHERE project.id = target_project
      AND project.owner_id = actor_user
      AND project.lifecycle_status = 'active'
      AND account.status = 'active'
      AND account.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'project share owner unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT link.* INTO selected_link
  FROM public.project_share_links link
  WHERE link.project_id = target_project
    AND link.owner_id = actor_user
    AND link.revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project share link missing' USING ERRCODE = '55000';
  END IF;
  IF selected_link.version <> expected_current_version THEN
    RAISE EXCEPTION 'project share version conflict' USING ERRCODE = '40001';
  END IF;

  UPDATE public.project_share_links link
  SET revoked_at = statement_timestamp(),
      revoke_idempotency_hash = requested_idempotency_hash,
      revoke_request_hash = requested_request_hash,
      version = link.version + 1
  WHERE link.id = selected_link.id
  RETURNING * INTO selected_link;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, request_id, metadata
  ) VALUES (
    'user', actor_user, 'project.share_link_revoked', 'project_share_link',
    selected_link.id, audit_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'projectId', target_project,
      'version', selected_link.version
    )
  );

  RETURN QUERY SELECT selected_link.project_id, selected_link.id, selected_link.version, false;
END
$function$;
--> statement-breakpoint

CREATE FUNCTION public.app_redeem_project_share_link(requested_token_hash text)
RETURNS TABLE(status text, link_id uuid, project_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  selected_link public.project_share_links%ROWTYPE;
  selected_project public.projects%ROWTYPE;
BEGIN
  IF requested_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT link.* INTO selected_link
  FROM public.project_share_links link
  WHERE link.token_hash = requested_token_hash;
  IF NOT FOUND OR selected_link.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT project.* INTO selected_project
  FROM public.projects project
  JOIN public.app_users owner_account ON owner_account.id = project.owner_id
  WHERE project.id = selected_link.project_id
    AND project.owner_id = selected_link.owner_id
    AND project.visibility = 'unlisted'::public.project_visibility
    AND project.lifecycle_status = 'active'
    AND owner_account.status = 'active'
    AND owner_account.deleted_at IS NULL
    AND NOT public.app_moderation_target_hidden('profile', project.owner_id)
    AND NOT public.app_moderation_target_hidden('project', project.id)
    AND NOT public.app_users_are_blocked(actor_user, project.owner_id);
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF selected_link.expires_at <= statement_timestamp() THEN
    RETURN QUERY SELECT 'expired'::text, selected_link.id, selected_link.project_id, selected_link.expires_at;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'active'::text, selected_link.id, selected_link.project_id, selected_link.expires_at;
END
$function$;
--> statement-breakpoint

CREATE FUNCTION public.invalidate_project_share_links_from_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.lifecycle_status = 'deleted' THEN
    DELETE FROM public.project_share_links link WHERE link.project_id = NEW.id;
  ELSIF NEW.lifecycle_status <> 'active' OR NEW.visibility <> 'unlisted'::public.project_visibility THEN
    WITH invalidated AS (
      UPDATE public.project_share_links link
      SET revoked_at = statement_timestamp(), version = link.version + 1
      WHERE link.project_id = NEW.id AND link.revoked_at IS NULL
      RETURNING link.id, link.version
    )
    INSERT INTO public.audit_events (
      actor_kind, actor_user_id, action, resource_type, resource_id, metadata
    )
    SELECT
      CASE WHEN public.app_actor_id() IS NULL THEN 'system'::public.audit_actor_kind ELSE 'user'::public.audit_actor_kind END,
      public.app_actor_id(), 'project.share_link_invalidated', 'project_share_link', invalidated.id,
      jsonb_build_object('schemaVersion', 1, 'projectId', NEW.id, 'reason', 'project_state', 'version', invalidated.version)
    FROM invalidated;
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER projects_invalidate_share_links
AFTER UPDATE OF visibility, lifecycle_status ON public.projects
FOR EACH ROW
WHEN (OLD.visibility IS DISTINCT FROM NEW.visibility OR OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status)
EXECUTE FUNCTION public.invalidate_project_share_links_from_project();
--> statement-breakpoint

CREATE FUNCTION public.invalidate_project_share_links_from_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status = 'deleted' THEN
    DELETE FROM public.project_share_links link WHERE link.owner_id = NEW.id;
  ELSIF NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL THEN
    WITH invalidated AS (
      UPDATE public.project_share_links link
      SET revoked_at = statement_timestamp(), version = link.version + 1
      WHERE link.owner_id = NEW.id AND link.revoked_at IS NULL
      RETURNING link.id, link.project_id, link.version
    )
    INSERT INTO public.audit_events (
      actor_kind, actor_user_id, action, resource_type, resource_id, metadata
    )
    SELECT
      CASE WHEN public.app_actor_id() IS NULL THEN 'system'::public.audit_actor_kind ELSE 'user'::public.audit_actor_kind END,
      public.app_actor_id(), 'project.share_link_invalidated', 'project_share_link', invalidated.id,
      jsonb_build_object('schemaVersion', 1, 'projectId', invalidated.project_id, 'reason', 'owner_account_state', 'version', invalidated.version)
    FROM invalidated;
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER app_users_invalidate_project_share_links
AFTER UPDATE OF status, deleted_at ON public.app_users
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
EXECUTE FUNCTION public.invalidate_project_share_links_from_account();
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_share_link_id() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_issue_project_share_link(uuid,uuid,text,timestamptz,integer,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_revoke_project_share_link(uuid,integer,text,text,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_redeem_project_share_link(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invalidate_project_share_links_from_project() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.invalidate_project_share_links_from_account() FROM PUBLIC;

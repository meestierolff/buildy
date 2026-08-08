-- Engagement and social write boundary hardening.
-- All helpers derive the actor from the transaction-local server identity.

-- Profiles are the public discovery boundary. Resolve account lifecycle inside
-- the existing policy helper so read queries never need cross-user app_users
-- access (app_users itself remains self-only).
CREATE OR REPLACE FUNCTION app_can_view_profile(target_user uuid)
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

CREATE OR REPLACE FUNCTION app_can_view_update(target_update uuid, target_project uuid)
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
      AND project.lifecycle_status = 'active'
      AND item.status IN ('draft', 'published')
      AND NOT public.app_users_are_blocked(public.app_actor_id(), project.owner_id)
      AND (
        project.owner_id = public.app_actor_id()
        OR (
          item.status = 'published'
          AND (
            project.visibility = 'public'
            OR EXISTS (
              SELECT 1
              FROM public.project_access_requests access_request
              WHERE access_request.project_id = project.id
                AND access_request.requester_id = public.app_actor_id()
                AND access_request.status = 'accepted'
            )
          )
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION app_can_manage_comment(target_comment uuid)
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
      AND project.lifecycle_status = 'active'
      AND (
        comment.author_id = public.app_actor_id()
        OR project.owner_id = public.app_actor_id()
      )
  )
$function$;

DROP POLICY IF EXISTS updates_select_visible ON updates;
CREATE POLICY updates_select_visible ON updates FOR SELECT
USING (app_can_view_update(id, project_id));

DROP POLICY IF EXISTS comments_select_visible ON comments;
CREATE POLICY comments_select_visible ON comments FOR SELECT
USING (
  app_can_view_update(update_id, project_id)
  AND NOT app_users_are_blocked(app_actor_id(), author_id)
  AND status <> 'deleted'
  AND (
    status = 'published'
    OR author_id = app_actor_id()
    OR app_owns_project(project_id)
  )
);

DROP POLICY IF EXISTS comments_insert_author ON comments;
CREATE POLICY comments_insert_author ON comments FOR INSERT
WITH CHECK (
  author_id = app_actor_id()
  AND status = 'published'
  AND deleted_at IS NULL
  AND edited_at IS NULL
  AND version = 1
  AND app_can_view_update(update_id, project_id)
);

DROP POLICY IF EXISTS comments_update_author_or_owner ON comments;
CREATE POLICY comments_update_author_or_owner ON comments FOR UPDATE
USING (
  app_can_view_update(update_id, project_id)
  AND (author_id = app_actor_id() OR app_owns_project(project_id))
)
WITH CHECK (
  app_can_view_update(update_id, project_id)
  AND (author_id = app_actor_id() OR app_owns_project(project_id))
);

DROP POLICY IF EXISTS comments_delete_author_or_owner ON comments;
CREATE POLICY comments_delete_author_or_owner ON comments FOR DELETE
USING (
  app_can_view_update(update_id, project_id)
  AND (author_id = app_actor_id() OR app_owns_project(project_id))
);

CREATE OR REPLACE FUNCTION guard_comment_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.update_id IS DISTINCT FROM OLD.update_id
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.parent_comment_id IS DISTINCT FROM OLD.parent_comment_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comment identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'deleted' THEN
    RAISE EXCEPTION 'deleted comment is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM 'deleted'::comment_status
     OR NEW.deleted_at IS NULL
     OR NEW.version IS DISTINCT FROM OLD.version + 1
     OR NEW.edited_at IS DISTINCT FROM OLD.edited_at THEN
    RAISE EXCEPTION 'comments may only transition once to deleted'
      USING ERRCODE = '42501';
  END IF;
  IF public.app_actor_id() = OLD.author_id THEN
    IF NEW.body IS DISTINCT FROM '[verwijderd]' THEN
      RAISE EXCEPTION 'comment author deletion must redact the body'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'project owner may moderate but not rewrite a comment'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS comments_guard_identity ON comments;
CREATE TRIGGER comments_guard_identity
BEFORE UPDATE ON comments
FOR EACH ROW EXECUTE FUNCTION guard_comment_identity();

DROP POLICY IF EXISTS reactions_select_visible ON reactions;
CREATE POLICY reactions_select_visible ON reactions FOR SELECT
USING (
  app_can_view_update(update_id, project_id)
  AND NOT app_users_are_blocked(app_actor_id(), actor_id)
  AND (
    (target = 'update' AND comment_id IS NULL)
    OR (
      target = 'comment'
      AND EXISTS (
        SELECT 1
        FROM comments comment
        WHERE comment.id = reactions.comment_id
          AND comment.update_id = reactions.update_id
          AND comment.project_id = reactions.project_id
          AND comment.status = 'published'
      )
    )
  )
);

DROP POLICY IF EXISTS reactions_insert_self ON reactions;
CREATE POLICY reactions_insert_self ON reactions FOR INSERT
WITH CHECK (
  actor_id = app_actor_id()
  AND app_can_view_update(update_id, project_id)
  AND (
    (target = 'update' AND comment_id IS NULL)
    OR (
      target = 'comment'
      AND EXISTS (
        SELECT 1
        FROM comments comment
        WHERE comment.id = reactions.comment_id
          AND comment.update_id = reactions.update_id
          AND comment.project_id = reactions.project_id
          AND comment.status = 'published'
          AND NOT app_users_are_blocked(app_actor_id(), comment.author_id)
      )
    )
  )
);

DROP POLICY IF EXISTS reactions_delete_self ON reactions;
CREATE POLICY reactions_delete_self ON reactions FOR DELETE
USING (actor_id = app_actor_id());

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target_hierarchy_ck;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_target_hierarchy_ck CHECK (
    (update_id IS NULL OR project_id IS NOT NULL)
    AND (comment_id IS NULL OR update_id IS NOT NULL)
  ) NOT VALID;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_target_hierarchy_ck;

CREATE OR REPLACE FUNCTION guard_notification_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_actor_id() = OLD.recipient_id THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
       OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.update_id IS DISTINCT FROM OLD.update_id
       OR NEW.comment_id IS DISTINCT FROM OLD.comment_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'recipient may only update notification read state'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status = 'archived'
       OR NEW.status NOT IN ('read', 'archived')
       OR NEW.read_at IS NULL THEN
      RAISE EXCEPTION 'invalid recipient notification transition'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION app_can_view_notification_target(
  target_actor uuid,
  target_project uuid,
  target_update uuid,
  target_comment uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    (target_actor IS NULL OR NOT public.app_users_are_blocked(public.app_actor_id(), target_actor))
    AND (target_project IS NULL OR public.app_can_view_project(target_project))
    AND (
      target_update IS NULL
      OR public.app_can_view_update(target_update, target_project)
    )
    AND (
      target_comment IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.comments comment
        WHERE comment.id = target_comment
          AND comment.update_id = target_update
          AND comment.project_id = target_project
          AND comment.status = 'published'
      )
    )
$function$;

DROP POLICY IF EXISTS notifications_select_recipient ON notifications;
CREATE POLICY notifications_select_recipient ON notifications FOR SELECT
USING (
  recipient_id = app_actor_id()
  AND app_can_view_notification_target(actor_id, project_id, update_id, comment_id)
);

DROP POLICY IF EXISTS notifications_update_recipient ON notifications;
CREATE POLICY notifications_update_recipient ON notifications FOR UPDATE
USING (
  recipient_id = app_actor_id()
  AND app_can_view_notification_target(actor_id, project_id, update_id, comment_id)
)
WITH CHECK (
  recipient_id = app_actor_id()
  AND app_can_view_notification_target(actor_id, project_id, update_id, comment_id)
);

DROP POLICY IF EXISTS notifications_delete_recipient ON notifications;
CREATE POLICY notifications_delete_recipient ON notifications FOR DELETE
USING (
  recipient_id = app_actor_id()
  AND app_can_view_notification_target(actor_id, project_id, update_id, comment_id)
);

-- This narrow helper is the only cross-user app_users read needed by the
-- server social repository. It locks the same ordered pair as the repository.
CREATE OR REPLACE FUNCTION app_lock_social_user_pair(target_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  target_is_private boolean;
BEGIN
  IF actor_user IS NULL OR target_user IS NULL OR actor_user = target_user THEN
    RAISE EXCEPTION 'invalid social actor pair' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'social:' || least(actor_user, target_user)::text || ':' || greatest(actor_user, target_user)::text,
      0
    )
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.app_users app_user
    WHERE app_user.id = actor_user
      AND app_user.status = 'active'
      AND app_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'inactive social actor' USING ERRCODE = '42501';
  END IF;

  SELECT profile.is_private
  INTO target_is_private
  FROM public.app_users app_user
  JOIN public.profiles profile ON profile.user_id = app_user.id
  WHERE app_user.id = target_user
    AND app_user.status = 'active'
    AND app_user.deleted_at IS NULL;

  IF target_is_private IS NULL THEN
    RAISE EXCEPTION 'social target unavailable' USING ERRCODE = 'P0002';
  END IF;
  RETURN target_is_private;
END
$function$;

CREATE OR REPLACE FUNCTION app_follow_state_allowed(
  target_user uuid,
  desired_status relationship_status
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users app_user
    JOIN public.profiles profile ON profile.user_id = app_user.id
    WHERE app_user.id = target_user
      AND app_user.status = 'active'
      AND app_user.deleted_at IS NULL
      AND NOT public.app_users_are_blocked(public.app_actor_id(), target_user)
      AND (
        (desired_status = 'pending' AND profile.is_private)
        OR (desired_status = 'active' AND NOT profile.is_private)
      )
  )
$function$;

CREATE OR REPLACE FUNCTION app_social_project_context(
  target_project uuid,
  lock_project boolean
)
RETURNS TABLE(project_id uuid, owner_id uuid, visibility project_visibility)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
BEGIN
  IF actor_user IS NULL
     OR target_project IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.app_users actor
       WHERE actor.id = actor_user
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid social project actor' USING ERRCODE = '42501';
  END IF;

  IF lock_project THEN
    RETURN QUERY
    SELECT project.id, project.owner_id, project.visibility
    FROM public.projects project
    JOIN public.app_users owner ON owner.id = project.owner_id
    WHERE project.id = target_project
      AND project.lifecycle_status = 'active'
      AND owner.status = 'active'
      AND owner.deleted_at IS NULL
      AND NOT public.app_users_are_blocked(actor_user, project.owner_id)
    FOR UPDATE OF project;
  ELSE
    RETURN QUERY
    SELECT project.id, project.owner_id, project.visibility
    FROM public.projects project
    JOIN public.app_users owner ON owner.id = project.owner_id
    WHERE project.id = target_project
      AND project.lifecycle_status = 'active'
      AND owner.status = 'active'
      AND owner.deleted_at IS NULL
      AND NOT public.app_users_are_blocked(actor_user, project.owner_id);
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION app_resolve_engagement_mentions(
  target_project uuid,
  target_update uuid,
  requested_mentions uuid[]
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  project_owner uuid;
  project_visibility project_visibility;
  item_status update_status;
  normalized uuid[];
  resolved uuid[];
BEGIN
  IF actor_user IS NULL
     OR target_project IS NULL
     OR target_update IS NULL
     OR cardinality(coalesce(requested_mentions, ARRAY[]::uuid[])) > 10
     OR NOT public.app_can_view_update(target_update, target_project) THEN
    RAISE EXCEPTION 'invalid engagement mentions' USING ERRCODE = '42501';
  END IF;

  SELECT project.owner_id, project.visibility, item.status
  INTO project_owner, project_visibility, item_status
  FROM public.projects project
  JOIN public.updates item
    ON item.id = target_update AND item.project_id = project.id
  WHERE project.id = target_project
    AND project.lifecycle_status = 'active'
    AND item.status IN ('draft', 'published');

  SELECT coalesce(array_agg(candidate ORDER BY candidate), ARRAY[]::uuid[])
  INTO normalized
  FROM (
    SELECT DISTINCT mention_id AS candidate
    FROM unnest(coalesce(requested_mentions, ARRAY[]::uuid[])) mention(mention_id)
    WHERE mention_id IS NOT NULL AND mention_id <> actor_user
  ) requested;

  SELECT coalesce(array_agg(candidate.id ORDER BY candidate.id), ARRAY[]::uuid[])
  INTO resolved
  FROM public.app_users candidate
  WHERE candidate.id = ANY(normalized)
    AND candidate.status = 'active'
    AND candidate.deleted_at IS NULL
    AND NOT public.app_users_are_blocked(candidate.id, actor_user)
    AND NOT public.app_users_are_blocked(candidate.id, project_owner)
    AND (
      candidate.id = project_owner
      OR (
        item_status = 'published'
        AND (
          project_visibility = 'public'
          OR EXISTS (
            SELECT 1
            FROM public.project_access_requests access_request
            WHERE access_request.project_id = target_project
              AND access_request.requester_id = candidate.id
              AND access_request.status = 'accepted'
          )
        )
      )
    );

  IF cardinality(resolved) <> cardinality(normalized) THEN
    RAISE EXCEPTION 'engagement mention target unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN resolved;
END
$function$;

DROP POLICY IF EXISTS relationships_insert_source ON user_relationships;
CREATE POLICY relationships_insert_source ON user_relationships FOR INSERT
WITH CHECK (
  source_user_id = app_actor_id()
  AND source_user_id <> target_user_id
  AND (
    (kind = 'block' AND status = 'active')
    OR (
      kind = 'follow'
      AND app_follow_state_allowed(target_user_id, status)
    )
  )
);

DROP POLICY IF EXISTS relationships_update_target_follow ON user_relationships;
CREATE POLICY relationships_update_target_follow ON user_relationships FOR UPDATE
USING (
  kind = 'follow'
  AND target_user_id = app_actor_id()
  AND status IN ('pending', 'active')
)
WITH CHECK (
  kind = 'follow'
  AND target_user_id = app_actor_id()
  AND status IN ('active', 'rejected', 'revoked')
);

CREATE POLICY relationships_update_source_follow ON user_relationships FOR UPDATE
USING (kind = 'follow' AND source_user_id = app_actor_id())
WITH CHECK (
  kind = 'follow'
  AND source_user_id = app_actor_id()
  AND (
    status = 'revoked'
    OR app_follow_state_allowed(target_user_id, status)
  )
);

CREATE POLICY relationships_update_source_block ON user_relationships FOR UPDATE
USING (kind = 'block' AND source_user_id = app_actor_id())
WITH CHECK (
  kind = 'block'
  AND source_user_id = app_actor_id()
  AND status IN ('active', 'revoked')
);

DROP POLICY IF EXISTS access_requests_update_owner ON project_access_requests;
DROP POLICY IF EXISTS access_requests_insert_requester ON project_access_requests;
CREATE POLICY access_requests_insert_requester ON project_access_requests FOR INSERT
WITH CHECK (
  requester_id = app_actor_id()
  AND requester_id <> project_owner_id
  AND status = 'pending'
  AND decided_by_id IS NULL
  AND decided_at IS NULL
  AND revoked_at IS NULL
  AND version = 1
  AND EXISTS (
    SELECT 1
    FROM app_social_project_context(project_id, false) project_context
    WHERE project_context.owner_id = project_owner_id
      AND project_context.visibility = 'private'
  )
);

CREATE POLICY access_requests_update_owner ON project_access_requests FOR UPDATE
USING (
  project_owner_id = app_actor_id()
  AND status IN ('pending', 'accepted')
)
WITH CHECK (
  project_owner_id = app_actor_id()
  AND (
    status = 'revoked'
    OR (
      status IN ('accepted', 'rejected')
      AND NOT app_users_are_blocked(app_actor_id(), requester_id)
      AND EXISTS (
        SELECT 1
        FROM app_social_project_context(project_id, false) project_context
        WHERE project_context.owner_id = project_owner_id
          AND project_context.visibility = 'private'
      )
    )
  )
);

CREATE POLICY access_requests_update_requester ON project_access_requests FOR UPDATE
USING (requester_id = app_actor_id())
WITH CHECK (
  requester_id = app_actor_id()
  AND (
    status IN ('cancelled', 'revoked')
    OR (
      status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM app_social_project_context(project_id, false) project_context
        WHERE project_context.owner_id = project_owner_id
          AND project_context.visibility = 'private'
      )
    )
  )
);

DROP POLICY IF EXISTS project_followers_insert_self ON project_followers;
CREATE POLICY project_followers_insert_self ON project_followers FOR INSERT
WITH CHECK (
  follower_id = app_actor_id()
  AND status = 'active'
  AND app_can_view_project(project_id)
);

CREATE OR REPLACE FUNCTION guard_project_follower_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.project_owner_id IS DISTINCT FROM OLD.project_owner_id
     OR NEW.follower_id IS DISTINCT FROM OLD.follower_id THEN
    RAISE EXCEPTION 'project follower identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS project_followers_guard_identity ON project_followers;
CREATE TRIGGER project_followers_guard_identity
BEFORE UPDATE ON project_followers
FOR EACH ROW EXECUTE FUNCTION guard_project_follower_identity();

CREATE POLICY project_followers_update_participant ON project_followers FOR UPDATE
USING (follower_id = app_actor_id() OR project_owner_id = app_actor_id())
WITH CHECK (
  (
    follower_id = app_actor_id()
    AND status IN ('active', 'muted', 'revoked')
    AND (status = 'revoked' OR app_can_view_project(project_id))
  )
  OR (project_owner_id = app_actor_id() AND status = 'revoked')
);

-- Social notification creation validates the already-committed-in-this-
-- transaction relationship transition. Actor, payload and dedupe are derived.
CREATE OR REPLACE FUNCTION app_enqueue_social_notification(
  notification_recipient uuid,
  notification_type text,
  notification_project uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  source_token text;
  notification_id uuid;
  notification_dedupe text;
BEGIN
  IF actor_user IS NULL
     OR notification_recipient IS NULL
     OR actor_user = notification_recipient
     OR NOT EXISTS (
       SELECT 1 FROM public.app_users actor
       WHERE actor.id = actor_user AND actor.status = 'active' AND actor.deleted_at IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.app_users recipient
       WHERE recipient.id = notification_recipient
         AND recipient.status = 'active'
         AND recipient.deleted_at IS NULL
     )
     OR public.app_users_are_blocked(actor_user, notification_recipient) THEN
    RAISE EXCEPTION 'invalid social notification participants' USING ERRCODE = '42501';
  END IF;

  IF notification_type IN ('profile.follow.requested', 'profile.followed')
     AND notification_project IS NULL THEN
    SELECT relationship.id::text || ':v' || relationship.version::text
    INTO source_token
    FROM public.user_relationships relationship
    WHERE relationship.source_user_id = actor_user
      AND relationship.target_user_id = notification_recipient
      AND relationship.kind = 'follow'
      AND relationship.status = CASE
        WHEN notification_type = 'profile.follow.requested' THEN 'pending'::relationship_status
        ELSE 'active'::relationship_status
      END;
  ELSIF notification_type IN ('profile.follow.accepted', 'profile.follow.rejected')
        AND notification_project IS NULL THEN
    SELECT relationship.id::text || ':v' || relationship.version::text
    INTO source_token
    FROM public.user_relationships relationship
    WHERE relationship.source_user_id = notification_recipient
      AND relationship.target_user_id = actor_user
      AND relationship.kind = 'follow'
      AND relationship.status = CASE
        WHEN notification_type = 'profile.follow.accepted' THEN 'active'::relationship_status
        ELSE 'rejected'::relationship_status
      END;
  ELSIF notification_type = 'project.followed' AND notification_project IS NOT NULL THEN
    SELECT follower.project_id::text || ':' || follower.follower_id::text || ':' || follower.updated_at::text
    INTO source_token
    FROM public.project_followers follower
    JOIN public.projects project ON project.id = follower.project_id
    WHERE follower.project_id = notification_project
      AND follower.follower_id = actor_user
      AND follower.project_owner_id = notification_recipient
      AND follower.status = 'active'
      AND project.lifecycle_status = 'active';
  ELSIF notification_type = 'project.access.requested' AND notification_project IS NOT NULL THEN
    SELECT access_request.id::text || ':v' || access_request.version::text
    INTO source_token
    FROM public.project_access_requests access_request
    WHERE access_request.project_id = notification_project
      AND access_request.requester_id = actor_user
      AND access_request.project_owner_id = notification_recipient
      AND access_request.status = 'pending';
  ELSIF notification_type IN ('project.access.accepted', 'project.access.rejected')
        AND notification_project IS NOT NULL THEN
    SELECT access_request.id::text || ':v' || access_request.version::text
    INTO source_token
    FROM public.project_access_requests access_request
    WHERE access_request.project_id = notification_project
      AND access_request.requester_id = notification_recipient
      AND access_request.project_owner_id = actor_user
      AND access_request.status = CASE
        WHEN notification_type = 'project.access.accepted' THEN 'accepted'::access_request_status
        ELSE 'rejected'::access_request_status
      END;
  ELSE
    RAISE EXCEPTION 'unsupported social notification type' USING ERRCODE = '22023';
  END IF;

  IF source_token IS NULL THEN
    RAISE EXCEPTION 'social notification transition not found' USING ERRCODE = '42501';
  END IF;

  notification_dedupe := 'social-notification:v1:' || encode(
    digest(notification_type || ':' || source_token || ':' || notification_recipient::text, 'sha256'),
    'hex'
  );

  INSERT INTO public.notifications (
    recipient_id, actor_id, project_id, type, dedupe_key, payload
  ) VALUES (
    notification_recipient,
    actor_user,
    notification_project,
    notification_type,
    notification_dedupe,
    jsonb_build_object('schemaVersion', 1)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT id INTO notification_id
    FROM public.notifications
    WHERE dedupe_key = notification_dedupe;
  ELSE
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'notification',
      notification_id,
      'social.notification.created.v1',
      'social-notification:' || notification_id::text,
      jsonb_build_object('schemaVersion', 1)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN notification_id;
END
$function$;

CREATE OR REPLACE FUNCTION app_enqueue_engagement_notification(
  notification_recipient uuid,
  notification_type text,
  source_aggregate uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  target_project uuid;
  target_update uuid;
  target_comment uuid;
  expected_recipient uuid;
  notification_id uuid;
  notification_dedupe text;
BEGIN
  IF actor_user IS NULL
     OR notification_recipient IS NULL
     OR source_aggregate IS NULL
     OR actor_user = notification_recipient
     OR NOT EXISTS (
       SELECT 1
       FROM public.app_users actor
       WHERE actor.id = actor_user
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'invalid engagement notification participants' USING ERRCODE = '42501';
  END IF;

  IF notification_type IN ('comment.created', 'comment.reply', 'comment.mention') THEN
    SELECT comment.project_id, comment.update_id, comment.id
    INTO target_project, target_update, target_comment
    FROM public.comments comment
    WHERE comment.id = source_aggregate
      AND comment.author_id = actor_user
      AND comment.status = 'published';

    IF notification_type = 'comment.created' THEN
      SELECT item.author_id INTO expected_recipient
      FROM public.updates item
      WHERE item.id = target_update AND item.project_id = target_project;
    ELSIF notification_type = 'comment.reply' THEN
      SELECT parent.author_id INTO expected_recipient
      FROM public.comments child
      JOIN public.comments parent
        ON parent.id = child.parent_comment_id
       AND parent.update_id = child.update_id
      WHERE child.id = source_aggregate AND parent.status = 'published';
    ELSE
      SELECT mention.mentioned_user_id INTO expected_recipient
      FROM public.comment_mentions mention
      WHERE mention.comment_id = source_aggregate
        AND mention.update_id = target_update
        AND mention.mentioned_user_id = notification_recipient;
    END IF;
  ELSIF notification_type = 'reaction.created' THEN
    SELECT reaction.project_id, reaction.update_id, reaction.comment_id
    INTO target_project, target_update, target_comment
    FROM public.reactions reaction
    WHERE reaction.id = source_aggregate AND reaction.actor_id = actor_user;

    IF target_comment IS NULL THEN
      SELECT item.author_id INTO expected_recipient
      FROM public.updates item
      WHERE item.id = target_update AND item.project_id = target_project;
    ELSE
      SELECT comment.author_id INTO expected_recipient
      FROM public.comments comment
      WHERE comment.id = target_comment
        AND comment.update_id = target_update
        AND comment.project_id = target_project
        AND comment.status = 'published';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported engagement notification type' USING ERRCODE = '22023';
  END IF;

  IF target_project IS NULL
     OR target_update IS NULL
     OR expected_recipient IS DISTINCT FROM notification_recipient
     OR NOT public.app_can_view_update(target_update, target_project) THEN
    RAISE EXCEPTION 'engagement notification target unavailable' USING ERRCODE = '42501';
  END IF;

  IF public.app_users_are_blocked(actor_user, notification_recipient)
     OR NOT EXISTS (
       SELECT 1
       FROM public.app_users recipient
       JOIN public.projects project ON project.id = target_project
       JOIN public.updates item
         ON item.id = target_update AND item.project_id = project.id
       WHERE recipient.id = notification_recipient
         AND recipient.status = 'active'
         AND recipient.deleted_at IS NULL
         AND project.lifecycle_status = 'active'
         AND item.status IN ('draft', 'published')
         AND NOT public.app_users_are_blocked(recipient.id, project.owner_id)
         AND (
           recipient.id = project.owner_id
           OR (
             item.status = 'published'
             AND (
               project.visibility = 'public'
               OR EXISTS (
                 SELECT 1
                 FROM public.project_access_requests access_request
                 WHERE access_request.project_id = project.id
                   AND access_request.requester_id = recipient.id
                   AND access_request.status = 'accepted'
               )
             )
           )
         )
     ) THEN
    RETURN NULL;
  END IF;

  notification_dedupe := 'engagement-notification:v1:' || encode(
    digest(notification_type || ':' || source_aggregate::text || ':' || notification_recipient::text, 'sha256'),
    'hex'
  );

  INSERT INTO public.notifications (
    recipient_id, actor_id, project_id, update_id, comment_id,
    type, dedupe_key, payload
  ) VALUES (
    notification_recipient,
    actor_user,
    target_project,
    target_update,
    target_comment,
    notification_type,
    notification_dedupe,
    jsonb_build_object('schemaVersion', 1)
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT id INTO notification_id
    FROM public.notifications
    WHERE dedupe_key = notification_dedupe;
  ELSE
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    ) VALUES (
      'notification',
      notification_id,
      'engagement.notification.created.v1',
      'engagement-notification:' || notification_id::text,
      jsonb_build_object('schemaVersion', 1)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN notification_id;
END
$function$;

-- Direct notification/outbox inserts remain denied by the absence of a
-- notification INSERT policy. Only the validated SECURITY DEFINER helpers can
-- write those rows. Comment mutation events get a separate minimal policy.
CREATE POLICY outbox_events_select_engagement_comment ON outbox_events FOR SELECT
USING (
  aggregate_type = 'comment'
  AND app_can_manage_comment(aggregate_id)
);

CREATE POLICY outbox_events_insert_engagement_comment ON outbox_events FOR INSERT
WITH CHECK (
  aggregate_type = 'comment'
  AND event_type IN ('engagement.comment.created.v1', 'engagement.comment.deleted.v1')
  AND app_can_manage_comment(aggregate_id)
  AND idempotency_key ~ '^engagement-command:v1:comment\.(create|delete):[0-9a-f]{64}$'
  AND payload ->> 'schemaVersion' = '1'
  AND payload ->> 'requestHash' ~ '^[0-9a-f]{64}$'
  AND payload - ARRAY['schemaVersion', 'requestHash'] = '{}'::jsonb
);

REVOKE EXECUTE ON FUNCTION guard_comment_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_project_follower_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guard_notification_recipient_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_can_view_profile(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_can_view_update(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_can_manage_comment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_can_view_notification_target(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_lock_social_user_pair(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_follow_state_allowed(uuid, relationship_status) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_social_project_context(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_resolve_engagement_mentions(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_enqueue_social_notification(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_enqueue_engagement_notification(uuid, text, uuid) FROM PUBLIC;

-- Four-mode project visibility. The original enum is retained under a legacy
-- name because app_social_project_context's historical return signature is
-- referenced by RLS policies. Runtime project rows exclusively use the new
-- canonical project_visibility type.

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_publication_ck;
--> statement-breakpoint
ALTER TABLE public.projects
  ALTER COLUMN visibility DROP DEFAULT;
--> statement-breakpoint
ALTER TYPE public.project_visibility RENAME TO project_visibility_legacy;
--> statement-breakpoint
ALTER TYPE public.project_visibility_legacy ADD VALUE 'followers';
ALTER TYPE public.project_visibility_legacy ADD VALUE 'unlisted';
--> statement-breakpoint
CREATE TYPE public.project_visibility AS ENUM (
  'private',
  'followers',
  'unlisted',
  'public'
);
--> statement-breakpoint
ALTER TABLE public.projects
  ALTER COLUMN visibility TYPE public.project_visibility
  USING visibility::text::public.project_visibility;
--> statement-breakpoint
ALTER TABLE public.projects
  ALTER COLUMN visibility SET DEFAULT 'private'::public.project_visibility;
--> statement-breakpoint
ALTER TABLE public.projects
  ADD CONSTRAINT projects_publication_ck CHECK (
    visibility = 'private'::public.project_visibility
    OR published_at IS NOT NULL
  );
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
        OR project.visibility IN (
          'unlisted'::public.project_visibility,
          'public'::public.project_visibility
        )
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
      )
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

-- Preserve the legacy function signature while returning the same textual
-- values to the TypeScript social compatibility repository.
CREATE OR REPLACE FUNCTION public.app_social_project_context(
  target_project uuid,
  lock_project boolean
)
RETURNS TABLE(
  project_id uuid,
  owner_id uuid,
  visibility public.project_visibility_legacy
)
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
    SELECT
      project.id,
      project.owner_id,
      project.visibility::text::public.project_visibility_legacy
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
    SELECT
      project.id,
      project.owner_id,
      project.visibility::text::public.project_visibility_legacy
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_resolve_engagement_mentions(
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
  selected_visibility text;
  item_status public.update_status;
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

  SELECT project.owner_id, project.visibility::text, item.status
  INTO project_owner, selected_visibility, item_status
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
          selected_visibility IN ('unlisted', 'public')
          OR (
            selected_visibility = 'followers'
            AND EXISTS (
              SELECT 1
              FROM public.user_relationships profile_follow
              WHERE profile_follow.source_user_id = candidate.id
                AND profile_follow.target_user_id = project_owner
                AND profile_follow.kind = 'follow'
                AND profile_follow.status = 'active'
            )
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_enqueue_engagement_notification(
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
       SELECT 1 FROM public.app_users actor
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
               project.visibility IN (
                 'unlisted'::public.project_visibility,
                 'public'::public.project_visibility
               )
               OR (
                 project.visibility = 'followers'::public.project_visibility
                 AND EXISTS (
                   SELECT 1
                   FROM public.user_relationships profile_follow
                   WHERE profile_follow.source_user_id = recipient.id
                     AND profile_follow.target_user_id = project.owner_id
                     AND profile_follow.kind = 'follow'
                     AND profile_follow.status = 'active'
                 )
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
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.app_can_view_project(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_can_view_update(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_social_project_context(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_resolve_engagement_mentions(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_enqueue_engagement_notification(uuid, text, uuid) FROM PUBLIC;

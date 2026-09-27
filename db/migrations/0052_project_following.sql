-- A project follow is a subscription, never a visibility grant. Keep the
-- existing participant RLS and app_can_view_project unchanged. Only the
-- aggregate and narrowly authorized revocation cross participant visibility.
CREATE FUNCTION public.app_project_follow_summary(target_project uuid)
RETURNS TABLE(follower_count integer, viewer_follow_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    (
      SELECT count(*)::integer
      FROM public.project_followers follower
      JOIN public.app_users account ON account.id = follower.follower_id
      WHERE follower.project_id = project.id
        AND follower.status IN ('active', 'muted')
        AND account.status = 'active'
        AND account.deleted_at IS NULL
        AND NOT public.app_users_are_blocked(follower.follower_id, project.owner_id)
        AND NOT public.app_moderation_target_hidden('profile', follower.follower_id)
    ),
    CASE
      WHEN project.owner_id = public.app_actor_id() THEN 'self'
      WHEN EXISTS (
        SELECT 1 FROM public.project_followers follower
        WHERE follower.project_id = project.id
          AND follower.follower_id = public.app_actor_id()
          AND follower.status IN ('active', 'muted')
      ) THEN 'following'
      ELSE 'none'
    END
  FROM public.projects project
  WHERE project.id = target_project
    AND public.app_can_view_project(project.id)
    AND (
      public.app_actor_id() IS NULL
      OR EXISTS (
        SELECT 1 FROM public.app_users actor
        WHERE actor.id = public.app_actor_id()
          AND actor.status = 'active'
          AND actor.deleted_at IS NULL
      )
    )
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_project_follow_summary(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION public.app_set_project_follow(target_project uuid, requested_follow boolean)
RETURNS TABLE(replayed boolean, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  owner_user uuid;
  changed_rows integer;
BEGIN
  IF actor_user IS NULL OR target_project IS NULL OR requested_follow IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.app_users account
       WHERE account.id = actor_user AND account.status = 'active'
         AND account.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'project follower unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT project.owner_id INTO owner_user
  FROM public.projects project WHERE project.id = target_project;
  IF owner_user IS NOT NULL THEN
    -- Same ordered pair lock as profile blocking/removal. Revocation must also
    -- work when that owner's account or content is no longer available.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'social:' || least(actor_user, owner_user)::text || ':' || greatest(actor_user, owner_user)::text,
      0
    ));
  END IF;

  IF NOT requested_follow THEN
    UPDATE public.project_followers follower
    SET status = 'revoked', updated_at = statement_timestamp()
    WHERE follower.project_id = target_project
      AND follower.follower_id = actor_user
      AND follower.status IN ('active', 'muted');
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    -- The same response for unknown and invisible projects discloses no
    -- content or other participant's relationship.
    RETURN QUERY SELECT changed_rows = 0, 'none'::text;
    RETURN;
  END IF;

  IF owner_user IS NULL OR owner_user = actor_user
     OR NOT public.app_can_view_project(target_project) THEN
    RAISE EXCEPTION 'project follower unavailable' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.project_followers AS follower (
    project_id, project_owner_id, follower_id, status
  ) VALUES (target_project, owner_user, actor_user, 'active')
  ON CONFLICT (project_id, follower_id) DO UPDATE
    SET status = 'active', followed_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE follower.status <> 'active';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows > 0 THEN
    PERFORM public.app_enqueue_social_notification(owner_user, 'project.followed', target_project);
  END IF;
  RETURN QUERY SELECT changed_rows = 0, 'following'::text;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_set_project_follow(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION public.app_revoke_project_follows(target_follower uuid, target_owner uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  changed_rows integer;
BEGIN
  IF actor_user IS NULL OR target_follower IS NULL OR target_owner IS NULL
     OR actor_user NOT IN (target_follower, target_owner)
     OR NOT EXISTS (
       SELECT 1 FROM public.app_users account
       WHERE account.id = actor_user AND account.status = 'active'
         AND account.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'project follower unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'social:' || least(target_follower, target_owner)::text || ':' || greatest(target_follower, target_owner)::text,
    0
  ));
  UPDATE public.project_followers follower
  SET status = 'revoked', updated_at = statement_timestamp()
  WHERE follower.follower_id = target_follower
    AND follower.project_owner_id = target_owner
    AND follower.status IN ('active', 'muted');
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_revoke_project_follows(uuid, uuid) FROM PUBLIC;

--> statement-breakpoint

-- Publication subscriptions target this project only. Existing visibility,
-- account, moderation and block eligibility still apply; a bearer link is not
-- a durable notification access grant. Keep unlisted/private targets excluded.
CREATE OR REPLACE FUNCTION public.app_enqueue_first_update_publication_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'published'::public.update_status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published'::public.update_status THEN
    RETURN NEW;
  END IF;

  WITH inserted_notifications AS (
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      project_id,
      update_id,
      type,
      dedupe_key,
      payload
    )
    SELECT
      recipient.id,
      NEW.author_id,
      NEW.project_id,
      NEW.id,
      'update.published',
      'product-notification:v2:' || gen_random_uuid()::text,
      jsonb_build_object('schemaVersion', 1)
    FROM public.projects project
    JOIN public.app_users owner_account
      ON owner_account.id = project.owner_id
    JOIN public.app_users author_account
      ON author_account.id = NEW.author_id
    JOIN public.project_followers project_follow
      ON project_follow.project_id = project.id
     AND project_follow.project_owner_id = project.owner_id
     AND project_follow.status = 'active'
    JOIN public.app_users recipient
      ON recipient.id = project_follow.follower_id
    WHERE project.id = NEW.project_id
      AND project.owner_id = NEW.project_owner_id
      AND project.lifecycle_status = 'active'
      AND (
        project.visibility = 'public'::public.project_visibility
        OR (
          project.visibility = 'followers'::public.project_visibility
          AND EXISTS (
            SELECT 1 FROM public.user_relationships profile_follow
            WHERE profile_follow.source_user_id = recipient.id
              AND profile_follow.target_user_id = project.owner_id
              AND profile_follow.kind = 'follow'
              AND profile_follow.status = 'active'
          )
        )
      )
      AND owner_account.status = 'active'
      AND owner_account.deleted_at IS NULL
      AND author_account.status = 'active'
      AND author_account.deleted_at IS NULL
      AND recipient.status = 'active'
      AND recipient.deleted_at IS NULL
      AND recipient.id <> NEW.author_id
      AND NOT public.app_users_are_blocked(recipient.id, project.owner_id)
      AND NOT public.app_users_are_blocked(recipient.id, NEW.author_id)
      AND NOT public.app_moderation_target_hidden('profile', project.owner_id)
      AND NOT public.app_moderation_target_hidden('profile', NEW.author_id)
      AND NOT public.app_moderation_target_hidden('profile', recipient.id)
      AND NOT public.app_moderation_target_hidden('project', NEW.project_id)
      AND NOT public.app_moderation_target_hidden('update', NEW.id)
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  INSERT INTO public.outbox_events (
    aggregate_type,
    aggregate_id,
    event_type,
    idempotency_key,
    payload
  )
  SELECT
    'notification',
    notification.id,
    'product.notification.created.v1',
    'product-notification:' || notification.id::text,
    jsonb_build_object('schemaVersion', 1)
  FROM inserted_notifications notification
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_first_update_publication_notifications()
FROM PUBLIC;

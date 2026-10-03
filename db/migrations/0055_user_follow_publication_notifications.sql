-- Both an explicit project subscription and an accepted user follow can
-- subscribe to published Bouwmomenten. Neither grants new content access.
-- UNION and the existing recipient/update uniqueness constraint prevent
-- duplicate notifications. An explicit project mute wins over either path.
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
      recipient_id, actor_id, project_id, update_id, type, dedupe_key, payload
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
    JOIN public.app_users owner_account ON owner_account.id = project.owner_id
    JOIN public.app_users author_account ON author_account.id = NEW.author_id
    JOIN LATERAL (
      SELECT project_follow.follower_id
      FROM public.project_followers project_follow
      WHERE project_follow.project_id = project.id
        AND project_follow.project_owner_id = project.owner_id
        AND project_follow.status = 'active'
      UNION
      SELECT profile_follow.source_user_id AS follower_id
      FROM public.user_relationships profile_follow
      WHERE profile_follow.target_user_id = project.owner_id
        AND profile_follow.kind = 'follow'
        AND profile_follow.status = 'active'
    ) subscription ON true
    JOIN public.app_users recipient ON recipient.id = subscription.follower_id
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
      AND NOT EXISTS (
        SELECT 1 FROM public.project_followers project_mute
        WHERE project_mute.project_id = project.id
          AND project_mute.follower_id = recipient.id
          AND project_mute.status = 'muted'
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
    aggregate_type, aggregate_id, event_type, idempotency_key, payload
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

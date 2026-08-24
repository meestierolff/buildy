-- Product notifications are derived atomically from durable publication and
-- order-ledger truth. Their payloads are deliberately context-free: target
-- identifiers live in typed foreign-key columns and no customer data is copied.

ALTER TABLE public.notifications
ADD COLUMN order_id uuid;
--> statement-breakpoint
ALTER TABLE public.notifications
ADD CONSTRAINT notifications_order_fk
FOREIGN KEY (order_id)
REFERENCES public.photobook_orders(id)
ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX notifications_recipient_order_idx
ON public.notifications(recipient_id, order_id, created_at DESC)
WHERE order_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_update_published_recipient_uq
ON public.notifications(update_id, recipient_id, type)
WHERE type = 'update.published';
--> statement-breakpoint

ALTER TABLE public.notifications
DROP CONSTRAINT notifications_target_hierarchy_ck;
--> statement-breakpoint
ALTER TABLE public.notifications
ADD CONSTRAINT notifications_target_hierarchy_ck CHECK (
  (update_id IS NULL OR project_id IS NOT NULL)
  AND (comment_id IS NULL OR update_id IS NOT NULL)
  AND (
    order_id IS NULL
    OR (
      actor_id IS NULL
      AND project_id IS NULL
      AND update_id IS NULL
      AND comment_id IS NULL
    )
  )
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.notifications
VALIDATE CONSTRAINT notifications_target_hierarchy_ck;
--> statement-breakpoint
ALTER TABLE public.notifications
ADD CONSTRAINT notifications_product_target_ck CHECK (
  (
    type <> 'update.published'
    OR (
      actor_id IS NOT NULL
      AND project_id IS NOT NULL
      AND update_id IS NOT NULL
      AND comment_id IS NULL
      AND order_id IS NULL
    )
  )
  AND (
    type NOT IN (
      'order.payment.succeeded',
      'order.payment.failed',
      'order.payment.expired',
      'order.payment.partially_refunded',
      'order.payment.refunded',
      'order.manual_review',
      'order.fulfilment.ordered',
      'order.fulfilment.in_production',
      'order.fulfilment.shipped',
      'order.fulfilment.completed',
      'order.fulfilment.cancelled',
      'order.fulfilment.refund_review'
    )
    OR (
      order_id IS NOT NULL
      AND actor_id IS NULL
      AND project_id IS NULL
      AND update_id IS NULL
      AND comment_id IS NULL
    )
  )
  AND (
    order_id IS NULL
    OR type IN (
      'order.payment.succeeded',
      'order.payment.failed',
      'order.payment.expired',
      'order.payment.partially_refunded',
      'order.payment.refunded',
      'order.manual_review',
      'order.fulfilment.ordered',
      'order.fulfilment.in_production',
      'order.fulfilment.shipped',
      'order.fulfilment.completed',
      'order.fulfilment.cancelled',
      'order.fulfilment.refund_review'
    )
  )
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.notifications
VALIDATE CONSTRAINT notifications_product_target_ck;
--> statement-breakpoint
ALTER TABLE public.notifications
ADD CONSTRAINT notifications_product_payload_ck CHECK (
  (
    type <> 'update.published'
    AND order_id IS NULL
  )
  OR payload = '{"schemaVersion": 1}'::jsonb
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.notifications
VALIDATE CONSTRAINT notifications_product_payload_ck;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_notification_recipient_update()
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
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
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
--> statement-breakpoint

DROP POLICY notifications_select_recipient ON public.notifications;
--> statement-breakpoint
DROP POLICY notifications_update_recipient ON public.notifications;
--> statement-breakpoint
DROP POLICY notifications_delete_recipient ON public.notifications;
--> statement-breakpoint
DROP FUNCTION public.app_can_view_notification_target(uuid, uuid, uuid, uuid);
--> statement-breakpoint
CREATE FUNCTION public.app_can_view_notification_target(
  target_actor uuid,
  target_project uuid,
  target_update uuid,
  target_comment uuid,
  target_order uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.app_users viewer
      WHERE viewer.id = public.app_actor_id()
        AND viewer.status = 'active'
        AND viewer.deleted_at IS NULL
    )
    AND (
      target_actor IS NULL
      OR NOT public.app_users_are_blocked(public.app_actor_id(), target_actor)
    )
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
    AND (
      target_order IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.photobook_orders orders
        JOIN public.app_users owner_account
          ON owner_account.id = orders.owner_id
        WHERE orders.id = target_order
          AND orders.owner_id = public.app_actor_id()
          AND owner_account.status = 'active'
          AND owner_account.deleted_at IS NULL
      )
    )
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_can_view_notification_target(uuid, uuid, uuid, uuid, uuid)
FROM PUBLIC;
--> statement-breakpoint

CREATE POLICY notifications_select_recipient
ON public.notifications
FOR SELECT
USING (
  recipient_id = public.app_actor_id()
  AND public.app_can_view_notification_target(
    actor_id, project_id, update_id, comment_id, order_id
  )
);
--> statement-breakpoint
CREATE POLICY notifications_update_recipient
ON public.notifications
FOR UPDATE
USING (
  recipient_id = public.app_actor_id()
  AND public.app_can_view_notification_target(
    actor_id, project_id, update_id, comment_id, order_id
  )
)
WITH CHECK (
  recipient_id = public.app_actor_id()
  AND public.app_can_view_notification_target(
    actor_id, project_id, update_id, comment_id, order_id
  )
);
--> statement-breakpoint
CREATE POLICY notifications_delete_recipient
ON public.notifications
FOR DELETE
USING (
  recipient_id = public.app_actor_id()
  AND public.app_can_view_notification_target(
    actor_id, project_id, update_id, comment_id, order_id
  )
);
--> statement-breakpoint

CREATE FUNCTION public.app_enqueue_first_update_publication_notifications()
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
    JOIN public.user_relationships profile_follow
      ON profile_follow.target_user_id = project.owner_id
     AND profile_follow.kind = 'follow'
     AND profile_follow.status = 'active'
    JOIN public.app_users recipient
      ON recipient.id = profile_follow.source_user_id
    WHERE project.id = NEW.project_id
      AND project.owner_id = NEW.project_owner_id
      AND project.lifecycle_status = 'active'
      AND project.visibility IN (
        'public'::public.project_visibility,
        'followers'::public.project_visibility
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
--> statement-breakpoint
CREATE TRIGGER updates_enqueue_first_publication_notifications
AFTER INSERT OR UPDATE ON public.updates
FOR EACH ROW
EXECUTE FUNCTION public.app_enqueue_first_update_publication_notifications();
--> statement-breakpoint

CREATE FUNCTION public.app_enqueue_photobook_order_event_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  notification_type text;
  notification_id uuid;
BEGIN
  notification_type := CASE
    WHEN NEW.event_type = 'order.payment_succeeded.v1'
      THEN 'order.payment.succeeded'
    WHEN NEW.event_type = 'order.payment_failed.v1'
      THEN 'order.payment.failed'
    WHEN NEW.event_type IN (
      'order.checkout_expired.v1',
      'order.checkout_reservation_expired.v1'
    ) THEN 'order.payment.expired'
    WHEN NEW.event_type = 'order.refund_recorded.v1'
      AND NEW.payload_summary ->> 'outcome' = 'partially_refunded'
      THEN 'order.payment.partially_refunded'
    WHEN NEW.event_type = 'order.refund_recorded.v1'
      AND NEW.payload_summary ->> 'outcome' = 'refunded'
      THEN 'order.payment.refunded'
    WHEN NEW.event_type IN (
      'order.payment_succeeded_manual_review.v1',
      'order.stripe_reconciliation_failed.v1',
      'order.refund_reconciliation_failed.v1',
      'order.refund_out_of_order.v1',
      'manual_fulfilment.manual_review.v1'
    ) THEN 'order.manual_review'
    WHEN NEW.event_type = 'manual_fulfilment.ordered_manually.v1'
      THEN 'order.fulfilment.ordered'
    WHEN NEW.event_type = 'manual_fulfilment.mark_in_production.v1'
      THEN 'order.fulfilment.in_production'
    WHEN NEW.event_type = 'manual_fulfilment.mark_shipped.v1'
      THEN 'order.fulfilment.shipped'
    WHEN NEW.event_type = 'manual_fulfilment.mark_completed.v1'
      THEN 'order.fulfilment.completed'
    WHEN NEW.event_type = 'manual_fulfilment.cancel.v1'
      THEN 'order.fulfilment.cancelled'
    WHEN NEW.event_type = 'manual_fulfilment.refund_review.v1'
      THEN 'order.fulfilment.refund_review'
    ELSE NULL
  END;

  IF notification_type IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    recipient_id,
    order_id,
    type,
    dedupe_key,
    payload
  )
  SELECT
    orders.owner_id,
    orders.id,
    notification_type,
    'product-notification:v2:' || encode(
      public.digest(
        'photobook-order-event:' || NEW.id::text,
        'sha256'
      ),
      'hex'
    ),
    jsonb_build_object('schemaVersion', 1)
  FROM public.photobook_orders orders
  JOIN public.app_users owner_account
    ON owner_account.id = orders.owner_id
  WHERE orders.id = NEW.order_id
    AND owner_account.status = 'active'
    AND owner_account.deleted_at IS NULL
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NOT NULL THEN
    INSERT INTO public.outbox_events (
      aggregate_type,
      aggregate_id,
      event_type,
      idempotency_key,
      payload
    ) VALUES (
      'notification',
      notification_id,
      'product.notification.created.v1',
      'product-notification:' || notification_id::text,
      jsonb_build_object('schemaVersion', 1)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_photobook_order_event_notification()
FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER photobook_order_events_enqueue_product_notification
AFTER INSERT ON public.photobook_order_events
FOR EACH ROW
EXECUTE FUNCTION public.app_enqueue_photobook_order_event_notification();
--> statement-breakpoint

-- Legacy social and engagement notification dedupe keys hashed actor/recipient
-- identifiers without a server secret. Move their semantic identity into typed,
-- non-exported columns and keep the opaque key random. The partial unique
-- indexes preserve exact retry semantics without encoding people in a string.
ALTER TABLE public.notifications
ADD COLUMN source_aggregate_id uuid,
ADD COLUMN source_version integer,
ADD COLUMN source_occurred_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.notifications
ADD CONSTRAINT notifications_source_version_ck CHECK (
  source_version IS NULL OR source_version > 0
) NOT VALID;
--> statement-breakpoint
ALTER TABLE public.notifications
VALIDATE CONSTRAINT notifications_source_version_ck;
--> statement-breakpoint

UPDATE public.notifications
SET
  dedupe_key = NULL,
  updated_at = statement_timestamp()
WHERE dedupe_key LIKE 'social-notification:v1:%'
   OR dedupe_key LIKE 'engagement-notification:v1:%';
--> statement-breakpoint

CREATE UNIQUE INDEX notifications_social_version_recipient_uq
ON public.notifications(type, source_aggregate_id, source_version, recipient_id)
WHERE type IN (
  'profile.follow.requested',
  'profile.followed',
  'profile.follow.accepted',
  'profile.follow.rejected',
  'project.access.requested',
  'project.access.accepted',
  'project.access.rejected'
)
AND source_aggregate_id IS NOT NULL
AND source_version IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_project_follow_event_recipient_uq
ON public.notifications(
  type,
  source_aggregate_id,
  source_occurred_at,
  actor_id,
  recipient_id
)
WHERE type = 'project.followed'
  AND source_aggregate_id IS NOT NULL
  AND source_occurred_at IS NOT NULL
  AND actor_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_engagement_source_recipient_uq
ON public.notifications(type, source_aggregate_id, recipient_id)
WHERE type IN (
  'comment.created',
  'comment.reply',
  'comment.mention',
  'reaction.created'
)
AND source_aggregate_id IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_notification_recipient_update()
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
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.source_aggregate_id IS DISTINCT FROM OLD.source_aggregate_id
       OR NEW.source_version IS DISTINCT FROM OLD.source_version
       OR NEW.source_occurred_at IS DISTINCT FROM OLD.source_occurred_at
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.app_enqueue_social_notification(
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
  resolved_source_id uuid;
  resolved_source_version integer;
  resolved_source_occurred_at timestamptz;
  notification_id uuid;
  notification_dedupe text := 'social-notification:v2:' || gen_random_uuid()::text;
BEGIN
  IF actor_user IS NULL
     OR notification_recipient IS NULL
     OR actor_user = notification_recipient
     OR NOT EXISTS (
       SELECT 1 FROM public.app_users actor
       WHERE actor.id = actor_user
         AND actor.status = 'active'
         AND actor.deleted_at IS NULL
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
    SELECT relationship.id, relationship.version
    INTO resolved_source_id, resolved_source_version
    FROM public.user_relationships relationship
    WHERE relationship.source_user_id = actor_user
      AND relationship.target_user_id = notification_recipient
      AND relationship.kind = 'follow'
      AND relationship.status = CASE
        WHEN notification_type = 'profile.follow.requested'
          THEN 'pending'::public.relationship_status
        ELSE 'active'::public.relationship_status
      END;
  ELSIF notification_type IN ('profile.follow.accepted', 'profile.follow.rejected')
        AND notification_project IS NULL THEN
    SELECT relationship.id, relationship.version
    INTO resolved_source_id, resolved_source_version
    FROM public.user_relationships relationship
    WHERE relationship.source_user_id = notification_recipient
      AND relationship.target_user_id = actor_user
      AND relationship.kind = 'follow'
      AND relationship.status = CASE
        WHEN notification_type = 'profile.follow.accepted'
          THEN 'active'::public.relationship_status
        ELSE 'rejected'::public.relationship_status
      END;
  ELSIF notification_type = 'project.followed'
        AND notification_project IS NOT NULL THEN
    SELECT follower.project_id, follower.updated_at
    INTO resolved_source_id, resolved_source_occurred_at
    FROM public.project_followers follower
    JOIN public.projects project ON project.id = follower.project_id
    WHERE follower.project_id = notification_project
      AND follower.follower_id = actor_user
      AND follower.project_owner_id = notification_recipient
      AND follower.status = 'active'
      AND project.lifecycle_status = 'active';
  ELSIF notification_type = 'project.access.requested'
        AND notification_project IS NOT NULL THEN
    SELECT access_request.id, access_request.version
    INTO resolved_source_id, resolved_source_version
    FROM public.project_access_requests access_request
    WHERE access_request.project_id = notification_project
      AND access_request.requester_id = actor_user
      AND access_request.project_owner_id = notification_recipient
      AND access_request.status = 'pending';
  ELSIF notification_type IN ('project.access.accepted', 'project.access.rejected')
        AND notification_project IS NOT NULL THEN
    SELECT access_request.id, access_request.version
    INTO resolved_source_id, resolved_source_version
    FROM public.project_access_requests access_request
    WHERE access_request.project_id = notification_project
      AND access_request.requester_id = notification_recipient
      AND access_request.project_owner_id = actor_user
      AND access_request.status = CASE
        WHEN notification_type = 'project.access.accepted'
          THEN 'accepted'::public.access_request_status
        ELSE 'rejected'::public.access_request_status
      END;
  ELSE
    RAISE EXCEPTION 'unsupported social notification type' USING ERRCODE = '22023';
  END IF;

  IF resolved_source_id IS NULL THEN
    RAISE EXCEPTION 'social notification transition not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    project_id,
    source_aggregate_id,
    source_version,
    source_occurred_at,
    type,
    dedupe_key,
    payload
  ) VALUES (
    notification_recipient,
    actor_user,
    notification_project,
    resolved_source_id,
    resolved_source_version,
    resolved_source_occurred_at,
    notification_type,
    notification_dedupe,
    jsonb_build_object('schemaVersion', 1)
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
    INTO notification_id
    FROM public.notifications notification
    WHERE notification.recipient_id = notification_recipient
      AND notification.actor_id = actor_user
      AND notification.project_id IS NOT DISTINCT FROM notification_project
      AND notification.type = notification_type
      AND notification.source_aggregate_id = resolved_source_id
      AND notification.source_version IS NOT DISTINCT FROM resolved_source_version
      AND notification.source_occurred_at IS NOT DISTINCT FROM resolved_source_occurred_at
    ORDER BY notification.created_at DESC, notification.id DESC
    LIMIT 1;

    IF notification_id IS NULL THEN
      RAISE EXCEPTION 'social notification idempotency conflict' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.outbox_events (
      aggregate_type,
      aggregate_id,
      event_type,
      idempotency_key,
      payload
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_social_notification(uuid, text, uuid)
FROM PUBLIC;
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
  notification_dedupe text := 'engagement-notification:v2:' || gen_random_uuid()::text;
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
    WHERE reaction.id = source_aggregate
      AND reaction.actor_id = actor_user;

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

  INSERT INTO public.notifications (
    recipient_id,
    actor_id,
    project_id,
    update_id,
    comment_id,
    source_aggregate_id,
    type,
    dedupe_key,
    payload
  ) VALUES (
    notification_recipient,
    actor_user,
    target_project,
    target_update,
    target_comment,
    source_aggregate,
    notification_type,
    notification_dedupe,
    jsonb_build_object('schemaVersion', 1)
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
    INTO notification_id
    FROM public.notifications notification
    WHERE notification.recipient_id = notification_recipient
      AND notification.actor_id = actor_user
      AND notification.project_id = target_project
      AND notification.update_id = target_update
      AND notification.comment_id IS NOT DISTINCT FROM target_comment
      AND notification.type = notification_type
      AND notification.source_aggregate_id = source_aggregate
    ORDER BY notification.created_at DESC, notification.id DESC
    LIMIT 1;

    IF notification_id IS NULL THEN
      RAISE EXCEPTION 'engagement notification idempotency conflict' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.outbox_events (
      aggregate_type,
      aggregate_id,
      event_type,
      idempotency_key,
      payload
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
REVOKE ALL ON FUNCTION public.app_enqueue_engagement_notification(uuid, text, uuid)
FROM PUBLIC;

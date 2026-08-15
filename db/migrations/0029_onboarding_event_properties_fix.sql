-- The owner-facing onboarding completion signal carries no extra properties in
-- the integration contract; keep the event append-only but normalize payload.

CREATE OR REPLACE FUNCTION public.app_capture_product_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'auth_identity_mappings' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'signup_completed',
      'product-event:signup-completed:' || NEW.app_user_id::text,
      NEW.app_user_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'profiles' AND TG_OP = 'UPDATE' THEN
    IF OLD.onboarded_at IS NULL AND NEW.onboarded_at IS NOT NULL THEN
      INSERT INTO public.product_events (
        event_name, event_key, subject_hash, properties, occurred_at
      ) VALUES (
        'onboarding_completed',
        'product-event:onboarding-completed:' || NEW.user_id::text,
        public.app_product_event_subject_hash(NEW.user_id),
        '{}'::jsonb,
        clock_timestamp()
      )
      ON CONFLICT (event_key) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'projects' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'project_created',
      'product-event:project-created:' || NEW.id::text,
      NEW.owner_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'updates' AND TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.updates sibling
      WHERE sibling.project_id = NEW.project_id AND sibling.id <> NEW.id
    ) THEN
      PERFORM public.app_insert_product_event(
        'first_update_created',
        'product-event:first-update-created:' || NEW.project_id::text,
        NEW.author_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'media_assets' THEN
    IF NEW.purpose = 'project_media' AND NEW.status = 'ready' THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM public.app_insert_product_event(
          'photo_upload_completed',
          'product-event:photo-upload-completed:' || NEW.id::text,
          NEW.owner_id
        );
      ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'photo_upload_completed',
          'product-event:photo-upload-completed:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_relationships' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind = 'follow' AND NEW.status = 'pending' THEN
        PERFORM public.app_insert_product_event(
          'follow_requested',
          'product-event:follow-requested:' || NEW.id::text,
          NEW.source_user_id
        );
      END IF;
    ELSE
      IF NEW.kind = 'follow' AND NEW.status = 'pending'
        AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'follow_requested',
          'product-event:follow-requested:' || NEW.id::text,
          NEW.source_user_id
        );
      END IF;
      IF NEW.kind = 'follow' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
        PERFORM public.app_insert_product_event(
          'follow_accepted',
          'product-event:follow-accepted:' || NEW.id::text,
          NEW.source_user_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'comments' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'comment_created',
      'product-event:comment-created:' || NEW.id::text,
      NEW.author_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_drafts' THEN
    IF NEW.status = 'ready' THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM public.app_insert_product_event(
          'photobook_draft_generated',
          'product-event:photobook-draft-generated:' || NEW.id::text,
          NEW.owner_id
        );
      ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'photobook_draft_generated',
          'product-event:photobook-draft-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_revisions' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated',
          'product-event:proof-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.approved_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved',
          'product-event:proof-approved:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    ELSE
      IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated',
          'product-event:proof-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved',
          'product-event:proof-approved:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;
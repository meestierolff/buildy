-- The canonical relationship_status enum uses `active` for an accepted
-- profile follow. Earlier product-event trigger revisions compared that enum
-- with the nonexistent value `accepted`, causing every later relationship
-- update (including follower removal) to fail during enum coercion.

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
      PERFORM public.app_insert_product_event(
        'onboarding_completed',
        'product-event:onboarding-completed:' || NEW.user_id::text,
        NEW.user_id
      );
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
      IF NEW.kind = 'follow' AND OLD.status = 'pending' AND NEW.status = 'active' THEN
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
      IF NEW.status IN ('ready', 'approved', 'locked')
        AND OLD.status NOT IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated',
          'product-event:proof-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved',
          'product-event:proof-approved:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.stripe_checkout_session_id IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_started',
          'product-event:checkout-started:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.paid_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_completed',
          'product-event:checkout-completed:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    ELSE
      IF NEW.stripe_checkout_session_id IS NOT NULL
        AND OLD.stripe_checkout_session_id IS NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_started',
          'product-event:checkout-started:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_completed',
          'product-event:checkout-completed:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'feedback_submissions' AND TG_OP = 'INSERT' THEN
    IF NEW.kind = 'feedback' THEN
      PERFORM public.app_insert_product_event(
        'feedback_submitted',
        'product-event:feedback-submitted:' || NEW.id::text,
        NEW.submitted_by_id
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_capture_product_event() FROM PUBLIC;

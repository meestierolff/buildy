-- Allow an authenticated owner to complete onboarding exactly once while
-- preserving the server-managed profile fields and optimistic version guard.

CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version IS DISTINCT FROM 1
       OR NEW.is_pro
       OR NEW.onboarded_at IS NOT NULL THEN
      RAISE EXCEPTION 'profile server fields have invalid defaults'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'profile identity is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF public.app_actor_id() = OLD.user_id THEN
      IF NEW.is_pro IS DISTINCT FROM OLD.is_pro THEN
        RAISE EXCEPTION 'profile privilege fields are server-managed'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
         AND NOT (
           OLD.onboarded_at IS NULL
           AND NEW.onboarded_at IS NOT NULL
           AND NEW.onboarded_at >= statement_timestamp() - interval '5 seconds'
           AND NEW.onboarded_at <= statement_timestamp() + interval '1 second'
         ) THEN
        RAISE EXCEPTION 'profile onboarding can only be completed once'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
      RAISE EXCEPTION 'profile version must increment exactly once'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF NEW.avatar_asset_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.avatar_asset_id IS DISTINCT FROM OLD.avatar_asset_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.media_assets asset
       WHERE asset.id = NEW.avatar_asset_id
         AND asset.owner_id = NEW.user_id
         AND asset.project_id IS NULL
         AND asset.original_asset_id IS NULL
         AND asset.purpose = 'avatar'
         AND asset.status = 'ready'
         AND asset.is_current
         AND asset.exif_stripped
         AND asset.deleted_at IS NULL
         AND asset.ready_at IS NOT NULL
         AND asset.object_key LIKE 'originals/%'
         AND asset.detected_content_type LIKE 'image/%'
         AND asset.size_bytes IS NOT NULL
         AND asset.sha256 IS NOT NULL
         AND asset.width_pixels > 0
         AND asset.height_pixels > 0
     ) THEN
    RAISE EXCEPTION 'profile avatar asset is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_profile_privileges() FROM PUBLIC;

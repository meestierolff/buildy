-- Profile/account boundary: explicit avatar selection, immutable identity fields,
-- optimistic writes and a minimal idempotency ledger.

ALTER TABLE public.profiles
  ADD COLUMN avatar_asset_id uuid;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_owner_fk
  FOREIGN KEY (avatar_asset_id, user_id)
  REFERENCES public.media_assets(id, owner_id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_avatar_owner_fk;

CREATE INDEX profiles_avatar_idx ON public.profiles (avatar_asset_id);

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

    IF public.app_actor_id() = OLD.user_id
       AND (
         NEW.is_pro IS DISTINCT FROM OLD.is_pro
         OR NEW.onboarded_at IS DISTINCT FROM OLD.onboarded_at
       ) THEN
      RAISE EXCEPTION 'profile privilege fields are server-managed'
        USING ERRCODE = '42501';
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

DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
CREATE TRIGGER profiles_guard_privileges
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

CREATE OR REPLACE FUNCTION public.guard_linked_avatar_asset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.avatar_asset_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'linked avatar asset cannot be deleted'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.original_asset_id IS DISTINCT FROM OLD.original_asset_id
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
       OR NEW.bucket IS DISTINCT FROM OLD.bucket
       OR NEW.object_key IS DISTINCT FROM OLD.object_key
       OR NEW.storage_version IS DISTINCT FROM OLD.storage_version
       OR NEW.detected_content_type IS DISTINCT FROM OLD.detected_content_type
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.width_pixels IS DISTINCT FROM OLD.width_pixels
       OR NEW.height_pixels IS DISTINCT FROM OLD.height_pixels
       OR NEW.exif_stripped IS DISTINCT FROM OLD.exif_stripped
       OR NEW.is_current IS DISTINCT FROM OLD.is_current
       OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code THEN
      RAISE EXCEPTION 'linked avatar asset is immutable until unlinked'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS media_assets_guard_linked_avatar ON public.media_assets;
CREATE TRIGGER media_assets_guard_linked_avatar
BEFORE UPDATE OR DELETE ON public.media_assets
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_avatar_asset();

CREATE POLICY outbox_events_select_profile_mutation
ON public.outbox_events
FOR SELECT
USING (
  aggregate_type = 'profile'
  AND aggregate_id = public.app_actor_id()
);

CREATE POLICY outbox_events_insert_profile_mutation
ON public.outbox_events
FOR INSERT
WITH CHECK (
  aggregate_type = 'profile'
  AND aggregate_id = public.app_actor_id()
  AND event_type = 'profile.updated.v1'
  AND idempotency_key ~ '^profile-command:v1:profile\.update:[0-9a-f]{64}$'
  AND payload ->> 'schemaVersion' = '1'
  AND payload ->> 'requestHash' ~ '^[0-9a-f]{64}$'
  AND payload ->> 'profileVersion' ~ '^[1-9][0-9]*$'
  AND payload - ARRAY['schemaVersion', 'requestHash', 'profileVersion'] = '{}'::jsonb
);

REVOKE ALL ON FUNCTION public.guard_profile_privileges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_linked_avatar_asset() FROM PUBLIC;

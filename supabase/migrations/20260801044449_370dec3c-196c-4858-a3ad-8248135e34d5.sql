ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS cover_storage_path text,
  ADD COLUMN IF NOT EXISTS floorplan_storage_path text;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_cover_storage_path_check;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_cover_storage_path_check CHECK (
    cover_storage_path IS NULL
    OR cover_storage_path LIKE user_id::text || '/trip-assets/' || id::text || '/covers/%'
  ) NOT VALID;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_floorplan_storage_path_check;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_floorplan_storage_path_check CHECK (
    floorplan_storage_path IS NULL
    OR floorplan_storage_path LIKE user_id::text || '/trip-assets/' || id::text || '/floorplans/%'
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS follows_user_project_key ON public.follows (user_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_follows_follower_following_key ON public.user_follows (follower_id, following_id);

CREATE OR REPLACE FUNCTION public.request_project_follow(_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requester uuid := auth.uid();
  result_status text;
BEGIN
  IF requester IS NULL THEN
    RAISE EXCEPTION 'Log in om een project te volgen';
  END IF;

  INSERT INTO public.follows (user_id, project_id, status)
  VALUES (requester, _project_id, 'pending')
  ON CONFLICT (user_id, project_id) DO NOTHING;

  SELECT f.status INTO result_status
  FROM public.follows f
  WHERE f.user_id = requester AND f.project_id = _project_id;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'Volgverzoek kon niet worden opgeslagen';
  END IF;
  RETURN result_status;
END
$$;

CREATE OR REPLACE FUNCTION public.request_user_follow(_following_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requester uuid := auth.uid();
  result_status text;
BEGIN
  IF requester IS NULL THEN
    RAISE EXCEPTION 'Log in om iemand te volgen';
  END IF;

  INSERT INTO public.user_follows (follower_id, following_id, status)
  VALUES (requester, _following_id, 'pending')
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  SELECT uf.status INTO result_status
  FROM public.user_follows uf
  WHERE uf.follower_id = requester AND uf.following_id = _following_id;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'Volgverzoek kon niet worden opgeslagen';
  END IF;
  RETURN result_status;
END
$$;

CREATE OR REPLACE FUNCTION public.respond_to_project_follow(
  _project_id uuid,
  _follower_id uuid,
  _accept boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  responder uuid := auth.uid();
BEGIN
  IF responder IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = _project_id AND t.user_id = responder
  ) THEN
    RAISE EXCEPTION 'Alleen de projecteigenaar kan dit verzoek behandelen';
  END IF;

  IF _accept THEN
    UPDATE public.follows f
    SET status = 'accepted'
    WHERE f.project_id = _project_id
      AND f.user_id = _follower_id
      AND f.status = 'pending';
  ELSE
    DELETE FROM public.follows f
    WHERE f.project_id = _project_id
      AND f.user_id = _follower_id
      AND f.status = 'pending';
  END IF;
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.respond_to_user_follow(
  _follower_id uuid,
  _accept boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  responder uuid := auth.uid();
BEGIN
  IF responder IS NULL THEN
    RAISE EXCEPTION 'Log in om dit verzoek te behandelen';
  END IF;

  IF _accept THEN
    UPDATE public.user_follows uf
    SET status = 'accepted'
    WHERE uf.follower_id = _follower_id
      AND uf.following_id = responder
      AND uf.status = 'pending';
  ELSE
    DELETE FROM public.user_follows uf
    WHERE uf.follower_id = _follower_id
      AND uf.following_id = responder
      AND uf.status = 'pending';
  END IF;
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION public.request_project_follow(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_user_follow(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_project_follow(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_user_follow(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_project_follow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_user_follow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_project_follow(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_user_follow(uuid, boolean) TO authenticated;
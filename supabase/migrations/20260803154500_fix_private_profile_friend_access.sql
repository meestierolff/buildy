-- ---------------------------------------------------------------------------
-- Fix private profile access for accepted friends (user_follows in either direction)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_view_profile(_profile_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = _profile_user_id
      AND (
        p.is_private = false
        OR p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.user_follows uf
          WHERE (
            (uf.following_id = p.user_id AND uf.follower_id = auth.uid())
            OR
            (uf.follower_id = p.user_id AND uf.following_id = auth.uid())
          )
          AND uf.status = 'accepted'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid) TO anon, authenticated;

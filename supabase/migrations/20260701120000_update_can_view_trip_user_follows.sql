-- Update can_view_trip so that accepted user followers can see all trips of the followed user
CREATE OR REPLACE FUNCTION public.can_view_trip(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = _trip_id
      AND (
        t.is_public = true
        OR t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.project_id = t.id
            AND f.user_id = auth.uid()
            AND f.status = 'accepted'
        )
        OR EXISTS (
          SELECT 1 FROM public.user_follows uf
          WHERE uf.following_id = t.user_id
            AND uf.follower_id = auth.uid()
            AND uf.status = 'accepted'
        )
      )
  )
$$;

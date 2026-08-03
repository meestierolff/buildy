DROP POLICY IF EXISTS "Users can follow or request to follow any project" ON public.follows;
CREATE POLICY "Users can follow or request to follow any project"
ON public.follows FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = follows.project_id
      AND (
        (follows.status = 'accepted' AND t.is_public = true)
        OR (follows.status = 'pending' AND t.is_public = false)
      )
  )
);

DROP POLICY IF EXISTS "Users can follow others" ON public.user_follows;
CREATE POLICY "Users can follow others"
ON public.user_follows FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = follower_id
  AND follower_id <> following_id
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = user_follows.following_id)
);

REVOKE UPDATE, DELETE ON public.photobook_orders FROM anon, authenticated;
GRANT ALL ON public.photobook_orders TO service_role;
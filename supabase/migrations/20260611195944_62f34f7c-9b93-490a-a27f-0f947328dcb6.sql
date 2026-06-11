DROP POLICY IF EXISTS "Follows readable by owner of follow or project owner" ON public.follows;
CREATE POLICY "Follows readable by owner, project owner or public trip"
ON public.follows FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = follows.project_id AND t.user_id = auth.uid())
  OR public.can_view_trip(project_id)
);

DROP POLICY IF EXISTS "Authenticated users can view user follows" ON public.user_follows;
CREATE POLICY "Users can view their own follow relationships"
ON public.user_follows FOR SELECT
TO authenticated
USING (auth.uid() = follower_id OR auth.uid() = following_id);
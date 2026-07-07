DROP POLICY IF EXISTS "Users can follow or request to follow any project" ON public.follows;
CREATE POLICY "Users can follow or request to follow any project"
ON public.follows FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status IN ('pending','accepted')
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = follows.project_id)
);
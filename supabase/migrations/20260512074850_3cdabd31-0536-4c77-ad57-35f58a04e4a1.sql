DROP POLICY IF EXISTS "Users can create steps on own trips" ON public.steps;
DROP POLICY IF EXISTS "Users can update own steps" ON public.steps;
DROP POLICY IF EXISTS "Users can delete own steps" ON public.steps;

CREATE POLICY "Project owners can create steps"
ON public.steps
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = steps.trip_id
      AND t.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners can update steps"
ON public.steps
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = steps.trip_id
      AND t.user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = steps.trip_id
      AND t.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners can delete steps"
ON public.steps
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = steps.trip_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can add media to own steps" ON public.step_media;
DROP POLICY IF EXISTS "Users can delete own media" ON public.step_media;

CREATE POLICY "Project owners can add media to steps"
ON public.step_media
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = step_media.step_id
      AND t.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners can delete media from steps"
ON public.step_media
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = step_media.step_id
      AND t.user_id = auth.uid()
  )
);

CREATE POLICY "Project owners can reorder media"
ON public.step_media
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = step_media.step_id
      AND t.user_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = step_media.step_id
      AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated users can like" ON public.likes;
CREATE POLICY "Users can like visible steps"
ON public.likes
FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.can_view_step(step_id));

DROP POLICY IF EXISTS "Auth users can react" ON public.reactions;
CREATE POLICY "Users can react to visible steps"
ON public.reactions
FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.can_view_step(step_id));

DROP POLICY IF EXISTS "Authenticated users can comment" ON public.comments;
CREATE POLICY "Users can comment on visible steps"
ON public.comments
FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.can_view_step(step_id));

DROP POLICY IF EXISTS "Users can add own favorites" ON public.favorites;
CREATE POLICY "Users can favorite visible projects"
ON public.favorites
FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.can_view_trip(project_id));

DROP POLICY IF EXISTS "Users can follow projects" ON public.follows;
CREATE POLICY "Users can follow visible projects"
ON public.follows
FOR INSERT
WITH CHECK (auth.uid() = user_id AND public.can_view_trip(project_id));
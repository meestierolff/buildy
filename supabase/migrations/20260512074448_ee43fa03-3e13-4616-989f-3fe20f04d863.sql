CREATE OR REPLACE FUNCTION public.can_view_trip(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = _trip_id
    AND (is_public = true OR user_id = auth.uid())
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_step(_step_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = _step_id
    AND (t.is_public = true OR t.user_id = auth.uid())
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_view_trip(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_step(uuid) TO anon, authenticated;
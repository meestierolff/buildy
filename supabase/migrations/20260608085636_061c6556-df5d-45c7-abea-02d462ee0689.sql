CREATE OR REPLACE FUNCTION public.can_view_budget(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = _trip_id
      AND (
        t.user_id = auth.uid()
        OR (public.can_view_trip(t.id) AND t.budget_public = true)
      )
  )
$$;
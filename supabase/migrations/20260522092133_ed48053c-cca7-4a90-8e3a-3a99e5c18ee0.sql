
ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS cost numeric,
  ADD COLUMN IF NOT EXISTS hours_spent numeric,
  ADD COLUMN IF NOT EXISTS work_type text;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS budget_public boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_view_budget(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips
    WHERE id = _trip_id
      AND (user_id = auth.uid() OR (is_public = true AND budget_public = true))
  )
$$;

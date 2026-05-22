
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS budget_total numeric;
